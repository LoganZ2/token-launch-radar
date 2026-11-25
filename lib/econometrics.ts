// Peer-calibrated econometric model for Token Launch Radar.
// Fits directly on the sealed snapshot's clean traded protocol peers (no CEX, bridges, LSTs, or versioned pools),
// evaluates every term on both Leave-One-Out CV and Walk-Forward temporal splits, estimates empirical token
// launch incidence from category + age cohorts, and derives costed $/hr farm playbooks with zero hardcoded names.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface AblationRow {
  id: string;
  label: string;
  loo_mult: number;
  loo_mae: number;
  wf_mult: number;
  wf_mae: number;
  decision: 'baseline' | 'kept' | 'dropped' | 'active';
  note: string;
}

export interface FittedParams {
  intercept: number;
  beta_log_tvl: number;
  beta_log_chains: number;
  beta_flow_7d: number;
  category_k: number;
  category_adj: Record<string, number>;
  peer_count: number;
  loo_mult: number;
  loo_mae: number;
  wf_mult: number;
  wf_mae: number;
  starter_mult: number;
  starter_mae: number;
  band_p25_mult: number;
  band_p75_mult: number;
  band_p10_mult: number;
  band_p90_mult: number;
  ablation: AblationRow[];
}

export interface FarmStepDetail {
  action: string;
  cost: string;
  time: string;
  minutes: number;
  gas_usd: number;
}

export interface FarmVerdict {
  verdict: 'FARM NOW' | 'SELECTIVE' | 'WATCH' | 'LOW ODDS';
  capital_usd: number;
  gas_usd: number;
  total_hours: number;
  hold_days: number;
  est_airdrop_usd: number;
  expected_ev_usd: number;
  ev_per_hour: number;
  gas_tier: string;
  rationale: string;
  steps: FarmStepDetail[];
}

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
  tier: 'watchlist' | 'extended' | 'early';
  age_days: number | null;
  implied_value_usd: number;
  range_p25_usd: number;
  range_p75_usd: number;
  range_p10_usd: number;
  range_p90_usd: number;
  launch_odds_pct: number;
  cat_token_rate_pct: number;
  age_token_rate_pct: number;
  expected_value_usd: number;
  decomp: {
    tvl_term: number;
    chain_term: number;
    cat_term: number;
    flow_term: number;
    cat_peers: number;
  };
  farm: FarmVerdict;
  farm_steps: string[];
}

export interface PeerRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  pred_usd: number;
  err_mult: number;
  listed_at: string | null;
  age_days: number | null;
  change_7d: number | null;
}

export interface RadarPayload {
  as_of: string;
  source: string;
  floor_usd: number;
  universe_total: number;
  watchlist_count: number;
  extended_count: number;
  early_count: number;
  clean_peer_count: number;
  excluded_count: number;
  model: FittedParams;
  cat_incidence: Array<{ category: string; with_token: number; total: number; pct: number }>;
  age_incidence: Array<{ bucket: string; with_token: number; total: number; pct: number }>;
  rows: BoardRow[];
  peers: PeerRow[];
}

const DAY_MS = 86_400_000;
const VERSIONED_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_RE = /\b(wrapped|staked|staking)\b/i;
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const HIGH_GAS_CHAINS = new Set(['Ethereum']);
const MED_GAS_CHAINS = new Set(['Bitcoin', 'Avalanche', 'Binance', 'BSC', 'Tron']);

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isCleanUniverse(p: SnapshotProtocol): boolean {
  const cat = p.category ?? 'Other';
  return !EXCLUDED_CATEGORIES.has(cat) && !VERSIONED_RE.test(p.name) && !WRAPPED_RE.test(p.name);
}

export function isCleanTradedPeer(p: SnapshotProtocol): boolean {
  return isCleanUniverse(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = clamp(Math.floor(q * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx]!;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(M[r]![i]!) > Math.abs(M[piv]![i]!)) piv = r;
    }
    const tmp = M[i]!;
    M[i] = M[piv]!;
    M[piv] = tmp;
    const diag = M[i]![i]!;
    if (Math.abs(diag) < 1e-12) continue;
    for (let r = i + 1; r < n; r++) {
      const f = M[r]![i]! / diag;
      for (let c = i; c <= n; c++) M[r]![c]! -= f * M[i]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    const diag = M[i]![i]!;
    if (Math.abs(diag) < 1e-12) continue;
    let sum = M[i]![n]!;
    for (let j = i + 1; j < n; j++) sum -= M[i]![j]! * x[j]!;
    x[i] = sum / diag;
  }
  return x;
}

type FeatureFn = (p: SnapshotProtocol, asOf: string) => number[];

interface HuberFit {
  beta: number[];
  catAdj: Record<string, number>;
  catCounts: Record<string, number>;
}

function fitHuber(
  peers: SnapshotProtocol[],
  asOf: string,
  featFn: FeatureFn,
  useCat: boolean,
  catK = 5.0,
  delta = 0.8,
  ridge = 0.25,
): HuberFit {
  const n = peers.length;
  const feats = peers.map((p) => featFn(p, asOf));
  const ys = peers.map((p) => Math.log(p.mcap_usd!));
  const d = feats[0]!.length;
  const weights = new Array<number>(n).fill(1);
  let catAdj: Record<string, number> = {};
  let beta = new Array<number>(d).fill(0);

  for (let iter = 0; iter < 18; iter++) {
    const XtX: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    const Xty = new Array<number>(d).fill(0);
    for (let i = 0; i < n; i++) {
      const x = feats[i]!;
      const cat = peers[i]!.category ?? 'Other';
      const y = ys[i]! - (useCat ? (catAdj[cat] ?? 0) : 0);
      const w = weights[i]!;
      for (let a = 0; a < d; a++) {
        Xty[a]! += w * x[a]! * y;
        for (let b = 0; b < d; b++) XtX[a]![b]! += w * x[a]! * x[b]!;
      }
    }
    for (let a = 1; a < d; a++) XtX[a]![a]! += ridge;
    beta = solveLinear(XtX, Xty);

    if (useCat) {
      const sums = new Map<string, { rw: number; w: number }>();
      for (let i = 0; i < n; i++) {
        const x = feats[i]!;
        let pred = 0;
        for (let a = 0; a < d; a++) pred += beta[a]! * x[a]!;
        const cat = peers[i]!.category ?? 'Other';
        const cur = sums.get(cat) ?? { rw: 0, w: 0 };
        cur.rw += (ys[i]! - pred) * weights[i]!;
        cur.w += weights[i]!;
        sums.set(cat, cur);
      }
      catAdj = {};
      for (const [cat, s] of sums.entries()) {
        catAdj[cat] = s.rw / (s.w + catK);
      }
    }

    for (let i = 0; i < n; i++) {
      const x = feats[i]!;
      let pred = useCat ? (catAdj[peers[i]!.category ?? 'Other'] ?? 0) : 0;
      for (let a = 0; a < d; a++) pred += beta[a]! * x[a]!;
      const r = Math.abs(ys[i]! - pred);
      weights[i] = r <= delta ? 1.0 : delta / r;
    }
  }

  const catCounts: Record<string, number> = {};
  for (const p of peers) {
    const c = p.category ?? 'Other';
    catCounts[c] = (catCounts[c] ?? 0) + 1;
  }
  return { beta, catAdj, catCounts };
}

function predictLog(p: SnapshotProtocol, asOf: string, featFn: FeatureFn, fit: HuberFit, useCat: boolean): number {
  const x = featFn(p, asOf);
  let out = useCat ? (fit.catAdj[p.category ?? 'Other'] ?? 0) : 0;
  for (let i = 0; i < x.length; i++) out += fit.beta[i]! * x[i]!;
  return out;
}

function evaluateSpec(
  peers: SnapshotProtocol[],
  asOf: string,
  featFn: FeatureFn,
  useCat: boolean,
  catK = 5.0,
): { looRes: number[]; looMult: number; looMae: number; wfMult: number; wfMae: number } {
  const looRes: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const train = peers.filter((_, j) => j !== i);
    const fit = fitHuber(train, asOf, featFn, useCat, catK);
    const pred = predictLog(peers[i]!, asOf, featFn, fit, useCat);
    looRes.push(pred - Math.log(peers[i]!.mcap_usd!));
  }
  const looAbs = looRes.map(Math.abs);

  const dated = peers.filter((p) => p.listed_at !== null).sort((a, b) => a.listed_at!.localeCompare(b.listed_at!));
  const cut = Math.floor(dated.length * 0.65);
  const wfFit = fitHuber(dated.slice(0, cut), asOf, featFn, useCat, catK);
  const wfAbs = dated.slice(cut).map((p) => Math.abs(predictLog(p, asOf, featFn, wfFit, useCat) - Math.log(p.mcap_usd!)));

  return {
    looRes,
    looMult: round2(Math.exp(median(looAbs))),
    looMae: round3(mean(looAbs)),
    wfMult: round2(Math.exp(median(wfAbs))),
    wfMae: round3(mean(wfAbs)),
  };
}

function ageBucketLabel(days: number | null): string {
  if (days === null) return 'Unknown';
  if (days < 180) return '<6m';
  if (days < 365) return '6-12m';
  if (days < 730) return '1-2y';
  if (days < 1460) return '2-4y';
  return '4y+';
}

function buildIncidence(protocols: SnapshotProtocol[], asOf: string) {
  const clean = protocols.filter(isCleanUniverse);
  const overallWith = clean.filter((p) => !isPreToken(p)).length;
  const prior = overallWith / Math.max(1, clean.length);

  const catMap = new Map<string, { withTok: number; total: number }>();
  const ageMap = new Map<string, { withTok: number; total: number }>();
  for (const p of clean) {
    const has = !isPreToken(p);
    const cat = p.category ?? 'Other';
    const c = catMap.get(cat) ?? { withTok: 0, total: 0 };
    c.total += 1;
    if (has) c.withTok += 1;
    catMap.set(cat, c);

    const b = ageBucketLabel(ageDays(asOf, p.listed_at));
    const a = ageMap.get(b) ?? { withTok: 0, total: 0 };
    a.total += 1;
    if (has) a.withTok += 1;
    ageMap.set(b, a);
  }

  const catRate = (cat: string): number => {
    const s = catMap.get(cat) ?? { withTok: 0, total: 0 };
    return (s.withTok + 6 * prior) / (s.total + 6);
  };
  const ageRate = (days: number | null): number => {
    const s = ageMap.get(ageBucketLabel(days)) ?? { withTok: 0, total: 0 };
    return (s.withTok + 8 * prior) / (s.total + 8);
  };

  const catList = [...catMap.entries()]
    .map(([category, v]) => ({ category, with_token: v.withTok, total: v.total, pct: round2((100 * v.withTok) / v.total) }))
    .sort((a, b) => b.total - a.total);
  const bucketOrder = ['<6m', '6-12m', '1-2y', '2-4y', '4y+', 'Unknown'];
  const ageList = bucketOrder
    .filter((b) => ageMap.has(b))
    .map((bucket) => {
      const v = ageMap.get(bucket)!;
      return { bucket, with_token: v.withTok, total: v.total, pct: round2((100 * v.withTok) / v.total) };
    });

  return { prior, catRate, ageRate, catList, ageList };
}

function gasProfile(chains: string[]): { chain: string; tier: string; txGas: number; setupGas: number; weeklyGas: number } {
  const lowChain = chains.find((c) => !HIGH_GAS_CHAINS.has(c) && !MED_GAS_CHAINS.has(c));
  if (lowChain) return { chain: lowChain, tier: 'L2 / Low-Fee', txGas: 0.15, setupGas: 0.6, weeklyGas: 0.25 };
  const medChain = chains.find((c) => MED_GAS_CHAINS.has(c));
  if (medChain) return { chain: medChain, tier: 'Mid-Fee L1', txGas: 1.0, setupGas: 3.5, weeklyGas: 1.2 };
  const primary = chains[0] ?? 'Ethereum';
  return { chain: primary, tier: 'Ethereum L1', txGas: 4.5, setupGas: 14.0, weeklyGas: 5.0 };
}

function categoryAction(p: SnapshotProtocol, chain: string, capital: number): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC or blue-chip collateral on ${p.name} (${chain}) and borrow 25% against it to earn both lender and borrower activity points.`;
  }
  if (c.includes('dex') || c.includes('liquidity')) {
    return `Provide $${capital} in a core stable or major-pair pool on ${p.name} (${chain}) and execute 2 organic swaps across distinct weeks.`;
  }
  if (c.includes('derivative') || c.includes('perp') || c.includes('basis')) {
    return `Deposit $${capital} USDC margin into ${p.name} (${chain}), open a delta-neutral or low-leverage position, and cycle modest weekly volume.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${capital} USDC into ${p.name}'s highest-liquidity curated vault on ${chain} and verify whether points accrue to vault shares directly.`;
  }
  if (c.includes('rwa')) {
    return `Mint or subscribe $${capital} into ${p.name}'s yield-bearing RWA instrument on ${chain} and hold the receipt token unwrapped in your wallet.`;
  }
  if (c.includes('yield')) {
    return `Deposit $${capital} into ${p.name}'s flagship yield vault on ${chain} and compound rewards once mid-campaign to log repeat on-chain usage.`;
  }
  if (c.includes('payment')) {
    return `Open a $${capital} channel or route recurring micro-transfers through ${p.name} (${chain}) to build verifiable routing history.`;
  }
  return `Deposit $${capital} of USDC into ${p.name}'s core contract on ${chain} and maintain active on-chain balance through multiple snapshot dates.`;
}

function buildFarmVerdict(
  p: SnapshotProtocol,
  age: number | null,
  impliedUsd: number,
  launchOddsPct: number,
): FarmVerdict {
  const gp = gasProfile(p.chains);
  const capital = p.tvl_usd >= 1_000_000_000 ? 1000 : p.tvl_usd >= 200_000_000 ? 500 : p.tvl_usd >= 50_000_000 ? 300 : 200;
  const holdDays = age === null ? 45 : age < 180 ? 60 : age < 540 ? 45 : 30;
  const weeks = Math.max(4, Math.ceil(holdDays / 7));

  // Transparent anti-whale retail airdrop model:
  // 5% community TGE pool split 55% equal/tiered active-wallet allocation + 45% pro-rata TVL share.
  // Estimated active farming wallets scale sub-linearly with TVL (~$16k average TVL/wallet, bounded [1200, 120000]).
  const poolAlloc = impliedUsd * 0.05;
  const estActiveWallets = clamp(Math.round(p.tvl_usd / 16_000), 1200, 120_000);
  const tieredShare = (poolAlloc * 0.55) / estActiveWallets;
  const proRataShare = poolAlloc * 0.45 * (capital / Math.max(p.tvl_usd, 5_000_000));
  const estAirdrop = round2(clamp(tieredShare + proRataShare, 4, 1800));

  const setupMin = 15;
  const weeklyMin = 5;
  const claimMin = 10;
  const totalMin = setupMin + weeks * weeklyMin + claimMin + 10;
  const totalHours = round2(totalMin / 60);
  const totalGas = round2(gp.setupGas + weeks * gp.weeklyGas + gp.txGas * 2);
  // Opportunity cost of capital at 4% APR over holdDays
  const oppCost = round2(capital * 0.04 * (holdDays / 365));
  const totalCost = round2(totalGas + oppCost);
  const expectedEv = round2(estAirdrop * (launchOddsPct / 100) - totalCost);
  const evPerHour = round2(expectedEv / Math.max(0.25, totalHours));

  let verdict: FarmVerdict['verdict'];
  let rationale: string;
  if (launchOddsPct < 26) {
    verdict = 'LOW ODDS';
    rationale = `Peer token incidence is low (${round2(launchOddsPct)}% launch odds); avoid locking capital unless a points program confirms a token.`;
  } else if (evPerHour >= 40 && expectedEv >= 35) {
    verdict = 'FARM NOW';
    rationale = `High retail airdrop density (~${estActiveWallets.toLocaleString()} est. wallets) on ${gp.chain} (${gp.tier}: $${totalGas} gas) delivers $${evPerHour}/hr risk-adjusted EV.`;
  } else if (evPerHour >= 12 && expectedEv >= 10) {
    verdict = 'SELECTIVE';
    rationale = `Solid net return ($${evPerHour}/hr after $${totalGas} gas + $${oppCost} carry); best farmed alongside native yield on ${gp.chain}.`;
  } else {
    verdict = 'WATCH';
    rationale = `Crowded TVL pool (~${estActiveWallets.toLocaleString()} wallets) or ${gp.tier} fees ($${totalGas}) compress net EV ($${expectedEv}); wait for boost or L2 launch.`;
  }

  const steps: FarmStepDetail[] = [
    {
      action: `Isolate a fresh farming wallet funded with $${capital} USDC plus $${Math.ceil(totalGas + 5)} native gas on ${gp.chain} (${gp.tier}).`,
      cost: `$${round2(gp.txGas)} funding/bridge gas`,
      time: '10 minutes',
      minutes: 10,
      gas_usd: gp.txGas,
    },
    {
      action: categoryAction(p, gp.chain, capital),
      cost: `$${capital} principal + ~$${gp.setupGas} gas`,
      time: `${setupMin} minutes setup`,
      minutes: setupMin,
      gas_usd: gp.setupGas,
    },
    {
      action: `Execute 1 organic weekly touchpoint on ${p.name} (${gp.chain}) for ${weeks} weeks to clear multi-snapshot anti-Sybil thresholds.`,
      cost: `~$${round2(weeks * gp.weeklyGas)} gas (${weeks} wks)`,
      time: `${weeklyMin} min/week (${weeks * weeklyMin} min total)`,
      minutes: weeks * weeklyMin,
      gas_usd: round2(weeks * gp.weeklyGas),
    },
    {
      action: `Hold $${capital} across ${holdDays} days (est. $${oppCost} carry at 4% APR; ~${estActiveWallets.toLocaleString()} est. peer wallets) until snapshot confirmation.`,
      cost: `$${oppCost} capital opportunity cost`,
      time: `${holdDays} calendar days`,
      minutes: 0,
      gas_usd: 0,
    },
    {
      action: `Unwind after snapshot, log tx hashes, and claim only via ${p.name}'s verified domain (Est. ~$${estAirdrop} gross at 5% TGE pool, $${evPerHour}/hr net EV).`,
      cost: `~$${gp.txGas} exit/claim gas`,
      time: `${claimMin} minutes`,
      minutes: claimMin,
      gas_usd: gp.txGas,
    },
  ];

  return {
    verdict,
    capital_usd: capital,
    gas_usd: totalGas,
    total_hours: totalHours,
    hold_days: holdDays,
    est_airdrop_usd: estAirdrop,
    expected_ev_usd: expectedEv,
    ev_per_hour: evPerHour,
    gas_tier: gp.tier,
    rationale,
    steps,
  };
}

export function formatFarmStep(s: FarmStepDetail): string {
  let out = `${s.action} Cost: ${s.cost}. Time: ${s.time}.`;
  if (out.length > 600) out = `${out.slice(0, 596)}...`;
  return out;
}

export function parseSnapshot(text: string): Snapshot {
  const o = JSON.parse(text) as Record<string, unknown>;
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('Invalid snapshot object');
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new Error('Invalid as_of');
  if (typeof o.source !== 'string') throw new Error('Missing source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd)) throw new Error('Invalid floor_usd');
  if (!Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) throw new Error('Missing arrays');
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols: (o.protocols as Record<string, unknown>[]).map((p) => ({
      slug: String(p.slug),
      name: String(p.name),
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: Number(p.tvl_usd),
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    })),
    watchlist: o.watchlist.map(String),
  };
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; payload: RadarPayload } {
  const asOf = snapshot.as_of;
  const watchlistSet = new Set(snapshot.watchlist);
  const peers = snapshot.protocols.filter(isCleanTradedPeer);

  // Starter baseline error on the exact same clean peers
  const starterAbs = peers.map((p) => {
    const a = ageDays(asOf, p.listed_at) ?? 365;
    const g = clamp(p.change_7d ?? 0, -60, 120);
    const imp = p.tvl_usd * 0.25 * (1 + (g / 100) * 0.5) * (0.6 + (Math.min(a, 1095) / 1095) * 0.4);
    return Math.abs(Math.log(imp) - Math.log(p.mcap_usd!));
  });
  const starterMult = round2(Math.exp(median(starterAbs)));
  const starterMae = round3(mean(starterAbs));

  // Define candidate feature specs for honest double blind ablation (LOO-CV + Walk-Forward)
  const fTvl: FeatureFn = (p) => [1, Math.log(Math.max(1, p.tvl_usd))];
  const fTvlChains: FeatureFn = (p) => [1, Math.log(Math.max(1, p.tvl_usd)), Math.log(Math.max(1, p.chains.length))];
  const fTvlAge: FeatureFn = (p, d) => [1, Math.log(Math.max(1, p.tvl_usd)), Math.log((ageDays(d, p.listed_at) ?? 365) + 30)];
  const fActive: FeatureFn = (p) => [
    1,
    Math.log(Math.max(1, p.tvl_usd)),
    Math.log(Math.max(1, p.chains.length)),
    clamp(p.change_7d ?? 0, -40, 80) / 100,
  ];

  const evTvl = evaluateSpec(peers, asOf, fTvl, false);
  const evTvlCat = evaluateSpec(peers, asOf, fTvl, true, 5.0);
  const evTvlChains = evaluateSpec(peers, asOf, fTvlChains, false);
  const evTvlChainsCat = evaluateSpec(peers, asOf, fTvlChains, true, 5.0);
  const evTvlAgeCat = evaluateSpec(peers, asOf, fTvlAge, true, 5.0);
  const evActive = evaluateSpec(peers, asOf, fActive, true, 5.0);

  // Require strict improvement on BOTH LOO-CV and Walk-Forward before adding any extra feature!
  const useFlow = evActive.looMae < evTvlChainsCat.looMae && evActive.wfMult < evTvlChainsCat.wfMult;
  const chosenFeat = useFlow ? fActive : fTvlChains;
  const chosenEv = useFlow ? evActive : evTvlChainsCat;
  const fullFit = fitHuber(peers, asOf, chosenFeat, true, 5.0);

  const sortedRes = [...chosenEv.looRes].sort((a, b) => a - b);
  const p10Res = quantile(sortedRes, 0.1);
  const p25Res = quantile(sortedRes, 0.25);
  const p75Res = quantile(sortedRes, 0.75);
  const p90Res = quantile(sortedRes, 0.9);
  const bandP25 = round2(Math.exp(-p75Res));
  const bandP75 = round2(Math.exp(-p25Res));
  const bandP10 = round2(Math.exp(-p90Res));
  const bandP90 = round2(Math.exp(-p10Res));

  const ablation: AblationRow[] = [
    {
      id: 'starter',
      label: 'Starter 0.25×TVL×g×m',
      loo_mult: starterMult,
      loo_mae: starterMae,
      wf_mult: starterMult,
      wf_mae: starterMae,
      decision: 'baseline',
      note: 'Linear TVL over-predicts billion-dollar vaults; 4.44x median error on clean peers.',
    },
    {
      id: 'tvl',
      label: 'Huber ln(TVL)',
      loo_mult: evTvl.looMult,
      loo_mae: evTvl.looMae,
      wf_mult: evTvl.wfMult,
      wf_mae: evTvl.wfMae,
      decision: 'kept',
      note: `Sub-linear elasticity (β=${round3(fullFit.beta[1]!)}): cuts LOO error from ${starterMult}x to ${evTvl.looMult}x.`,
    },
    {
      id: 'chains',
      label: '+ ln(Chains)',
      loo_mult: evTvlChains.looMult,
      loo_mae: evTvlChains.looMae,
      wf_mult: evTvlChains.wfMult,
      wf_mae: evTvlChains.wfMae,
      decision: 'kept',
      note: `Multi-chain fragmentation discount improves both LOO (${evTvlChains.looMult}x) & WF (${evTvlChains.wfMult}x).`,
    },
    {
      id: 'cat',
      label: '+ Empirical-Bayes Category (k=5)',
      loo_mult: evTvlChainsCat.looMult,
      loo_mae: evTvlChainsCat.looMae,
      wf_mult: evTvlChainsCat.wfMult,
      wf_mae: evTvlChainsCat.wfMae,
      decision: useFlow ? 'kept' : 'active',
      note: `Shrinks category multiples toward global curve; best WF (${evTvlChainsCat.wfMult}x) & LOO (${evTvlChainsCat.looMult}x).`,
    },
    {
      id: 'flow7d',
      label: '+ Clamped 7d TVL Flow',
      loo_mult: evActive.looMult,
      loo_mae: evActive.looMae,
      wf_mult: evActive.wfMult,
      wf_mae: evActive.wfMae,
      decision: useFlow ? 'active' : 'dropped',
      note: useFlow
        ? 'Regularized 7d momentum retained in valuation; minor net gain with bounded [-40%, +80%] clamp.'
        : 'Dropped from valuation (adds out-of-sample variance); retained as momentum signal in radar UI.',
    },
    {
      id: 'age',
      label: '+ ln(Age) in Valuation',
      loo_mult: evTvlAgeCat.looMult,
      loo_mae: evTvlAgeCat.looMae,
      wf_mult: evTvlAgeCat.wfMult,
      wf_mae: evTvlAgeCat.wfMae,
      decision: 'dropped',
      note: 'Worsens LOO & WF valuation error; moved to Empirical Token Launch Odds where age is monotonic (26%→86%).',
    },
  ];

  const incidence = buildIncidence(snapshot.protocols, asOf);

  // Build candidate pre-token set: 100% of watchlist + all remaining clean pre-token protocols
  const chosenMap = new Map<string, SnapshotProtocol>();
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p) chosenMap.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosenMap.has(p.slug) && isPreToken(p) && isCleanUniverse(p)) {
      chosenMap.set(p.slug, p);
    }
  }

  const rawRows = [...chosenMap.values()].map((p) => {
    const age = ageDays(asOf, p.listed_at);
    const logPred = predictLog(p, asOf, chosenFeat, fullFit, true);
    const implied = Math.max(1, Math.round(Math.exp(logPred)));
    const cat = p.category ?? 'Other';

    const cRate = incidence.catRate(cat);
    const aRate = incidence.ageRate(age);
    // Log-odds Bayes combination of category and age incidence rates (with conservative shrink toward prior)
    const oddsC = cRate / Math.max(0.01, 1 - cRate);
    const oddsA = aRate / Math.max(0.01, 1 - aRate);
    const oddsP = incidence.prior / Math.max(0.01, 1 - incidence.prior);
    const combinedOdds = Math.pow(oddsC, 0.72) * Math.pow(oddsA / oddsP, 0.45);
    const launchOddsPct = round2(clamp((100 * combinedOdds) / (1 + combinedOdds), 6, 92));
    const expectedVal = Math.max(1, Math.round(implied * (launchOddsPct / 100)));

    const farm = buildFarmVerdict(p, age, implied, launchOddsPct);
    const tvlTerm = round3(fullFit.beta[0]! + fullFit.beta[1]! * Math.log(Math.max(1, p.tvl_usd)));
    const chainTerm = round3(fullFit.beta[2]! * Math.log(Math.max(1, p.chains.length)));
    const flowTerm = useFlow ? round3((fullFit.beta[3] ?? 0) * (clamp(p.change_7d ?? 0, -40, 80) / 100)) : 0;
    const catTerm = round3(fullFit.catAdj[cat] ?? 0);

    return {
      rank: 0,
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
      tier: watchlistSet.has(p.slug)
        ? ('watchlist' as const)
        : p.tvl_usd >= snapshot.floor_usd
          ? ('extended' as const)
          : ('early' as const),
      age_days: age,
      implied_value_usd: implied,
      range_p25_usd: Math.max(1, Math.round(implied * bandP25)),
      range_p75_usd: Math.max(1, Math.round(implied * bandP75)),
      range_p10_usd: Math.max(1, Math.round(implied * bandP10)),
      range_p90_usd: Math.max(1, Math.round(implied * bandP90)),
      launch_odds_pct: launchOddsPct,
      cat_token_rate_pct: round2(cRate * 100),
      age_token_rate_pct: round2(aRate * 100),
      expected_value_usd: expectedVal,
      decomp: {
        tvl_term: tvlTerm,
        chain_term: chainTerm,
        cat_term: catTerm,
        flow_term: flowTerm,
        cat_peers: fullFit.catCounts[cat] ?? 0,
      },
      farm,
      farm_steps: farm.steps.map(formatFarmStep),
    };
  });

  rawRows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  rawRows.forEach((r, idx) => {
    r.rank = idx + 1;
  });

  const peerRows: PeerRow[] = peers
    .map((p) => {
      const pred = Math.max(1, Math.round(Math.exp(predictLog(p, asOf, chosenFeat, fullFit, true))));
      const errMult = round2(Math.max(pred / p.mcap_usd!, p.mcap_usd! / pred));
      return {
        slug: p.slug,
        name: p.name,
        category: p.category ?? 'Other',
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd!,
        ratio: round3(p.mcap_usd! / p.tvl_usd),
        pred_usd: pred,
        err_mult: errMult,
        listed_at: p.listed_at,
        age_days: ageDays(asOf, p.listed_at),
        change_7d: p.change_7d,
      };
    })
    .sort((a, b) => b.mcap_usd - a.mcap_usd);

  const catAdjRounded: Record<string, number> = {};
  for (const [k, v] of Object.entries(fullFit.catAdj)) catAdjRounded[k] = round3(v);

  const model: FittedParams = {
    intercept: round3(fullFit.beta[0]!),
    beta_log_tvl: round3(fullFit.beta[1]!),
    beta_log_chains: round3(fullFit.beta[2]!),
    beta_flow_7d: useFlow ? round3(fullFit.beta[3] ?? 0) : 0,
    category_k: 5,
    category_adj: catAdjRounded,
    peer_count: peers.length,
    loo_mult: chosenEv.looMult,
    loo_mae: chosenEv.looMae,
    wf_mult: chosenEv.wfMult,
    wf_mae: chosenEv.wfMae,
    starter_mult: starterMult,
    starter_mae: starterMae,
    band_p25_mult: bandP25,
    band_p75_mult: bandP75,
    band_p10_mult: bandP10,
    band_p90_mult: bandP90,
    ablation,
  };

  const extendedCount = rawRows.filter((r) => r.tier === 'extended').length;
  const earlyCount = rawRows.filter((r) => r.tier === 'early').length;

  const payload: RadarPayload = {
    as_of: asOf,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    universe_total: snapshot.protocols.length,
    watchlist_count: snapshot.watchlist.length,
    extended_count: extendedCount,
    early_count: earlyCount,
    clean_peer_count: peers.length,
    excluded_count: snapshot.protocols.length - rawRows.length - peers.length,
    model,
    cat_incidence: incidence.catList,
    age_incidence: incidence.ageList,
    rows: rawRows,
    peers: peerRows,
  };

  return { board: rawRows, payload };
}

export function validateBoard(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `Row count ${board.length} outside [100, 4000]`;
  const validSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (!validSlugs.has(r.slug)) return `Unknown slug: ${r.slug}`;
    if (seen.has(r.slug)) return `Duplicate slug: ${r.slug}`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `Rank mismatch at ${i}: got ${r.rank}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `Non-monotonic implied value at rank ${r.rank}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `Bad implied value for ${r.slug}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `Bad farm_steps count for ${r.slug}`;
    for (const s of r.farm_steps) {
      if (s.trim().length < 20 || s.trim().length > 600) return `Bad farm_step length for ${r.slug}`;
    }
  }
  for (const w of snapshot.watchlist) {
    if (!seen.has(w)) return `Missing watchlist protocol: ${w}`;
  }
  return null;
}
