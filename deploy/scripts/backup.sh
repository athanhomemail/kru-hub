#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
umask 077
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)-$$
base="backups/kruhub-$stamp"
resume=''
for service in $(sh deploy/scripts/compose.sh ps --status running --services); do
  case "$service" in api|web) resume="$resume $service" ;; esac
done
cleanup() {
  result=$?
  trap - EXIT
  rm -f "$base.tmp.sql" "$base.tmp.sql.gz" "$base.tmp.uploads.tar.gz" "$base.tmp.sha256"
  if [ -n "$resume" ]; then
    # Service names come only from the api/web whitelist above.
    if ! sh deploy/scripts/compose.sh up -d --wait $resume; then
      printf '%s\n' 'Backup finished, but services failed to restart. Inspect service logs.' >&2
      result=1
    fi
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
# Freeze application writes so the DB and uploaded files describe the same state.
if [ -n "$resume" ]; then sh deploy/scripts/compose.sh stop $resume; fi
sh deploy/scripts/compose.sh exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --triggers --no-tablespaces --set-gtid-purged=OFF kruhub' > "$base.tmp.sql"
gzip -c "$base.tmp.sql" > "$base.tmp.sql.gz"
sh deploy/scripts/compose.sh run --rm --no-deps -T api sh -c 'tar -czf - -C /app/uploads .' > "$base.tmp.uploads.tar.gz"
mv "$base.tmp.sql.gz" "$base.sql.gz"
mv "$base.tmp.uploads.tar.gz" "$base.uploads.tar.gz"
sha256sum "$base.sql.gz" "$base.uploads.tar.gz" > "$base.tmp.sha256"
mv "$base.tmp.sha256" "$base.sha256"
printf 'Backup saved: %s.sql.gz + %s.uploads.tar.gz + checksum\n' "$base" "$base"
