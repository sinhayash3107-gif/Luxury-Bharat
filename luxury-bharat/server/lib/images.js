import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { run, get, now } from './db.js';
import { bad } from './http.js';

let sharp = null;
try { sharp = (await import('sharp')).default; } catch { console.warn('[images] "sharp" not installed: uploads are validated and stored as-is (no resize/compress). Run `npm i sharp` for optimisation.'); }
export const imageOptimisation = !!sharp;

export const MAX_UPLOAD = 8 * 1024 * 1024;

/** Detect real image type from magic bytes (never trust the client's Content-Type). SVG is intentionally rejected (script injection risk). */
export function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return { ext: 'gif', mime: 'image/gif' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

/** Storage adapter. Local-disk driver by default; swap `put`/`remove` for S3 or Cloudinary in production (see README). */
export const storage = {
  put(name, buf) { fs.writeFileSync(path.join(config.uploadDir, name), buf); return `/uploads/${name}`; },
  remove(url) { const f = path.basename(url || ''); if (f) fs.rmSync(path.join(config.uploadDir, f), { force: true }); },
};

export async function saveUpload(buf, { originalName, userId } = {}) {
  if (!buf.length) throw bad('No file received.');
  if (buf.length > MAX_UPLOAD) throw bad('Image is larger than 8 MB.');
  const type = sniff(buf);
  if (!type) throw bad('Unsupported file. Upload a JPEG, PNG, WebP or GIF image.');
  const id = crypto.randomBytes(12).toString('hex');
  let url, thumb = null, width = null, height = null, bytes = buf.length;
  if (sharp) {
    try {
      const img = sharp(buf, { limitInputPixels: 60_000_000, animated: false }).rotate();
      const main = await img.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
      const th = await img.clone().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();
      url = storage.put(`${id}.webp`, main.data); thumb = storage.put(`${id}_t.webp`, th);
      width = main.info.width; height = main.info.height; bytes = main.data.length;
    } catch { throw bad('That image could not be processed. It may be corrupt.'); }
  } else {
    url = storage.put(`${id}.${type.ext}`, buf);
  }
  run('INSERT INTO media(url,thumb_url,bytes,width,height,original_name,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?)', url, thumb, bytes, width, height, String(originalName || '').slice(0, 120) || null, userId ?? null, now());
  return get('SELECT * FROM media WHERE url=?', url);
}
