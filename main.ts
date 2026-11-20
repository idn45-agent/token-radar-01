// Token Launch Radar — entrypoint (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot, prices every protocol that records
// no token with the signal-4 model in lib/model.ts, and writes the entry's
// outputs: board.json (the ranked board), data.js (the dashboard's data),
// dashboard/ and screenshots/ (copied from this repository) and
// dossier.json (built with vendor/makefun-board.ts). The program is fully
// deterministic: two runs over the same snapshot write identical bytes.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot>
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBoard, dashboardData, selfCheck } from "./lib/model.ts";
import type { DetailRow, Snapshot } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = "/input/snapshot.json";
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input" && argv[i + 1]) input = argv[++i];
    else if (arg === "--output" && argv[i + 1]) output = argv[++i];
    else if (arg.startsWith("--input=")) input = arg.slice("--input=".length);
    else if (arg.startsWith("--output=")) output = arg.slice("--output=".length);
  }
  return { input, output };
}

function readSnapshot(path: string): Snapshot {
  const file = statSync(path).isDirectory() ? join(path, "snapshot.json") : path;
  const snap = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
  if (!Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist)) {
    throw new Error(`main: ${file} is not a token-radar snapshot`);
  }
  return snap;
}

/** Copy a directory tree in sorted order so the copy is deterministic. */
function copyTree(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    if (entry.isDirectory()) copyTree(join(src, entry.name), join(dst, entry.name));
    else if (entry.isFile()) copyFileSync(join(src, entry.name), join(dst, entry.name));
  }
}

/** The board's rows as board.json carries them: gate fields plus evidence. */
function boardRow(r: DetailRow): object {
  return {
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    age_days: r.age_days,
    watchlist: r.watchlist,
    implied_multiple: r.multiple,
    confidence: r.confidence,
    value_low_usd: r.value_low_usd,
    value_high_usd: r.value_high_usd,
  };
}

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));
  const outDir = resolve(output);
  const snapshot = readSnapshot(resolve(input));

  const built = buildBoard(snapshot);
  selfCheck(snapshot, built.rows);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "board.json"),
    JSON.stringify(
      { as_of: snapshot.as_of, source: snapshot.source, rows: built.rows.map(boardRow) },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  // data.js sits beside the dashboard folder and carries everything the
  // page renders: full board detail, the live (already-tokened) view and
  // the calibration the Method panel quotes.
  const data = dashboardData(snapshot, built);
  writeFileSync(join(outDir, "data.js"), "window.RADAR = " + JSON.stringify(data) + ";\n", "utf8");

  copyTree(join(HERE, "dashboard"), join(outDir, "dashboard"));
  copyTree(join(HERE, "screenshots"), join(outDir, "screenshots"));

  // The dossier is written last: buildDossier reads the copied dashboard/
  // and screenshots/ back out of the output directory.
  writeFileSync(join(outDir, "dossier.json"), buildDossier(outDir, { text_max_bytes: 65536 }));

  const top = built.rows[0];
  console.log(
    `token-radar v3: ${built.rows.length} pre-token rows, watchlist ` +
      `${built.rows.filter((r) => r.watchlist).length}/${snapshot.watchlist.length}, ` +
      `top ${top.slug} $${top.implied_value_usd.toLocaleString("en-US")}, ` +
      `live ${built.live.length} -> ${outDir}`,
  );
}

main();
