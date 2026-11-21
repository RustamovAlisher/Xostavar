/**
 * Aqlli qidiruv yadrosi. Frontend (src/lib/search.ts) va backend (src/common/search.ts) da BIR XIL fayl —
 * birini o'zgartirsangiz, ikkinchisiga ham nusxalang (testlar ikkalasida bir xil).
 *
 * Qanday ishlaydi (Meilisearch/Typesense/Elasticsearch'dagi kabi, lekin o'zbek tiliga moslab):
 *  1. NORMALLASHTIRISH (`fold`): kichik harf, kirill→lotin, apostroflar (o', o‘, o`, ў) olib tashlanadi,
 *     imlo variantlari bir xil harfga keltiriladi: w→v, x/kh/ks→h, q→k, c→s/k, ts→s, ph→f, zh/dj→j,
 *     sh/ch bitta belgi, qo'sh harflar bittaga (pollwon → polvon). Shu sabab «qo'l», «қўл», «qol», «kol» bir xil.
 *  2. TOKENLASH: so'zlarga bo'linadi; raqam↔harf chegarasida ham (10mm = 10 mm), 5x10 = 5 10.
 *  3. HAR BIR SO'Z alohida topiladi (tartib ahamiyatsiz, hammasi bo'lishi kerak): aniq > prefiks > ichida > xato
 *     bilan (Damerau–Levenshtein; ruxsat etilgan xato soni so'z uzunligiga bog'liq).
 *  4. BALL bo'yicha tartiblash: aniq/prefiks yaxshiroq, nom maydoni variant/SKU dan kuchliroq,
 *     so'zlar ketma-ket kelsa bonus, qisqa nom (aniqroq) oldinda.
 *  5. Hech narsa chiqmasa — bitta so'zni tashlab qayta qidiriladi (nol natijadan qochish).
 */

const APOS = /['`´‘’ʻʼʹ′ˈ]/g;

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: '', ь: '', ы: 'i', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h', ң: 'ng', ҷ: 'j', ѕ: 's', і: 'i',
};

/** Matnni normallashtirib so'zlarga (tokenlarga) ajratadi. */
export function foldTokens(input: string): string[] {
  let s = (input ?? '').normalize('NFKC').toLowerCase();
  s = s.replace(/(\d)\s*[x×*х]\s*(?=\d)/g, '$1 '); // 5x10, 5х10, 5*10 → 5 10
  s = Array.from(s, (ch) => CYR[ch] ?? ch).join('');
  s = s.normalize('NFD').replace(/\p{M}/gu, '').replace(APOS, '');
  s = s
    .replace(/zh|dj/g, 'j')
    .replace(/kh/g, 'h')
    .replace(/ph/g, 'f')
    .replace(/ch/g, 'C') // C = ch, S = sh: bitta belgi
    .replace(/sh/g, 'S')
    .replace(/ck/g, 'k')
    .replace(/ts/g, 's')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/w/g, 'v')
    .replace(/x/g, 'h')
    .replace(/q/g, 'k')
    .replace(/ks/g, 'h'); // кс = x (Акфикс = Akfix)
  s = s.replace(/(\d)(?=[a-zA-Z])/g, '$1 ').replace(/([a-zA-Z])(?=\d)/g, '$1 ');
  return s
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    // qo'sh harflar bittaga (pollwon → polvon), lekin qisqa so'zlarda (mm, arra, kall) emas
    .map((t) => (t.length >= 5 && /^[a-zA-Z]+$/.test(t) ? t.replace(/([a-zA-Z])\1+/g, '$1') : t));
}

/** Bir qatorli normal ko'rinish (indekslar, solishtirish uchun). */
export function fold(input: string): string {
  return foldTokens(input).join(' ');
}

/** Ruxsat etilgan xato soni (Meilisearch kabi): 4 gacha — 0, 5–8 — 1, 9+ — 2. */
export function typoBudget(len: number): number {
  return len <= 4 ? 0 : len <= 8 ? 1 : 2;
}

/** Damerau–Levenshtein (OSA): almashtirish, qo'shish, o'chirish, qo'shni harflar o'rni. `max` dan oshsa max+1. */
export function editDistance(a: string, b: string, max: number): number {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (a === b) return 0;
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[lb];
}

export interface SearchDoc {
  /** Asosiy nom tokenlari (to'liq vazn). */
  name: string[];
  /** Qo'shimcha tokenlar: variant nomlari, SKU qismlari (0.7 vazn). */
  extra: string[];
  /** Xom kodlar (kichik harfda): SKU, shtrix-kod — qidiruv matni kod ichida bo'lsa to'g'ridan-to'g'ri topiladi. */
  codes: string[];
  nameKey: string;
}

export function makeDoc(names: string[], extras: string[] = [], codes: string[] = []): SearchDoc {
  const name = names.flatMap(foldTokens);
  return {
    name,
    extra: extras.flatMap(foldTokens),
    codes: codes.map((c) => c.trim().toLowerCase()).filter(Boolean),
    nameKey: name.join(' '),
  };
}

export interface ParsedQuery { raw: string; tokens: string[] }

export function parseQuery(q: string): ParsedQuery {
  const raw = (q ?? '').trim().toLowerCase();
  return { raw, tokens: foldTokens(raw) };
}

const isNum = (t: string) => /\d/.test(t);

const collapse = (s: string) => (/^[a-zA-Z]+$/.test(s) ? s.replace(/([a-zA-Z])\1+/g, '$1') : s);

/** Bitta so'z bitta token bilan qanchalik mos (0 — mos emas). Qo'sh harflar (arra/ara) ikki tomonda ham hisobga olinadi. */
function tokenScore(t: string, p: string): number {
  const s = rawScore(t, p);
  if (t.length < 3) return s;
  const c = collapse(t), cp = collapse(p);
  return c === t && cp === p ? s : Math.max(s, rawScore(c, cp) * 0.95);
}

function rawScore(t: string, p: string): number {
  if (p === t) return 10;
  if (p.startsWith(t)) return 8 - Math.min(2, (p.length - t.length) * 0.1);
  if (t.length >= 4 && p.includes(t)) return 5; // so'z o'rtasida — faqat 4+ belgi (3 belgida «ara» ⊂ «darajasi» kabi yolg'on moslik)
  if (isNum(t) || isNum(p)) return 0; // o'lcham/raqamlarda xato yo'q (5 ≠ 6)
  const k = typoBudget(t.length);
  if (k === 0) return 0;
  let best = k + 1;
  // to'liq so'zga yoki uning boshiga (yozib tugatilmagan so'z) nisbatan
  for (const L of [t.length - 1, t.length, t.length + 1]) {
    if (L < 2 || L > p.length) continue;
    best = Math.min(best, editDistance(t, p.slice(0, L), k));
  }
  best = Math.min(best, editDistance(t, p, k));
  return best <= k ? 6 - 1.5 * best : 0;
}

function best(t: string, tokens: string[]): { s: number; i: number } {
  let s = 0, idx = -1;
  for (let i = 0; i < tokens.length; i++) {
    const v = tokenScore(t, tokens[i]);
    if (v > s) { s = v; idx = i; }
  }
  return { s, i: idx };
}

export interface Scored { score: number; matched: number; total: number }

/** Hujjatning so'rovga mosligi: score > 0 va matched === total — to'liq mos. */
export function scoreDoc(doc: SearchDoc, q: ParsedQuery): Scored {
  const total = q.tokens.length;
  if (!total) return { score: 0, matched: 0, total };
  if (q.raw.length >= 2 && doc.codes.length) {
    if (doc.codes.includes(q.raw)) return { score: 200, matched: total, total };
    if (doc.codes.some((c) => c.includes(q.raw))) return { score: 60, matched: total, total };
  }
  let sum = 0, matched = 0, lastIdx = -1, ordered = true;
  for (const t of q.tokens) {
    const n = best(t, doc.name);
    const e = best(t, doc.extra);
    let s = Math.max(n.s, e.s * 0.7);
    if (s === 0 && t.length >= 3 && isNum(t) && doc.codes.some((c) => c.includes(t))) s = 4; // kodning raqamli bo'lagi
    if (s > 0) {
      matched++;
      sum += s;
      if (n.s >= e.s * 0.7 && n.i >= 0) { if (n.i < lastIdx) ordered = false; lastIdx = n.i; }
    }
  }
  if (!matched) return { score: 0, matched: 0, total };
  let score = sum;
  if (matched === total) {
    const key = q.tokens.join(' ');
    if (total > 1 && ordered) score += 3;
    if (doc.nameKey === key) score += 4;
    else if (doc.nameKey.startsWith(key)) score += 2;
  }
  score -= Math.min(2, doc.nameKey.length * 0.02);
  return { score: Math.max(score, 0.01), matched, total };
}

/**
 * Ro'yxatni so'rov bo'yicha filtrlaydi va ball bo'yicha tartiblaydi. Bo'sh so'rov — o'zgarishsiz.
 * To'liq mos kelganlar bo'lmasa va 2+ so'z bo'lsa — bitta so'zi mos kelmaganlari (past ball bilan); `strict` — faqat to'liq mos.
 */
export function rank<T>(items: readonly T[], query: string, getDoc: (x: T) => SearchDoc, strict = false): T[] {
  const q = parseQuery(query);
  if (!q.raw) return items as T[];
  if (!q.tokens.length) return items.filter((x) => getDoc(x).codes.some((c) => c.includes(q.raw)));
  const full: { x: T; s: number }[] = [];
  const part: { x: T; s: number }[] = [];
  const need = Math.max(1, q.tokens.length - 1);
  for (const x of items) {
    const r = scoreDoc(getDoc(x), q);
    if (r.score <= 0) continue;
    if (r.matched === r.total) full.push({ x, s: r.score });
    else if (!strict && q.tokens.length >= 2 && r.matched >= need) part.push({ x, s: r.score });
  }
  const pick = full.length ? full : part;
  return pick.sort((a, b) => b.s - a.s).map((e) => e.x); // sort barqaror — teng ballda asl tartib
}

/** Oddiy matnli ro'yxatlar uchun (mijoz, foydalanuvchi, xarajat...): har bir maydon — nom tokenlari. */
export function matchesText(query: string, ...texts: (string | undefined | null)[]): boolean {
  const q = parseQuery(query);
  if (!q.raw) return true;
  const doc = makeDoc(texts.map((t) => t ?? ''));
  const r = scoreDoc(doc, q);
  if (r.score > 0 && r.matched === r.total) return true;
  return texts.some((t) => (t ?? '').toLowerCase().includes(q.raw)); // fold bilan topilmagan g'alati belgilar
}

/** Matnli elementlarni tartiblab filtrlaydi. */
export function rankText<T>(items: readonly T[], query: string, getTexts: (x: T) => (string | undefined | null)[]): T[] {
  return rank(items, query, (x) => makeDoc(getTexts(x).map((t) => t ?? '')));
}

/**
 * SQL (Postgres `~*`) uchun regex: so'zning barcha imlo variantlarini (lotin/kirill, apostrof, w/v, k/q/қ, x/h/ҳ,
 * qo'sh harflar) qamrab oladi. Faqat [a-zA-Z0-9] dan tuzilgan `fold` tokenini beriladi — regex'ni buzib bo'lmaydi.
 */
export function tokenRegex(token: string): string {
  const cls: Record<string, string> = {
    a: 'aа', b: 'bб', v: 'vwв', g: 'gгғ', d: 'dд', e: 'eеэё', j: 'jж', z: 'zз', i: 'iиыі', y: 'yй', k: 'kqкқc', l: 'lл',
    m: 'mм', n: 'nн', o: 'oоў', p: 'pп', r: 'rр', s: 'sсцc', t: 'tт', u: 'uу', f: 'fф', h: 'hxхҳ',
  };
  const apos = "['`´‘’ʻʼ]?";
  let out = '';
  for (const ch of token) {
    if (ch === 'C') out += '(?:ch|ч)';
    else if (ch === 'S') out += '(?:sh|ш|щ)';
    else if (cls[ch]) out += `[${cls[ch]}]+${ch === 'o' || ch === 'g' ? apos : ''}`;
    else if (/[0-9]/.test(ch)) out += ch;
    else out += '';
  }
  return out;
}
