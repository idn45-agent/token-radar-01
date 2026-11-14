// The radar's model, signal-2: one sealed snapshot in, one ranked board out.
//
// The board ranks protocols that record no token yet. Its implied value is a claim about what a
// launch could be worth if the protocol's record stayed as it is, and it is built from the
// snapshot's own figures only — TVL, the seven-day TVL change, the day DefiLlama began tracking
// the protocol, the chains its TVL spans, and its category. No protocol's name is ever read by
// the formula: the same code scores every row.
//
//   implied = tvl_usd x base(category) x growth(change_7d) x maturity(age) x breadth(chains)
//
// base(category)  an FDV/TVL multiple per category family. A dollar of TVL in a lending market
//                 supports a different fee base than a dollar parked with a risk curator or
//                 bridged through a canonical bridge, so one flat multiple would misprice both.
// growth          the 7-day change, clamped to [-50, +150] per cent so one wild week cannot
//                 dominate, weighted by GROWTH_WEIGHT and floored so a shrinking protocol
//                 still keeps half its base value.
// maturity        log-scaled age: a protocol that has run for years with no token has proved
//                 the record the value rests on; log scaling keeps the tenth year from counting
//                 ten times the first.
// breadth         +4% per chain beyond the first, capped at five extra chains: TVL that already
//                 spans chains is likelier to matter at launch than the same TVL on one chain.
//
// Protocols whose token already trades never enter the ranking: they are returned apart, at the
// market's own values, for the dashboard's Live view.

/** One protocol of the snapshot: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's tunable constants, stated in the dashboard and open to its sandbox. */
export interface ModelConstants {
  /** FDV/TVL multiple when a category names no family. */
  default_base: number;
  /** The 7-day change is clamped to this band, in per cent, before it is weighted. */
  growth_floor_pct: number;
  growth_cap_pct: number;
  /** How much of the clamped change moves the value; also the growth multiplier's floor. */
  growth_weight: number;
  growth_mult_floor: number;
  /** Maturity: multiplier = floor + span x ln(1 + age_days) / ln(1 + full_age_days). */
  maturity_floor: number;
  maturity_span: number;
  full_age_days: number;
  /** The age a protocol with no listed_at is scored at. */
  unknown_age_days: number;
  /** Breadth: bonus per chain beyond the first, and how many extra chains count. */
  breadth_per_chain: number;
  breadth_max_extra: number;
}

export const MODEL: ModelConstants = {
  default_base: 0.22,
  growth_floor_pct: -50,
  growth_cap_pct: 150,
  growth_weight: 0.6,
  growth_mult_floor: 0.5,
  maturity_floor: 0.55,
  maturity_span: 0.45,
  full_age_days: 1460,
  unknown_age_days: 270,
  breadth_per_chain: 0.04,
  breadth_max_extra: 5,
};

/** The model's version label: the dashboard names it, the README quotes it. */
export const MODEL_VERSION = 'signal-2';

/** How many early protocols below the watchlist floor the board adds. */
export const EARLY_ROWS = 200;

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/**
 * FDV/TVL base multiples by category family, matched on the category's words. Curators and
 * allocators earn a thin fee on assets they route, so their TVL supports the least launch value;
 * lending, CDP and trading venues keep the widest fee base. The order matters: the first family
 * whose words appear in the category wins.
 */
const BASE_FAMILIES: { words: string[]; base: number }[] = [
  { words: ['curator', 'allocator'], base: 0.14 },
  { words: ['bridge'], base: 0.15 },
  { words: ['stable', 'issuer', 'money market'], base: 0.16 },
  { words: ['yield', 'farm'], base: 0.2 },
  { words: ['liquid staking', 'restaking', 'staking'], base: 0.25 },
  { words: ['dex', 'exchange'], base: 0.28 },
  { words: ['lend', 'cdp', 'collateral'], base: 0.3 },
  { words: ['perpetual', 'derivative', 'options'], base: 0.32 },
];

/** The FDV/TVL base multiple one category earns. */
export function baseMultiple(category: string | null, model: ModelConstants = MODEL): number {
  if (category === null) return model.default_base;
  const c = category.toLowerCase();
  for (const family of BASE_FAMILIES) {
    if (family.words.some((w) => c.includes(w))) return family.base;
  }
  return model.default_base;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** One protocol broken into the model's factors: everything the dashboard's detail view shows. */
export interface Scored {
  implied: number;
  base: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
  chainCount: number;
}

/** Score one protocol under `model`: the four factors and the implied value they multiply to. */
export function impliedValue(p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): Scored {
  const age = ageDays(asOf, p.listed_at);
  const base = baseMultiple(p.category, model);
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = Math.min(model.growth_cap_pct, Math.max(model.growth_floor_pct, rawGrowth));
  const growthMult = Math.max(model.growth_mult_floor, 1 + (growthPct / 100) * model.growth_weight);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + model.maturity_span * (Math.log(1 + Math.max(0, ageForModel)) / Math.log(1 + model.full_age_days));
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_extra);
  const breadthMult = 1 + model.breadth_per_chain * extraChains;
  const implied = Math.max(1, Math.round(p.tvl_usd * base * growthMult * maturityMult * breadthMult));
  return { implied, base, growthPct, growthMult, maturityMult, breadthMult, age, chainCount: p.chains.length };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is another protocol's pool, not a launch of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether the board may rank a protocol: pre-token, not an exchange itself, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** One row of board.json: the snapshot's record, the model's factors, and the farm plan. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
    chain_count: number;
  };
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the dashboard shows the market's value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
}

/** The dashboard's compact view of one board row: everything the page renders, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  base_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** Everything the dashboard needs: the board, the live set apart, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  protocol_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * The board: every watchlist slug (the floor), plus the EARLY_ROWS strongest early protocols —
 * rankable, pre-token, below the floor — chosen by the same implied value the board then ranks
 * by, so the radar's reach is the model's judgement, not a TVL cut. Ranks 1..N follow implied
 * value; ties break on TVL, then slug, so two runs write the same bytes.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) if (watch.has(p.slug)) chosen.set(p.slug, p);

  const scored = snapshot.protocols.map((p) => ({ p, s: impliedValue(p, snapshot.as_of, model) }));
  const early = scored
    .filter(({ p }) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.s.implied - a.s.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const { p } of early) chosen.set(p.slug, p);

  const rows = scored
    .filter(({ p }) => chosen.has(p.slug))
    .sort((a, b) => b.s.implied - a.s.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return rows.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token' as const,
    on_watchlist: watch.has(p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: s.base,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
      chain_count: s.chainCount,
    },
    farm_steps: farmPlan(p, s.age),
  }));
}

/** The live-token protocols, by market cap, kept apart from the ranking. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    protocol_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      on_watchlist: r.on_watchlist,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      base_multiple: r.model.base_multiple,
      growth_pct: r.model.growth_pct,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      breadth_multiplier: r.model.breadth_multiplier,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, steps, values. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const snapshotSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (!snapshotSlugs.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${i + 1} outvalues rank ${i}`;
  }
  if (byRank.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// ---------------------------------------------------------------- farm plans
//
// Every plan is generated from the protocol's own record — its category family, first chain, TVL
// and age — so the steps a reader follows are the steps that protocol actually offers: a lending
// market is farmed by supplying and borrowing, a bridge by bridging, a curator vault by holding
// shares. Each step states its action, its cost and its time, and the whole plan is seven steps:
// set up, take the position, deepen it, keep a weekly cadence, hold through the window, verify
// rewards only at the source, and keep an exit log.

/** The first chain a protocol names, or a neutral phrase. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

const L2_CHAINS = new Set(['Base', 'Optimism', 'Arbitrum', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Ink', 'Mode', 'Taiko', 'Soneium']);

/** A realistic gas figure for one transaction on a chain, in words. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $10 of ETH in gas';
  if (chain === 'Solana') return 'under $0.50 of SOL in fees';
  if (chain === 'Tron') return 'about $1 of TRX in fees';
  if (chain === 'Binance' || chain === 'BNB Chain') return 'about $0.40 of BNB in gas';
  if (L2_CHAINS.has(chain)) return 'about $0.30 of ETH in gas';
  return "about $2 of the chain's gas token";
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 2_000_000_000) return 500;
  if (tvl >= 500_000_000) return 300;
  if (tvl >= 100_000_000) return 200;
  if (tvl >= 25_000_000) return 120;
  return 75;
}

/** How long to hold, from the protocol's age: younger protocols earn a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category family a plan is written for, matched on the category's words. */
type FarmFamily = 'lending' | 'dex' | 'bridge' | 'staking' | 'perps' | 'curator' | 'stable' | 'generic';

function familyOf(category: string | null): FarmFamily {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return 'curator';
  if (c.includes('dex') || c.includes('exchange')) return 'dex';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('staking') || c.includes('restak')) return 'staking';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return 'perps';
  if (c.includes('stable')) return 'stable';
  return 'generic';
}

/** The position-taking step and the deepening step, per family, in words a farmer can follow. */
function familyActions(family: FarmFamily, name: string, chain: string, capital: number): [string, string] {
  switch (family) {
    case 'lending':
      return [
        `Supply $${capital} of USDC as collateral in ${name} on ${chain}; pick the market with the deepest liquidity, not the highest rate.`,
        `Borrow about 30% of the supplied value in the same asset and re-supply it once, so the wallet shows both sides of the market.`,
      ];
    case 'dex':
      return [
        `Add $${capital} of liquidity to ${name}'s busiest stable or blue-chip pool on ${chain}, in the default range if it offers one.`,
        `Swap about $${Math.max(20, Math.round(capital / 5))} through the same pool each visit, so the wallet reads as a trader and not only a depositor.`,
      ];
    case 'bridge':
      return [
        `Bridge $${capital} of USDC from Ethereum to ${chain} through ${name}, then hold the bridged balance on the far side.`,
        `Use the bridged funds in one app on ${chain} — a swap or a deposit — so the trip ends in activity, not an idle balance.`,
      ];
    case 'staking':
      return [
        `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the liquid receipt token in the same wallet.`,
        `Restake or lend the receipt token in one integrated market the protocol's own page names, if it lists one, and keep both positions.`,
      ];
    case 'perps':
      return [
        `Deposit $${capital} of USDC as margin on ${name} and open one small position, no larger than the deposit, in its most liquid market.`,
        `Close and reopen the hedge once a week at a similar size, so the account shows a trading history rather than one lucky trade.`,
      ];
    case 'curator':
      return [
        `Deposit $${capital} of USDC into a ${name} vault on ${chain}; choose the vault with the longest track record, not the highest APY.`,
        `Split a second $${Math.max(25, Math.round(capital / 2))} into a second ${name} vault on another chain it serves, if it serves one, and hold both share balances.`,
      ];
    case 'stable':
      return [
        `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the issued balance untouched.`,
        `Move half the balance into the protocol's own savings or staking wrapper, if it offers one, so both products carry the wallet's history.`,
      ];
    default:
      return [
        `Deposit $${capital} of USDC into ${name} on ${chain} through its main app and leave the position open.`,
        `Repeat the core action once at half size two weeks later, so the wallet's history spans more than a single day.`,
      ];
  }
}

/**
 * A protocol's farm plan: seven steps, each an action with its cost and its time, derived from
 * the protocol's record alone. Step strings carry their cost and time inline ("Cost: ... Time:
 * ...") and land between 20 and 600 characters, as the gate asks.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): string[] {
  const chain = firstChain(p);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const [take, deepen] = familyActions(familyOf(p.category), p.name, chain, capital);
  const steps: [string, string, string][] = [
    [
      `Open a fresh wallet for ${p.name} alone, write its seed phrase on paper, and fund it on ${chain} with the position capital plus gas money.`,
      gas,
      '10 minutes',
    ],
    [take, `$${capital} of capital plus ${gas}`, '15 minutes'],
    [deepen, 'the amounts stated, plus gas per transaction', '15 minutes'],
    [
      `Repeat one qualifying action every week — a deposit, a swap, a borrow or a claim — on the same weekday, so the activity reads as a habit and not a raid.`,
      'about $2 of gas a week on most chains, more on Ethereum',
      '10 minutes a week',
    ],
    [
      `Hold every position for at least ${hold} days without withdrawing below the opening size, so the balance is present in more than one weekly snapshot.`,
      `the $${capital} stays in the position for the whole window`,
      `${hold} days`,
    ],
    [
      `Check ${p.name}'s points or rewards page only through the protocol's official site or docs; never sign a claim from a link in a message, and never pay a fee to claim.`,
      'nothing to check; a claim that asks for a fee is a scam',
      '15 minutes a month',
    ],
    [
      `Keep a farm log — wallet, dates, amounts, transaction hashes — and plan the exit now: unwind in two tranches a week apart once a launch is announced or the window ends.`,
      gas,
      '20 minutes to set up, then 5 minutes a week',
    ],
  ];
  return steps.map(([text, cost, time]) => {
    let s = `${text} Cost: ${cost}. Time: ${time}.`;
    if (s.length > 600) s = `${s.slice(0, 596)}...`;
    return s;
  });
}


