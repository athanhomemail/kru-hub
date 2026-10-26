#!/bin/sh
# Run on the developer Mac. Download only, without updating or stopping the VPS.
set -eu
umask 077
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
stamp=$(date -u +%Y%m%dT%H%M%SZ)-$$
destination="$root/backups/vps-kruhub-full-$stamp"
mkdir -p "$destination"
cleanup() { rm -f "$destination/database.tmp.sql" "$destination/database.sql.gz.partial" "$destination/uploads.tar.gz.partial"; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

printf '%s\n' '1/2 Downloading a consistent database snapshot. Enter your VPS SSH password if prompted.'
ssh -o ConnectTimeout=15 root@143.14.9.30 'sh -s' <<'REMOTE' > "$destination/database.tmp.sql"
set -eu
cd /srv/apps/kruhub
sh deploy/scripts/compose.sh exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --quick --no-tablespaces --set-gtid-purged=OFF --skip-add-locks --hex-blob kruhub'
REMOTE
if ! test -s "$destination/database.tmp.sql" || ! head -n 5 "$destination/database.tmp.sql" | grep -q 'MySQL dump'; then
 printf '%s\n' 'Database snapshot is empty or unrecognized. Download aborted.' >&2; exit 1
fi
gzip -c "$destination/database.tmp.sql" > "$destination/database.sql.gz.partial"
gzip -t "$destination/database.sql.gz.partial"
mv "$destination/database.sql.gz.partial" "$destination/database.sql.gz"
rm "$destination/database.tmp.sql"

printf '%s\n' '2/2 Downloading all Kru-Hub uploads. You may be asked for your SSH password again.'
ssh -o ConnectTimeout=15 root@143.14.9.30 'sh -s' <<'REMOTE' > "$destination/uploads.tar.gz.partial"
set -eu
cd /srv/apps/kruhub
sh deploy/scripts/compose.sh exec -T api sh -c 'tar -czf - -C /app/uploads .'
REMOTE
gzip -t "$destination/uploads.tar.gz.partial"
tar -tzf "$destination/uploads.tar.gz.partial" > /dev/null
mv "$destination/uploads.tar.gz.partial" "$destination/uploads.tar.gz"
(
 cd "$destination"
 shasum -a 256 database.sql.gz uploads.tar.gz > SHA256SUMS
)
printf '\nDownload complete. Snapshot folder:\n%s\n' "$destination"
printf '%s\n' 'Contains database.sql.gz, uploads.tar.gz and SHA256SUMS.'
printf '%s\n' 'The VPS was not updated or stopped. No local database or environment file was changed.'
printf '%s\n' 'Avoid edits/uploads on the VPS during this download: the database and upload archive are read separately.'
printf '%s\n' 'Send only this folder path back to your assistant. Do not upload the database or files to Git or chat.'
