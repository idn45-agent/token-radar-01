// Token Launch Radar — entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every pre-token protocol with the model
// in lib/model.ts, and writes board.json, data.js, dashboard/, screenshots/
// and dossier.json into the output directory. Fully deterministic: two runs
// write byte-identical outputs.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBoard, selfCheck, dashboardData } from "./lib/model.ts";
import type { Snapshot, DetailRow } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = "/input/snapshot.json";
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && argv[i + 1]) input = argv[++i];
    else if (argv[i] === "--output" && argv[i + 1]) output = argv[++i];
    else if (argv[i].startsWith("--input=")) input = argv[i].slice(8);
    else if (argv[i].startsWith("--output=")) output = argv[i].slice(9);
  }
  return { input, output };
}

function readSnapshot(input: string): Snapshot {
  let path = input;
  if (statSync(path).isDirectory()) path = join(path, "snapshot.json");
  const raw = readFileSync(path, "utf8");
  const snap = JSON.parse(raw) as Snapshot;
  if (!Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist)) {
    throw new Error(`main: ${path} is not a token-radar snapshot`);
  }
  return snap;
}

/** Copy a directory tree, files in sorted order, so the copy is deterministic. */
function copyTree(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  );
  for (const e of entries) {
    const s = join(src, e.name);
    const d = join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) copyFileSync(s, d);
  }
}

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));
  const outDir = resolve(output);
  const snapshot = readSnapshot(resolve(input));

  const built = buildBoard(snapshot, 200);
  selfCheck(snapshot, built.rows);

  // board.json carries exactly the gate's fields per row.
  const boardRows = built.rows.map((r: DetailRow) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "board.json"),
    JSON.stringify({ as_of: snapshot.as_of, rows: boardRows }, null, 2) + "\n",
    "utf8",
  );

  // data.js carries the full detail the dashboard renders (board + live view).
  const data = dashboardData(snapshot, built);
  writeFileSync(
    join(outDir, "data.js"),
    "window.RADAR = " + JSON.stringify(data, null, 2) + ";\n",
    "utf8",
  );

  copyTree(join(HERE, "dashboard"), join(outDir, "dashboard"));
  copyTree(join(HERE, "screenshots"), join(outDir, "screenshots"));

  // Dossier last: buildDossier reads dashboard/ and screenshots/ from outDir.
  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, "dossier.json"), dossier);

  console.log(
    `token-radar: ${built.rows.length} rows, top ${built.rows[0].slug} $${built.rows[0].implied_value_usd.toLocaleString("en-US")}, live ${built.live.length} -> ${outDir}`,
  );
}

main();
