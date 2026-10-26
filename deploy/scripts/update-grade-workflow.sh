#!/bin/sh
# One-time transition for the explicitly reviewed school/term/grade source plan.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
if [ -n "$(git status --porcelain)" ]; then printf '%s\n' 'Working tree has changes; review before updating.' >&2; exit 1; fi
branch=$(sed -n 's/^UPDATE_BRANCH=//p' deploy/.env | tail -n 1)
branch=${branch:-main}
if [ "$(git branch --show-current)" != "$branch" ]; then printf '%s\n' 'Current branch differs from UPDATE_BRANCH.' >&2; exit 1; fi
mkdir -p backups
lock="$root/backups/.update-lock"
if ! mkdir "$lock" 2>/dev/null; then printf '%s\n' 'Another update is running.' >&2; exit 1; fi
resume_old=''
cleanup(){
 result=$?
 trap - EXIT
 if [ -n "$resume_old" ]; then sh deploy/scripts/compose.sh start $resume_old || result=1; fi
 rmdir "$lock"
 exit "$result"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
git pull --ff-only origin "$branch"
plan=$(cat backend/scripts/plans/grade-transition-20261026.json)
check_sources(){
 sh deploy/scripts/compose.sh exec -T -e KRUHUB_MERGE_STDIN=1 -e "KRUHUB_GRADE_PLAN=$plan" api node --input-type=module - --check < backend/scripts/merge-legacy-grades.mjs
}
printf '%s\n' 'Checking grade sources and teacher conflicts before making changes...'
initial=$(check_sources)
printf '%s\n' "$initial"
sh deploy/scripts/backup.sh
sh deploy/scripts/compose.sh build api web
for service in $(sh deploy/scripts/compose.sh ps --status running --services); do
 case "$service" in api|web) resume_old="$resume_old $service" ;; esac
done
# Freeze Kru-Hub only. Existing containers retain the old image for pre-migration recovery.
sh deploy/scripts/compose.sh stop web api
frozen=$(sh deploy/scripts/compose.sh run --rm --no-deps -T -e "KRUHUB_GRADE_PLAN=$plan" api node scripts/merge-legacy-grades.mjs --check)
if [ "$initial" != "$frozen" ]; then printf '%s\n' 'Source data changed during preparation. Old services will restart; review before retrying.' >&2; exit 1; fi
umask 077
stamp=$(date -u +%Y%m%dT%H%M%SZ)-$$
printf '%s\n' "$frozen" > "backups/grade-transition-$stamp.preflight.json"
# After schema writes start, keep the app stopped on failure for deliberate recovery.
resume_old=''
if ! sh deploy/scripts/compose.sh run --rm --no-deps -T api npm run migrate; then
 printf '%s\n' 'Migration failed. Kru-Hub remains stopped; inspect the backup and logs.' >&2; exit 1
fi
if ! sh deploy/scripts/compose.sh run --rm --no-deps -T -e "KRUHUB_GRADE_PLAN=$plan" -e "KRUHUB_GRADE_EXPECTED=$frozen" api node scripts/merge-legacy-grades.mjs --apply > "backups/grade-transition-$stamp.result.json"; then
 printf '%s\n' 'Grade merge failed. Kru-Hub remains stopped; original timetables are preserved. Inspect logs before recovery.' >&2; exit 1
fi
cat "backups/grade-transition-$stamp.result.json"
sh deploy/scripts/compose.sh up -d --wait
printf '%s\n' 'Updated. Grade 5 is completed, grade 4 is in progress, original lessons are preserved.'
