#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
mode=${1:-deploy}
case "$mode" in deploy|local) ;; *) printf '%s\n' 'Usage: init-env.sh [deploy|local]' >&2; exit 1 ;; esac
if [ "$mode" = local ]; then output="$root/docker/.env"; else output="$root/deploy/.env"; fi
if [ -e "$output" ]; then printf '%s\n' 'Environment file exists; refusing to overwrite.' >&2; exit 1; fi
command -v openssl >/dev/null
umask 077
{
  if [ "$mode" = local ]; then printf 'MYSQL_PORT=3309\n'; else
    printf 'WEB_PORT=8082\nFRONTEND_URL=https://kruhub.twiniiz.com\nUPDATE_BRANCH=main\nSUPER_ADMIN_USERNAME=owner\n'
    printf 'SUPER_ADMIN_INITIAL_PASSWORD=%s\n' "$(openssl rand -hex 16)"
  fi
  printf 'MYSQL_PASSWORD=%s\n' "$(openssl rand -hex 32)"
  printf 'MYSQL_ROOT_PASSWORD=%s\n' "$(openssl rand -hex 32)"
} > "$output"
printf 'Created %s (permission 600).\n' "$output"
