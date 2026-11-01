#!/usr/bin/env python3
"""Rasm papkasini kuzatadi: yangi rasm tushib, nusxalash tugagach nomlarini chiqarib chiqadi.

  python3 backend/tools/watch_rasmlar.py [papka] [--interval 5]

Claude Code fonda ishga tushiradi (run_in_background); skript chiqishi bilan Claude xabar oladi va
chiqarilgan rasmlarni MAHSULOT-KIRITISH.md bo'yicha kiritadi, so'ng skriptni qayta ishga tushiradi.
Papkada boshidanoq kiritilmagan rasm bo'lsa, darhol ularni chiqaradi (`qoshilgan/` papkasi hisobga olinmaydi).
Chiqish: har qatorda bitta rasm yo'li; hech narsa topilmasa chiqmaydi, kutaveradi.
"""
import os, re, sys, time

EXT = {'.jpg', '.jpeg', '.png', '.webp'}
DONE = re.compile(r'^[A-Z0-9-]+__')  # `done` bilan belgilangan (SKU__nom.jpg) — allaqachon kiritilgan, e'tiborsiz


def images(folder):
    out = {}
    for n in os.listdir(folder):
        p = os.path.join(folder, n)
        if os.path.isfile(p) and os.path.splitext(n)[1].lower() in EXT and not DONE.match(n):
            out[p] = os.path.getsize(p)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    folder = args[0] if args else 'real-mahsulotlar-rasimlari'
    interval = 5
    if '--interval' in sys.argv:
        interval = float(sys.argv[sys.argv.index('--interval') + 1])
    os.makedirs(folder, exist_ok=True)
    print(f'kuzatilmoqda: {os.path.abspath(folder)} (har {interval:g} s)', file=sys.stderr, flush=True)
    prev = None
    while True:
        cur = images(folder)
        # Nusxalash tugaganini bilish uchun hajm ikki tekshiruvda bir xil bo'lishi kerak
        if prev is not None:
            stable = [p for p, s in cur.items() if s > 0 and prev.get(p) == s]
            if stable:
                for p in sorted(stable):
                    print(p, flush=True)
                return
        prev = cur
        time.sleep(interval)


if __name__ == '__main__':
    main()
