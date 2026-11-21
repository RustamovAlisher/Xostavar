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
 *  5. Elasticsearch `match` + `minimum_should_match` kabi: hamma so'zi mos kelganlar tepada, keyin qisman moslar
 *     (istalgan so'z: 1–3 so'zli so'rovda kamida 1 tasi, uzunroqda yarmi), ko'proq so'z mos kelgani oldinroq.
 */

const APOS = /['`´‘’ʻʼʹ′ˈ]/g;

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: '', ь: '', ы: 'i', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h', ң: 'ng', ҷ: 'j', ѕ: 's', і: 'i',
};

/** Matnni normallashtirib so'zlarga (tokenlarga) ajratadi. */
export function foldTokens(input: string): string[] {
  // № ni NFKC «No» ga aylantiradi — matnda bunday harflar yo'q (SQL regex ham topa olmaydi), shuning uchun ajratuvchi
  let s = (input ?? '').replace(/№/g, ' ').normalize('NFKC').toLowerCase();
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

/* ───────── Sinonimlar (Elasticsearch synonym filter kabi) ───────── */

/**
 * Ichki lug'at: har qator — bir xil narsaning nomlari (rasmiy, ruscha, mahalliy/og'zaki). Kirill ham bo'ladi —
 * hammasi `fold` qilinadi. Bir nechta so'zli nom (ibora) ham mumkin: «suyuq mix, jidkie gvozdi».
 * Do'kon o'z nomlarini Sozlamalar → Qidiruv lug'atida qo'shadi (`setExtraSynonyms`).
 */
export const BUILTIN_SYNONYMS: readonly string[] = [
  'ombur, ombir, ambur, ambir, plaskagubsi, ploskogubsy, ploskogubtsy, passatij, passatiji, плоскогубцы, пассатижи, kombinirovannye',
  'bokorez, bokorezy, kusachki, kusachka, кусачки, бокорезы, sim kesgich',
  'bolgarka, болгарка, ushm, burchak shlifovka, shlifovka mashinasi, flex',
  'drel, дрель, drill, burg\'ilash mashinasi',
  'shurupovert, shurupavyort, шуруповерт, vintovert, akkumulyatorli drel, otvyortka mashina',
  'perforator, perfarator, перфоратор, puncher, udarnik',
  'sverlo, svyorlo, сверло, burg\'u, burgu, parma, parmali, sverloli, со сверлом',
  'bur, бур, sds',
  'otvertka, otvyortka, atvyortka, отвертка, отвёртка, burama, buragich, vint burag\'ich',
  'bit, bita, бита, nasadka, насадка',
  'ruletka, рулетка, o\'lchov lentasi, olchov lenta, metrovka',
  'arra, pila, пила, nojovka, ножовка, arracha',
  'disk arra, sirkulyarka, циркулярка, циркулярная пила, sirkulyar',
  'qaychi, nojnitsy, ножницы, kaychi',
  'sekator, секатор, bog\' qaychisi',
  'pichoq, noj, nozh, нож, kanselyarskiy pichoq, utility knife',
  'lezviye, lezviya, лезвие, лезвия, tig\'',
  'shpatel, шпатель, kurakcha, malyar shpateli',
  'gladilka, гладилка, palatorka, polutorka, poluterok, terka, терка, тёрка, malka',
  'kovsh, masterok, мастерок, chumich, kelma',
  'valik, валик, rolik, bo\'yoq roligi',
  'kist, кисть, cho\'tka, chotka, щетка, щётка, shotka, makloviitsa, maklovitsa',
  'bo\'yoq, boyok, kraska, краска, rang',
  'emal, эмаль',
  'gruntovka, грунтовка, grunt, astar',
  'shpaklyovka, shpatlyovka, shpaklevka, shpatlevka, шпаклевка, шпатлевка, shpaklyovka, putty',
  'erituvchi, rastvoritel, растворитель, razbavitel, разбавитель, 646',
  'yelim, elim, kley, клей, kleyi',
  'suyuq mix, jidkie gvozdi, жидкие гвозди, jidkiy gvozd',
  'germetik, герметик, silikon, силикон, sealant',
  'pena, пена, montaj pena, montaj penasi, ko\'pik, kopik, montajka',
  'izolenta, изолента, izolyatsiya lentasi',
  'skotch, скотч, yopishqoq lenta',
  'fum lenta, fumka, фумка, фум лента, ptfe',
  'rozetka, розетка, rozetkasi',
  'vyklyuchatel, viklyuchatel, выключатель, o\'chirgich, ochirgich, knopka',
  'udlinitel, удлинитель, ko\'chma rozetka, uzaytirgich, pilot, troynik, тройник',
  'vilka, вилка, shtepsel, штепсель, shtekker',
  'avtomat, автомат, avtomatik uzgich, predoxranitel, предохранитель, probka',
  'shchit, щит, shit, boks, avtomat qutisi',
  'lampochka, лампочка, lampa, лампа, chiroq, chirog\'i',
  'svetilnik, светильник, plafon, плафон, lyustra, люстра, chiroq',
  'prozhektor, projektor, прожектор, fonar, фонарь',
  'ventilyator, вентилятор, vytyajka, вытяжка, havo tortuvchi',
  'kran, кран, jo\'mrak, jomrak, sharovoy kran, sharli kran',
  'gazovoy klyuch, газовый ключ, truba kaliti, trubniy klyuch, трубный ключ',
  'kalit, klyuch, ключ',
  'qulf, kulf, zamok, замок, qulif',
  'payvandlash, svarka, сварка, svarochniy, сварочный, payvand',
  'elektrod, электрод, svarka simi',
  'nivelir, нивелир, uroven, уровень, daraja, darajasi, lazer',
  'samorez, samariz, саморез, shurup, шуруп, burama mix',
  'press shayba, press-shayba, presshayba, пресс-шайба, прессшайба, klop, клоп, shaybali',
  'anker mix, anker-mix, ankermix, dyubel mix, dyubel-mix, дюбель-гвоздь, дюбель гвоздь, montaj mixi, pistolet mixi',
  'anker, анкер, gluxar, glukhar, gluhar, глухарь, shurup-gluxar, lag screw, din 571',
  'krovelniy, krovelnyy, кровельный, tom samorezi, tom samorez, krovlya',
  'olti qirrali, shestigrannik, шестигранник, shestigrannoy, hex',
  'qalin, yo\'g\'on, yogon, tolstiy, толстый',
  'ingichka, yupqa, tonkiy, тонкий',
  'o\'tkir, otkir, ostriy, острый, ostry',
  'gipsokarton, gipsakarton, gipskarton, гипсокартон, gkl, гкл, drywall',
  'mix, gvozd, гвоздь, gvozdi, гвозди',
  'dyubel, дюбель',
  'shlang, шланг, rezina truba',
  'nasos, насос, pompa',
  'najdak, наждак, qum qog\'oz, shkurka, шкурка, zumpara',
  'gupka, gubka, губка, poralon, porolon, поролон',
  'sim, provod, провод, kabel, кабель',
  'kontaktor, контактор, puskatel, пускатель',
  'reduktor, редуктор, lyagushka',
  'gorelka, горелка',
  'stepler, степлер, skobozabivatel',
  'mikser, miksher, миксер, aralashtirgich',
  'fen, термофен, termofen, фен',
  'koronka, коронка',
  'koler, kolorant, колер, pigment',
  'ohak, izvest, известь',
  'suyuq shisha, jidkoe steklo, жидкое стекло',
  'serpyanka, серпянка, setka lenta',
  'disk, диск, krug, круг',
  'zanglamas, nerjaveyka, нержавейка, inox',
];

interface SynIndex { groups: string[][][]; singles: { tok: string; g: number }[]; phrases: { toks: string[]; g: number }[] }
let extraSynonyms: readonly string[] = [];
let synCache: { key: string; idx: SynIndex } | null = null;

/** Do'konning o'z sinonimlari (Sozlamalar → Qidiruv lug'ati): har element — vergul bilan ajratilgan nomlar. */
export function setExtraSynonyms(groups: readonly string[] | undefined | null): void {
  extraSynonyms = groups ?? [];
}

export function getExtraSynonyms(): readonly string[] {
  return extraSynonyms;
}

function synIndex(): SynIndex {
  const key = extraSynonyms.join('\n');
  if (synCache?.key === key) return synCache.idx;
  const groups = [...BUILTIN_SYNONYMS, ...extraSynonyms]
    .map((line) => line.split(/[,;=\n]/).map(foldTokens).filter((m) => m.length))
    .filter((g) => g.length >= 2);
  const idx: SynIndex = { groups, singles: [], phrases: [] };
  groups.forEach((g, gi) => g.forEach((m) => (m.length === 1 ? idx.singles.push({ tok: m[0], g: gi }) : idx.phrases.push({ toks: m, g: gi }))));
  synCache = { key, idx };
  return idx;
}

/**
 * So'rov: `tokens` — so'zlar; `units` — har so'z (yoki lug'atdagi ibora) uchun muqobillar ro'yxati.
 * Birinchi muqobil — foydalanuvchi yozgani, qolganlari sinonimlar (har biri bir yoki bir nechta token).
 */
export interface ParsedQuery {
  raw: string; tokens: string[]; units: string[][][];
  /** So'z × hujjat so'zi bali keshi (nomlarda so'zlar ko'p takrorlanadi — 5000 mahsulotda ~10 barobar tez). */
  memo: Map<string, Map<string, number>>;
}

let lastParsed: { key: string; q: ParsedQuery } | null = null;

export function parseQuery(q: string): ParsedQuery {
  const raw = (q ?? '').trim().toLowerCase();
  const idx = synIndex();
  const key = `${raw}\u0000${synCache!.key}`;
  if (lastParsed?.key === key) return lastParsed.q;
  const tokens = foldTokens(raw);
  const units: string[][][] = [];
  const uniq = (alts: string[][]) => [...new Map(alts.map((a) => [a.join(' '), a])).values()];
  for (let i = 0; i < tokens.length;) {
    // Lug'atdagi ibora (masalan «suyuq mix»): oxirgi so'z yozib tugatilmagan bo'lishi mumkin
    let hit: { L: number; g: number } | null = null;
    for (const ph of idx.phrases) {
      const L = ph.toks.length;
      if (i + L > tokens.length || (hit && hit.L >= L)) continue;
      const ok = ph.toks.every((pt, j) => pt === tokens[i + j] || (j === L - 1 && tokens[i + j].length >= 3 && pt.startsWith(tokens[i + j])));
      if (ok) hit = { L, g: ph.g };
    }
    if (hit) {
      units.push(uniq([tokens.slice(i, i + hit.L), ...idx.groups[hit.g]]));
      i += hit.L;
      continue;
    }
    const t = tokens[i];
    const alts: string[][] = [[t]];
    if (!isNum(t)) {
      for (const sy of idx.singles) {
        if (sy.tok === t || (t.length >= 4 && tokenScore(t, sy.tok) >= 4.5)) alts.push(...idx.groups[sy.g]);
      }
    }
    units.push(uniq(alts));
    i++;
  }
  const parsed: ParsedQuery = { raw, tokens, units, memo: new Map() };
  lastParsed = { key, q: parsed };
  return parsed;
}

const isNum = (t: string) => /\d/.test(t);

const collapse = (s: string) => (/^[a-zA-Z]+$/.test(s) ? s.replace(/([a-zA-Z])\1+/g, '$1') : s);

/** Bitta so'z bitta token bilan qanchalik mos (0 — mos emas). Qo'sh harflar (arra/ara) va unlilar (o/a, e/i) hisobga olinadi. */
function tokenScore(t: string, p: string): number {
  let s = rawScore(t, p);
  if (t.length < 3) return s;
  const c = collapse(t), cp = collapse(p);
  if (c !== t || cp !== p) s = Math.max(s, rawScore(c, cp) * 0.95);
  // Unlilar (rus «akanye»: gazovoy = gazavoy; e/i): faqat 5+ harfda — qisqa so'zda yolg'on moslik ko'payadi
  if (t.length >= 5 && s < 10) {
    const vt = vowelFold(c), vp = vowelFold(cp);
    if (vt !== c || vp !== cp) s = Math.max(s, rawScore(vt, vp) * 0.92);
  }
  return s;
}

const vowelFold = (s: string) => s.replace(/o/g, 'a').replace(/e/g, 'i');

// O'zbekcha qo'shimchalar (fold'dan keyin: q→k): arrasi = arra + si, mixlar = mix + lar (yengil stemmer)
const SUFFIX = /^(?:si|i|lar|lari|larni|larga|ni|ning|ga|ka|da|ta|dan|tan|dagi|lik|li)$/;

function rawScore(t: string, p: string): number {
  if (p === t) return 10;
  if (p.startsWith(t)) return 8 - Math.min(2, (p.length - t.length) * 0.1);
  // so'z + qo'shimcha (har ikki tomonda): «arrasi» → «arra», «arra» → «arrasi» prefiks bilan yuqorida
  if (p.length >= 3 && t.startsWith(p) && SUFFIX.test(t.slice(p.length))) return 7.5;
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

function best(t: string, tokens: string[], memo: Map<string, Map<string, number>>): { s: number; i: number } {
  let m = memo.get(t);
  if (!m) memo.set(t, (m = new Map()));
  let s = 0, idx = -1;
  for (let i = 0; i < tokens.length; i++) {
    const p = tokens[i];
    let v = m.get(p);
    if (v === undefined) m.set(p, (v = tokenScore(t, p)));
    if (v > s) { s = v; idx = i; }
  }
  return { s, i: idx };
}

export interface Scored { score: number; matched: number; total: number }

/** Hujjatning so'rovga mosligi: score > 0 va matched === total — to'liq mos. */
export function scoreDoc(doc: SearchDoc, q: ParsedQuery): Scored {
  const total = q.units.length;
  if (!total) return { score: 0, matched: 0, total };
  if (q.raw.length >= 2 && doc.codes.length) {
    if (doc.codes.includes(q.raw)) return { score: 200, matched: total, total };
    if (doc.codes.some((c) => c.includes(q.raw))) return { score: 60, matched: total, total };
  }
  let sum = 0, matched = 0, lastIdx = -1, ordered = true;
  for (const alts of q.units) {
    let bestS = 0, bestIdx = -1;
    alts.forEach((alt, k) => {
      // muqobil — hamma so'zi topilishi kerak (ibora); sinonim asl so'zdan biroz pastroq ball oladi
      let acc = 0, idx = -1;
      for (const t of alt) {
        const n = best(t, doc.name, q.memo);
        const e = best(t, doc.extra, q.memo);
        let s = Math.max(n.s, e.s * 0.7);
        if (s === 0 && k === 0 && t.length >= 3 && isNum(t) && doc.codes.some((c) => c.includes(t))) s = 4; // kodning raqamli bo'lagi
        if (s === 0) return;
        acc += s;
        if (idx < 0 && n.s >= e.s * 0.7) idx = n.i;
      }
      const v = (acc / alt.length) * (k === 0 ? 1 : 0.9);
      if (v > bestS) { bestS = v; bestIdx = idx; }
    });
    if (bestS > 0) {
      matched++;
      sum += bestS;
      if (bestIdx >= 0) { if (bestIdx < lastIdx) ordered = false; lastIdx = bestIdx; }
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
 * Avval hamma so'zi mos kelganlar, keyin qisman moslar (ko'p so'z mos → oldinroq). `strict` — faqat to'liq mos.
 */
export function rank<T>(items: readonly T[], query: string, getDoc: (x: T) => SearchDoc, strict = false): T[] {
  const q = parseQuery(query);
  if (!q.raw) return items as T[];
  if (!q.tokens.length) return items.filter((x) => getDoc(x).codes.some((c) => c.includes(q.raw)));
  const n = q.units.length;
  const minShould = n <= 3 ? 1 : Math.ceil(n / 2);
  const full: { x: T; s: number; m: number }[] = [];
  const part: { x: T; s: number; m: number }[] = [];
  for (const x of items) {
    const r = scoreDoc(getDoc(x), q);
    if (r.score <= 0) continue;
    if (r.matched === r.total) full.push({ x, s: r.score, m: r.matched });
    else if (!strict && r.matched >= minShould) part.push({ x, s: r.score, m: r.matched });
  }
  full.sort((a, b) => b.s - a.s); // sort barqaror — teng ballda asl tartib
  part.sort((a, b) => b.m - a.m || b.s - a.s);
  return [...full, ...part].map((e) => e.x);
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
 * qo'sh harflar; 5+ harfli so'zda o/a, e/i) qamrab oladi. Faqat [a-zA-Z0-9] dan tuzilgan `fold` tokeni beriladi —
 * regex'ni buzib bo'lmaydi.
 */
export function tokenRegex(token: string): string {
  const loose = token.length >= 5;
  const cls: Record<string, string> = {
    a: loose ? 'aаoо' : 'aа', b: 'bб', v: 'vwв', g: 'gгғ', d: 'dд', e: loose ? 'eеэёiи' : 'eеэё', j: 'jж', z: 'zз',
    i: loose ? 'iиыіeе' : 'iиыі', y: 'yй', k: 'kqкқc', l: 'lл', m: 'mм', n: 'nн', o: loose ? 'oоўaа' : 'oоў', p: 'pп', r: 'rр',
    s: 'sсцc', t: 'tт', u: 'uу', f: 'fф', h: 'hxхҳ',
  };
  const apos = "['`´‘’ʻʼ]?";
  let out = '';
  for (const ch of token) {
    // fold'dagi birikmalar ham qaytariladi: ts→s, kh/ks→h, zh/dj→j, ph→f
    if (ch === 'C') out += '(?:ch|ч)';
    else if (ch === 'S') out += '(?:sh|ш|щ)';
    else if (ch === 's') out += `t?[${cls.s}]+`;
    else if (ch === 'h') out += `(?:[${cls.h}]|[${cls.k}][${cls.h}${cls.s}])+`; // x, ҳ, kh, ks, qs, кс
    else if (ch === 'j') out += `(?:[${cls.j}]|zh|dj)+`;
    else if (ch === 'f') out += `(?:[${cls.f}]|ph)+`;
    else if (cls[ch]) out += `[${cls[ch]}]+${ch === 'o' || ch === 'g' ? apos : ''}`;
    else if (/[0-9]/.test(ch)) out += ch;
  }
  return out;
}
