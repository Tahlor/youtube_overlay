#!/usr/bin/env bash
set -euo pipefail
# Archimedes code-only promotion. Runtime data, .env and host configuration are untouched.
source_dir=$(cd "$(dirname "$0")/.." && pwd)
run_dir=${1:?Usage: scripts/deploy.sh RUN_DIRECTORY}
production=/home/ubuntu/Projects/youtube_overlay
service=app-youtube-overlay.service
commit=$(git -C "$source_dir" rev-parse HEAD)
git -C "$source_dir" diff --quiet
git -C "$source_dir" diff --cached --quiet
node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1]));if(b.commit!==process.argv[2])process.exit(1)' "$source_dir/dist/build.json" "$commit"
mkdir -p "$run_dir"
run_dir=$(cd "$run_dir" && pwd)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
stage="$run_dir/release-$stamp"
backup="$run_dir/rollback-$stamp"
mkdir -p "$stage" "$backup/original" "$backup/retired"
paths=(src server public dist dist-server node_modules package.json package-lock.json tsconfig.json tsconfig.server.json vite.config.ts index.html README.md docs scripts .env.example)
for item in "${paths[@]}"; do
  if [[ "$item" != node_modules && -e "$source_dir/$item" ]]; then cp -a "$source_dir/$item" "$stage/$item"; fi
done
(cd "$stage" && npm ci --omit=dev)
# Confirm the exact packaged runtime before any stop or promotion.
(cd "$stage" && exec env HOST=127.0.0.1 PORT=13051 BASE_PATH=/youtube_overlay DATA_PATH="$stage/smoke.sqlite" /usr/bin/node dist-server/server/index.js) > "$stage/smoke.log" 2>&1 &
smoke_pid=$!
trap 'kill "$smoke_pid" 2>/dev/null || true' EXIT
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:13051/youtube_overlay/api/healthz > "$stage/health.json"; then break; fi
  sleep .2
done
node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1]));if(!b.ok||b.build.commit!==process.argv[2])process.exit(1)' "$stage/health.json" "$commit"
kill "$smoke_pid"; wait "$smoke_pid" || true
trap - EXIT
rm -f "$stage/smoke.sqlite" "$stage/smoke.sqlite-wal" "$stage/smoke.sqlite-shm"
# Copy all original code before promotion so rollback also handles a partial swap.
for item in "${paths[@]}"; do
  if [[ -e "$production/$item" ]]; then cp -a "$production/$item" "$backup/original/$item"; fi
done
printf '%s\n' "${paths[@]}" > "$backup/paths.txt"
cat > "$backup/restore.sh" <<'RESTORE'
#!/usr/bin/env bash
set -euo pipefail
backup=$(cd "$(dirname "$0")" && pwd)
production=/home/ubuntu/Projects/youtube_overlay
failed="$backup/failed-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$failed"
sudo -n systemctl stop app-youtube-overlay.service
while IFS= read -r item; do
  if [[ -e "$production/$item" ]]; then mv "$production/$item" "$failed/$item"; fi
  if [[ -e "$backup/original/$item" ]]; then cp -a "$backup/original/$item" "$production/$item"; fi
done < "$backup/paths.txt"
sudo -n systemctl start app-youtube-overlay.service
RESTORE
chmod +x "$backup/restore.sh"
printf '%s\n' "$backup" > "$run_dir/rollback-path.txt"
promoting=false
rollback() {
  if [[ "$promoting" == true ]]; then
    echo 'Promotion failed; restoring original code.' >&2
    "$backup/restore.sh"
  fi
}
trap rollback ERR
sudo -n systemctl stop "$service"
promoting=true
for item in "${paths[@]}"; do
  if [[ -e "$production/$item" ]]; then mv "$production/$item" "$backup/retired/$item"; fi
  if [[ -e "$stage/$item" ]]; then mv "$stage/$item" "$production/$item"; fi
done
sudo -n systemctl start "$service"
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:13050/youtube_overlay/api/healthz > "$run_dir/deployed-health.json"; then break; fi
  sleep .3
done
node -e 'const h=JSON.parse(require("fs").readFileSync(process.argv[1]));if(!h.ok||h.persistence!=="ok"||h.build.commit!==process.argv[2])process.exit(1)' "$run_dir/deployed-health.json" "$commit"
promoting=false
trap - ERR
printf 'Deployed %s\nRollback: %s/restore.sh\n' "$commit" "$backup"
