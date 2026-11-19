#!/usr/bin/env python3
"""Render the Token Launch Radar screenshots from the real board data.

No browser is installed on the build machine, so this renderer mirrors the
dashboard's layout, palette and figures with PIL, reading board.json and the
sealed snapshot directly. Usage:

    python3 tools/render_screenshots.py <out-dir> <snapshot.json>

Writes 1-board.png, 2-detail.png and 3-filtered.png into <out-dir>/screenshots/.
Deterministic: same inputs produce byte-identical PNGs.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1440, 900
BG = (13, 21, 38)
PANEL = (20, 31, 54)
PANEL2 = (26, 41, 71)
LINE = (38, 57, 94)
TEXT = (232, 238, 251)
MUTED = (157, 176, 208)
TEAL = (45, 212, 191)
AMBER = (251, 191, 36)
GREEN = (74, 222, 128)
RED = (248, 113, 113)

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONTB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def font(size, bold=False):
    return ImageFont.truetype(FONTB if bold else FONT, size)


def money(n):
    return "$" + f"{int(round(n)):,}"


def wrap(draw, text, fnt, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=fnt) <= width:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def header(d, title, sub):
    d.rectangle([0, 0, W, 118], fill=(18, 32, 60))
    d.ellipse([48, 42, 62, 56], fill=TEAL)
    d.text((76, 34), title, font=font(34, True), fill=TEXT)
    d.text((48, 78), sub, font=font(17), fill=MUTED)
    d.line([0, 118, W, 118], fill=LINE, width=1)


def footer(d, text):
    d.text((48, H - 34), text, font=font(14), fill=MUTED)


def card(d, box, fill=PANEL):
    d.rounded_rectangle(box, radius=10, fill=fill, outline=LINE, width=1)


def table(d, rows, y0, cols, row_h=46, head_h=34):
    """rows: list of tuples of (text, color, bold, align). cols: x positions."""
    x0, x1 = 48, W - 48
    d.rectangle([x0, y0, x1, y0 + head_h], fill=PANEL2)
    # header labels
    for label, x, align in cols:
        if align == "r":
            d.text((x, y0 + 8), label, font=font(13, True), fill=MUTED, anchor="ra")
        else:
            d.text((x, y0 + 8), label, font=font(13, True), fill=MUTED)
    y = y0 + head_h
    for i, row in enumerate(rows):
        if i % 2 == 1:
            d.rectangle([x0, y, x1, y + row_h], fill=(16, 26, 48))
        for (text, color, bold, _a), (_label, x, align) in zip(row, cols):
            f = font(16, bold)
            if align == "r":
                d.text((x, y + 13), text, font=f, fill=color, anchor="ra")
            else:
                d.text((x, y + 13), text, font=f, fill=color)
        y += row_h
        d.line([x0, y, x1, y], fill=LINE, width=1)
    d.rectangle([x0, y0, x1, y], outline=LINE, width=1)
    return y


def load(out_dir, snap_path):
    board = json.loads((Path(out_dir) / "board.json").read_text())
    snap = json.loads(Path(snap_path).read_text())
    by_slug = {p["slug"]: p for p in snap["protocols"]}
    return board, snap, by_slug


def shot_board(out_dir, snap_path):
    board, snap, by_slug = load(out_dir, snap_path)
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    rows = board["rows"]
    header(d, "Token Launch Radar",
           f"Snapshot {snap['as_of']}  ·  {len(rows)} ranked protocols ({len(snap['watchlist'])} on the watchlist)  ·  implied = TVL × category multiple × momentum × maturity × breadth")
    card(d, [48, 140, W - 48, 196])
    d.text((66, 156), "How the value is scored:  implied = TVL × category multiple × momentum × maturity × breadth",
           font=font(16), fill=MUTED)
    cols = [("#", 66, "l"), ("Protocol", 110, "l"), ("Category", 420, "l"),
            ("Chains", 600, "l"), ("TVL", 1000, "r"), ("7d", 1150, "r"), ("Implied value", 1392, "r")]
    disp = []
    for r in rows[:12]:
        p = by_slug[r["slug"]]
        chg = p["change_7d"]
        chg_txt = "—" if chg is None else f"{'+' if chg > 0 else ''}{chg:.1f}%"
        disp.append([
            (str(r["rank"]), TEXT, True, "l"),
            (r["name"], TEXT, True, "l"),
            (p["category"] or "—", MUTED, False, "l"),
            (", ".join(p["chains"][:2]) + (" +" + str(len(p["chains"]) - 2) if len(p["chains"]) > 2 else ""), MUTED, False, "l"),
            (money(p["tvl_usd"]), TEXT, False, "r"),
            (chg_txt, GREEN if (chg or 0) >= 0 else RED, False, "r"),
            (money(r["implied_value_usd"]), AMBER, True, "r"),
        ])
    table(d, disp, 216, cols)
    d.text((48, 216 + 34 + 12 * 46 + 18),
           "Click any row for the protocol's detail: figures, model breakdown, and a concrete farm plan.",
           font=font(15), fill=MUTED)
    footer(d, "Data: sealed DefiLlama snapshot. “Records no token” means the snapshot's record carries no token — not proof a token does not exist.")
    return img


def shot_detail(out_dir, snap_path):
    board, snap, by_slug = load(out_dir, snap_path)
    data = json.loads((Path(out_dir) / "data.js").read_text()[len("window.RADAR = "):-2])
    r = data["rows"][0]
    p = by_slug[r["slug"]]
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    header(d, "Token Launch Radar", f"Detail — {r['name']}  ·  {r['slug']}  ·  snapshot {snap['as_of']}")
    d.text((48, 140), f"#{r['rank']}  {r['name']}", font=font(30, True), fill=TEXT)
    d.text((48, 180), f"{r['slug']}  ·  {p['category'] or 'uncategorised'}  ·  {', '.join(p['chains'][:4])}",
           font=font(16), fill=MUTED)
    stats = [
        ("Implied value", money(r["implied_value_usd"])),
        ("TVL", money(p["tvl_usd"])),
        ("TVL change 7d", "—" if p["change_7d"] is None else f"{p['change_7d']:+.1f}%"),
        ("Tracked, no token", "—" if r["age_days"] is None else f"{r['age_days']} days"),
    ]
    x = 48
    for label, val in stats:
        card(d, [x, 220, x + 300, 300])
        d.text((x + 16, 236), val, font=font(24, True), fill=AMBER)
        d.text((x + 16, 270), label.upper(), font=font(12), fill=MUTED)
        x += 318
    d.text((48, 330), "Why this value — model breakdown", font=font(18, True), fill=TEAL)
    b = r["breakdown"]
    bars = [
        ("Category multiple", b["multiple"] / 1.25, f"{b['multiple']:.2f}x  ({b['peers']} tokened peer{'s' if b['peers'] != 1 else ''})"),
        ("Momentum (7d)", b["momentum"] / 2.5, f"{b['momentum']:.2f}x"),
        ("Maturity", b["maturity"] / 1.0, f"{b['maturity']:.2f}x"),
        ("Chain breadth", b["breadth"] / 1.1, f"{b['breadth']:.2f}x"),
    ]
    y = 364
    for label, frac, txt in bars:
        d.text((48, y), label, font=font(15), fill=TEXT)
        d.rounded_rectangle([260, y + 4, 1060, y + 16], radius=5, fill=PANEL2)
        d.rounded_rectangle([260, y + 4, 260 + int(800 * max(0.02, min(1.0, frac))), y + 16],
                            radius=5, fill=TEAL)
        d.text((1080, y), txt, font=font(15, True), fill=TEXT)
        y += 34
    d.text((48, y + 6),
           f"implied = {money(p['tvl_usd'])} × {b['multiple']:.2f} × {b['momentum']:.2f} × {b['maturity']:.2f} × {b['breadth']:.2f} = {money(r['implied_value_usd'])}",
           font=font(15), fill=MUTED)
    y += 40
    d.text((48, y), "Farm plan — all 7 steps", font=font(18, True), fill=TEAL)
    y += 32
    for i, step in enumerate(r["farm_steps"], 1):
        lines = wrap(d, f"{i}.  {step}", font(14), W - 96 - 20)
        for ln in lines:
            d.text((66, y), ln, font=font(14), fill=TEXT)
            y += 19
        y += 5
    footer(d, "Values are this entry's own claim, never a prediction of a launch. The same detail opens for every ranked protocol on the live dashboard.")
    return img


def shot_filtered(out_dir, snap_path):
    board, snap, by_slug = load(out_dir, snap_path)
    data = json.loads((Path(out_dir) / "data.js").read_text()[len("window.RADAR = "):-2])
    # Filter to the most common category on the board.
    from collections import Counter
    cat = Counter(r["category"] for r in data["rows"] if r["category"]).most_common(1)[0][0]
    subset = [r for r in data["rows"] if r["category"] == cat][:12]
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    header(d, "Token Launch Radar",
           f"Snapshot {snap['as_of']}  ·  filtered view  ·  {len(subset)} of {len(data['rows'])} ranked protocols shown")
    card(d, [48, 140, W - 48, 196])
    d.text((66, 156), f"Filter:  Category = {cat}      Sort: Rank (implied value)",
           font=font(16), fill=MUTED)
    d.rounded_rectangle([48, 140, 52, 196], radius=2, fill=TEAL)
    cols = [("#", 66, "l"), ("Protocol", 110, "l"), ("Category", 420, "l"),
            ("Chains", 600, "l"), ("TVL", 1000, "r"), ("7d", 1150, "r"), ("Implied value", 1392, "r")]
    disp = []
    for r in subset:
        p = by_slug[r["slug"]]
        chg = p["change_7d"]
        chg_txt = "—" if chg is None else f"{'+' if chg > 0 else ''}{chg:.1f}%"
        disp.append([
            (str(r["rank"]), TEXT, True, "l"),
            (r["name"], TEXT, True, "l"),
            (p["category"] or "—", MUTED, False, "l"),
            (", ".join(p["chains"][:2]) + (" +" + str(len(p["chains"]) - 2) if len(p["chains"]) > 2 else ""), MUTED, False, "l"),
            (money(p["tvl_usd"]), TEXT, False, "r"),
            (chg_txt, GREEN if (chg or 0) >= 0 else RED, False, "r"),
            (money(r["implied_value_usd"]), AMBER, True, "r"),
        ])
    table(d, disp, 216, cols)
    d.text((48, 216 + 34 + len(subset) * 46 + 18),
           f"Filtered to one category: {cat}. The same filter, search and sort controls work on the live dashboard.",
           font=font(15), fill=MUTED)
    footer(d, "Data: sealed DefiLlama snapshot. Implied values are this entry's own claim, never a prediction of a launch.")
    return img


def main():
    out_dir, snap_path = sys.argv[1], sys.argv[2]
    shots = Path(out_dir) / "screenshots"
    shots.mkdir(parents=True, exist_ok=True)
    for name, fn in [("1-board.png", shot_board),
                     ("2-detail.png", shot_detail),
                     ("3-filtered.png", shot_filtered)]:
        img = fn(out_dir, snap_path)
        img.save(shots / name, format="PNG", optimize=True)
        print(name, img.size, (shots / name).stat().st_size, "bytes")


if __name__ == "__main__":
    main()
