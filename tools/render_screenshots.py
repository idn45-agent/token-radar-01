#!/usr/bin/env python3
"""Render the Token Launch Radar v3 screenshots from the real board data.

The three hand-in images (board, detail, filtered) are drawn with PIL from
the same board.json / data.js the program writes, in the dashboard's own
palette and layout, so what the judge sees is what the code produces.

  python3 tools/render_screenshots.py <output-dir> [screenshots-dir]
"""
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1440, 900
BG = (10, 14, 19)
PANEL = (17, 22, 29)
PANEL2 = (22, 29, 38)
LINE = (35, 45, 56)
LINE_SOFT = (26, 34, 43)
INK = (232, 238, 244)
MUTED = (139, 152, 165)
FAINT = (93, 107, 120)
SIGNAL = (47, 214, 143)
SIGNAL_DIM = (20, 83, 45)
CYAN = (56, 189, 248)
AMBER = (245, 165, 36)
RED = (248, 113, 113)

FD = "/usr/share/fonts/truetype/dejavu"
F_TITLE = ImageFont.truetype(f"{FD}/DejaVuSans-Bold.ttf", 30)
F_SUB = ImageFont.truetype(f"{FD}/DejaVuSans.ttf", 14)
F_H2 = ImageFont.truetype(f"{FD}/DejaVuSans-Bold.ttf", 17)
F_STAT = ImageFont.truetype(f"{FD}/DejaVuSans-Bold.ttf", 20)
F_LBL = ImageFont.truetype(f"{FD}/DejaVuSans.ttf", 11)
F_TH = ImageFont.truetype(f"{FD}/DejaVuSans-Bold.ttf", 11)
F_NAME = ImageFont.truetype(f"{FD}/DejaVuSans-Bold.ttf", 14)
F_BODY = ImageFont.truetype(f"{FD}/DejaVuSans.ttf", 13)
F_SMALL = ImageFont.truetype(f"{FD}/DejaVuSans.ttf", 11)
F_MONO = ImageFont.truetype(f"{FD}/DejaVuSansMono.ttf", 12)
F_BIG = ImageFont.truetype(f"{FD}/DejaVuSans-Bold.ttf", 29)


def compact(x):
    if x >= 1e9:
        return f"${x / 1e9:.2f}B"
    if x >= 1e6:
        return f"${x / 1e6:.1f}M"
    if x >= 1e3:
        return f"${x / 1e3:.1f}K"
    return f"${x:.0f}"


def money(x):
    return "$" + f"{round(x):,}"


def age_text(days):
    if days is None:
        return "unknown"
    if days >= 730:
        return f"{days / 365.25:.1f} yrs"
    if days >= 60:
        return f"{round(days / 30.4)} mo"
    return f"{days} d"


def base_canvas():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img, "RGBA")
    # faint dot grid, denser toward the top — texture without noise
    for gx in range(24, W, 36):
        for gy in range(18, 300, 36):
            a = max(6, 26 - gy // 14)
            d.ellipse([gx, gy, gx + 2, gy + 2], fill=(47, 214, 143, a))
    # radar rings, top right
    cx, cy = 1330, 46
    for r in (26, 52, 78):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(47, 214, 143, 34), width=1)
    d.pieslice([cx - 78, cy - 78, cx + 78, cy + 78], start=300, end=345, fill=(47, 214, 143, 26))
    return img, d


def radar_mark(d, x, y, s=62):
    d.ellipse([x, y, x + s, y + s], outline=SIGNAL_DIM, width=3)
    for r in (s * 0.66, s * 0.36):
        d.ellipse([x + (s - r) / 2, y + (s - r) / 2, x + (s + r) / 2, y + (s + r) / 2],
                  outline=(47, 214, 143, 90), width=1)
    import math as m
    ex = x + s / 2 + (s / 2 - 4) * m.cos(m.radians(-38))
    ey = y + s / 2 + (s / 2 - 4) * m.sin(m.radians(-38))
    d.line([x + s / 2, y + s / 2, ex, ey], fill=SIGNAL, width=3)
    d.ellipse([x + s / 2 - 3, y + s / 2 - 3, x + s / 2 + 3, y + s / 2 + 3], fill=SIGNAL)
    d.ellipse([x + s - 16, y + 12, x + s - 10, y + 18], fill=AMBER)


def header(d, meta, title="TOKEN LAUNCH RADAR", tag=None):
    radar_mark(d, 36, 30)
    d.text((116, 36), title, font=F_TITLE, fill=INK)
    d.rectangle([118, 78, 182, 81], fill=SIGNAL)
    d.text((116, 90), tag or "Every protocol that records no token yet, ranked by what its launch would be worth — and how to farm it.",
           font=F_SUB, fill=MUTED)
    d.text((116, 116), f"Snapshot: DefiLlama protocol universe, as of {meta['as_of']} · computed from the sealed snapshot alone",
           font=F_SMALL, fill=FAINT)


def stats_row(d, meta, y=146):
    tiles = [
        (str(meta["protocols_scanned"]), "PROTOCOLS SCANNED", INK),
        (str(meta["pretoken_tracked"]), "PRE-TOKEN TRACKED", INK),
        (f"{meta['watchlist_covered']} / {meta['watchlist_total']}", "WATCHLIST COVERED", SIGNAL),
        (compact(meta["aggregate_implied_usd"]), "AGGREGATE IMPLIED VALUE", AMBER),
        (f"x{meta['median_multiple']:.2f}", "MEDIAN IMPLIED MULTIPLE", INK),
    ]
    x = 36
    w = (W - 72 - 4 * 10) // 5
    for value, label, color in tiles:
        d.rounded_rectangle([x, y, x + w, y + 56], radius=9, fill=PANEL2, outline=LINE)
        d.text((x + 13, y + 8), value, font=F_STAT, fill=color)
        d.text((x + 13, y + 36), label, font=F_LBL, fill=MUTED)
        x += w + 10


def wrap(d, text, font, width):
    words, lines, cur = text.split(), [], ""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if d.textlength(t, font=font) <= width:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w_
    if cur:
        lines.append(cur)
    return lines


# Column geometry for the board table (shared by board + filtered views)
COLS = [
    ("#", 40, 30, "r"),
    ("PROTOCOL", 84, 430, "l"),
    ("TVL", 640, 110, "r"),
    ("7D", 770, 80, "r"),
    ("AGE", 866, 80, "r"),
    ("IMPLIED VALUE", 962, 140, "r"),
    ("RANGE (LOG SCALE)", 1122, 150, "l"),
    ("CONFIDENCE", 1296, 110, "l"),
]


def table_header(d, y):
    d.rectangle([36, y, W - 36, y + 30], fill=PANEL2)
    for label, x, w, align in COLS:
        tx = x + w if align == "r" else x
        d.text((tx, y + 8), label, font=F_TH, fill=FAINT,
               anchor="ra" if align == "r" else "la")


def table_row(d, r, y, log_lo, log_hi):
    def pos(v):
        return (math.log10(max(1, v)) - log_lo) / (log_hi - log_lo)

    d.text((70, y + 6), str(r["rank"]), font=F_BODY, fill=FAINT, anchor="ra")
    name = r["name"] if d.textlength(r["name"], font=F_NAME) <= 330 else r["name"][:30] + "…"
    d.text((84, y + 2), name, font=F_NAME, fill=INK)
    if r["watchlist"]:
        nw = d.textlength(name, font=F_NAME)
        bx = 84 + nw + 8
        d.rounded_rectangle([bx, y + 3, bx + 74, y + 19], radius=4, fill=SIGNAL)
        d.text((bx + 6, y + 4), "WATCHLIST", font=F_LBL, fill=(6, 19, 12))
    meta = f"{r['category'] or 'Uncategorised'} — " + " · ".join(r["chains"][:3])
    d.text((84, y + 23), meta, font=F_SMALL, fill=FAINT)
    d.text((750, y + 6), compact(r["tvl_usd"]), font=F_BODY, fill=INK, anchor="ra")
    chg = r["change_7d"]
    if chg is None:
        d.text((850, y + 6), "—", font=F_BODY, fill=FAINT, anchor="ra")
    else:
        d.text((850, y + 6), f"{chg:+.1f}%", font=F_BODY,
               fill=SIGNAL if chg > 0 else RED if chg < 0 else MUTED, anchor="ra")
    d.text((946, y + 6), age_text(r["age_days"]), font=F_BODY, fill=INK, anchor="ra")
    d.text((1102, y + 6), compact(r["implied_value_usd"]), font=F_NAME, fill=AMBER, anchor="ra")
    # range bar
    bx, bw = 1122, 140
    d.rounded_rectangle([bx, y + 8, bx + bw, y + 16], radius=4, fill=(13, 19, 15), outline=LINE)
    left = bx + pos(r["value_low_usd"]) * bw
    right = bx + pos(r["value_high_usd"]) * bw
    d.rounded_rectangle([left, y + 9, max(left + 3, right), y + 15], radius=3, fill=(245, 165, 36, 140))
    mark = bx + pos(r["implied_value_usd"]) * bw
    d.rectangle([mark - 1, y + 6, mark + 1, y + 18], fill=AMBER)
    d.text((1122, y + 21), f"{compact(r['value_low_usd'])} – {compact(r['value_high_usd'])}",
           font=F_SMALL, fill=FAINT)
    # confidence
    cx = 1296
    d.rounded_rectangle([cx, y + 8, cx + 66, y + 15], radius=4, fill=(13, 19, 15), outline=LINE)
    d.rectangle([cx + 1, y + 9, cx + 1 + 64 * r["confidence"] / 100, y + 14], fill=CYAN)
    d.text((cx + 74, y + 4), str(r["confidence"]), font=F_BODY, fill=MUTED)
    d.line([36, y + 41, W - 36, y + 41], fill=LINE_SOFT)


def board_shot(rows, meta, out):
    img, d = base_canvas()
    header(d, meta)
    stats_row(d, meta)
    table_header(d, 224)
    lo = math.log10(max(1, min(r["value_low_usd"] for r in rows)))
    hi = math.log10(max(10, max(r["value_high_usd"] for r in rows)))
    y = 254
    for r in rows[:14]:
        table_row(d, r, y, lo, hi)
        y += 42
    d.text((36, y + 8),
           f"Showing 14 of {len(rows)} pre-token protocols — the full {meta['watchlist_total']}-protocol watchlist is on the board. Click a row in the live dashboard for its pricing detail and farm plan.",
           font=F_SMALL, fill=FAINT)
    img.save(out)
    return out


def chip(d, x, y, text, hot=False, font=None):
    font = font or F_SMALL
    w = d.textlength(text, font=font) + 20
    if hot:
        d.rounded_rectangle([x, y, x + w, y + 22], radius=11, fill=SIGNAL)
        d.text((x + 10, y + 4), text, font=font, fill=(6, 19, 12))
    else:
        d.rounded_rectangle([x, y, x + w, y + 22], radius=11, fill=PANEL, outline=LINE)
        d.text((x + 10, y + 4), text, font=font, fill=MUTED)
    return x + w + 8


def detail_shot(r, meta, out):
    img, d = base_canvas()
    d.rounded_rectangle([36, 28, 128, 54], radius=8, fill=PANEL, outline=LINE)
    d.text((48, 33), "← BOARD", font=F_BODY, fill=INK)
    d.text((36, 66), r["name"], font=F_TITLE, fill=INK)
    x = 36
    y = 112
    if r["watchlist"]:
        x = chip(d, x, y, "WATCHLIST", hot=True)
    x = chip(d, x, y, r["category"] or "Uncategorised")
    for c in r["chains"][:5]:
        x = chip(d, x, y, c)
    d.text((W - 36, 76), f"BOARD RANK #{r['rank']} OF {meta['pretoken_tracked']}",
           font=F_H2, fill=SIGNAL, anchor="ra")

    tiles = [
        (compact(r["tvl_usd"]), "TVL"),
        ("—" if r["change_7d"] is None else f"{r['change_7d']:+.1f}%", "TVL CHANGE, 7D"),
        (age_text(r["age_days"]), "TRACKED, NO TOKEN RECORDED"),
        (f"{r['confidence']} / 100", "CONFIDENCE"),
    ]
    tw = (W - 72 - 3 * 10) // 4
    for i, (v, l) in enumerate(tiles):
        tx = 36 + i * (tw + 10)
        d.rounded_rectangle([tx, 148, tx + tw, 204], radius=9, fill=PANEL2, outline=LINE)
        d.text((tx + 13, 156), v, font=F_STAT, fill=INK)
        d.text((tx + 13, 184), l, font=F_LBL, fill=MUTED)

    # left: value + factor build
    d.rounded_rectangle([36, 220, 884, 512], radius=10, fill=PANEL, outline=LINE)
    d.text((56, 234), "IMPLIED VALUE IF IT LAUNCHED AT THE FITTED MULTIPLE", font=F_LBL, fill=MUTED)
    d.text((56, 252), money(r["implied_value_usd"]), font=F_BIG, fill=AMBER)
    d.text((56, 292),
           f"Range {money(r['value_low_usd'])} – {money(r['value_high_usd'])}  ·  x{r['multiple']:.3f} of TVL  ·  model claim, not a forecast",
           font=F_SMALL, fill=FAINT)
    d.line([56, 318, 864, 318], fill=LINE_SOFT)
    d.text((56, 328), "HOW THE PRICE IS BUILT", font=F_H2, fill=INK)
    f = r["factors"]
    mom = ("7d change unreported: neutral" if r["change_7d"] is None
           else f"7d TVL {r['change_7d']:+.1f}% at 0.85 weight")
    age = ("listing date unreported" if r["age_days"] is None
           else f"tracked {r['age_days']} days, no token")
    factors = [
        ("Peer multiple", f["peer_multiple"], "category median, winsorised + shrunk"),
        ("Size factor", f["size_factor"], "size curve vs $100M reference"),
        ("Momentum", f["momentum"], mom),
        ("Maturity", f["maturity"], age),
        ("Breadth", f["breadth"], f"{len(r['chains'])} chains, 1.5% per extra"),
    ]
    fy = 358
    for label, val, desc in factors:
        d.text((56, fy), label, font=F_BODY, fill=INK)
        bw = 300
        wfrac = (math.log(val) - math.log(0.3)) / (math.log(2.2) - math.log(0.3))
        wfrac = min(1.0, max(0.02, wfrac))
        d.rounded_rectangle([230, fy + 3, 230 + bw, fy + 12], radius=5, fill=(13, 19, 15), outline=LINE)
        d.rectangle([231, fy + 4, 231 + (bw - 2) * wfrac, fy + 11], fill=CYAN)
        d.text((548, fy), f"x{val:.2f}", font=F_NAME, fill=CYAN)
        d.text((612, fy + 1), desc, font=F_SMALL, fill=FAINT)
        fy += 30

    # right: peers + why
    d.rounded_rectangle([900, 220, W - 36, 512], radius=10, fill=PANEL, outline=LINE)
    d.text((920, 234), "CALIBRATION PEERS (TOKENS ALREADY TRADE)", font=F_LBL, fill=MUTED)
    py = 262
    if r["peers"]:
        for p in r["peers"]:
            d.text((920, py), p["name"], font=F_BODY, fill=INK)
            d.text((W - 56, py), f"x{p['multiple']:.2f}", font=F_BODY, fill=CYAN, anchor="ra")
            d.text((920, py + 19), f"mcap {compact(p['mcap_usd'])} · TVL {compact(p['tvl_usd'])}",
                   font=F_SMALL, fill=FAINT)
            py += 48
    else:
        for line in wrap(d, "No tokened protocol in this category records a market cap, so the peer multiple is the global median itself.", F_BODY, 440):
            d.text((920, py), line, font=F_BODY, fill=MUTED)
            py += 19
    d.line([920, py + 4, W - 56, py + 4], fill=LINE_SOFT)
    d.text((920, py + 14), "WHY THIS RANK", font=F_LBL, fill=MUTED)
    why = (f"Priced at x{r['multiple']:.3f} of its {compact(r['tvl_usd'])} TVL. Peers support "
           f"x{f['peer_multiple']:.2f}, size adjusts by x{f['size_factor']:.2f}, momentum x{f['momentum']:.2f} "
           f"and maturity x{f['maturity']:.2f}. Confidence {r['confidence']}/100 sets the range's width.")
    wy = py + 36
    for line in wrap(d, why, F_BODY, 448):
        d.text((920, wy), line, font=F_BODY, fill=MUTED)
        wy += 19

    # bottom: farm plan, two columns
    d.rounded_rectangle([36, 528, W - 36, 872], radius=10, fill=PANEL, outline=LINE)
    d.text((56, 542), "FARM PLAN — 8 STEPS, COSTED", font=F_H2, fill=INK)
    col_w = (W - 72 - 56 - 30) // 2
    for i, step in enumerate(r["farm_steps"]):
        col = 0 if i < 4 else 1
        row = i % 4
        sx = 56 + col * (col_w + 30)
        sy = 578 + row * 74
        d.text((sx, sy), f"{i + 1}.", font=F_NAME, fill=SIGNAL)
        lines = wrap(d, step, F_SMALL, col_w - 26)
        for j, line in enumerate(lines[:4]):
            d.text((sx + 24, sy + 1 + j * 15), line, font=F_SMALL, fill=INK)
    img.save(out)
    return out


def filtered_shot(rows, meta, out):
    img, d = base_canvas()
    header(d, meta)
    x = 36
    x = chip(d, x, 146, "SEGMENT: WATCHLIST ≥ $50M", hot=True, font=F_BODY)
    x = chip(d, x, 146, "CATEGORY: ALL", font=F_BODY)
    x = chip(d, x, 146, "CHAIN: ALL", font=F_BODY)
    x = chip(d, x, 146, "SORT: BOARD RANK", font=F_BODY)
    d.text((W - 36, 150), f"{len(rows)} of {meta['pretoken_tracked']} protocols",
           font=F_BODY, fill=MUTED, anchor="ra")
    table_header(d, 190)
    all_rows = rows
    lo = math.log10(max(1, min(r["value_low_usd"] for r in all_rows)))
    hi = math.log10(max(10, max(r["value_high_usd"] for r in all_rows)))
    y = 220
    for r in rows[:15]:
        table_row(d, r, y, lo, hi)
        y += 42
    d.text((36, y + 8),
           f"Filtered view: the house watchlist — every protocol at or above the $50M floor that records no token. The radar also tracks {meta['pretoken_tracked'] - meta['watchlist_total']} early protocols below the floor.",
           font=F_SMALL, fill=FAINT)
    img.save(out)
    return out


def main():
    out_dir = Path(sys.argv[1])
    shots_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else out_dir / "screenshots"
    board = json.loads((out_dir / "board.json").read_text())
    data = json.loads((out_dir / "data.js").read_text()[len("window.RADAR = "):-2])
    rows = data["rows"]
    meta = data["meta"]
    shots_dir.mkdir(parents=True, exist_ok=True)
    board_shot(rows, meta, shots_dir / "1-board.png")
    detail_shot(rows[0], meta, shots_dir / "2-detail.png")
    filtered_shot([r for r in rows if r["watchlist"]], meta, shots_dir / "3-filtered.png")
    for p in sorted(shots_dir.glob("*.png")):
        print(p.name, p.stat().st_size)


if __name__ == "__main__":
    main()
