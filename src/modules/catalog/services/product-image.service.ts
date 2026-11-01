import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DB, type Db } from '../../../db/db.module.js';
import { runTx } from '../../../db/tx.js';
import type { Env } from '../../../config/env.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { badRequest, notFound } from '../../../common/errors/app-error.js';
import { IMAGE_MIME, processProductImage, removeProductFiles, storeProductImage } from '../../../common/utils/images.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { CatalogRepository } from '../repositories/catalog.repository.js';
import { CatalogService, type ProductView } from './catalog.service.js';

/** Multer xotira faylidan kerakli qism (Express.Multer.File ning qisqa shakli). */
export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}

/**
 * Mahsulot rasmi (TZ qo'shimcha): bitta rasm — to'liq (≤1200px) va eskiz (≤320px).
 * Yangi rasm yuklanganda eskisi diskdan o'chiriladi; versiya o'zgarmaydi (forma qulfiga ta'sir qilmasin).
 */
@Injectable()
export class ProductImageService {
  private readonly dir: string;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: CatalogRepository,
    private readonly catalog: CatalogService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.dir = config.get('UPLOAD_DIR', { infer: true });
  }

  async upload(user: AuthUser, branchId: string | null, id: string, file: UploadedImage | undefined): Promise<ProductView> {
    if (!file?.buffer?.length) throw badRequest("Rasm fayli yuborilmadi (multipart maydon nomi: file)");
    if (!IMAGE_MIME.has(file.mimetype)) throw badRequest('Faqat JPEG, PNG yoki WebP rasm qabul qilinadi');
    const p = await this.repo.findById(id);
    if (!p) throw notFound('Mahsulot');

    const img = await processProductImage(file.buffer).catch(() => {
      throw badRequest("Rasm faylini o'qib bo'lmadi — buzilgan yoki qo'llab-quvvatlanmaydigan format");
    });
    const paths = await storeProductImage(this.dir, id, img);
    try {
      await runTx(this.db, async (tx) => {
        await this.repo.updateProduct(tx, id, paths);
        await this.audit.log(user, { action: 'edit', module: 'Mahsulotlar', targetId: id, targetName: p.name, details: `Rasm yuklandi (${img.width}×${img.height})` }, tx);
      });
    } catch (e) {
      await removeProductFiles(this.dir, [paths.imagePath, paths.thumbPath]);
      throw e;
    }
    await removeProductFiles(this.dir, [p.imagePath, p.thumbPath]);
    return this.catalog.get(user, branchId, id);
  }

  async remove(user: AuthUser, branchId: string | null, id: string): Promise<ProductView> {
    const p = await this.repo.findById(id);
    if (!p) throw notFound('Mahsulot');
    if (p.imagePath || p.thumbPath) {
      await runTx(this.db, async (tx) => {
        await this.repo.updateProduct(tx, id, { imagePath: null, thumbPath: null });
        await this.audit.log(user, { action: 'edit', module: 'Mahsulotlar', targetId: id, targetName: p.name, details: "Rasm o'chirildi" }, tx);
      });
      await removeProductFiles(this.dir, [p.imagePath, p.thumbPath]);
    }
    return this.catalog.get(user, branchId, id);
  }
}
