#!/usr/bin/env bash
set -Eeuo pipefail
archive=${1:?Usage: deploy.sh /tmp/package.zip sha256}
expected=${2:?Missing SHA256}
[[ $(id -u) == 0 && "$archive" == /tmp/*.zip && "$expected" =~ ^[a-fA-F0-9]{64}$ ]]
printf '%s  %s\n' "$expected" "$archive" | sha256sum --check --status
base=/opt/modern-art
[[ -d "$base/app" && -d /var/lib/modern-art && -x /opt/node/bin/node ]]
[[ $(systemctl show modern-art -p User --value) == modernart ]]
[[ $(systemctl show modern-art -p WorkingDirectory --value) == "$base/app" ]]
systemctl is-active --quiet modern-art
getent passwd modernart >/dev/null
stamp=$(date -u +%Y%m%dT%H%M%SZ)-$$
stage=$(mktemp -d "$base/.deploy-XXXXXX")
retired="$base/app.prev.retired-$stamp"
backup="/var/lib/modern-art.bak-$stamp"
stopped=0
old_moved=0
new_moved=0
health() {
  for attempt in $(seq 1 15); do
    if systemctl is-active --quiet modern-art &&
       curl --fail --silent --max-time 2 http://127.0.0.1:28787/health | /opt/node/bin/node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(s);process.exit(j.ok===true&&j.service==="modern-art"?0:1)}catch{process.exit(1)}})'; then
      return 0
    fi
    sleep 1
  done
  return 1
}
recover() {
  code=$?
  trap - ERR
  set +e
  if (( stopped )); then
    systemctl stop modern-art
    if (( new_moved )); then mv "$base/app" "$base/app.failed-$stamp"; fi
    if (( old_moved )); then mv "$base/app.prev" "$base/app"; fi
    if [[ -d "$retired" && ! -e "$base/app.prev" ]]; then mv "$retired" "$base/app.prev"; fi
    systemctl start modern-art
    if health; then echo 'Previous service restored.' >&2; else echo 'Recovery health check failed; inspect service immediately.' >&2; fi
  fi
  echo "Deployment failed (exit $code). Stage: $stage; backup if created: $backup" >&2
  exit "$code"
}
trap recover ERR
# Require the expected top-level directory and reject archive path traversal.
python3 - "$archive" <<'PY'
import sys
from zipfile import ZipFile
from pathlib import PurePosixPath
with ZipFile(sys.argv[1]) as z:
    for info in z.infolist():
        p = PurePosixPath(info.filename)
        assert not p.is_absolute() and '..' not in p.parts and p.parts[0] == 'modern-art'
        assert '\\' not in info.filename
        assert (info.external_attr >> 16) & 0o170000 != 0o120000
PY
unzip -q "$archive" -d "$stage"
[[ -f "$stage/modern-art/dist/index.html" && -f "$stage/modern-art/package-lock.json" ]]
chown -R modernart:modernart "$stage"
cd "$stage/modern-art"
runuser -u modernart -- env PATH=/opt/node/bin:/usr/bin:/bin npm_config_registry=https://registry.npmmirror.com npm ci --omit=dev --install-links --no-audit --no-fund
runuser -u modernart -- /opt/node/bin/node --check server/index.js
runuser -u modernart -- /opt/node/bin/node --input-type=module -e 'await import("ws");await import("./packages/modern-art/src/rules.js")'
printf '%s\n' "$expected" > DEPLOYED_SHA256
chown modernart:modernart DEPLOYED_SHA256
cd "$base"
stopped=1
systemctl stop modern-art
cp -a /var/lib/modern-art "$backup"
if [[ -e "$base/app.prev" ]]; then mv "$base/app.prev" "$retired"; fi
mv "$base/app" "$base/app.prev"
old_moved=1
mv "$stage/modern-art" "$base/app"
new_moved=1
systemctl start modern-art
health
curl --fail --silent --max-time 5 http://127.0.0.1:28787/ | cmp - "$base/app/dist/index.html"
stopped=0
trap - ERR
# Only remove the known retired rollback directory after a healthy replacement.
if [[ -d "$retired" && "$retired" == /opt/modern-art/app.prev.retired-* ]]; then rm -rf -- "$retired"; fi
rmdir "$stage"
printf 'DEPLOYED=%s\nDATA_BACKUP=%s\nROLLBACK=%s/app.prev\n' "$expected" "$backup" "$base"
systemctl is-active modern-art
