import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { runTx } from '../../../db/tx.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { conflict, notFound, unprocessable } from '../../../common/errors/app-error.js';
import { slug } from '../../../common/utils/numbers.js';
import { page, type Page } from '../../../common/utils/pagination.js';
import { assertVersion } from '../../../common/utils/version.js';
import { AuditService } from '../../audit/services/audit.service.js';
import type { BranchPriceDto, ProductDto, ProductListQuery, VariantDto } from '../dto/catalog.dto.js';
import { allCodes, productSummary, toChildRows, toProductColumns, toProductViews, toVariantColumns, type ProductView } from '../mappers/catalog.mapper.js';
import { CatalogRepository, NIL, type LevelFields, type ProductRow } from '../repositories/catalog.repository.js';

export type { ProductView, VariantView } from '../mappers/catalog.mapper.js';

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: CatalogRepository,
    private readonly audit: AuditService,
  ) {}

  /* ───────── O'qish (N+1 siz: 6 ta batch so'rov) ───────── */

  /**
   * Berilgan mahsulotlarni to'liq yig'adi: variantlar, konversiyalar, shtrix-kodlar, filial qoldig'i va narxi.
   * Mahsulot soniga bog'liq bo'lmagan doimiy sonli so'rov.
   */
  async assemble(rows: ProductRow[], branchId: string | null, withCost: boolean, db?: DbOrTx): Promise<ProductView[]> {
    if (!rows.length) return [];
    const children = await this.repo.loadChildren(rows.map((p) => p.id), branchId, db);
    return toProductViews(rows, children, withCost);
  }

  async list(user: AuthUser, branchId: string | null, q: ProductListQuery): Promise<Page<ProductView> & { facets: { byCategory: Record<string, number> } }> {
    const [rows, total, facets] = await this.repo.list(branchId, q);
    const items = await this.assemble(rows, branchId, user.permissions.includes('view_cost_price'));
    return { ...page(items, total, q), facets: { byCategory: Object.fromEntries(facets.map((f) => [f.categoryId, f.n])) } };
  }

  async get(user: AuthUser, branchId: string | null, id: string): Promise<ProductView> {
    const row = await this.repo.findById(id);
    if (!row) throw notFound('Mahsulot');
    const [v] = await this.assemble([row], branchId, user.permissions.includes('view_cost_price'));
    return v;
  }

  /** SKU/shtrix-kod bo'yicha aniq moslik (skaner). Qadoq shtrix-kodi bo'lsa `unit` ham qaytadi (TZ 9.4). */
  async lookup(user: AuthUser, branchId: string | null, code: string) {
    const c = code.trim().toLowerCase();
    if (!c) throw notFound('Mahsulot');
    const bc = await this.repo.findBarcode(c);
    let productId = bc?.productId;
    let variantId = bc?.variantId ?? null;
    const unit = bc?.unit ?? null;
    if (!productId) {
      const v = await this.repo.findVariantBySku(c);
      if (v) {
        productId = v.productId;
        variantId = v.id;
      } else {
        const p = await this.repo.findProductBySku(c);
        productId = p?.id;
      }
    }
    if (!productId) throw notFound('Mahsulot', { code });
    const product = await this.get(user, branchId, productId);
    return { product, variantId, unit };
  }

  /* ───────── Yozish ───────── */

  /** Kodlarning (SKU, shtrix-kod) butun tizimda unikalligi — katta-kichik harfga sezgir emas (TZ 7.3). */
  private async assertCodesFree(tx: DbOrTx, codes: string[], exceptProductId?: string) {
    const list = [...new Set(codes.map((c) => c.trim().toLowerCase()).filter(Boolean))];
    if (list.length !== codes.filter((c) => c.trim()).length) {
      const seen = new Set<string>();
      const dup = codes.map((c) => c.trim().toLowerCase()).find((c) => c && (seen.has(c) ? true : (seen.add(c), false)));
      throw conflict('duplicate_code', `"${dup}" kodi takrorlangan`);
    }
    if (!list.length) return;
    const hit = await this.repo.findCodeHit(tx, list, exceptProductId);
    if (hit) throw conflict('duplicate_code', `"${hit.code}" kodi "${hit.name}" mahsulotida bor`, { code: hit.code });
  }

  private async validate(tx: DbOrTx, dto: ProductDto) {
    const err = (m: string) => unprocessable('validation_failed', m);
    const unitIds = new Set(await this.repo.unitIds(tx));
    if (!unitIds.has(dto.baseUnit)) throw err(`"${dto.baseUnit}" birligi mavjud emas`);
    const cat = await this.repo.findCategory(dto.categoryId, tx);
    if (!cat) throw err('Kategoriya topilmadi');
    const checkConvs = (list: { unit: string; factor: number }[] | undefined, who: string) => {
      const seen = new Set<string>();
      for (const c of list ?? []) {
        if (!unitIds.has(c.unit)) throw err(`${who}: "${c.unit}" birligi mavjud emas`);
        if (c.unit === dto.baseUnit) throw err(`${who}: qo'shimcha birlik asosiy birlik bilan bir xil bo'lmasin`);
        if (seen.has(c.unit)) throw err(`${who}: "${c.unit}" birligi ikki marta kiritilgan`);
        if (!(c.factor > 0)) throw err(`${who}: koeffitsient 0 dan katta bo'lsin`);
        seen.add(c.unit);
      }
    };
    checkConvs(dto.conversions, dto.name);
    if (dto.isVariable) {
      if (!dto.variants?.length) throw err("Kamida bitta variant qo'shing");
      for (const v of dto.variants) {
        if (!v.name.trim()) throw err('Variant nomini kiriting');
        checkConvs(v.conversions, v.name);
      }
    }
  }

  /** Bo'sh SKU larga avtomatik, unikal qiymat (TZ 7.3). */
  private async finalizeSkus(tx: DbOrTx, dto: ProductDto, exceptProductId?: string) {
    const taken = new Set((await this.repo.takenSkus(tx, exceptProductId)).map((s) => s.toLowerCase()));
    const claim = (base: string) => {
      let s = base;
      let n = 2;
      while (taken.has(s.toLowerCase())) s = `${base}-${n++}`;
      taken.add(s.toLowerCase());
      return s;
    };
    if (dto.sku?.trim()) taken.add(dto.sku.trim().toLowerCase());
    for (const x of dto.variants ?? []) if (x.sku?.trim()) taken.add(x.sku.trim().toLowerCase());
    const cat = await this.repo.findCategory(dto.categoryId, tx);
    const sku = dto.sku?.trim() || claim(slug(dto.name).split('-').filter(Boolean).slice(0, 2).join('-').slice(0, 12) || slug(cat?.name ?? '') || 'SKU');
    const variants = (dto.variants ?? []).map((x, i) => ({ ...x, sku: x.sku?.trim() || claim(`${sku}-${slug(x.name) || i + 1}`) }));
    return { sku, variants };
  }

  private writeChildren(tx: DbOrTx, productId: string, dto: ProductDto, variants: VariantDto[], keepVariantIds: Map<number, string>) {
    const { convRows, codeRows } = toChildRows(productId, dto, variants, keepVariantIds);
    return this.repo.replaceChildren(tx, productId, convRows, codeRows);
  }

  /** Joriy filial uchun min. qoldiq / tannarx (TZ 7.3): qator bo'lmasa 0 qoldiq bilan yaratiladi. */
  private async writeLevelFields(tx: DbOrTx, user: AuthUser, branchId: string | null, productId: string, variantId: string | null, dto: { minStock?: number | null; costPrice?: number | null }) {
    if (!branchId || (dto.minStock === undefined && dto.costPrice === undefined)) return;
    const set: LevelFields = {};
    if (dto.minStock !== undefined) set.minStock = dto.minStock != null && dto.minStock > 0 ? dto.minStock : null;
    if (dto.costPrice !== undefined && user.permissions.includes('view_cost_price')) set.costPrice = dto.costPrice != null && dto.costPrice > 0 ? dto.costPrice : null;
    if (!Object.keys(set).length) return;
    await this.repo.upsertLevelFields(tx, branchId, productId, variantId, set);
  }

  async create(user: AuthUser, branchId: string | null, dto: ProductDto): Promise<ProductView> {
    const id = await runTx(this.db, async (tx) => {
      await this.validate(tx, dto);
      const { sku, variants } = await this.finalizeSkus(tx, dto);
      await this.assertCodesFree(tx, allCodes(sku, dto, variants));
      const productId = await this.repo.insertProduct(tx, toProductColumns(dto, sku));
      const ids = new Map<number, string>();
      if (dto.isVariable) {
        const rows = await this.repo.insertVariants(tx, variants.map((v, i) => ({ productId, ...toVariantColumns(v, i) })));
        rows.forEach((r, i) => ids.set(i, r));
      }
      await this.writeChildren(tx, productId, dto, dto.isVariable ? variants : [], ids);
      if (!dto.isVariable) await this.writeLevelFields(tx, user, branchId, productId, null, dto);
      else for (const [i, v] of variants.entries()) await this.writeLevelFields(tx, user, branchId, productId, ids.get(i) ?? null, v);
      await this.audit.log(user, { action: 'add', module: 'Mahsulotlar', targetId: productId, targetName: dto.name.trim(), details: `Yangi mahsulot (SKU: ${sku})`, diff: { after: productSummary(dto, sku) } }, tx);
      return productId;
    });
    return this.get(user, branchId, id);
  }

  async update(user: AuthUser, branchId: string | null, id: string, dto: ProductDto): Promise<ProductView> {
    await runTx(this.db, async (tx) => {
      const old = await this.repo.findByIdForUpdate(tx, id);
      if (!old) throw notFound('Mahsulot');
      assertVersion(old.version, dto.version, 'Mahsulot');
      await this.validate(tx, dto);
      const { sku, variants } = await this.finalizeSkus(tx, dto, id);
      await this.assertCodesFree(tx, allCodes(sku, dto, variants), id);

      // Variantsiz → variantli o'tish: asosiy qatorda qoldiq bo'lsa u ko'rinmay qolardi (variantlar yig'indisi ko'rsatiladi) — 409
      if (!old.isVariable && dto.isVariable) {
        const stocked = await this.repo.findStocked(tx, id, true);
        if (stocked) throw conflict('in_use', `${stocked.branch} omborida ${Number(stocked.stock)} qoldiq bor — variantlarga o'tishdan oldin qoldiqni 0 ga keltiring`);
      }
      // Variantlar: id bo'yicha yangilash; olib tashlanganlari — biror filialda qoldig'i bo'lsa 409, aks holda yumshoq o'chirish
      const existing = await this.repo.activeVariants(tx, id);
      const keep = new Set(dto.isVariable ? variants.map((v) => v.id).filter(Boolean) : []);
      const removed = existing.filter((v) => !keep.has(v.id));
      if (removed.length) {
        const stocked = await this.repo.stockedVariants(tx, removed.map((v) => v.id));
        if (stocked.length) {
          const v = removed.find((x) => x.id === stocked[0].variantId)!;
          throw conflict('in_use', `"${v.name}" variantining ${stocked[0].branch} omborida qoldig'i bor (${Number(stocked[0].stock)}) — avval qoldiqni 0 ga keltiring`, { variantId: v.id });
        }
        await this.repo.softDeleteVariants(tx, removed.map((v) => v.id));
      }
      const ids = new Map<number, string>();
      if (dto.isVariable) {
        for (const [i, v] of variants.entries()) {
          if (v.id && existing.some((e) => e.id === v.id)) {
            await this.repo.updateVariant(tx, v.id, toVariantColumns(v, i));
            ids.set(i, v.id);
          } else {
            const [newId] = await this.repo.insertVariants(tx, [{ productId: id, ...toVariantColumns(v, i) }]);
            ids.set(i, newId);
          }
        }
      }
      await this.repo.updateProduct(tx, id, { ...toProductColumns(dto, sku), version: old.version + 1 });
      await this.writeChildren(tx, id, dto, dto.isVariable ? variants : [], ids);
      if (!dto.isVariable) await this.writeLevelFields(tx, user, branchId, id, null, dto);
      else for (const [i, v] of variants.entries()) await this.writeLevelFields(tx, user, branchId, id, ids.get(i) ?? null, v);
      await this.audit.log(user, { action: 'edit', module: 'Mahsulotlar', targetId: id, targetName: dto.name.trim(), details: 'Mahsulot tahrirlandi', diff: { before: productSummary({ ...old, conversions: [], variants: [] } as unknown as ProductDto, old.sku), after: productSummary(dto, sku) } }, tx);
    });
    return this.get(user, branchId, id);
  }

  /** TZ 8.11: tarixi bor mahsulot yumshoq o'chiriladi; qoldig'i bo'lsa o'chirilmaydi. */
  async remove(user: AuthUser, id: string) {
    await runTx(this.db, async (tx) => {
      const p = await this.repo.findByIdForUpdate(tx, id);
      if (!p) throw notFound('Mahsulot');
      const stocked = await this.repo.findStocked(tx, id);
      if (stocked) throw conflict('in_use', `${stocked.branch} omborida qoldig'i bor (${Number(stocked.stock)}) — avval qoldiqni 0 ga keltiring`);
      // Kodlar bo'shatiladi, tarixiy cheklar nusxalar bilan saqlanadi
      if (await this.repo.hasHistory(tx, id)) await this.repo.softDeleteProduct(tx, id);
      else await this.repo.hardDeleteProduct(tx, id); // cascade: variantlar, konversiyalar, kodlar, qoldiq qatorlari
      await this.audit.log(user, { action: 'delete', module: 'Mahsulotlar', targetId: id, targetName: p.name, details: `O'chirildi (SKU: ${p.sku})` }, tx);
    });
  }

  /* ───────── Filial narxi (TZ 7.3) ───────── */

  async setBranchPrice(user: AuthUser, branchId: string, productId: string, dto: BranchPriceDto): Promise<ProductView> {
    const p = await this.repo.findBrief(productId);
    if (!p) throw notFound('Mahsulot');
    if (p.isVariable !== !!dto.variantId) throw unprocessable('validation_failed', p.isVariable ? 'Variantli mahsulotda narx variant uchun belgilanadi' : "Variantsiz mahsulotda variantId bo'lmaydi");
    if (dto.variantId && !(await this.repo.variantExists(productId, dto.variantId))) throw notFound('Variant');
    await runTx(this.db, async (tx) => {
      await this.repo.upsertBranchPrice(tx, branchId, productId, dto.variantId ?? null, { retailPrice: dto.retailPrice, wholesalePrice: dto.wholesalePrice ?? null });
      await this.audit.log(user, { action: 'edit', module: 'Mahsulotlar', targetId: productId, targetName: p.name, branchId, details: `Filial narxi: ${dto.retailPrice.toLocaleString('ru-RU')} so'm${dto.variantId ? ' (variant)' : ''}` }, tx);
    });
    return this.get(user, branchId, productId);
  }

  async clearBranchPrice(user: AuthUser, branchId: string, productId: string, variantId?: string) {
    const p = await this.repo.findBrief(productId);
    if (!p) throw notFound('Mahsulot');
    const n = await this.repo.deleteBranchPrice(branchId, productId, variantId ?? null);
    if (n) await this.audit.log(user, { action: 'edit', module: 'Mahsulotlar', targetId: productId, targetName: p.name, branchId, details: 'Filial narxi olib tashlandi (umumiy narx)' });
    return this.get(user, branchId, productId);
  }
}

export { NIL };
