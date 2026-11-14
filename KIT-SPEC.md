# token-radar-01 — kit spec summary (from the kit's RULES.txt + competition.yaml)

Competition: token-radar-01, opens 2026-11-14T10:00:00Z, deadline 2026-12-14T10:00:00Z.
Rewards $1,325 over 10 places, paid from escrow in USDC on Solana; max 5 submissions/day, 10 total.

## Program contract

- `main.ts` at the repo root, Node 22, standard library only, no network. It runs twice in the
  grader; both runs must write identical bytes (1 CPU, 1024 MB, 120 s).
- Reads the sealed snapshot at `/input/snapshot.json` (dev: `--input <file|dir>`,
  `MAKEFUN_OUTPUT_DIR` stands in for `/output`; also `--output`).
- Writes to `/output`:
  - `board.json` — `{"rows": [...]}` (see board rules below);
  - `data.js` — the dashboard's data beside the page (`window.RADAR = ...`);
  - `dashboard/` — copied from the repo's `dashboard/`;
  - `screenshots/` — copied from the repo's `screenshots/`;
  - `dossier.json` — exactly `buildDossier('/output', {text_max_bytes: 65536})` from
    `vendor/makefun-board.ts`, byte for byte, and at most 1.5 MiB.

## Snapshot

`snapshot.json`: `{as_of, source, floor_usd (50,000,000), protocols[758], watchlist[40]}`.
Each protocol has exactly ten fields: slug, name, category (nullable), chains, tvl_usd,
change_7d (nullable, per cent), mcap_usd (nullable), listed_at (nullable date), gecko_id
(nullable), symbol (nullable). A protocol "records no token" when gecko_id and symbol are null
(and mcap_usd is null). The watchlist is a floor, never a ceiling.

## Gate (seven checks on /output)

- dashboard_files: `dashboard/` holds index.html + at least one .css and one .js, ≤400 files,
  ≤4 MiB, plain file names (letters, digits, `._-`, 1–128 chars, not starting with `.` or `-`),
  no dot-directories, and no `http://`/`https://` in any HTML attribute value, `<style>` body,
  inline `<script>` import, CSS file, or JS import/export/require/dynamic-import specifier.
  Visible text and comments may carry URLs.
- board_file: `board.json` rows array of 100–4,000 rows, ≤8 MiB. Each row: `slug` (one of the
  snapshot's protocols, unique), non-empty `name`, positive whole `rank`, positive whole
  `implied_value_usd` ≤ 100,000,000,000,000, `farm_steps` array.
- sorted_by_value: ranks are exactly 1..N; `implied_value_usd` never rises as rank ascends;
  not all rows may share one implied value.
- coverage: every watchlist slug appears among the rows (min_watchlist_coverage = 1), so at
  least 60 of the ≥100 rows are non-watchlist protocols.
- farm_steps: every row has 3–12 strings, each 20–600 characters once trimmed.
- screenshots: `screenshots/` holds 3–4 whole PNG/JPEG images, plain names, ≤512 KiB each,
  long side ≤1440 px, short side ≥800 px. First image by name is the cover.
- dossier_matches: `dossier.json` equals buildDossier's output and is ≤1.5 MiB. Keep the
  dashboard source under 64 KB in total so the dossier's 65,536-byte text shows it whole, and
  keep screenshots modest (≈300 KB or less each) so the dossier stays under the cap.

## Repo layout (this entry)

- `main.ts` — the program (this entry's own code).
- `lib/model.ts` — snapshot parsing, the value model (signal-2), board building, farm plans,
  board self-check, `data.js` rendering.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied byte for byte from the kit's
  starter (sha256 9ca51b6e5cd84fe46cb0efa61e2ea99365a1fb0e21f2b75e6007f977f0dc326e); the
  scorer runs the same file and compares the dossier against it.
- `dashboard/index.html`, `dashboard/app.css`, `dashboard/app.js` — the static page; it reads
  `../data.js` (written by main.ts beside `dashboard/` in /output) and renders with no network.
- `screenshots/1-board.png`, `2-detail.png`, `3-filtered.png` — the board, one protocol's
  detail view, and a filtered view, rendered from the real board data by
  `tools/render_screenshots.py` (no browser is installed on the build machine; the renderer
  mirrors the dashboard's layout, palette and figures exactly, and its source ships in the repo).
- `LICENSE` (MIT), `.makefun/owner.json` (the entrant wallet), `README.md`.

## How the entry is run locally

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```
