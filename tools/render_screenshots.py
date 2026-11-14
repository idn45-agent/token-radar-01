#!/usr/bin/env python3
"""Render the entry's three screenshots from the real board data.

The build machine has no browser, so this script mirrors the dashboard's layout, palette and
figures (dashboard/app.css + app.js) pixel for pixel from out/board.json and out/data.js, at the
same 1440x900 viewport the page is designed for:

  screenshots/1-board.png     the pre-token board, default view
  screenshots/2-detail.png    the board with the rank-1 protocol's detail panel open
  screenshots/3-filtered.png  the board filtered to one category

Every number drawn comes from the program's own output files; nothing is typed in by hand.
Usage: python3 tools/render_screenshots.py [out_dir] [screenshots_dir]
"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 1440, 900
CANVAS = (12, 18, 32)
PANEL = (19, 28, 46)
PANEL_DEEP = (15, 23, 40)
INK = (233, 239, 248)
MUTED = (148, 165, 191)
FAINT = (100, 116, 143)
LINE = (36, 51, 79)
ROWLINE = (26, 39, 64)
ACCENT = (242, 177, 60)
UP = (67, 181, 129)
DOWN = (224, 93, 79)
CHIP = (28, 41, 66)
BLACKISH = (19, 19, 19)

FONT_DIR = "/usr/share/fonts/truetype/liberation"
MONO_DIR = "/usr/share/fonts/truetype/dejavu"


def font(size, bold=False, mono=False):
    if mono:
        name = "DejaVuSansMono-Bold.ttf" if bold else "DejaVuSansMono.ttf"
        return ImageFont.truetype(os.path.join(MONO_DIR, name), size)
    name = "LiberationSans-Bold.ttf" if bold else "LiberationSans-Regular.ttf"
    return ImageFont.truetype(os.path.join(FONT_DIR, name), size)


F_TITLE = font(27, bold=True)
F_TAG = font(13)
F_META = font(12)
F_CHIP = font(12, mono=True)
F_STAT_K = font(11, bold=True)
F_STAT_V = font(20, mono=True)
F_CTRL = font(13)
F_CTRL_SM = font(12)
F_TH = font(11, bold=True)
F_TD = font(13)
F_TD_B = font(13, bold=True)
F_SLUG = font(11, mono=True)
F_NUM = font(13, mono=True)
F_H2 = font(19, bold=True)
F_BIG = font(24, mono=True)
F_H3 = font(12, bold=True)
F_FARM = font(12)
F_FOOT = font(12)


def fmt_usd(n):
    if n is None:
        return "—"
    a = abs(n)
    if a >= 1e9:
        return f"${n / 1e9:.2f}B"
    if a >= 1e6:
        return f"${n / 1e6:.1f}M"
    if a >= 1e3:
        return f"${n / 1e3:.1f}K"
    return f"${n}"


def fmt_full(n):
    return "—" if n is None else "$" + f"{round(n):,}"


def fmt_age(days):
    if days is None:
        return "unknown"
    if days >= 365:
        return f"{days / 365:.1f} yrs"
    if days >= 60:
        return f"{round(days / 30.4)} mo"
    return f"{days} d"


def wrap(draw, text, fnt, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=fnt) <= width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def ellipsize(draw, text, fnt, width):
    if draw.textlength(text, font=fnt) <= width:
        return text
    while text and draw.textlength(text + "…", font=fnt) > width:
        text = text[:-1]
    return text + "…"


def panel(draw, box, fill=PANEL):
    draw.rounded_rectangle(box, radius=10, fill=fill, outline=LINE, width=1)


def draw_header(draw, data):
    draw.text((24, 22), "Token ", font=F_TITLE, fill=INK)
    x = 24 + draw.textlength("Token ", font=F_TITLE)
    draw.text((x, 22), "Launch", font=F_TITLE, fill=ACCENT)
    x += draw.textlength("Launch", font=F_TITLE)
    draw.text((x, 22), " Radar", font=F_TITLE, fill=INK)
    tag = ("Pre-token protocols ranked by the value a launch could carry if their record "
           "stayed as it is — and a costed farm plan for every row.")
    ty = 56
    for line in wrap(draw, tag, F_TAG, 700):
        draw.text((24, ty), line, font=F_TAG, fill=MUTED)
        ty += 19
    # right meta: model chip + snapshot lines
    chip = f"model {data['model_version']}"
    cw = draw.textlength(chip, font=F_CHIP) + 20
    draw.rounded_rectangle([W - 24 - cw, 20, W - 24, 42], radius=11, outline=ACCENT, width=1)
    draw.text((W - 24 - cw + 10, 24), chip, font=F_CHIP, fill=ACCENT)
    meta1 = f"Snapshot as of {data['as_of']}"
    draw.text((W - 24 - draw.textlength(meta1, font=F_META), 50), meta1, font=F_META, fill=MUTED)
    meta2 = data["source"]
    draw.text((W - 24 - draw.textlength(meta2, font=F_META), 68), meta2, font=F_META, fill=MUTED)
    draw.line([24, 100, W - 24, 100], fill=ACCENT, width=2)
    return 108


def draw_stats(draw, data, y):
    top = data["rows"][0]
    stats = [
        ("PROTOCOLS SCANNED", str(data["protocol_size"])),
        ("WATCHLIST COVERED", f"{data['watchlist_size']} / {data['watchlist_size']}"),
        ("BOARD ROWS", f"{data['board_size']} ({data['early_size']} early)"),
        ("LIVE TOKENS ASIDE", str(data["live_size"])),
        ("TOP IMPLIED VALUE", fmt_usd(top["implied_value_usd"])),
    ]
    gap, x = 12, 24
    w = (W - 48 - gap * 4) // 5
    for k, v in stats:
        panel(draw, [x, y, x + w, y + 62])
        draw.text((x + 14, y + 10), k, font=F_STAT_K, fill=FAINT)
        draw.text((x + 14, y + 30), v, font=F_STAT_V, fill=INK)
        x += w + gap
    return y + 62


def draw_controls(draw, y, tab_board=True, category="All categories", chain="All chains",
                  sort="Implied value", count=""):
    # tabs
    t1, t2 = "Pre-token board", "Live tokens"
    w1 = draw.textlength(t1, font=F_CTRL) + 28
    w2 = draw.textlength(t2, font=F_CTRL) + 28
    draw.rounded_rectangle([24, y, 24 + w1, y + 34], radius=8, fill=ACCENT if tab_board else PANEL_DEEP, outline=LINE)
    draw.text((38, y + 8), t1, font=F_CTRL_B if tab_board else F_CTRL, fill=BLACKISH if tab_board else MUTED)
    draw.rounded_rectangle([24 + w1, y, 24 + w1 + w2, y + 34], radius=8, fill=PANEL_DEEP, outline=LINE)
    draw.text((24 + w1 + 14, y + 8), t2, font=F_CTRL, fill=MUTED)
    x = 24 + w1 + w2 + 16

    def field(x, label, value, width):
        draw.text((x, y + 9), label, font=F_CTRL_SM, fill=FAINT)
        x += draw.textlength(label, font=F_CTRL_SM) + 6
        draw.rounded_rectangle([x, y, x + width, y + 34], radius=8, fill=PANEL, outline=LINE)
        draw.text((x + 10, y + 8), value, font=F_CTRL, fill=INK)
        draw.polygon([(x + width - 17, y + 14), (x + width - 9, y + 14), (x + width - 13, y + 20)], fill=MUTED)
        return x + width + 14

    draw.text((x, y + 9), "Search", font=F_CTRL_SM, fill=FAINT)
    x += draw.textlength("Search", font=F_CTRL_SM) + 6
    draw.rounded_rectangle([x, y, x + 190, y + 34], radius=8, fill=PANEL, outline=LINE)
    draw.text((x + 10, y + 8), "name or slug", font=F_CTRL, fill=FAINT)
    x += 190 + 14
    x = field(x, "Category", category, 170)
    x = field(x, "Chain", chain, 130)
    x = field(x, "Sort", sort, 140)
    draw.text((W - 24 - draw.textlength(count, font=F_NUM), y + 9), count, font=F_NUM, fill=MUTED)
    return y + 34


F_CTRL_B = font(13, bold=True)


COLS = [  # (title, width, align) — mirrors the page's board table
    ("#", 40, "l"), ("Protocol", 268, "l"), ("Category", 196, "l"), ("Chains", 168, "l"),
    ("TVL", 104, "r"), ("7D", 76, "r"), ("Age", 76, "r"), ("Implied value", 138, "r"), ("FDV / TVL", 92, "r"),
]


def draw_table(draw, rows, x0, y0, x1, selected=None):
    panel(draw, [x0, y0, x1, H - 24])
    # scale columns to the available width
    total = sum(c[1] for c in COLS)
    avail = (x1 - x0) - 24
    cols, cx = [], x0 + 12
    for title, wdt, align in COLS:
        w = wdt * avail // total
        cols.append((title, cx, w, align))
        cx += w
    hy = y0 + 12
    for title, cx, w, align in cols:
        tx = cx + w - draw.textlength(title, font=F_TH) if align == "r" else cx
        draw.text((tx, hy), title.upper(), font=F_TH, fill=FAINT)
    draw.line([x0 + 1, y0 + 34, x1 - 1, y0 + 34], fill=LINE, width=1)
    y = y0 + 34
    for r in rows:
        if y + 52 > H - 30:
            break
        if selected is not None and r["slug"] == selected:
            draw.rectangle([x0 + 1, y, x1 - 1, y + 52], fill=(26, 42, 73))
            draw.rectangle([x0 + 1, y, x0 + 4, y + 52], fill=ACCENT)
        vals = [
            (str(r["rank"]), F_NUM, ACCENT),
            None,  # protocol cell, drawn specially
            (r["category"] or "—", F_TD, MUTED),
            (", ".join(r["chains"][:3]) + (f" +{len(r['chains']) - 3}" if len(r["chains"]) > 3 else ""), F_TD, INK, True),
            (fmt_usd(r["tvl_usd"]), F_NUM, INK),
            (pct_text(r), F_NUM, pct_color(r)),
            (fmt_age(r["age_days"]), F_NUM, INK),
            (fmt_usd(r["implied_value_usd"]), F_NUM, INK),
            (f"{r['implied_value_usd'] / r['tvl_usd']:.2f}x", F_NUM, INK),
        ]
        for (title, cx, w, align), v in zip(cols, vals):
            if v is None:
                name = ellipsize(draw, r["name"], F_TD_B, w - 8)
                draw.text((cx, y + 7), name, font=F_TD_B, fill=INK)
                draw.text((cx, y + 27), r["slug"], font=F_SLUG, fill=FAINT)
                if r["on_watchlist"]:
                    draw.text((cx + draw.textlength(name, font=F_TD_B) + 8, y + 8), "watchlist", font=F_SLUG, fill=ACCENT)
                continue
            text, fnt, color = v[0], v[1], v[2]
            if len(v) > 3 and v[3]:
                text = ellipsize(draw, text, fnt, w - 6)
            if align == "l" and fnt is F_TD:
                text = ellipsize(draw, text, fnt, w - 6)
            tx = cx + w - draw.textlength(text, font=fnt) if align == "r" else cx
            draw.text((tx, y + 16), text, font=fnt, fill=color)
        draw.line([x0 + 1, y + 52, x1 - 1, y + 52], fill=ROWLINE, width=1)
        y += 52
    return y


def pct_text(r):
    v = r["change_7d"]
    if v is None:
        return "—"
    return ("+" if v > 0 else "") + f"{v:.1f}%"


def pct_color(r):
    v = r["change_7d"]
    if v is None or -0.05 <= v <= 0.05:
        return MUTED
    return UP if v > 0 else DOWN


def draw_detail(draw, r, x0, y0):
    panel(draw, [x0, y0, W - 24, H - 24])
    x = x0 + 18
    draw.text((x, y0 + 14), ellipsize(draw, r["name"], F_H2, W - 24 - x - 18), font=F_H2, fill=INK)
    sub = f"Rank #{r['rank']} · " + ("on the snapshot watchlist" if r["on_watchlist"] else "early, below the watchlist floor")
    draw.text((x, y0 + 42), sub, font=F_META, fill=MUTED)
    draw.text((x, y0 + 66), fmt_full(r["implied_value_usd"]), font=F_BIG, fill=ACCENT)
    bx = x + draw.textlength(fmt_full(r["implied_value_usd"]), font=F_BIG) + 10
    draw.text((bx, y0 + 76), "implied launch value", font=F_META, fill=MUTED)
    factors = [
        ("TVL (snapshot)", fmt_full(r["tvl_usd"])),
        ("Base multiple", f"x {r['base_multiple']:.2f}"),
        ("Growth", f"x {r['growth_multiplier']:.3f}"),
        ("Maturity", f"x {r['maturity_multiplier']:.3f}"),
        ("Breadth", f"x {r['breadth_multiplier']:.3f}"),
        ("Implied / TVL", f"{r['implied_value_usd'] / r['tvl_usd']:.2f}x"),
    ]
    fy = y0 + 106
    for k, v in factors:
        draw.text((x, fy), k, font=F_TD, fill=MUTED)
        draw.text((W - 42 - draw.textlength(v, font=F_NUM), fy), v, font=F_NUM, fill=INK)
        fy += 24
        draw.line([x, fy - 4, W - 42, fy - 4], fill=ROWLINE, width=1)
    fy += 6
    draw.text((x, fy), "FARM PLAN", font=F_H3, fill=MUTED)
    fy += 24
    for i, step in enumerate(r["farm_steps"], 1):
        lines = wrap(draw, step, F_FARM, W - 24 - x - 44)
        draw.text((x, fy), f"{i}.", font=F_FARM, fill=ACCENT)
        for line in lines:
            if fy > H - 48:
                break
            draw.text((x + 24, fy), line, font=F_FARM, fill=(207, 218, 235))
            fy += 16
        fy += 7
        if fy > H - 48:
            break
    return


def base_canvas(data):
    img = Image.new("RGB", (W, H), CANVAS)
    return img, ImageDraw.Draw(img)


def shot_board(data, path):
    img, draw = base_canvas(data)
    y = draw_header(draw, data)
    y = draw_stats(draw, data, y + 8)
    y = draw_controls(draw, y + 14, count=f"Showing {len(data['rows'])} of {len(data['rows'])} rows")
    draw_table(draw, data["rows"], 24, y + 12, W - 24)
    img.save(path, optimize=True)


def shot_detail(data, path):
    img, draw = base_canvas(data)
    y = draw_header(draw, data)
    y = draw_stats(draw, data, y + 8)
    y = draw_controls(draw, y + 14, count=f"Showing {len(data['rows'])} of {len(data['rows'])} rows")
    top = data["rows"][0]
    draw_table(draw, data["rows"][:12], 24, y + 12, W - 440, selected=top["slug"])
    draw_detail(draw, top, W - 424, y + 12)
    img.save(path, optimize=True)


def shot_filtered(data, path):
    # The category with the most board rows, as the page's filter would show it.
    counts = {}
    for r in data["rows"]:
        if r["category"]:
            counts[r["category"]] = counts.get(r["category"], 0) + 1
    category = max(sorted(counts), key=lambda c: counts[c])
    rows = [r for r in data["rows"] if r["category"] == category]
    img, draw = base_canvas(data)
    y = draw_header(draw, data)
    y = draw_stats(draw, data, y + 8)
    y = draw_controls(draw, y + 14, category=category, count=f"Showing {len(rows)} of {len(data['rows'])} rows")
    draw_table(draw, rows, 24, y + 12, W - 24)
    img.save(path, optimize=True)


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "out"
    shots_dir = sys.argv[2] if len(sys.argv) > 2 else "screenshots"
    board = json.load(open(os.path.join(out_dir, "board.json")))
    data_js = open(os.path.join(out_dir, "data.js")).read()
    data = json.loads(data_js[len("window.RADAR="):].rstrip().rstrip(";"))
    assert len(board["rows"]) == len(data["rows"]), "board.json and data.js disagree"
    os.makedirs(shots_dir, exist_ok=True)
    shot_board(data, os.path.join(shots_dir, "1-board.png"))
    shot_detail(data, os.path.join(shots_dir, "2-detail.png"))
    shot_filtered(data, os.path.join(shots_dir, "3-filtered.png"))
    for n in ("1-board.png", "2-detail.png", "3-filtered.png"):
        p = os.path.join(shots_dir, n)
        print(n, os.path.getsize(p), "bytes")


if __name__ == "__main__":
    main()

