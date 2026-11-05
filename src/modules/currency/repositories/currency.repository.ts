import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { exchangeRates, products, productVariants } from '../../../entities/index.js';

export type ExchangeRateRow = typeof exchangeRates.$inferSelect;
export type ExchangeRateInsert = typeof exchangeRates.$inferInsert;

/** Valyuta kurslari va dollar narxli mahsulotlarni qayta hisoblash SQL lari. */
@Injectable()
export class CurrencyRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  latest(currency = 'USD', tx: DbOrTx = this.db): Promise<ExchangeRateRow | undefined> {
    return tx.select().from(exchangeRates).where(eq(exchangeRates.currency, currency)).orderBy(desc(exchangeRates.createdAt)).limit(1).then((r) => r[0]);
  }

  /** Eng oxirgi Markaziy bank yozuvi (qo'lda kiritilganlardan tashqari). */
  latestFromCbu(currency = 'USD', tx: DbOrTx = this.db): Promise<ExchangeRateRow | undefined> {
    return tx
      .select()
      .from(exchangeRates)
      .where(and(eq(exchangeRates.currency, currency), eq(exchangeRates.source, 'cbu')))
      .orderBy(desc(exchangeRates.createdAt))
      .limit(1)
      .then((r) => r[0]);
  }

  history(limit: number, currency = 'USD'): Promise<ExchangeRateRow[]> {
    return this.db.select().from(exchangeRates).where(eq(exchangeRates.currency, currency)).orderBy(desc(exchangeRates.createdAt)).limit(limit);
  }

  insert(tx: DbOrTx, v: ExchangeRateInsert): Promise<ExchangeRateRow> {
    return tx.insert(exchangeRates).values(v).returning().then((r) => r[0]);
  }

  /**
   * Dollar narxli mahsulot va variantlarning so'm narxini yangi kurs bo'yicha qayta yozadi
   * (`roundTo` so'mgacha yaxlitlab). Versiya oshirilmaydi: tahrirlanayotgan forma buzilmasin, saqlashda server baribir qayta hisoblaydi.
   */
  async recalcUsdPrices(tx: DbOrTx, rate: number, roundTo: number): Promise<number> {
    const p = await tx
      .update(products)
      .set({ retailPrice: sql`(round(${products.retailPriceUsd} * ${rate} / ${roundTo}) * ${roundTo})::bigint` })
      .where(sql`${products.priceCurrency} = 'USD' and ${products.retailPriceUsd} is not null and ${products.deletedAt} is null and not ${products.isVariable}`)
      .returning({ id: products.id });
    const v = await tx.execute(sql`
      update ${productVariants} v
         set retail_price = (round(v.retail_price_usd * ${rate} / ${roundTo}) * ${roundTo})::bigint
        from ${products} p
       where p.id = v.product_id and p.price_currency = 'USD' and v.retail_price_usd is not null
         and v.deleted_at is null and p.deleted_at is null
      returning v.product_id`);
    return new Set([...p.map((x) => x.id), ...(v.rows as { product_id: string }[]).map((x) => x.product_id)]).size;
  }
}
