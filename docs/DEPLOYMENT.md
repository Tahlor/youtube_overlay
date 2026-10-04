# Archimedes Deployment

The M0–M3 application is deployed on Archimedes as a single Node process behind the existing nginx frontend.

## Production endpoints

- App root: `https://taylorarchibald.com/youtube_overlay/`
- Director: `https://taylorarchibald.com/youtube_overlay/director`
- TV output: `https://taylorarchibald.com/youtube_overlay/output`
- Android TV APK: `https://taylorarchibald.com/youtube_overlay/downloads/youtube-overlay-tv.apk`
- Phone join: a source-specific link generated in Director (`/youtube_overlay/phone?source=…&token=…`)
- Health: `https://taylorarchibald.com/youtube_overlay/api/healthz`
- Socket.IO path: `/youtube_overlay/socket.io`

## Host layout

- Project: `/home/ubuntu/Projects/youtube_overlay`
- Service: `app-youtube-overlay.service`
- Bind: `127.0.0.1:13050`
- Base path: `/youtube_overlay`
- nginx locations: `/etc/nginx/snippets/oracle-webapps-locations.conf`

The service runs the compiled server from `dist-server/server/index.js`; that process also serves the built Vite assets from `dist/`.

## Build

From the project directory:

```bash
npm ci
VITE_BASE_PATH=/youtube_overlay/ npm run build
```

The production service requires these environment values:

```text
NODE_ENV=production
HOST=127.0.0.1
PORT=13050
BASE_PATH=/youtube_overlay
```

Phone media uses direct WebRTC. The build can include `VITE_TURN_URL`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL` if a TURN relay is required for restrictive networks. STUN alone may fail through symmetric NAT or restrictive firewalls. Phone capture requires HTTPS; the public URL already supplies it. Invite tokens are created in memory on server startup and must be regenerated after a restart. Do not publish invite links or append their tokens to the public Output URL. In production, the server creates `data/director-access-key` (mode 0600) when `DIRECTOR_ACCESS_KEY` is unset. Production Director commands (source/video selection, image TAKE/LIVE and sync) require this key; public Output retains native YouTube playback controls. Open Director once with `#access=KEY` or enter the key under **Phone camera links**; the browser stores it locally and removes the fragment from the address bar. Preserve this key file with other runtime data.

## systemd

The service is enabled at boot and configured to restart on failure. Useful checks:

```bash
sudo systemctl status app-youtube-overlay.service
sudo journalctl -u app-youtube-overlay.service -n 100 --no-pager
curl http://127.0.0.1:13050/youtube_overlay/api/healthz
```

## nginx

The nginx integration intentionally preserves the `/youtube_overlay` prefix when proxying to Node. Socket.IO requires HTTP/1.1 upgrade headers in the same location.

Before changing nginx, create a timestamped backup of the shared snippet, then run:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Do not reload nginx when `nginx -t` fails.

## Verification performed on initial deployment

The initial M0 deployment was verified on October 3, 2026 with:

- systemd service active and enabled;
- local health endpoint returning 200;
- public Director and Output routes returning 200;
- public test graphic returning the expected 1,057 bytes;
- production HTML referencing `/youtube_overlay/assets/...` paths;
- public HTTPS/WSS Socket.IO command flow;
- TAKE changing Program to `graphic`;
- a newly connected viewer restoring the current graphic state;
- LIVE returning Program to `live` and clearing the active asset;
- nginx configuration test succeeding before reload.

## Safe update pattern

Build a candidate separately from the active directory, verify it against an unused/local port, and only then promote it. Never make nginx/service changes before the candidate build and state-flow checks pass.

For a code-only update after promotion:

1. Build the candidate.
2. Run health + Socket.IO acceptance checks locally.
3. Replace the production directory while preserving a timestamped backup when one exists.
4. Restart `app-youtube-overlay.service`.
5. Verify local health.
6. Verify the public Director, Output, test graphic, health endpoint, and Socket.IO path.

The core application should always be left in LIVE mode after deployment verification.

## M0–M3 code-only deployment

Work in an isolated owning-repository checkout; the established production directory does not need a `.git` directory. Use Node 22.13+; Archimedes production uses `/usr/bin/node` 24.16.0.

1. Run `npm ci` and `npm run check`.
2. Run `npm run test:browser` against the candidate. Inspect recorded screenshots and distinguish actual YouTube playback observations from simulated autoplay-event tests.
3. Commit the tested source, push `master`, then build again so `dist/build.json` records that exact commit. If source changes, repeat affected checks.
4. Run `scripts/deploy.sh /absolute/run-directory`. It installs production dependencies into a separate release, tests that runtime on port 13051, then stops only `app-youtube-overlay.service`, moves original code into a timestamped rollback directory and promotes the release. It restores originals automatically on a failed promotion check.
5. Check public health, Director/Output, all HTML asset URLs, built-in graphic and WSS. Run browser acceptance against the public prefix; set `RESTART_SERVICE=app-youtube-overlay.service` to verify a real service restart. Finish in LIVE.

The deployment touches only an explicit list of code/build/dependency/doc paths. It preserves production `data/`, `.env`, uploads, unknown paths, systemd and nginx. The backup location is recorded in `rollback-path.txt`; run its `restore.sh` to restore original code while keeping current runtime data. Keep backup directories until the release is accepted. Do not use a directory replacement or `rsync --delete` against the production root.

SQLite defaults to `/home/ubuntu/Projects/youtube_overlay/data/overlay.sqlite`. `DATA_PATH` can select another file. For a consistent live database backup use SQLite’s backup API or stop this app before copying the DB/WAL/SHM together. A service restart reconnects clients and restores the saved full Program. Missing/unavailable persistence starts safely and leaves core switching available; health reports `persistence: unavailable`.

`/youtube_overlay/build.json` and `/api/healthz` include exact commit and built asset names. The service remains enabled at boot; verify `systemctl is-enabled app-youtube-overlay.service`. A host reboot is not required to validate this release and would disturb unrelated services.

A browser on Archimedes may encounter YouTube’s “Sign in to confirm you’re not a bot” challenge. Recovery controls and Program layout can be verified there; actual playback/audio acceptance must be checked on the household TV/browser when YouTube allows playback.
