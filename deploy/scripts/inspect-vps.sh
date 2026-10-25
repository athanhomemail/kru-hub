#!/bin/sh
# Read-only inventory. Never reads .env files or container environments.
set -u
section() { printf '\n=== %s ===\n' "$1"; }
section 'Host and resources'
uname -sm
uptime
free -h 2>/dev/null || true
df -h / /var/lib/docker 2>/dev/null || true
section 'Listening TCP ports'
ss -ltn 2>/dev/null || true
section 'Docker versions and projects'
docker --version 2>/dev/null || true
docker compose version 2>/dev/null || true
docker compose ls 2>/dev/null || true
section 'Containers (no secrets)'
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true
section 'Current container resource usage'
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' 2>/dev/null || true
section 'Nginx host routing (selected directives only)'
if command -v nginx >/dev/null 2>&1; then
  nginx -t 2>&1 || true
  nginx -T 2>/dev/null | awk '/^# configuration file / || /^[[:space:]]*(listen|server_name|proxy_pass)[[:space:]]/ {print}'
else
  printf '%s\n' 'No host nginx command found. Check listed proxy containers.'
fi
section 'DNS as seen from VPS'
if command -v getent >/dev/null 2>&1; then
  getent ahostsv4 kruhub.twiniiz.com 2>/dev/null || true
  getent ahostsv6 kruhub.twiniiz.com 2>/dev/null || true
fi
