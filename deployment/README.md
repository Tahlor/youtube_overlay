# Deployment Directory

This directory manages deployment tooling, release runs, and rollback backups for YouTube Overlay.

## Rules & Architecture

1. **No Parent Directory Pollution**:
   - Never create sibling folders, temporary clones, worktrees, or deployment staging directories in the parent directory (`/home/ubuntu/Projects/` or any path outside the repo root).
   - All builds, worktrees, staging releases, and rollback archives must reside inside this repository.

2. **Deployment Runs & Rollbacks**:
   - Release stages and rollback snapshots are stored in `deployment/runs/` (e.g. `deployment/runs/release-<timestamp>`, `deployment/runs/rollback-<timestamp>`).
   - `deployment/runs/` is configured in `.gitignore` and is never committed to Git.

3. **Canonical Service Root**:
   - The production systemd service (`app-youtube-overlay.service`) runs directly from `/home/ubuntu/Projects/youtube_overlay`.
   - All runtime SQLite data and media assets live in `data/` within this repository.

4. **Rolling Back**:
   - Active rollback scripts are stored at the path recorded in `deployment/runs/<commit>/rollback-path.txt`.
   - To restore the previous build:
     ```bash
     bash $(cat deployment/runs/98c0fcd/rollback-path.txt)/restore.sh
     ```
