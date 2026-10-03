# Archimedes Deployment

The M0 application is deployed on Archimedes as a single Node process behind the existing nginx frontend.

## Production endpoints

- App root: `https://taylorarchibald.com/youtube_overlay/`
- Director: `https://taylorarchibald.com/youtube_overlay/director`
- TV output: `https://taylorarchibald.com/youtube_overlay/output`
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
npm install
VITE_BASE_PATH=/youtube_overlay/ npm run build
```

The production service requires these environment values:

```text
NODE_ENV=production
HOST=127.0.0.1
PORT=13050
BASE_PATH=/youtube_overlay
```

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
