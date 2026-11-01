import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../entities/index.js';
import { processProductImage, removeProductFiles, storeProductImage } from '../common/utils/images.js';

/**
 * Papkadagi `<SKU>.jpg|png|webp` fayllarini SKU bo'yicha mahsulotlarga rasm qilib biriktiradi.
 *   npm run db:import-images -- --dir ../mahsulotlar-rasimlari/crops            (quruq rejim: faqat hisobot)
 *   npm run db:import-images -- --dir ../mahsulotlar-rasimlari/crops --apply    (saqlaydi)
 *   --force  — rasmi bor mahsulotlarni ham almashtiradi (standart: o'tkazib yuboriladi)
 * SKU solishtirish registrga bog'liq emas; `_` va `-` bir xil hisoblanadi (fayl nomida `/` bo'lmaydi).
 * Fayllar UPLOAD_DIR (standart ./uploads) ga yoziladi — Docker'da `/app/uploads` volume.
 */
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = resolve(opt('--dir') ?? '../mahsulotlar-rasimlari/crops');
const apply = flag('--apply');
const force = flag('--force');
const uploadDir = process.env.UPLOAD_DIR ?? './uploads';
const norm = (s: string) => s.toLowerCase().replace(/[_\s]/g, '-');

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  try {
    const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
    const rows = await db.select({ id: schema.products.id, sku: schema.products.sku, name: schema.products.name, imagePath: schema.products.imagePath, thumbPath: schema.products.thumbPath })
      .from(schema.products).where(isNull(schema.products.deletedAt));
    const bySku = new Map(rows.map((r) => [norm(r.sku), r]));
    let added = 0, replaced = 0, skipped = 0, missing = 0, failed = 0;
    for (const f of files) {
      const sku = basename(f, extname(f));
      const p = bySku.get(norm(sku));
      if (!p) { missing++; console.log(`  ? ${sku}: mahsulot topilmadi`); continue; }
      if (p.imagePath && !force) { skipped++; continue; }
      let img;
      try { img = await processProductImage(await readFile(join(dir, f))); } catch (e) { failed++; console.log(`  ! ${sku}: rasm o'qilmadi (${(e as Error).message})`); continue; }
      const mark = p.imagePath ? '~' : '+';
      console.log(`  ${mark} ${sku} → ${p.name} (${img.width}×${img.height})`);
      if (p.imagePath) replaced++; else added++;
      if (!apply) continue;
      const paths = await storeProductImage(uploadDir, p.id, img);
      await db.update(schema.products).set(paths).where(and(eq(schema.products.id, p.id), isNull(schema.products.deletedAt)));
      await db.insert(schema.auditLogs).values({ userId: null, userName: 'Tizim', userRole: '', action: 'edit', module: 'Mahsulotlar', targetId: p.id, targetName: p.name, details: `Rasm import qilindi (${f})` }).catch(() => undefined);
      await removeProductFiles(uploadDir, [p.imagePath, p.thumbPath]);
    }
    const unmatched = rows.filter((r) => !files.some((f) => norm(basename(f, extname(f))) === norm(r.sku)) && !r.imagePath).length;
    console.log(`${apply ? 'SAQLANDI' : 'QURUQ REJIM (--apply yo\'q)'}: +${added} ~${replaced} o'tkazildi ${skipped}, SKU topilmadi ${missing}, xato ${failed}; rasmsiz qolgan mahsulotlar: ${unmatched}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
