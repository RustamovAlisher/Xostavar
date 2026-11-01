import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';

/**
 * Mahsulot rasmlari: yuklangan fayl `UPLOAD_DIR/products/<id>-<ts>.jpg` (≤1200px) va `-thumb.jpg` (≤320px) ko'rinishida saqlanadi.
 * Bazada faqat UPLOAD_DIR ga nisbatan yo'l turadi; URL `/api/v1/uploads/<yo'l>` (static) orqali beriladi.
 */
export const UPLOADS_URL_PREFIX = '/api/v1/uploads';
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const FULL_PX = 1200;
const THUMB_PX = 320;

export interface ProcessedImage {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

/** EXIF bo'yicha buriladi, 1200px gacha kichraytiriladi, JPEG; eskiz 320px. Buzuq/rasm bo'lmagan fayl → xato. */
export async function processProductImage(input: Buffer): Promise<ProcessedImage> {
  const base = sharp(input, { failOn: 'error', limitInputPixels: 80_000_000 }).rotate();
  const meta = await base.metadata();
  if (!meta.width || !meta.height) throw new Error('image_unreadable');
  const full = await base.clone().resize({ width: FULL_PX, height: FULL_PX, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  const thumb = await base.clone().resize({ width: THUMB_PX, height: THUMB_PX, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  return { full: full.data, thumb, width: full.info.width, height: full.info.height };
}

export const uploadUrl = (path: string | null | undefined): string | undefined => (path ? `${UPLOADS_URL_PREFIX}/${path}` : undefined);

/** Fayllarni diskka yozadi; qaytgan yo'llar UPLOAD_DIR ga nisbatan (`products/<id>-<ts>.jpg`). */
export async function storeProductImage(uploadDir: string, productId: string, img: ProcessedImage): Promise<{ imagePath: string; thumbPath: string }> {
  const ts = Date.now();
  const imagePath = `products/${productId}-${ts}.jpg`;
  const thumbPath = `products/${productId}-${ts}-thumb.jpg`;
  const root = resolve(uploadDir);
  await mkdir(dirname(join(root, imagePath)), { recursive: true });
  await writeFile(join(root, imagePath), img.full);
  await writeFile(join(root, thumbPath), img.thumb);
  return { imagePath, thumbPath };
}

/** Eski fayllarni o'chiradi; yo'q fayl xato emas (disk va baza biroz farqlashi mumkin). */
export async function removeProductFiles(uploadDir: string, paths: (string | null | undefined)[]): Promise<void> {
  const root = resolve(uploadDir);
  for (const p of paths) {
    if (!p || p.includes('..')) continue;
    await unlink(join(root, p)).catch(() => undefined);
  }
}
