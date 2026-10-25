#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
if [ -n "$(git status --porcelain)" ]; then printf '%s\n' 'Working tree has changes; review before updating.' >&2; exit 1; fi
# Use a directory lock, portable on macOS and Linux. Not tracked by Git.
lock="$root/backups/.update-lock"
mkdir -p backups
if ! mkdir "$lock" 2>/dev/null; then printf '%s\n' 'An update is already running; inspect backups/.update-lock if interrupted.' >&2; exit 1; fi
cleanup() { rmdir "$lock"; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
branch=$(sed -n 's/^UPDATE_BRANCH=//p' deploy/.env | tail -n 1)
branch=${branch:-main}
if [ "$(git branch --show-current)" != "$branch" ]; then printf '%s\n' 'Current branch differs from UPDATE_BRANCH.' >&2; exit 1; fi
sh deploy/scripts/backup.sh
git pull --ff-only origin "$branch"
sh deploy/scripts/compose.sh build api web
# Keep the old version from writing while schema changes are applied.
sh deploy/scripts/compose.sh stop web api
if ! sh deploy/scripts/compose.sh run --rm --no-deps api npm run migrate; then
  printf '%s\n' 'Migration failed. API/web remain stopped; inspect logs and backup before recovery.' >&2; exit 1
fi
sh deploy/scripts/compose.sh up -d --wait
printf '%s\n' 'Updated. Database migration and service health checks passed.'
