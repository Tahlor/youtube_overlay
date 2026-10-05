import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import type { Asset } from '../src/shared/types.js';
import type { LibraryStore } from './library.js';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const SUPPORTED = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const;

type SupportedMime = keyof typeof SUPPORTED;

export function createUploadRouter(options: {
  uploadDir: string;
  publicBasePath: string;
  library: LibraryStore | null;
  directorKey: string | null;
  onChanged(): void;
}) {
  const router = Router();
  mkdirSync(options.uploadDir, { recursive: true });

  router.use('/files', express.static(options.uploadDir, {
    index: false,
    dotfiles: 'deny',
    maxAge: '30d',
    immutable: true,
  }));

  router.post('/', requireDirector(options.directorKey), express.raw({
    type: ['image/png', 'image/jpeg', 'image/webp'],
    limit: MAX_IMAGE_BYTES,
  }), (req, res) => {
    if (!options.library) {
      res.status(503).json({ error: 'Uploaded media storage is unavailable.' });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Choose a PNG, JPEG, or WebP image.' });
      return;
    }
    const declaredMime = normalizedMime(req.get('content-type'));
    const detectedMime = detectImageMime(req.body);
    if (!declaredMime || !detectedMime || declaredMime !== detectedMime) {
      res.status(415).json({ error: 'File contents do not match a supported PNG, JPEG, or WebP image.' });
      return;
    }

    const digest = createHash('sha256').update(req.body).digest('hex');
    const extension = SUPPORTED[detectedMime];
    const filename = `${digest}.${extension}`;
    const destination = path.join(options.uploadDir, filename);
    const existed = existsSync(destination);
    const temp = path.join(options.uploadDir, `.${digest}.${process.pid}.${Date.now()}.tmp`);
    const title = uploadTitle(req.get('x-upload-name'), filename);
    const root = options.publicBasePath ? options.publicBasePath : '';
    const url = `${root}/uploads/files/${filename}`;
    const asset: Asset = {
      id: `upload:${digest}`,
      title,
      fullUrl: url,
      thumbnailUrl: url,
      source: 'Upload',
    };

    try {
      if (!existed) {
        writeFileSync(temp, req.body, { flag: 'wx' });
        renameSync(temp, destination);
      }
      options.library.imported(asset);
      options.onChanged();
      res.status(existed ? 200 : 201).json({ asset });
    } catch {
      rmSync(temp, { force: true });
      if (!existed) rmSync(destination, { force: true });
      res.status(503).json({ error: 'Could not save this image. Try again.' });
    }
  });

  return router;
}

function normalizedMime(value: string | undefined): SupportedMime | null {
  const mime = value?.split(';', 1)[0].trim().toLowerCase();
  if (mime === 'image/jpg') return 'image/jpeg';
  return mime && mime in SUPPORTED ? mime as SupportedMime : null;
}

export function detectImageMime(buffer: Buffer): SupportedMime | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function uploadTitle(encoded: string | undefined, fallback: string): string {
  if (!encoded) return fallback;
  try {
    const value = decodeURIComponent(encoded).replace(/[\x00-\x1f\x7f]/g, '').trim();
    return value ? value.slice(0, 500) : fallback;
  } catch {
    return fallback;
  }
}

function requireDirector(key: string | null) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Temporary adapter for the current deployment. #25 replaces this header
    // with Webapps/SSO authorization; keep the upload boundary server-side now.
    if (key === null) { next(); return; }
    const supplied = req.get('x-director-access-key');
    if (!supplied || !safeEqual(supplied, key)) {
      res.status(401).json({ error: 'Director access is required to upload media.' });
      return;
    }
    next();
  };
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
