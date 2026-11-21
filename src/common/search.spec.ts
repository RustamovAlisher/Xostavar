import { describe, expect, it } from 'vitest';
import { fold, foldTokens, makeDoc, rank, rankText, matchesText, tokenRegex, editDistance, setExtraSynonyms } from './search.js';

const names = [
  "Polvon qo'l arrasi",
  "Polvon elektr arra",
  "Bosch qo'l arrasi 500mm",
  'Shtukaturka 25 kg',
  'Sement M400 50 kg',
  'Mix 5x10 mm',
  'Gvozd 100 mm',
  'Gvozd 10 mm',
  'Қўл арра Полвон',
];
const find = (q: string) => rankText(names, q, (n) => [n]);

describe('fold', () => {
  it('imlo variantlari bir xil kalitga keladi', () => {
    expect(fold('pollwon')).toBe('polvon');
    expect(fold('Полвон')).toBe('polvon');
    expect(fold("qo'l")).toBe(fold('қўл'));
    expect(fold('qo‘l')).toBe(fold('kol'));
    expect(fold('Цемент')).toBe(fold('sement'));
    expect(fold('Xostavar')).toBe(fold('hostavar'));
    expect(fold('shifer')).toBe(fold('шифер'));
    expect(fold('Акфикс')).toBe(fold('Akfix'));
    expect(fold('Лексус')).toBe(fold('lexus'));
  });
  it("raqam/harf chegarasi va o'lcham", () => {
    expect(foldTokens('10mm')).toEqual(['10', 'mm']);
    expect(foldTokens('5x10')).toEqual(['5', '10']);
    expect(foldTokens('5*10 мм')).toEqual(['5', '10', 'mm']);
    expect(foldTokens('Kirim №12')).toEqual(['kirim', '12']); // № → ajratuvchi (NFKC «No» emas)
  });
});

describe('editDistance', () => {
  it('Damerau', () => {
    expect(editDistance('polvon', 'polvno', 2)).toBe(1); // transpozitsiya
    expect(editDistance('abc', 'xyz', 1)).toBe(2); // max+1
  });
});

describe('rank', () => {
  it('pollwon arrasi → Polvon arralari', () => {
    const r = find('pollwon arrasi');
    expect(r).toContain("Polvon qo'l arrasi");
    expect(r[0]).toBe("Polvon qo'l arrasi");
  });
  it("so'zlar tartibi ahamiyatsiz", () => {
    expect(find("arrasi qo'l polvon")[0]).toBe("Polvon qo'l arrasi");
    expect(find('qol polvon')).toContain("Polvon qo'l arrasi");
  });
  it('kirill va lotin', () => {
    expect(find('қўл полвон')).toEqual(expect.arrayContaining(["Polvon qo'l arrasi", 'Қўл арра Полвон']));
    expect(find('Полвон арра')).toContain('Polvon elektr arra');
    expect(find('цемент')).toEqual(['Sement M400 50 kg']);
    expect(find('sement')).toEqual(['Sement M400 50 kg']);
  });
  it("4 harfli so'zda xato yo'q (arra ≠ abra), 5+ da bor", () => {
    expect(rankText(['Abraziv'], 'arra', (n) => [n])).toEqual([]);
    expect(rankText(['Gvozdilka'], 'gvozdlka', (n) => [n])).toHaveLength(1);
  });
  it('xato bilan yozilgan', () => {
    expect(find('polwan')).toContain("Polvon qo'l arrasi");
    expect(find('polvno')).toContain("Polvon qo'l arrasi");
    expect(find('shtukatruka')).toContain('Shtukaturka 25 kg');
  });
  it("o'lcham aniq: 10 mm ≠ 100 mm birinchi", () => {
    expect(find('gvozd 10mm')[0]).toBe('Gvozd 10 mm');
    expect(find('5х10')).toContain('Mix 5x10 mm');
  });
  it("qisman yozilgan so'z (prefiks)", () => {
    expect(find('pol arr')).toEqual(expect.arrayContaining(["Polvon qo'l arrasi", 'Polvon elektr arra']));
    expect(find('shtuk')).toEqual(['Shtukaturka 25 kg']);
  });
  it('bo\'sh so\'rov — hammasi; begona so\'z — bo\'sh', () => {
    expect(find('  ')).toHaveLength(names.length);
    expect(find('zzzzqqq')).toEqual([]);
  });
  it("istalgan so'z (Elasticsearch match kabi): to'liq moslar tepada, qisman moslar pastda", () => {
    expect(find('polvon xyzxyz')).toContain("Polvon qo'l arrasi");
    const r = find("bosch qo'l arrasi");
    expect(r[0]).toBe("Bosch qo'l arrasi 500mm");
    expect(r).toContain("Polvon qo'l arrasi"); // 2 ta so'zi mos
    expect(r.indexOf("Polvon qo'l arrasi")).toBeLessThan(r.indexOf('Polvon elektr arra')); // 2 so'z > 1 so'z
    expect(rankText(names, "bosch qo'l arrasi", (n) => [n]).length).toBeGreaterThan(1);
    expect(rank(names, "bosch qo'l arrasi", (n) => makeDoc([n]), true)).toEqual(["Bosch qo'l arrasi 500mm"]); // strict
  });
  it('kodlar: SKU/shtrix-kod bo\'yicha', () => {
    const items = [
      { n: 'A', code: 'AB-120', bc: '4780001' },
      { n: 'B', code: 'ZZ-9', bc: '4780002' },
    ];
    const r = rank(items, '4780002', (x) => makeDoc([x.n], [x.code], [x.code, x.bc]));
    expect(r.map((x) => x.n)).toEqual(['B']);
    expect(rank(items, 'ab-12', (x) => makeDoc([x.n], [x.code], [x.code, x.bc])).map((x) => x.n)).toEqual(['A']);
  });
});

describe('matchesText', () => {
  it('ism va tartib', () => {
    expect(matchesText('akbar aliyev', 'Aliyev Akbar')).toBe(true);
    expect(matchesText('Акбар', 'Akbar Karimov')).toBe(true);
    expect(matchesText('bobur', 'Akbar Karimov')).toBe(false);
  });
});

describe('tokenRegex', () => {
  const re = (t: string) => new RegExp(tokenRegex(foldTokens(t)[0]), 'i');
  it('SQL regex imlo variantlarini qamraydi', () => {
    expect(re('polvon').test('Полвон')).toBe(true);
    expect(re('pollwon').test('Polvon arra')).toBe(true);
    expect(re('kol').test("qo'l arra")).toBe(true);
    expect(re('kol').test('қўл')).toBe(true);
    expect(re('arrasi').test('arasi')).toBe(true);
    expect(re('sement').test('цемент')).toBe(true);
    expect(re('ploskogubtsy').test('Pollwon ploskogubtsy')).toBe(true); // ts → s
    expect(re('plaskagubsi').test('ploskogubtsy')).toBe(false); // y≠i oxirida: SQL da xato-tuzatish yo'q
    expect(re('akfix').test('Akfiks')).toBe(true); // x = ks
    expect(re('jidkie').test('zhidkie')).toBe(true); // zh = j
    expect(re('qsyhq').test('Pollwon 3qsyhq')).toBe(true); // q→k, ks→h zanjiri
  });
});

describe("mahalliy nomlar, harf va unli farqlari (foydalanuvchi so'rovlari)", () => {
  const cat = [
    'Pollwon ploskogubtsy va bokorezy, ikki komponentli dasta',
    'Truba kaliti richagli (газовый / трубный ключ), qizil',
    "Pollwon qo'l arrasi yog'och uchun (ножовка), 3D tish",
    'Akfix 620 Power Classic montaj kleyi (suyuq mix), shaffof, 310 ml',
    'U-Yes 880 montaj yelimi (jidkie gvozdi), 350 ml',
    'Makute burchak shlifovka mashinasi (bolgarka)',
    'Sait 646 erituvchi (rastvoritel) 1 l',
    'Ruletka 3 m, sariq',
  ];
  const f = (q: string) => rankText(cat, q, (n) => [n]);
  it('bitta l / ikkita l: polwon = pollwon', () => {
    expect(f('polwon')[0]).toMatch(/^Pollwon/);
    expect(f('pollwon')[0]).toMatch(/^Pollwon/);
    expect(f('polvon arra')[0]).toBe("Pollwon qo'l arrasi yog'och uchun (ножовка), 3D tish");
  });
  it('unli farqi: gazovoy = gazavoy = газовый', () => {
    for (const q of ['gazovoy', 'gazavoy', 'газовый', 'gazoviy kalit']) expect(f(q)[0], q).toMatch(/^Truba kaliti/);
  });
  it('mahalliy nom: ombur / ploskegubsa / passatij → ploskogubtsy', () => {
    for (const q of ['ombur', 'ombir', 'ploskegubsa', 'plaskagubsi', 'пассатижи', 'ombur pollwon']) expect(f(q)[0], q).toMatch(/ploskogubtsy/);
  });
  it('ibora sinonimi: suyuq mix ↔ jidkie gvozdi (ikkala mahsulot)', () => {
    expect(f('jidkie gvozdi')).toEqual(expect.arrayContaining([cat[3], cat[4]]));
    expect(f('suyuq mix')).toEqual(expect.arrayContaining([cat[3], cat[4]]));
  });
  it('boshqa sinonimlar: nojovka→arra, rastvaritel, рулетка, ushm', () => {
    expect(f('nojovka')[0]).toMatch(/arrasi/);
    expect(f('rastvaritel')[0]).toMatch(/erituvchi/);
    expect(f('рулетка')[0]).toMatch(/^Ruletka/);
    expect(f('ushm')[0]).toMatch(/bolgarka/);
  });
  it("do'kon lug'ati (Sozlamalar): qo'shilgan nom ishlaydi, olib tashlansa ishlamaydi", () => {
    expect(f('tarozicha')).toEqual([]);
    setExtraSynonyms(['tarozicha, ruletka']);
    expect(f('tarozicha')[0]).toMatch(/^Ruletka/);
    setExtraSynonyms([]);
    expect(f('tarozicha')).toEqual([]);
  });
  it("qisqa so'zda unli farqi yolg'on moslik bermaydi (kol ≠ kalit)", () => {
    expect(f('kol')).not.toContain('Truba kaliti richagli (газовый / трубный ключ), qizil');
  });
  it('SQL regex: 5+ harfda o/a', () => {
    const re = new RegExp(tokenRegex(foldTokens('gazavoy')[0]), 'i');
    expect(re.test('gazovoy klyuch')).toBe(true);
    expect(re.test('газовый')).toBe(false); // -ый: regex xatoga chidamli emas, faqat imlo variantlari
  });
});

describe("samorezlar: press-shayba, uch turi, gipsokarton (bozor atamalari)", () => {
  const cat = [
    "Press-shaybali samorez, o'tkir uchli (rux qoplamali, oq)",
    "Press-shaybali samorez, parmali uchli (rux qoplamali, oq)",
    "Samorez gipsokarton va yog'och uchun, qora (fosfatlangan), yirik rezbali",
  ];
  const f = (q: string) => rankText(cat, q, (n) => [n]);
  it('press shayba / klop / пресс-шайба → ikkala press-shaybali', () => {
    for (const q of ['press shayba', 'klop samorez', 'пресс-шайба', 'presshayba']) expect(f(q).slice(0, 2).sort(), q).toEqual([cat[0], cat[1]].sort());
  });
  it("uch turi: sverlo/parmali → parmali; ostriy → o'tkir", () => {
    expect(f('samorez sverlo')[0]).toBe(cat[1]);
    expect(f('samariz parmali')[0]).toBe(cat[1]);
    expect(f('саморез острый')[0]).toBe(cat[0]);
  });
  it('gipsakarton samariz → qora gipsokarton samorezi', () => {
    expect(f('gipsakarton samariz')[0]).toBe(cat[2]);
    expect(f('саморез гкл')[0]).toBe(cat[2]);
  });
});

describe('gluxar va tom samorezi (bozor atamalari)', () => {
  const cat = [
    'Tom samorezi (krovelniy), rezina shaybali, olti qirrali bosh',
    "Shurup-gluxar (olti qirrali boshli yog'och shurupi), Ø8 mm, rux qoplamali",
    "Shurup-gluxar (olti qirrali boshli yog'och shurupi), Ø10 mm, rux qoplamali",
    "Press-shaybali samorez, o'tkir uchli (rux qoplamali, oq)",
  ];
  const f = (q: string) => rankText(cat, q, (n) => [n]);
  it('глухарь / gluhar 10 → gluxar Ø10', () => {
    expect(f('глухарь 10')[0]).toBe(cat[2]);
    expect(f('gluhar 8')[0]).toBe(cat[1]);
  });
  it('anker = gluxar (bozorda «anker»)', () => {
    const a = ['Anker (shurup-gluxar, olti qirrali bosh, rux qoplamali)', "Press-shaybali samorez, o'tkir uchli (rux qoplamali, oq)"];
    expect(rankText(a, 'анкер 100', (n) => [n])[0]).toBe(a[0]);
    expect(rankText(a, 'gluxar', (n) => [n])[0]).toBe(a[0]);
  });
  it("yo'g'on/толстый → qalin, тонкий → ingichka (variant tanlash)", () => {
    const v = ['100 mm (100-lik), ingichka', '100 mm (100-lik), qalin'];
    expect(rankText(v, "100 yo'g'on", (n) => [n])[0]).toBe(v[1]);
    expect(rankText(v, 'толстый 100', (n) => [n])[0]).toBe(v[1]);
    expect(rankText(v, 'тонкий 100', (n) => [n])[0]).toBe(v[0]);
  });
  it('кровельный саморез / krovelniy → tom samorezi', () => {
    expect(f('кровельный саморез')[0]).toBe(cat[0]);
    expect(f('krovelnyy')[0]).toBe(cat[0]);
  });
});

describe('anker mix (dyubel-mix) ≠ anker (gluxar)', () => {
  const cat = ['Anker (shurup-gluxar, olti qirrali bosh, rux qoplamali)', 'Anker mix (dyubel-mix, montaj pistoleti uchun, shaybali)',
    "Qurilish mixi (gvozd), qora po'lat — GOST 4028-63"];
  const f = (q: string) => rankText(cat, q, (n) => [n]);
  it('anker mix / дюбель-гвоздь → anker mix birinchi', () => {
    expect(f('anker mix 50')[0]).toBe(cat[1]);
    expect(f('дюбель-гвоздь')[0]).toBe(cat[1]);
    expect(f('ankermix')[0]).toBe(cat[1]);
  });
  it('anker / глухарь → gluxar-anker birinchi', () => {
    expect(f('глухарь')[0]).toBe(cat[0]);
  });
});

describe('tom shaybasi — uchala nom bilan', () => {
  const cat = ['Tom shaybasi (krisha shaybasi, shifer shaybasi), rezinali, rux qoplamali',
    'Tom samorezi (krovelniy), rezina shaybali, olti qirrali bosh', 'Delixi CDB6PLEi differensial avtomat 1P+N, 30 mA'];
  const f = (q: string) => rankText(cat, q, (n) => [n]);
  it("tom / krisha / shifer shaybasi va ruscha → shayba birinchi", () => {
    for (const q of ['tom shaybasi', 'krisha shayba', 'shifer shaybasi', 'кровельная шайба', 'шайба для шифера', 'krisha shaybasi']) expect(f(q)[0], q).toBe(cat[0]);
  });
  it('krisha samorez → tom samorezi', () => {
    expect(f('krisha samorez')[0]).toBe(cat[1]);
  });
});
