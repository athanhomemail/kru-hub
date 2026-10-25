#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
domain=$(sed -n 's/^FRONTEND_URL=//p' deploy/.env | tail -n 1)
case "$domain" in
  *replace-with*) printf '%s\n' 'Set FRONTEND_URL to your real HTTPS domain first.' >&2; exit 1 ;;
  https://?*) ;;
  *) printf '%s\n' 'FRONTEND_URL must be a real HTTPS URL.' >&2; exit 1 ;;
esac
sh deploy/scripts/compose.sh config --quiet
sh deploy/scripts/compose.sh up -d --wait db
sh deploy/scripts/compose.sh build api web
sh deploy/scripts/compose.sh run --rm --no-deps api npm run migrate
sh deploy/scripts/compose.sh run --rm --no-deps api npm run bootstrap
sh deploy/scripts/compose.sh up -d --wait
sh deploy/scripts/compose.sh ps
