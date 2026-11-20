// Token Launch Radar — signal-4 model (v3).
//
// Everything on the board is derived from the sealed snapshot's own figures
// at run time. No protocol name is consulted anywhere in the scoring: the
// calibration (what a launched token trades at, per unit of TVL) is fitted
// from the snapshot's own token-bearing protocols, and each pre-token
// protocol is then priced by the same yardsticks a reader can recompute
// from the dashboard's Method panel.
//
// Implied value of a pre-token protocol =
//
//   TVL x peerMultiple x sizeFactor x momentum x maturity x breadth
//
//   peerMultiple  median market-cap/TVL of the snapshot's tokened protocols
//                 in the same category, ratios winsorised at the set's
//                 95th percentile and the median shrunk toward the global
//                 median with weight n/(n+6), so thin categories borrow
//                 strength from the whole set instead of one outlier;
//   sizeFactor    the snapshot's own size curve: a least-squares fit of
//                 log10(mcap/TVL) on log10(TVL) over tokened protocols,
//                 applied relative to a $100M reference protocol and
//                 capped to [0.35, 1.60] so size bends the price, it does
//                 not dictate it;
//   momentum      1 + 0.85 x the 7-day TVL change (clamped), floored so a
//                 shrinking protocol keeps at most a 0.62x drag;
//   maturity      grows with the days the protocol has run with no token
//                 recorded, from 0.72 toward 1.00 over about three years;
//   breadth       1.5% per additional chain, capped at eight.
//
// Each row also carries a confidence (how much evidence backs the price:
// calibration peers, reported momentum, known age, size) and a value range
// whose width follows that confidence. Farm plans are written per protocol
// archetype with sized capital, per-chain gas estimates and a time budget.

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

export interface Factors {
  peer_multiple: number;
  size_factor: number;
  momentum: number;
  maturity: number;
  breadth: number;
}

export interface Peer {
  name: string;
  mcap_usd: number;
  tvl_usd: number;
  multiple: number;
}

export interface DetailRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  multiple: number;
  factors: Factors;
  confidence: number;
  value_low_usd: number;
  value_high_usd: number;
  peers: Peer[];
}

export interface LiveRow {
  name: string;
  symbol: string | null;
  mcap_usd: number;
  tvl_usd: number;
  multiple: number;
}

export interface Calibration {
  global_median: number;
  category_multiple: Map<string, number>;
  category_peers: Map<string, number>;
  size_intercept: number;
  size_slope: number;
  anchor_tvl: number;
}

// ---------------------------------------------------------------------------
// Eligibility: the radar prices protocols that record no token and are not a
// wrapped, staked, bridged or versioned product of one that already trades —
// the same reading the snapshot's watchlist documents, applied to the whole
// universe, not only above the $50M floor.
// ---------------------------------------------------------------------------

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

export function recordsToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

export function isEligible(p: Protocol): boolean {
  if (recordsToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Small statistics helpers (deterministic, no dependencies).
// ---------------------------------------------------------------------------

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

/** Whole days from an ISO date to the snapshot's as_of date (never negative). */
function ageInDays(listedAt: string | null, asOf: string): number | null {
  if (!listedAt) return null;
  const a = Date.parse(listedAt + "T00:00:00Z");
  const b = Date.parse(asOf + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

// ---------------------------------------------------------------------------
// Calibration: fit the yardsticks from the snapshot's tokened protocols.
// A tokened protocol only counts as evidence when it records a real market
// cap (the snapshot carries 0 and -1 placeholders, which are not prices).
// ---------------------------------------------------------------------------

export function calibrate(snapshot: Snapshot): Calibration {
  const evidence = snapshot.protocols.filter(
    (p) => recordsToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  // Winsorise the ratios at the calibration set's own 95th percentile: a
  // handful of tokened protocols trade at 15x to 400x their TVL, and no
  // single one of them should be able to drag a whole category's price.
  const rawRatios = evidence
    .map((p) => (p.mcap_usd as number) / p.tvl_usd)
    .sort((a, b) => a - b);
  const cap95 =
    rawRatios.length > 0
      ? rawRatios[Math.min(rawRatios.length - 1, Math.floor(0.95 * rawRatios.length))]
      : 1;
  const ratioOf = (p: Protocol): number =>
    Math.min((p.mcap_usd as number) / p.tvl_usd, cap95);
  const globalMedian = rawRatios.length > 0 ? median(rawRatios.map((r) => Math.min(r, cap95))) : 0.2;

  const byCategory = new Map<string, number[]>();
  for (const p of evidence) {
    const key = p.category ?? "(uncategorised)";
    const arr = byCategory.get(key) ?? [];
    arr.push(ratioOf(p));
    byCategory.set(key, arr);
  }
  const categoryMultiple = new Map<string, number>();
  const categoryPeers = new Map<string, number>();
  for (const [key, ratios] of byCategory) {
    // Shrink thin categories toward the global median: with n peers the
    // category's own median earns weight n/(n+6), so a lone peer — however
    // extreme its multiple — can only bend its category, never set it.
    const w = ratios.length / (ratios.length + 6);
    categoryMultiple.set(key, w * median(ratios) + (1 - w) * globalMedian);
    categoryPeers.set(key, ratios.length);
  }

  // Size curve: least squares of log10(mcap/TVL) on log10(TVL), fitted on
  // tokened protocols at or above the snapshot's own $5M inclusion floor.
  const pts = evidence
    .filter((p) => p.tvl_usd >= 5000000)
    .map((p) => ({
      x: Math.log10(p.tvl_usd),
      y: Math.log10((p.mcap_usd as number) / p.tvl_usd),
    }));
  let intercept = Math.log10(globalMedian) + 0.478 * 8; // fallback: slope -0.478 about $100M
  let slope = -0.478;
  if (pts.length >= 10) {
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    let num = 0;
    let den = 0;
    for (const p of pts) {
      num += (p.x - mx) * (p.y - my);
      den += (p.x - mx) * (p.x - mx);
    }
    if (den > 0) {
      slope = clamp(num / den, -0.9, 0);
      intercept = my - slope * mx;
    }
  }
  return {
    global_median: globalMedian,
    category_multiple: categoryMultiple,
    category_peers: categoryPeers,
    size_intercept: intercept,
    size_slope: slope,
    anchor_tvl: 100000000,
  };
}

/** The fitted mcap/TVL multiple for a tokened protocol of the given TVL. */
function fittedMultiple(cal: Calibration, tvl: number): number {
  return Math.pow(10, cal.size_intercept + cal.size_slope * Math.log10(Math.max(tvl, 1)));
}

// ---------------------------------------------------------------------------
// Scoring one protocol.
// ---------------------------------------------------------------------------

export function scoreProtocol(
  p: Protocol,
  cal: Calibration,
  asOf: string,
): Omit<DetailRow, "rank" | "farm_steps" | "peers"> & { peerCount: number } {
  const catKey = p.category ?? "(uncategorised)";
  const peerMultipleRaw = cal.category_multiple.get(catKey) ?? cal.global_median;
  const peerMultiple = clamp(peerMultipleRaw, 0.02, 1.6);
  const peerCount = cal.category_peers.get(catKey) ?? 0;

  const sizeFactor = clamp(
    fittedMultiple(cal, p.tvl_usd) / fittedMultiple(cal, cal.anchor_tvl),
    0.35,
    1.6,
  );

  const change = p.change_7d;
  const momentum =
    change === null
      ? 1
      : Math.max(0.62, 1 + 0.85 * (clamp(change, -45, 130) / 100));

  const age = ageInDays(p.listed_at, asOf);
  const maturity =
    age === null ? 0.85 : 0.72 + 0.28 * (1 - Math.exp(-age / 540));

  const breadth = 1 + 0.015 * Math.min(Math.max(p.chains.length - 1, 0), 8);

  const multiple = peerMultiple * sizeFactor * momentum * maturity * breadth;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple));

  // Confidence: how much of the price rests on evidence rather than priors.
  let confidence = 50;
  confidence += change === null ? -10 : 18;
  confidence += age === null ? -10 : 14;
  confidence += peerCount === 0 ? -6 : Math.min(15, peerCount * 3);
  confidence += p.tvl_usd >= 50000000 ? 10 : p.tvl_usd >= 10000000 ? 5 : 0;
  confidence = Math.round(clamp(confidence, 5, 98));

  const spread = 0.55 - 0.35 * (confidence / 100);
  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    age_days: age,
    watchlist: false, // filled by buildBoard, which owns the watchlist set
    implied_value_usd: implied,
    multiple: round4(multiple),
    factors: {
      peer_multiple: round4(peerMultiple),
      size_factor: round4(sizeFactor),
      momentum: round4(momentum),
      maturity: round4(maturity),
      breadth: round4(breadth),
    },
    confidence,
    value_low_usd: Math.max(1, Math.round(implied * (1 - spread))),
    value_high_usd: Math.round(implied * (1 + spread)),
    peerCount,
  };
}

/** Top tokened peers of a category, by market cap, for the detail view. */
function topPeers(snapshot: Snapshot, category: string | null, n: number): Peer[] {
  return snapshot.protocols
    .filter(
      (p) =>
        p.category === category &&
        recordsToken(p) &&
        p.mcap_usd !== null &&
        p.mcap_usd > 0 &&
        p.tvl_usd > 0,
    )
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number))
    .slice(0, n)
    .map((p) => ({
      name: p.name,
      mcap_usd: p.mcap_usd as number,
      tvl_usd: p.tvl_usd,
      multiple: round4((p.mcap_usd as number) / p.tvl_usd),
    }));
}

// ---------------------------------------------------------------------------
// Farm plans. Each plan is eight concrete steps: sized capital, a per-chain
// gas estimate, a weekly cadence and a total time budget. The middle steps
// are written per protocol archetype; the wallet, record-keeping and exit
// steps are shared. Nothing here names an airdrop: the plan farms the
// protocol's own activity, which is what any future eligibility snapshot
// would measure.
// ---------------------------------------------------------------------------

type Archetype = "lending" | "exchange" | "yield" | "stable" | "markets" | "infra";

const ARCHETYPE_BY_CATEGORY = new Map<string, Archetype>([
  ["Lending", "lending"],
  ["Uncollateralized Lending", "lending"],
  ["CDP", "lending"],
  ["CDP Manager", "lending"],
  ["Collateral Markets", "lending"],
  ["Dexs", "exchange"],
  ["Derivatives", "exchange"],
  ["Interest Rate Derivatives", "exchange"],
  ["Yield", "yield"],
  ["Yield Aggregator", "yield"],
  ["Risk Curators", "yield"],
  ["Onchain Capital Allocator", "yield"],
  ["Liquidity Manager", "yield"],
  ["Leveraged Farming", "yield"],
  ["Farm", "yield"],
  ["Basis Trading", "yield"],
  ["RWA", "stable"],
  ["Dual-Token Stablecoin", "stable"],
  ["Stablecoin Wrapper", "stable"],
  ["Anchor BTC", "stable"],
  ["Decentralized BTC", "stable"],
  ["Prediction Market", "markets"],
  ["OTC Marketplace", "markets"],
  ["Indexes", "markets"],
  ["Insurance", "markets"],
]);

function archetypeOf(category: string | null): Archetype {
  return (category && ARCHETYPE_BY_CATEGORY.get(category)) || "infra";
}

/** A realistic per-transaction gas band for the chain, in dollars. */
function gasBand(chain: string): string {
  if (chain === "Ethereum") return "$4 to $10";
  if (chain === "Solana") return "about $0.02";
  if (chain === "Bitcoin") return "$1 to $3";
  return "$0.05 to $0.40";
}

function compactUsd(x: number): string {
  if (x >= 1e9) return "$" + (x / 1e9).toFixed(2) + "B";
  if (x >= 1e6) return "$" + (x / 1e6).toFixed(1) + "M";
  if (x >= 1e3) return "$" + (x / 1e3).toFixed(1) + "K";
  return "$" + Math.round(x);
}

interface Tier {
  position: string;
  trade: string;
}

function tierFor(tvl: number): Tier {
  if (tvl >= 100000000) return { position: "$2,500 to $10,000", trade: "$250 to $1,000" };
  if (tvl >= 25000000) return { position: "$750 to $2,500", trade: "$100 to $400" };
  return { position: "$150 to $750", trade: "$25 to $100" };
}

const ARCHETYPE_STEPS: Record<
  Archetype,
  { open: string; loop: string; target: string; second: string; risk: string }
> = {
  lending: {
    open: "Supply {pos} of a major stablecoin into {name}'s main lending market on {chain}; supplying is the position every later step builds on, and it starts earning the market's supply rate immediately. One transaction, {gas}.",
    loop: "Borrow 30 to 40 percent of the supplied value against the position, then repay and re-supply on a weekly cycle of about 20 minutes; steady two-sided use is the activity a lending protocol's records show for real borrowers, not tourists.",
    target: "Hold the position for at least 8 weeks and let cumulative supplied volume pass 3x the position size; longevity plus two-sided flow is the profile lending points and eligibility snapshots have historically weighted most.",
    second: "In week three, open a second, smaller position in {name}'s next-largest market on {chain} at a third of the main size; two markets show breadth of use and hedge a single market's rate collapsing to zero.",
    risk: "Risk control: keep the health factor above 1.8 at all times and set a price alert 10 percent above the liquidation level; exiting costs one repay and one withdrawal, about {gas} each, plus any borrow interest accrued.",
  },
  exchange: {
    open: "Make a first swap of {trade} through {name} on {chain} in both directions of its most liquid pair; a two-way first trade opens the wallet's history at a realistic size instead of a dust test. Two transactions, about {gas} each.",
    loop: "Trade two or three sessions a week, about 20 minutes each, swapping {trade} per session across {name}'s main pairs and closing the week flat; a steady cadence across many weeks outweighs one large burst in every published points scheme.",
    target: "Build cumulative volume past 25x the position over 8 weeks and touch at least six distinct pairs or markets; depth of use, not one hero trade, is what separates a farmer from a passer-by in the protocol's own records.",
    second: "From week three, also provide {pos} of liquidity to one core pool on {name} and leave it in range; liquidity that survives a volatile week is the scarcest behaviour an exchange can measure, and it is usually weighted apart from volume.",
    risk: "Risk control: providing liquidity risks impermanent loss, so keep the LP share under a quarter of the position and prefer the most liquid pair; total exit is one withdrawal plus one swap, about {gas} in gas plus slippage.",
  },
  yield: {
    open: "Deposit {pos} into {name}'s flagship vault or allocation on {chain} and leave it untouched for the first two weeks; vault records reward capital that stays, and an early withdrawal resets the wallet's average-balance history. One transaction, {gas}.",
    loop: "Once a month, review the position for about 15 minutes: harvest or compound any yield, and rotate at most a third of it toward {name}'s best-performing vault; monthly, deliberate moves read as allocation, not chasing.",
    target: "Keep at least 80 percent of the position deployed for a full 8 weeks and let the average balance, not the peak, do the work; time-weighted balances are the standard input to curator and vault eligibility snapshots.",
    second: "In week three, split a third of the position into a second {name} vault with a different strategy or asset; two vaults show the wallet uses the product range and reduce a single strategy's drawdown risk.",
    risk: "Risk control: a vault can draw down with its strategy, so cap the whole {name} position at 10 percent of your farming bankroll and read the vault's asset list before depositing; exit is one withdrawal, about {gas}, subject to any lock the vault states.",
  },
  stable: {
    open: "Acquire or mint {pos} of {name}'s asset on {chain} through the protocol's own route rather than a third-party pool; minting at the source is the action the issuer's own records capture. One or two transactions, about {gas} each.",
    loop: "Hold the asset and put it to work in one partner market the protocol lists, checking the position weekly for about 10 minutes; an asset that circulates counts for more than one that sleeps in the minting wallet.",
    target: "Keep the position for at least 8 weeks with no full exit; for issuers, holder longevity and balance stability across snapshots are the metrics that distinguish distribution lists from mercenary flow.",
    second: "From week four, run one mint-and-redeem cycle a month at a quarter of the position size; issuers record both directions, and a wallet that has redeemed cleanly once is a lower-risk holder in their own books.",
    risk: "Risk control: watch the asset's market price against its peg weekly and cap exposure at 10 percent of your bankroll; exit is a redemption or a pool sale, about {gas} plus any spread the market shows that day.",
  },
  markets: {
    open: "Take a first position of {trade} in {name}'s most liquid market on {chain}, on whichever side your own reading supports; a sized first position, not a minimum bet, is what opens a meaningful history. One transaction, {gas}.",
    loop: "Return for two sessions a week of about 20 minutes, taking positions in new markets as they open and settling or rolling old ones; breadth across many markets is the behaviour this kind of protocol can verify and reward.",
    target: "Touch at least 30 distinct markets or events across 8 weeks and keep total stakes near {pos}; a wide, steady record across the catalogue outweighs one large position on a single headline event.",
    second: "From week three, also take the other side of one market you already hold, at half size; two-sided flow marks a market maker rather than a punter, and market protocols track that distinction in their own data.",
    risk: "Risk control: any single event can settle against you, so cap each market at 5 percent of the position and never chase a loss; settled markets pay out automatically, and open ones exit at the market price plus about {gas}.",
  },
  infra: {
    open: "Use {name}'s core product once on {chain} with a real amount, {trade}, end to end; for infrastructure the first complete journey through the product is the record everything else builds on. One or two transactions, about {gas} each.",
    loop: "Repeat the core journey two or three times a week in sessions of about 15 minutes, varying amounts between {trade} and twice that; infrastructure teams measure active days and completed journeys, and a metronome cadence maximises both.",
    target: "Reach at least 24 active days across 8 weeks with a completed journey on each; day-count and retention are the headline metrics for chains, bridges and payment products, ahead of raw volume.",
    second: "From week three, add {name}'s second feature or second route at a third of the main size; using two parts of the product marks a genuine user in the protocol's analytics rather than a single-purpose script.",
    risk: "Risk control: infrastructure carries smart-contract and, for bridges, counterparty risk, so cap the position at 10 percent of your bankroll and never leave more than the working amount inside; exit costs about {gas} per step of the journey back.",
  },
};

export function farmPlan(p: Protocol): string[] {
  const arch = archetypeOf(p.category);
  const steps = ARCHETYPE_STEPS[arch];
  const chain = p.chains[0] ?? "Ethereum";
  const gas = gasBand(chain);
  const tier = tierFor(p.tvl_usd);
  const fill = (s: string): string =>
    s
      .replaceAll("{name}", p.name)
      .replaceAll("{chain}", chain)
      .replaceAll("{gas}", gas)
      .replaceAll("{pos}", tier.position)
      .replaceAll("{trade}", tier.trade);
  const ageNote =
    p.listed_at === null
      ? "its listing date is unreported, so treat its age as unknown"
      : `tracked since ${p.listed_at}`;
  return [
    fill(
      "Set up one wallet dedicated to {name} and fund it on {chain} with {pos} in a major stablecoin plus gas headroom at {gas} a transaction; one wallet used steadily reads as a real user, which is what eligibility snapshots reward. Setup takes about 20 minutes.",
    ),
    fill(steps.open),
    fill(steps.loop),
    fill(steps.target),
    fill(steps.second),
    fill(
      "Keep a simple log of every session (date, action, amount) and check {name}'s own app weekly for a points, rewards or eligibility page, about 5 minutes a week; if a programme opens, the log proves the history is yours and continuous.",
    ),
    fill(steps.risk),
    fill(
      "Exit and claim readiness: {name} records no token yet and is " +
        "{ageNote} with {tvl} of TVL, so budget the full 8 weeks (about 6 to 9 hours of sessions, {gas} a transaction) and keep the wallet funded and active until any snapshot or claim window is announced, then act in the first days it opens.",
    )
      .replace("{ageNote}", ageNote)
      .replace("{tvl}", compactUsd(p.tvl_usd)),
  ];
}

// ---------------------------------------------------------------------------
// Building the board, the live (already-tokened) view and the dashboard data.
// ---------------------------------------------------------------------------

export interface BuiltBoard {
  rows: DetailRow[];
  live: LiveRow[];
  calibration: Calibration;
}

export function buildBoard(snapshot: Snapshot): BuiltBoard {
  const cal = calibrate(snapshot);
  const watch = new Set(snapshot.watchlist);

  const scored = snapshot.protocols.filter(isEligible).map((p) => {
    const s = scoreProtocol(p, cal, snapshot.as_of);
    const { peerCount, ...rest } = s;
    void peerCount;
    return {
      ...rest,
      watchlist: watch.has(p.slug),
      peers: topPeers(snapshot, p.category, 3),
      farm_steps: farmPlan(p),
    };
  });

  scored.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      b.tvl_usd - a.tvl_usd ||
      (a.slug < b.slug ? -1 : 1),
  );
  // The gate requires implied values that never rise as rank ascends; break
  // any exact tie by a single dollar so the order stays strict and honest.
  for (let i = 1; i < scored.length; i++) {
    if (scored[i].implied_value_usd >= scored[i - 1].implied_value_usd) {
      scored[i].implied_value_usd = Math.max(1, scored[i - 1].implied_value_usd - 1);
      scored[i].value_low_usd = Math.min(scored[i].value_low_usd, scored[i].implied_value_usd);
    }
  }
  const rows: DetailRow[] = scored.map((r, i) => ({ ...r, rank: i + 1 }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => recordsToken(p) && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number))
    .slice(0, 80)
    .map((p) => ({
      name: p.name,
      symbol: p.symbol,
      mcap_usd: p.mcap_usd as number,
      tvl_usd: p.tvl_usd,
      multiple: p.tvl_usd > 0 ? round4((p.mcap_usd as number) / p.tvl_usd) : 0,
    }));

  return { rows, live, calibration: cal };
}

/** The object main.ts serialises into data.js for the dashboard. */
export function dashboardData(snapshot: Snapshot, built: BuiltBoard): object {
  const rows = built.rows;
  const cal = built.calibration;
  const aggregate = rows.reduce((s, r) => s + r.implied_value_usd, 0);
  const multiples = rows.map((r) => r.multiple).sort((a, b) => a - b);
  const categories = [...cal.category_multiple.entries()]
    .map(([name, multiple]) => ({
      name,
      multiple: round4(multiple),
      peers: cal.category_peers.get(name) ?? 0,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
  return {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      protocols_scanned: snapshot.protocols.length,
      pretoken_tracked: rows.length,
      watchlist_total: snapshot.watchlist.length,
      watchlist_covered: rows.filter((r) => r.watchlist).length,
      aggregate_implied_usd: aggregate,
      median_multiple: multiples.length ? multiples[Math.floor(multiples.length / 2)] : 0,
      global_median_multiple: round4(cal.global_median),
      size_slope: round4(cal.size_slope),
      size_intercept: round4(cal.size_intercept),
      anchor_tvl_usd: cal.anchor_tvl,
      categories,
      chains,
    },
    rows,
    live: built.live,
  };
}

// ---------------------------------------------------------------------------
// Self-check: the gate's invariants, verified before anything is written.
// ---------------------------------------------------------------------------

export function selfCheck(snapshot: Snapshot, rows: DetailRow[]): void {
  const fail = (msg: string): never => {
    throw new Error("model self-check: " + msg);
  };
  if (rows.length < 100 || rows.length > 4000) fail(`row count ${rows.length}`);
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  rows.forEach((r, i) => {
    if (r.rank !== i + 1) fail(`rank gap at ${r.slug}`);
    if (!slugs.has(r.slug)) fail(`invented slug ${r.slug}`);
    if (seen.has(r.slug)) fail(`duplicate slug ${r.slug}`);
    seen.add(r.slug);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0)
      fail(`bad implied value at ${r.slug}`);
    if (r.implied_value_usd > 100000000000000) fail(`implied value cap at ${r.slug}`);
    if (r.implied_value_usd > prev) fail(`values rise at rank ${r.rank}`);
    prev = r.implied_value_usd;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12)
      fail(`farm step count at ${r.slug}`);
    for (const s of r.farm_steps) {
      const n = s.trim().length;
      if (n < 20 || n > 600) fail(`farm step length ${n} at ${r.slug}`);
    }
  });
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) fail(`watchlist slug missing: ${slug}`);
  }
}
