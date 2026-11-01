#!/usr/bin/env python3
"""Mahsulot kiritish yordamchisi — API orqali (lokal yoki demo/prod server).

Muhit o'zgaruvchilari:
  XOSTAVAR_API       API manzili (standart: https://demo.ombor-control.uz/api/v1)
  XOSTAVAR_LOGIN     foydalanuvchi logini (standart: admin)
  XOSTAVAR_PASSWORD  parol (standart: 1234)

Buyruqlar:
  addprod.py settings                     kategoriyalar, birliklar, o'lcham andozalari
  addprod.py search <matn>                nom / SKU bo'yicha qidirish (dublikat tekshiruvi — add dan OLDIN)
  addprod.py add <spec.json> [--force]    mahsulot yaratish; spec ichida "image" bo'lsa rasm ham biriktiriladi
  addprod.py image <SKU> <fayl|URL>       rasm biriktirish (URL bo'lsa yuklab olinadi; server 1200px + eskizga keltiradi)
  addprod.py show <SKU>                   mahsulotni to'liq ko'rsatish
  addprod.py update <SKU> <spec.json>     mavjud mahsulotni yangilash (versiya avtomatik olinadi)
  addprod.py done <SKU> <rasm...>         ishlov berilgan rasmlarni `qoshilgan/` papkasiga SKU prefiksi bilan ko'chirish

spec.json — POST /products tanasi + "categoryName" (kategoriya nomi) + ixtiyoriy "image" va "costPrice" (tannarx):
  {
    "categoryName": "Bo'yoqlar",
    "name": "Numix Reliance molotkovaya bo'yoq 2,2 kg (bolg'a effektli emal)",
    "sku": "NUMIX-REL", "baseUnit": "piece", "isDivisible": false, "conversions": [],
    "description": "…", "isVariable": true,
    "costPrice": 80000,
    "variants": [{ "name": "407", "sku": "NUMIX-REL-407", "retailPrice": 100000 },
                 { "name": "444", "sku": "NUMIX-REL-444", "retailPrice": 100000, "costPrice": 82000 }],
    "image": "https://…/rasm.jpg"
  }
Variantsiz mahsulot: "isVariable": false, "retailPrice": 25000, "costPrice": 18000 (variants yo'q).
Variantli mahsulotda yuqori darajadagi "costPrice" o'z tannarxi yozilmagan barcha variantlarga qo'llanadi.
Tannarx asosiy filial (MAIN) uchun yoziladi — skript X-Branch-Id ni o'zi qo'yadi.
"""
import json, mimetypes, os, re, shutil, sys, tempfile, urllib.parse, urllib.request, uuid

BASE = os.environ.get('XOSTAVAR_API', 'https://demo.ombor-control.uz/api/v1').rstrip('/')
LOGIN = os.environ.get('XOSTAVAR_LOGIN', 'admin')
PASSWORD = os.environ.get('XOSTAVAR_PASSWORD', '1234')
_tok = None
_branch = None  # asosiy filial id — tannarx/qoldiq shu filial uchun


def call(method, path, body=None, headers=None, raw=None):
    req = urllib.request.Request(BASE + path, method=method)
    h = dict(headers or {})
    if _tok:
        h['Authorization'] = 'Bearer ' + _tok
    if _branch:
        h['X-Branch-Id'] = _branch
    data = None
    if raw is not None:
        data = raw
    elif body is not None:
        data = json.dumps(body).encode()
        h['Content-Type'] = 'application/json'
    if method == 'POST' and raw is None:
        h['Idempotency-Key'] = str(uuid.uuid4())
    for k, v in h.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, data=data, timeout=90) as r:
            t = r.read().decode()
            return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        msg = e.read().decode()[:800]
        try:
            msg = json.loads(msg)['error']
            msg = f"{msg.get('code')}: {msg.get('message')}" + (f" {json.dumps(msg.get('details'), ensure_ascii=False)}" if msg.get('details') else '')
        except Exception:
            pass
        print(f'XATO {e.code} {method} {path}: {msg}')
        sys.exit(1)


def login():
    global _tok, _branch
    _tok = call('POST', '/auth/login', {'login': LOGIN, 'password': PASSWORD})['accessToken']
    branches = call('GET', '/branches')
    main = [b for b in branches if b.get('isMain')] or [b for b in branches if b.get('code') == 'MAIN'] or branches[:1]
    _branch = main[0]['id'] if main else None


def settings():
    return call('GET', '/settings')


def norm(s):
    return re.sub(r'[^a-z0-9а-яё]+', ' ', (s or '').lower().replace("'", '').replace('‘', '').replace('ʻ', '')).strip()


def search(q, page_size=20):
    return call('GET', f'/products?q={urllib.parse.quote(q)}&pageSize={page_size}')['items']


def find(sku):
    hit = [p for p in search(sku) if p['sku'].lower() == sku.lower()]
    if not hit:
        print('topilmadi:', sku)
        sys.exit(1)
    return hit[0]


def upload(pid, src):
    path = src
    if re.match(r'^https?://', src):
        req = urllib.request.Request(src, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
            ext = mimetypes.guess_extension(r.headers.get_content_type() or '') or '.jpg'
        fd, path = tempfile.mkstemp(suffix=ext)
        os.write(fd, data)
        os.close(fd)
    ctype = mimetypes.guess_type(path)[0] or 'image/jpeg'
    data = open(path, 'rb').read()
    boundary = '----xostavar' + uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{os.path.basename(path)}"\r\nContent-Type: {ctype}\r\n\r\n').encode() + data + f'\r\n--{boundary}--\r\n'.encode()
    return call('POST', f'/products/{pid}/image', raw=body, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})


def brief(p):
    cost = lambda x: f"/t{x['costPrice']}" if x.get('costPrice') else ''
    v = [f"{x['sku']} {x['name']} {x['retailPrice']}{cost(x)}" for x in p.get('variants') or []]
    return f"{p['sku']} | {p['name']} | {p['baseUnit']} | {'variantlar (narx/t=tannarx): ' + '; '.join(v) if v else 'narx ' + str(p['retailPrice']) + cost(p)} | rasm: {'bor' if p.get('imageUrl') else 'yoq'}"


def apply_cost(spec):
    """Variantli mahsulotda yuqori darajadagi costPrice → o'z tannarxi yo'q variantlarga."""
    if spec.get('isVariable') and spec.get('costPrice') is not None:
        for v in spec.get('variants') or []:
            v.setdefault('costPrice', spec['costPrice'])
        spec.pop('costPrice')
    return spec


def resolve_category(spec):
    cname = spec.pop('categoryName', None)
    if cname and not spec.get('categoryId'):
        cats = [c for c in settings()['categories'] if c['name'].lower() == cname.lower()]
        if not cats:
            print(f'kategoriya topilmadi: "{cname}". Mavjudlari: ' + ', '.join(c['name'] for c in settings()['categories']))
            sys.exit(1)
        spec['categoryId'] = cats[0]['id']
    return spec


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)
    cmd = sys.argv[1]
    if cmd == 'done':  # serverga ulanish shart emas
        sku = sys.argv[2]
        for f in sys.argv[3:]:
            dst_dir = os.path.join(os.path.dirname(os.path.abspath(f)), 'qoshilgan')
            os.makedirs(dst_dir, exist_ok=True)
            dst = os.path.join(dst_dir, f'{sku}__{os.path.basename(f)}')
            shutil.move(f, dst)
            print('ko\'chirildi:', dst)
        return
    login()
    if cmd == 'settings':
        s = settings()
        print('== kategoriyalar')
        for c in s['categories']:
            print(f"  {c['name']}  | asosiy birlik: {c.get('defaultBaseUnit')} | shablon: {[(x['unit'], x['factor']) for x in c.get('defaultConversions', [])]}")
        print('== birliklar: ' + ', '.join(f"{u['id']} ({u['short']})" for u in s['units']))
        print('== o\'lcham andozalari:')
        byc = {c['id']: c['name'] for c in s['categories']}
        for p in s['sizePresets']:
            print(f"  {byc.get(p['categoryId'])}: {p['name']}{' — ' + str(p['kgPerMeter']) + ' kg/m' if p.get('kgPerMeter') else ''}")
    elif cmd == 'search':
        items = search(sys.argv[2])
        print(f'{len(items)} ta topildi' if items else 'hech narsa topilmadi')
        for p in items:
            print('  ' + brief(p))
    elif cmd == 'add':
        spec = json.load(open(sys.argv[2]))
        force = '--force' in sys.argv
        image = spec.pop('image', None)
        spec = resolve_category(spec)
        # Dublikat tekshiruvi: SKU va o'xshash nom
        if spec.get('sku'):
            same = [p for p in search(spec['sku']) if p['sku'].lower() == spec['sku'].lower()]
            if same:
                print('BOR: shu SKU bilan mahsulot mavjud — ' + brief(same[0]))
                sys.exit(2)
        words = norm(spec['name']).split()
        similar = [p for p in search(' '.join(words[:2])) if norm(p['name']) == norm(spec['name']) or norm(spec['name']) in norm(p['name']) or norm(p['name']) in norm(spec['name'])]
        if similar and not force:
            print("O'XSHASH mahsulot bor (dublikat bo'lishi mumkin). Tekshiring; baribir qo'shish uchun --force:")
            for p in similar:
                print('  ' + brief(p))
            sys.exit(2)
        p = call('POST', '/products', apply_cost(spec))
        print('QO\'SHILDI: ' + brief(p))
        if image:
            r = upload(p['id'], image)
            print('rasm:', r.get('imageUrl'))
    elif cmd == 'image':
        p = find(sys.argv[2])
        r = upload(p['id'], sys.argv[3])
        print('rasm:', r.get('imageUrl'), '| eskiz:', r.get('thumbUrl'))
    elif cmd == 'show':
        print(json.dumps(find(sys.argv[2]), ensure_ascii=False, indent=1))
    elif cmd == 'update':
        cur = find(sys.argv[2])
        spec = resolve_category(json.load(open(sys.argv[3])))
        image = spec.pop('image', None)
        body = {
            'name': cur['name'], 'categoryId': cur['categoryId'], 'sku': cur['sku'], 'barcodes': cur.get('barcodes', []),
            'description': cur.get('description'), 'baseUnit': cur['baseUnit'], 'isDivisible': cur['isDivisible'],
            'conversions': [{k: v for k, v in c.items() if k in ('unit', 'factor', 'price', 'barcode')} for c in cur.get('conversions', [])],
            'retailPrice': cur.get('retailPrice'), 'wholesalePrice': cur.get('wholesalePrice'), 'isVariable': cur['isVariable'],
            'variants': [{'id': v['id'], 'name': v['name'], 'sku': v['sku'], 'barcodes': v.get('barcodes', []), 'retailPrice': v['retailPrice'], 'wholesalePrice': v.get('wholesalePrice'), 'conversions': v.get('conversions')} for v in cur.get('variants') or []],
            'version': cur['version'],
        }
        body.update(spec)
        p = call('PUT', f"/products/{cur['id']}", apply_cost(body))
        print('YANGILANDI: ' + brief(p))
        if image:
            r = upload(p['id'], image)
            print('rasm:', r.get('imageUrl'))
    else:
        print(__doc__)


if __name__ == '__main__':
    main()
