import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { DB, type Db } from '../src/db/db.module.js';
import { NotifyService } from '../src/modules/telegram/services/notify.service.js';
import { NotifyWorker } from '../src/modules/telegram/services/notify.worker.js';
import { TelegramBotService } from '../src/modules/telegram/services/telegram-bot.service.js';
import { TelegramClient, TelegramError } from '../src/modules/telegram/services/telegram.client.js';
import { createApp, ensureShift, rawDb, seeded, uniq, type Client, type Seeded } from './helpers.js';

const GROUP = '-1009990001';
const tkDay = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

/** Savdo boti: chat ulash, har sotuv/bekor xabari, filtrlar, tugmalar (hisobot, ro'yxat, Excel), kun yakuni. Telegram — soxta. */
describe('telegram savdo boti', () => {
  let app: INestApplication;
  let s: Seeded;
  let c: Client;
  let branch: string;
  let close: () => Promise<unknown>;
  let bot: TelegramBotService;
  let worker: NotifyWorker;
  const sent: { chatId: string; text: string }[] = [];
  const markups: (Record<string, unknown> | undefined)[] = [];
  const docs: { chatId: string; filename: string; buf: Buffer; caption?: string }[] = [];
  let failNext: TelegramError | null = null;

  const lastTo = (chatId: string) => sent.filter((m) => m.chatId === chatId).at(-1)?.text ?? '';
  const countTo = (chatId: string) => sent.filter((m) => m.chatId === chatId).length;
  const groupMsg = (text: string) => ({ update_id: 1, message: { message_id: 1, chat: { id: Number(GROUP), type: 'supergroup' as const, title: "Do'kon guruhi" }, text } });
  const press = (data: string) => ({ update_id: 2, callback_query: { id: 'cb', from: { id: 1 }, data, message: { message_id: 2, chat: { id: Number(GROUP), type: 'supergroup' as const, title: "Do'kon guruhi" } } } });

  beforeAll(async () => {
    const pool = rawDb();
    await pool.query('delete from telegram_chats; delete from notification_outbox');
    await pool.end();
    app = await createApp();
    // Serverdagi SALES_BOT_ENABLED=1 holati (env ilova moduli import qilinganda o'qiladi — shu yerda yoqamiz)
    (app.get(NotifyService) as { enabled: boolean }).enabled = true;
    const tg = app.get(TelegramClient);
    vi.spyOn(tg, 'sendMessage').mockImplementation(async (chatId, text, markup) => {
      if (failNext) { const e = failNext; failNext = null; throw e; }
      sent.push({ chatId: String(chatId), text });
      markups.push(markup as Record<string, unknown> | undefined);
      return { message_id: sent.length, chat: { id: Number(chatId), type: 'supergroup' } };
    });
    vi.spyOn(tg, 'sendDocument').mockImplementation(async (chatId, buf, filename, caption, markup) => {
      docs.push({ chatId: String(chatId), buf, filename, caption });
      markups.push(markup as Record<string, unknown> | undefined);
      return { message_id: 1, chat: { id: Number(chatId), type: 'supergroup' } };
    });
    vi.spyOn(tg, 'answerCallback').mockResolvedValue(true);
    vi.spyOn(tg, 'sendChatAction').mockResolvedValue(true);
    bot = app.get(TelegramBotService);
    bot.botUsername = 'test_bot';
    worker = app.get(NotifyWorker);
    s = await seeded(app);
    branch = (await s.admin.post('/branches', { name: uniq('TG ') }, { idem: false })).body.id;
    c = s.admin.at(branch);
    close = await ensureShift(c);
  });
  afterAll(async () => {
    await close();
    await app.close();
  });

  let prodId: string;
  const sell = async (qty = 1, extra: Record<string, unknown> = {}) => {
    const r = await c.post('/sales', { lines: [{ productId: prodId, unit: 'piece', qty }], payments: [{ methodId: s.methods.cash, amount: 50_000 * qty }], ...extra });
    expect(r.status).toBe(201);
    return r.body;
  };

  it('ulash: kod faqat admin uchun, bir martalik; ulanmagan chatga ma\'lumot berilmaydi', async () => {
    expect((await s.kassir.get('/telegram')).status).toBe(403);
    expect((await s.kassir.post('/telegram/link-code')).status).toBe(403);
    const st = await s.admin.get('/telegram');
    expect(st.body).toMatchObject({ enabled: true, botUsername: 'test_bot', dailyAt: '21:00' });

    await bot.handleUpdate(groupMsg('/bugun'));
    expect(lastTo(GROUP)).toContain('hali ulanmagan');

    const code = (await s.admin.post('/telegram/link-code')).body;
    expect(code.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(code.groupUrl).toBe(`https://t.me/test_bot?startgroup=${code.code}`);
    await bot.handleUpdate(groupMsg(`/start@test_bot ${code.code.toLowerCase()}`));
    expect(lastTo(GROUP)).toContain("Do'kon guruhi</b> ulandi");
    await bot.handleUpdate(groupMsg(`/start ${code.code}`));
    expect(lastTo(GROUP)).toContain("muddati o'tgan");

    const chats = (await s.admin.get('/telegram')).body.chats;
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ chatId: GROUP, type: 'supergroup', title: "Do'kon guruhi", branchIds: null, notifySales: true, active: true });
  });

  it("har sotuv va bekor qilish xabari; minimal summa va filial filtri", async () => {
    prodId = (await c.post('/products', { name: uniq('Sement <M400> '), categoryId: s.cats['Asbob-uskunalar'], baseUnit: 'piece', isDivisible: false, conversions: [], isVariable: false, retailPrice: 50_000 }, { idem: false })).body.id;
    await c.post('/stock-in', { lines: [{ productId: prodId, unit: 'piece', qty: 50, costPerUnit: 30_000 }] });

    const sale = await sell(2);
    await worker.processOnce();
    const msg = lastTo(GROUP);
    expect(msg).toContain('🧾 <b>Sotuv</b>');
    expect(msg).toContain(sale.number);
    expect(msg).toContain('&lt;M400&gt;');
    expect(msg).toContain("Jami: 100 000 so'm");

    // Bir xil hodisa ikki marta yuborilmaydi
    const n = countTo(GROUP);
    await worker.processOnce();
    expect(countTo(GROUP)).toBe(n);

    const chat = (await s.admin.get('/telegram')).body.chats[0];
    expect((await s.admin.patch(`/telegram/chats/${chat.id}`, { minAmount: 1_000_000 })).status).toBe(200);
    await sell(1);
    await worker.processOnce();
    expect(countTo(GROUP)).toBe(n); // kichik chek — xabar yo'q

    // Bekor qilish — minimal summadan qat'i nazar
    expect((await c.post(`/sales/${sale.id}/void`, { reason: 'Mijoz qaytardi' })).status).toBe(201);
    await worker.processOnce();
    expect(lastTo(GROUP)).toContain('❌ <b>Chek bekor qilindi</b>');
    expect(lastTo(GROUP)).toContain('Mijoz qaytardi');

    // Boshqa filialga cheklangan chat bu filial sotuvini olmaydi
    await s.admin.patch(`/telegram/chats/${chat.id}`, { minAmount: 0, branchIds: [s.mainId] });
    const n2 = countTo(GROUP);
    await sell(1);
    await worker.processOnce();
    expect(countTo(GROUP)).toBe(n2);
    await s.admin.patch(`/telegram/chats/${chat.id}`, { branchIds: null });
  });

  it("buyruqlar va eski tugmalar: bugungi hisobot, cheklar ro'yxati, Excel fayl — javobda tugma yo'q", async () => {
    // Test bazasida boshqa fayllarning cheklari ham bor — hisobotni shu test filialiga cheklaymiz
    const ch0 = (await s.admin.get('/telegram')).body.chats[0];
    await s.admin.patch(`/telegram/chats/${ch0.id}`, { branchIds: [branch] });
    await bot.handleUpdate(groupMsg('/bugun'));
    const rep = lastTo(GROUP);
    expect(rep).toContain('📊 <b>Bugungi savdo');
    expect(rep).toContain('Tushum:');
    expect(rep).toContain('Bekor qilingan: 1 ta');
    expect(rep).toContain("Tushum: <b>100 000 so'm</b>");
    expect(rep).toContain('Yalpi foyda');

    const before = sent.length;
    await bot.handleUpdate(groupMsg('/cheklar'));
    const list = sent.slice(before).map((m) => m.text).join('\n');
    expect(list).toContain('🧾 <b>Cheklar');
    expect(list).toContain('❌ <s>');
    expect(list).toContain("Jami: <b>2</b> ta sotuv");

    // Eski xabardagi tugma bosilsa ham ishlaydi
    await bot.handleUpdate(press('x:t'));
    const d = docs.at(-1)!;
    expect(d.chatId).toBe(GROUP);
    expect(d.filename).toBe(`savdo-${tkDay()}.xlsx`);
    expect(d.buf.subarray(0, 2).toString()).toBe('PK'); // xlsx = zip
    expect(d.buf.length).toBeGreaterThan(3000);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(d.buf as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Jami', 'Cheklar', 'Mahsulotlar', "Mahsulot bo'yicha"]);
    const ch = wb.getWorksheet('Cheklar')!;
    expect(ch.rowCount).toBe(1 + 3); // sarlavha + 3 chek (biri bekor)
    expect(ch.getRow(1).getCell(2).value).toBe('Chek №');
    expect([2, 3, 4].map((i) => ch.getRow(i).getCell(4).value)).toContain('Bekor');
    expect(wb.getWorksheet("Mahsulot bo'yicha")!.getRow(2).getCell(4).value).toBe(100_000);
    // Hech bir xabarda tugma yuborilmaydi
    expect(markups.filter((m) => m && 'inline_keyboard' in m)).toHaveLength(0);
    expect(markups.filter((m) => m && 'keyboard' in m)).toHaveLength(0);

    // Foyda yashirilsa hisobotda ham yo'q
    const chat = (await s.admin.get('/telegram')).body.chats[0];
    await s.admin.patch(`/telegram/chats/${chat.id}`, { showProfit: false });
    await bot.handleUpdate(groupMsg('/bugun@test_bot'));
    expect(lastTo(GROUP)).not.toContain('foyda');
    await s.admin.patch(`/telegram/chats/${chat.id}`, { branchIds: null });
  });

  it('kun yakuni bir marta; sinov xabari; bot chiqarilsa chat o\'chadi', async () => {
    const notify = app.get(NotifyService);
    const db = app.get<Db>(DB);
    await notify.enqueueDaily(db, tkDay());
    await notify.enqueueDaily(db, tkDay());
    const n = countTo(GROUP);
    await worker.processOnce();
    expect(countTo(GROUP)).toBe(n + 1);
    expect(lastTo(GROUP)).toContain('Kun yakuni');

    const chat = (await s.admin.get('/telegram')).body.chats[0];
    expect((await s.admin.post(`/telegram/chats/${chat.id}/test`)).status).toBe(200);
    await worker.processOnce();
    expect(lastTo(GROUP)).toContain('Sinov xabari');

    failNext = new TelegramError(403, 'Forbidden: bot was kicked from the supergroup chat');
    await sell(1);
    await worker.processOnce();
    expect((await s.admin.get('/telegram')).body.chats[0].active).toBe(false);

    expect((await s.admin.del(`/telegram/chats/${chat.id}`)).status).toBe(204);
    expect((await s.admin.get('/telegram')).body.chats).toHaveLength(0);
  });
});
