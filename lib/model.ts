// Token Launch Radar — value model (signal-3, v2).
//
// The implied value of a pre-token protocol is derived ONLY from the sealed
// snapshot's own figures. No protocol name is ever consulted by the model:
// every parameter below is calibrated from the snapshot itself at run time.
//
//   implied = tvl_usd x categoryMultiple x momentum x maturity x breadth
//
// - categoryMultiple: the median mcap/tvl of the snapshot's own tokened
//   protocols in the same category (blended with the global median when a
//   category has few tokened peers), clamped to [0.05, 1.25]. A category's
//   TVL supports a different fee base than another's, and the snapshot's own
//   traded protocols say how much.
// - momentum: the 7-day TVL change, clamped to [-50%, +150%], at full weight
//   (v1 used 0.6). factor = max(0.4, 1 + clampedChange). Fast-growing TVL
//   earns up to 2.5x; collapsing TVL is cut to 0.4x, never to zero.
// - maturity: log-scaled age since listed_at, 0.75 for a newborn protocol up
//   to 1.00 after ~3 years with no token. A long tokenless track record is
//   worth more than a fresh launch; unlisted protocols sit at 0.85.
// - breadth: 1 + 0.02 per extra chain beyond the first, capped at five extra
//   chains (1.00..1.10). Multi-chain reach is a small, real advantage.
//
// Protocols that record a token (gecko_id or symbol non-null) never enter the
// ranked board: they are listed separately, at the market's own values, in the
// dashboard's Live view. Wrapped, staked, bridged and versioned products are
// excluded from the board by the same rule the snapshot's watchlist uses.

export interface Protocol {
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Breakdown {
  multiple: number;
  momentum: number;
  maturity: number;
  breadth: number;
  peers: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface DetailRow extends BoardRow {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  breakdown: Breakdown;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  symbol: string | null;
}

const EXCLUDED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

const EXCHANGE_PREFIXES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function recordsNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** True when the protocol is a wrapped/staked/bridged/versioned product. */
export function isDerivative(p: Protocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  for (const ex of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(ex + " ") || p.name === ex) return true;
  }
  return false;
}

export function isBoardEligible(p: Protocol): boolean {
  return recordsNoToken(p) && !isDerivative(p);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

/** Calibrate per-category FDV/TVL multiples from the snapshot's tokened peers. */
export function calibrateMultiples(
  protocols: Protocol[],
): { byCategory: Map<string, { multiple: number; peers: number }>; global: number } {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0) continue;
    if (p.tvl_usd <= 0 || p.category === null) continue;
    const r = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(r) || r <= 0) continue;
    all.push(r);
    const arr = byCat.get(p.category) ?? [];
    arr.push(r);
    byCat.set(p.category, arr);
  }
  const global = clamp(median(all), 0.05, 1.25);
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [cat, vals] of [...byCat.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const m = median(vals);
    // Few peers: blend with the global median so one outlier cannot set a category.
    const multiple =
      vals.length >= 3 ? clamp(m, 0.05, 1.25) : clamp(0.5 * m + 0.5 * global, 0.05, 1.25);
    byCategory.set(cat, { multiple, peers: vals.length });
  }
  return { byCategory, global };
}

export function scoreProtocol(
  p: Protocol,
  asOf: string,
  multiples: { byCategory: Map<string, { multiple: number; peers: number }>; global: number },
): { implied: number; breakdown: Breakdown; ageDays: number | null } {
  const cat = p.category === null ? null : multiples.byCategory.get(p.category);
  const multiple = cat ? cat.multiple : multiples.global;
  const peers = cat ? cat.peers : 0;

  const change = p.change_7d === null ? 0 : p.change_7d;
  const momentum = Math.max(0.4, 1 + clamp(change / 100, -0.5, 1.5));

  let ageDays: number | null = null;
  let maturity = 0.85;
  if (p.listed_at !== null) {
    ageDays = daysBetween(p.listed_at, asOf);
    maturity = 0.75 + 0.25 * Math.min(1, Math.log1p(ageDays) / Math.log1p(1095));
  }

  const breadth = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 5);

  const implied = Math.max(
    1,
    Math.round(p.tvl_usd * multiple * momentum * maturity * breadth),
  );
  return {
    implied,
    breakdown: { multiple, momentum, maturity, breadth, peers },
    ageDays,
  };
}

// ---------------------------------------------------------------------------
// Farm plans. Generated from the protocol's own category, chains, TVL and age.
// Every step is concrete: an amount of capital, a gas estimate, a cadence and
// a time window. Amounts scale with the protocol's size, never with its name.
// ---------------------------------------------------------------------------

const GAS_USD: Record<string, number> = {
  Ethereum: 6,
  Solana: 0.02,
  Base: 0.08,
  Arbitrum: 0.15,
  Optimism: 0.12,
  Polygon: 0.05,
  BSC: 0.2,
  Avalanche: 0.3,
};

const CATEGORY_ACTION: Record<string, string> = {
  Dexs: "swap a small amount and add liquidity to the deepest pool",
  Lending: "supply collateral, then borrow a small amount against it",
  "Yield Aggregator": "deposit into the highest-TVL vault and enable auto-compound",
  Yield: "deposit into the highest-TVL vault and enable auto-compound",
  Derivatives: "open a small hedged position and keep it open through the week",
  "Liquid Staking": "stake the native asset through the protocol",
  RWA: "deposit into the tokenised-asset vault and hold the receipt token",
  Bridge: "bridge a small amount across the protocol's busiest route",
  "Onchain Capital Allocator": "deposit into the allocation vault and hold the receipt token",
  "Risk Curators": "deposit into a curated vault and hold the receipt token",
  "Leveraged Farming": "open a small leveraged farming position at 2x or less",
  "Basis Trading": "deposit into the basis vault and hold the receipt token",
  "Prediction Market": "place small trades on the most liquid market each week",
  "NFT Marketplace": "list or buy one low-priced item and complete a trade",
  "Algo-Stables": "mint a small amount of the stable asset against collateral",
  CDP: "open a collateralised debt position at under 50% loan-to-value",
  "Options Vault": "deposit into the options vault and hold the receipt token",
  "Yield Index": "buy the yield index token and hold it",
};

function gasFor(chain: string): number {
  return GAS_USD[chain] ?? 0.5;
}

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** Gas is often cents: show two decimals below $1 so it never reads "$0". */
function gasMoney(n: number): string {
  return n < 1 ? "$" + n.toFixed(2) : money(n);
}

function capitalTier(tvl: number): { low: number; high: number; label: string } {
  if (tvl >= 1_000_000_000) return { low: 1000, high: 5000, label: "$1,000-$5,000" };
  if (tvl >= 100_000_000) return { low: 500, high: 2000, label: "$500-$2,000" };
  if (tvl >= 20_000_000) return { low: 200, high: 1000, label: "$200-$1,000" };
  return { low: 100, high: 500, label: "$100-$500" };
}

export function farmSteps(p: Protocol, asOf: string): string[] {
  const chain = p.chains[0] ?? "Ethereum";
  const gas = gasFor(chain);
  const tier = capitalTier(p.tvl_usd);
  const action = CATEGORY_ACTION[p.category ?? ""] ?? "use the protocol's core feature with a small position";
  const age = p.listed_at === null ? null : daysBetween(p.listed_at, asOf);
  const ageNote =
    age === null
      ? "recently listed"
      : age >= 365
        ? `live for ${Math.floor(age / 365)}+ year(s)`
        : `live for ${age} days`;
  const cat = p.category ?? "uncategorised";
  const steps = [
    `Set up a fresh wallet, fund it with ${tier.label} on ${chain} plus ${money(Math.max(20, gas * 10))} spare for gas (about ${gasMoney(gas)} per transaction on ${chain}), and write down the seed phrase offline.`,
    `Bridge or send ${money(tier.low)} to ${chain} if your funds sit elsewhere, then open ${p.name} and connect the wallet; confirm the site shows ${p.name} (${cat}, ${ageNote}) before approving anything.`,
    `Start farming: ${action} with ${money(tier.low)} first, as a test deposit. Wait for the transaction to confirm and check the position shows in the dashboard before adding more.`,
    `Scale to ${money(tier.high)} over the first week in two or three deposits, keeping at least ${money(gas * 20)} of ${chain} gas in reserve; never deploy funds you need within 30 days.`,
    `Repeat the core action once a week for at least 8 weeks: re-deposit earnings, keep the position active, and save a screenshot plus the transaction hash of every deposit as proof of activity.`,
    `Watch the protocol's TVL and announcements weekly; if a points program or snapshot is announced, keep the position open through it and do not withdraw early, since early exits usually forfeit rewards.`,
    `Hold the position until a token is announced, then claim any airdrop within the claim window (usually 30-90 days) and sell at most half in the first week; keep the rest staked or supplied for 3-6 months.`,
  ];
  // Keep every step inside the gate's 20..600 character window.
  return steps.map((s) => (s.length > 600 ? s.slice(0, 597) + "..." : s));
}

// ---------------------------------------------------------------------------
// Board construction
// ---------------------------------------------------------------------------

export interface BuiltBoard {
  rows: DetailRow[];
  live: LiveRow[];
  multiples: { byCategory: Map<string, { multiple: number; peers: number }>; global: number };
}

export function buildBoard(snapshot: Snapshot, extraRows = 200): BuiltBoard {
  const multiples = calibrateMultiples(snapshot.protocols);

  const scored: DetailRow[] = [];
  for (const p of snapshot.protocols) {
    if (!isBoardEligible(p)) continue;
    const { implied, breakdown, ageDays } = scoreProtocol(p, snapshot.as_of, multiples);
    scored.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: farmSteps(p, snapshot.as_of),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: ageDays,
      breakdown,
    });
  }
  // Highest implied value first; slug breaks ties so the order is total.
  scored.sort((a, b) =>
    b.implied_value_usd !== a.implied_value_usd
      ? b.implied_value_usd - a.implied_value_usd
      : a.slug < b.slug
        ? -1
        : 1,
  );

  const watch = new Set(snapshot.watchlist);
  const watchRows = scored.filter((r) => watch.has(r.slug));
  const rest = scored.filter((r) => !watch.has(r.slug)).slice(0, extraRows);
  const chosen = [...watchRows, ...rest];
  // Re-rank the chosen set: ranks are exactly 1..N by implied value.
  chosen.sort((a, b) =>
    b.implied_value_usd !== a.implied_value_usd
      ? b.implied_value_usd - a.implied_value_usd
      : a.slug < b.slug
        ? -1
        : 1,
  );
  chosen.forEach((r, i) => {
    r.rank = i + 1;
  });

  // Live view: protocols whose token already trades, at the market's own values.
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.mcap_usd !== null)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      symbol: p.symbol,
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd)
    .slice(0, 60);

  return { rows: chosen, live, multiples };
}

/** Gate self-check: throws on the first violation. */
export function selfCheck(snapshot: Snapshot, rows: DetailRow[]): void {
  if (rows.length < 100 || rows.length > 4000) {
    throw new Error(`selfCheck: ${rows.length} rows, need 100..4000`);
  }
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    if (!slugs.has(r.slug)) throw new Error(`selfCheck: unknown slug ${r.slug}`);
    if (seen.has(r.slug)) throw new Error(`selfCheck: duplicate slug ${r.slug}`);
    seen.add(r.slug);
    if (r.rank !== i + 1) throw new Error(`selfCheck: rank ${r.rank} at position ${i}`);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      throw new Error(`selfCheck: bad implied value for ${r.slug}`);
    }
    if (i > 0 && rows[i - 1].implied_value_usd < r.implied_value_usd) {
      throw new Error(`selfCheck: implied value rises at rank ${r.rank}`);
    }
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      throw new Error(`selfCheck: farm_steps count for ${r.slug}`);
    }
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) {
        throw new Error(`selfCheck: farm step length ${t.length} for ${r.slug}`);
      }
    }
    if (!r.name || typeof r.name !== "string") throw new Error(`selfCheck: bad name ${r.slug}`);
  });
  for (const w of snapshot.watchlist) {
    if (!seen.has(w)) throw new Error(`selfCheck: watchlist slug missing: ${w}`);
  }
  const values = new Set(rows.map((r) => r.implied_value_usd));
  if (rows.length >= 2 && values.size === 1) {
    throw new Error("selfCheck: all implied values identical");
  }
}

/** The dashboard's data file payload (board detail + live view + model notes). */
export function dashboardData(
  snapshot: Snapshot,
  built: BuiltBoard,
): Record<string, unknown> {
  return {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    watchlist_count: snapshot.watchlist.length,
    model: {
      formula: "implied = tvl_usd x categoryMultiple x momentum x maturity x breadth",
      categoryMultiple:
        "median mcap/tvl of the snapshot's own tokened protocols in the same category (global median when a category has no peers), clamped 0.05..1.25",
      momentum: "1 + 7-day TVL change clamped to [-50%, +150%], floored at 0.4",
      maturity: "0.75 + 0.25 x log-scaled age since listed_at (3 years = 1.00); 0.85 when unlisted",
      breadth: "1 + 0.02 per extra chain, capped at five extra chains",
      globalMultiple: built.multiples.global,
    },
    rows: built.rows,
    live: built.live,
  };
}
