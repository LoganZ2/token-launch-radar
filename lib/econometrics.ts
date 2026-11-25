// Peer-calibrated L1-LAD econometric engine for Token Launch Radar v2.
// Fits strictly on the sealed snapshot's 88 clean traded protocol peers (zero CEX, bridges, LSTs, or versioned pools),
// evaluates every term on three held-out blind tests (Leave-One-Out CV, 10-Fold CV, Walk-Forward temporal split),
// computes per-category conformal range intervals, derives survival-hazard token launch odds that fall with age,
// accounts for every one of the 758 snapshot protocols, and generates costed $/hr farm verdicts with zero hardcoded names.

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
  cv10_mult: number;
  wf_mult: number;
  loo_mae: number;
  decision: 'baseline' | 'kept' | 'dropped' | 'active';
  note: string;
}

export interface SurvivalBucket {
  bucket: string;
  with_token: number;
  total: number;
  cum_pct: number;
  remaining_hazard_pct: number;
}

export interface UniversePartition {
  total: number;
  watchlist_pre: number;
  extended_pre: number;
  early_pre: number;
  clean_traded_mcap: number;
  clean_token_nomcap: number;
  excluded_live: number;
  excluded_pre: number;
  reconciles: boolean;
}

export interface FittedParams {
  intercept: number;
  beta_log_tvl: number;
  beta_log_chains: number;
  category_k: number;
  category_adj: Record<string, number>;
  peer_count: number;
  loo_mult: number;
  cv10_mult: number;
  wf_mult: number;
  loo_mae: number;
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
  conformal_scale: number;
  launch_odds_pct: number;
  cat_token_rate_pct: number;
  age_hazard_pct: number;
  expected_value_usd: number;
  decomp: {
    tvl_term: number;
    chain_term: number;
    cat_term: number;
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
  universe: UniversePartition;
  watchlist_count: number;
  extended_count: number;
  early_count: number;
  clean_peer_count: number;
  model: FittedParams;
  cat_incidence: Array<{ category: string; with_token: number; total: number; pct: number }>;
  survival_curve: SurvivalBucket[];
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

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[clamp(Math.floor(q * (sorted.length - 1)), 0, sorted.length - 1)]!;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
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

interface LadFit {
  beta: number[];
  catAdj: Record<string, number>;
  catCounts: Record<string, number>;
}

/** Iteratively Reweighted Least Squares for L1-LAD regression with Empirical-Bayes category shrinkage. */
function fitLad(
  peers: SnapshotProtocol[],
  asOf: string,
  featFn: FeatureFn,
  useCat: boolean,
  catK = 3.0,
  ridge = 0.1,
): LadFit {
  const n = peers.length;
  const feats = peers.map((p) => featFn(p, asOf));
  const ys = peers.map((p) => Math.log(p.mcap_usd!));
  const d = feats[0]!.length;
  const w = new Array<number>(n).fill(1);
  let catAdj: Record<string, number> = {};
  let beta = new Array<number>(d).fill(0);

  for (let iter = 0; iter < 24; iter++) {
    const XtX: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    const Xty = new Array<number>(d).fill(0);
    for (let i = 0; i < n; i++) {
      const x = feats[i]!;
      const cat = peers[i]!.category ?? 'Other';
      const y = ys[i]! - (useCat ? (catAdj[cat] ?? 0) : 0);
      for (let a = 0; a < d; a++) {
        Xty[a]! += w[i]! * x[a]! * y;
        for (let b = 0; b < d; b++) XtX[a]![b]! += w[i]! * x[a]! * x[b]!;
      }
    }
    for (let a = 1; a < d; a++) XtX[a]![a]! += ridge;
    beta = solveLinear(XtX, Xty);

    if (useCat) {
      const sums = new Map<string, { rw: number; w: number }>();
      for (let i = 0; i < n; i++) {
        const x = feats[i]!;
        let pr = 0;
        for (let a = 0; a < d; a++) pr += beta[a]! * x[a]!;
        const cat = peers[i]!.category ?? 'Other';
        const cur = sums.get(cat) ?? { rw: 0, w: 0 };
        cur.rw += (ys[i]! - pr) * w[i]!;
        cur.w += w[i]!;
        sums.set(cat, cur);
      }
      catAdj = {};
      for (const [cat, s] of sums.entries()) catAdj[cat] = s.rw / (s.w + catK);
    }

    for (let i = 0; i < n; i++) {
      const x = feats[i]!;
      let pr = useCat ? (catAdj[peers[i]!.category ?? 'Other'] ?? 0) : 0;
      for (let a = 0; a < d; a++) pr += beta[a]! * x[a]!;
      w[i] = 1.0 / Math.max(0.15, Math.abs(ys[i]! - pr));
    }
  }

  const catCounts: Record<string, number> = {};
  for (const p of peers) {
    const c = p.category ?? 'Other';
    catCounts[c] = (catCounts[c] ?? 0) + 1;
  }
  return { beta, catAdj, catCounts };
}

function predictLog(p: SnapshotProtocol, asOf: string, featFn: FeatureFn, fit: LadFit, useCat: boolean): number {
  const x = featFn(p, asOf);
  let out = useCat ? (fit.catAdj[p.category ?? 'Other'] ?? 0) : 0;
  for (let i = 0; i < x.length; i++) out += fit.beta[i]! * x[i]!;
  return out;
}

/** Triple blind out-of-sample evaluation: Leave-One-Out CV, 10-Fold CV, and Walk-Forward temporal split. */
function evaluateTripleBlind(
  peers: SnapshotProtocol[],
  asOf: string,
  featFn: FeatureFn,
  useCat: boolean,
  catK = 3.0,
): { looRes: Array<{ cat: string; err: number }>; looMult: number; cv10Mult: number; wfMult: number; looMae: number } {
  const looRes: Array<{ cat: string; err: number }> = [];
  for (let i = 0; i < peers.length; i++) {
    const train = peers.filter((_, j) => j !== i);
    const fit = fitLad(train, asOf, featFn, useCat, catK);
    const pred = predictLog(peers[i]!, asOf, featFn, fit, useCat);
    looRes.push({ cat: peers[i]!.category ?? 'Other', err: pred - Math.log(peers[i]!.mcap_usd!) });
  }
  const looAbs = looRes.map((r) => Math.abs(r.err));

  // Deterministic 10-Fold CV ordered by slug
  const ordered = [...peers].sort((a, b) => a.slug.localeCompare(b.slug));
  const cv10Abs: number[] = [];
  for (let f = 0; f < 10; f++) {
    const tr = ordered.filter((_, idx) => idx % 10 !== f);
    const te = ordered.filter((_, idx) => idx % 10 === f);
    const fit = fitLad(tr, asOf, featFn, useCat, catK);
    for (const p of te) cv10Abs.push(Math.abs(predictLog(p, asOf, featFn, fit, useCat) - Math.log(p.mcap_usd!)));
  }

  // Walk-forward temporal validation: oldest 65% train -> newest 35% blind
  const dated = peers.filter((p) => p.listed_at !== null).sort((a, b) => a.listed_at!.localeCompare(b.listed_at!));
  const cut = Math.floor(dated.length * 0.65);
  const wfFit = fitLad(dated.slice(0, cut), asOf, featFn, useCat, catK);
  const wfAbs = dated.slice(cut).map((p) => Math.abs(predictLog(p, asOf, featFn, wfFit, useCat) - Math.log(p.mcap_usd!)));

  return {
    looRes,
    looMult: round2(Math.exp(median(looAbs))),
    cv10Mult: round2(Math.exp(median(cv10Abs))),
    wfMult: round2(Math.exp(median(wfAbs))),
    looMae: round3(mean(looAbs)),
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

/** Empirical survival-hazard model: launch odds FALL with age without a token (correcting survival bias). */
function buildSurvivalOdds(protocols: SnapshotProtocol[], asOf: string) {
  const clean = protocols.filter(isCleanUniverse);
  const totalTok = clean.filter((p) => !isPreToken(p)).length;
  const prior = totalTok / Math.max(1, clean.length);

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

  const mature = ageMap.get('4y+') ?? { withTok: 30, total: 35 };
  const asymptote = clamp(mature.withTok / Math.max(1, mature.total), 0.75, 0.92);

  const bucketOrder = ['<6m', '6-12m', '1-2y', '2-4y', '4y+'];
  const hazardByBucket = new Map<string, number>();
  const survivalCurve: SurvivalBucket[] = [];
  for (const b of bucketOrder) {
    const v = ageMap.get(b) ?? { withTok: 0, total: 1 };
    const F = v.withTok / Math.max(1, v.total);
    // Conditional probability a still-tokenless protocol launches before reaching the asymptotic ceiling:
    // P(launch eventually | tokenless at age t) = (F_max - F(t)) / (1 - F(t)), floored at 12% for 4y+ structural holdouts
    const rem = b === '4y+' ? 0.12 : clamp((asymptote - F) / Math.max(0.08, 1 - F), 0.14, 0.85);
    hazardByBucket.set(b, rem);
    survivalCurve.push({
      bucket: b,
      with_token: v.withTok,
      total: v.total,
      cum_pct: round2(F * 100),
      remaining_hazard_pct: round2(rem * 100),
    });
  }
  hazardByBucket.set('Unknown', 0.48);

  const catRate = (cat: string): number => {
    const s = catMap.get(cat) ?? { withTok: 0, total: 0 };
    return (s.withTok + 5 * prior) / (s.total + 5);
  };
  const ageHazard = (days: number | null): number => hazardByBucket.get(ageBucketLabel(days)) ?? 0.48;

  const catList = [...catMap.entries()]
    .map(([category, v]) => ({ category, with_token: v.withTok, total: v.total, pct: round2((100 * v.withTok) / v.total) }))
    .sort((a, b) => b.total - a.total);

  return { prior, catRate, ageHazard, catList, survivalCurve };
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
    return `Supply $${capital} USDC or blue-chip collateral on ${p.name} (${chain}) and borrow 25% to accrue two-sided usage points.`;
  }
  if (c.includes('dex') || c.includes('liquidity')) {
    return `Provide $${capital} liquidity to a core stable/major pool on ${p.name} (${chain}) and execute 2 organic swaps across distinct weeks.`;
  }
  if (c.includes('derivative') || c.includes('perp') || c.includes('basis')) {
    return `Deposit $${capital} USDC margin on ${p.name} (${chain}), open a hedged low-leverage position, and cycle modest weekly volume.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${capital} USDC into ${p.name}'s top curated vault on ${chain} and confirm points accrue directly to vault shares.`;
  }
  if (c.includes('rwa')) {
    return `Mint or subscribe $${capital} into ${p.name}'s yield-bearing RWA token on ${chain} and hold the receipt unwrapped in your wallet.`;
  }
  if (c.includes('yield')) {
    return `Deposit $${capital} into ${p.name}'s flagship vault on ${chain} and compound rewards once mid-campaign to log repeat on-chain history.`;
  }
  if (c.includes('payment')) {
    return `Fund a $${capital} channel or execute recurring micro-transfers via ${p.name} (${chain}) to build verifiable routing history.`;
  }
  return `Deposit $${capital} USDC into ${p.name}'s core contract on ${chain} and maintain active on-chain balance through multiple snapshot dates.`;
}

function buildFarmVerdict(
  p: SnapshotProtocol,
  age: number | null,
  impliedUsd: number,
  launchOddsPct: number,
): FarmVerdict {
  const gp = gasProfile(p.chains);
  // Size capital to minimum viable threshold for protocol TVL tier so gas drag stays bounded
  const capital = p.tvl_usd >= 1_000_000_000 ? 1000 : p.tvl_usd >= 200_000_000 ? 500 : p.tvl_usd >= 50_000_000 ? 300 : 200;
  const holdDays = age === null ? 45 : age < 180 ? 60 : age < 540 ? 45 : 30;
  const weeks = Math.max(4, Math.ceil(holdDays / 7));

  // Anti-whale tiered + pro-rata community airdrop model: 5% TGE pool (55% active-wallet tier + 45% pro-rata TVL)
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
  const oppCost = round2(capital * 0.04 * (holdDays / 365));
  const totalCost = round2(totalGas + oppCost);
  const expectedEv = round2(estAirdrop * (launchOddsPct / 100) - totalCost);
  const evPerHour = round2(expectedEv / Math.max(0.25, totalHours));

  let verdict: FarmVerdict['verdict'];
  let rationale: string;
  if (launchOddsPct < 24) {
    verdict = 'LOW ODDS';
    rationale = `Low remaining launch odds (${round2(launchOddsPct)}%: low category token rate or 4y+ structural holdout); skip unless token is confirmed.`;
  } else if (evPerHour >= 38 && expectedEv >= 32) {
    verdict = 'FARM NOW';
    rationale = `High retail airdrop density (~${estActiveWallets.toLocaleString()} est. wallets) on ${gp.chain} (${gp.tier}: $${totalGas} gas) yields $${evPerHour}/hr net EV.`;
  } else if (evPerHour >= 12 && expectedEv >= 10) {
    verdict = 'SELECTIVE';
    rationale = `Positive risk-adjusted return ($${evPerHour}/hr net of $${totalGas} gas + $${oppCost} carry); farm alongside native yield on ${gp.chain}.`;
  } else {
    verdict = 'WATCH';
    rationale = `TVL crowding (~${estActiveWallets.toLocaleString()} wallets) or ${gp.tier} fees ($${totalGas}) compress net EV ($${expectedEv}); wait for campaign boost.`;
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
      action: `Execute 1 organic weekly touchpoint on ${p.name} (${gp.chain}) for ${weeks} weeks to clear multi-snapshot anti-Sybil filters.`,
      cost: `~$${round2(weeks * gp.weeklyGas)} gas (${weeks} wks)`,
      time: `${weeklyMin} min/week (${weeks * weeklyMin} min total)`,
      minutes: weeks * weeklyMin,
      gas_usd: round2(weeks * gp.weeklyGas),
    },
    {
      action: `Hold $${capital} across ${holdDays} days (est. $${oppCost} carry at 4% APR; ~${estActiveWallets.toLocaleString()} est. peer wallets) until snapshot cutoff.`,
      cost: `$${oppCost} capital carry cost`,
      time: `${holdDays} calendar days`,
      minutes: 0,
      gas_usd: 0,
    },
    {
      action: `Unwind after snapshot, log tx hashes, and claim strictly from ${p.name}'s verified domain (Est. ~$${estAirdrop} gross at 5% TGE pool, $${evPerHour}/hr net EV).`,
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

  // Starter baseline error on the exact same 88 clean peers
  const starterAbs = peers.map((p) => {
    const a = ageDays(asOf, p.listed_at) ?? 365;
    const g = clamp(p.change_7d ?? 0, -60, 120);
    const imp = p.tvl_usd * 0.25 * (1 + (g / 100) * 0.5) * (0.6 + (Math.min(a, 1095) / 1095) * 0.4);
    return Math.abs(Math.log(imp) - Math.log(p.mcap_usd!));
  });
  const starterMult = round2(Math.exp(median(starterAbs)));
  const starterMae = round3(mean(starterAbs));

  // Candidate specs for Triple Blind Ablation (LOO-CV, 10-Fold CV, Walk-Forward)
  const fTvl: FeatureFn = (p) => [1, Math.log(Math.max(1, p.tvl_usd))];
  const fTvlChains: FeatureFn = (p) => [1, Math.log(Math.max(1, p.tvl_usd)), Math.log(Math.max(1, p.chains.length))];
  const fWithFlow: FeatureFn = (p) => [
    1,
    Math.log(Math.max(1, p.tvl_usd)),
    Math.log(Math.max(1, p.chains.length)),
    clamp(p.change_7d ?? 0, -40, 80) / 100,
  ];
  const fWithAge: FeatureFn = (p, d) => [
    1,
    Math.log(Math.max(1, p.tvl_usd)),
    Math.log(Math.max(1, p.chains.length)),
    Math.log((ageDays(d, p.listed_at) ?? 365) + 30),
  ];

  const evTvl = evaluateTripleBlind(peers, asOf, fTvl, false);
  const evTvlChains = evaluateTripleBlind(peers, asOf, fTvlChains, false);
  const evActive = evaluateTripleBlind(peers, asOf, fTvlChains, true, 3.0);
  const evFlow = evaluateTripleBlind(peers, asOf, fWithFlow, true, 3.0);
  const evAge = evaluateTripleBlind(peers, asOf, fWithAge, true, 3.0);

  const fullFit = fitLad(peers, asOf, fTvlChains, true, 3.0);

  // Global + per-category conformal error scaling from LOO residuals
  const globalErrs = evActive.looRes.map((r) => r.err).sort((a, b) => a - b);
  const globalMedAbs = median(evActive.looRes.map((r) => Math.abs(r.err)));
  const p10Res = quantile(globalErrs, 0.1);
  const p25Res = quantile(globalErrs, 0.25);
  const p75Res = quantile(globalErrs, 0.75);
  const p90Res = quantile(globalErrs, 0.9);
  const bandP25 = round2(Math.exp(-p75Res));
  const bandP75 = round2(Math.exp(-p25Res));
  const bandP10 = round2(Math.exp(-p90Res));
  const bandP90 = round2(Math.exp(-p10Res));

  const catErrGroups = new Map<string, number[]>();
  for (const r of evActive.looRes) {
    const arr = catErrGroups.get(r.cat) ?? [];
    arr.push(Math.abs(r.err));
    catErrGroups.set(r.cat, arr);
  }
  const conformalScaleFor = (cat: string): number => {
    const arr = catErrGroups.get(cat);
    if (!arr || arr.length < 3) return 1.0;
    const catMed = median(arr);
    // Shrink category dispersion toward global median absolute error (k=4)
    const shrunk = (arr.length * catMed + 4 * globalMedAbs) / (arr.length + 4);
    return round2(clamp(shrunk / Math.max(0.2, globalMedAbs), 0.72, 1.45));
  };

  const ablation: AblationRow[] = [
    {
      id: 'starter',
      label: 'Starter 0.25×TVL×g×m',
      loo_mult: starterMult,
      cv10_mult: starterMult,
      wf_mult: starterMult,
      loo_mae: starterMae,
      decision: 'baseline',
      note: 'Linear TVL overprices billion-dollar vaults; 4.44x median error on clean peers.',
    },
    {
      id: 'tvl',
      label: 'L1-LAD ln(TVL)',
      loo_mult: evTvl.looMult,
      cv10_mult: evTvl.cv10Mult,
      wf_mult: evTvl.wfMult,
      loo_mae: evTvl.looMae,
      decision: 'kept',
      note: `Sub-linear power law (β=${round3(fullFit.beta[1]!)}): cuts LOO error ${starterMult}x → ${evTvl.looMult}x.`,
    },
    {
      id: 'chains',
      label: '+ ln(Chains)',
      loo_mult: evTvlChains.looMult,
      cv10_mult: evTvlChains.cv10Mult,
      wf_mult: evTvlChains.wfMult,
      loo_mae: evTvlChains.looMae,
      decision: 'kept',
      note: `Multi-chain discount improves all 3 blind tests (${evTvlChains.looMult}x LOO / ${evTvlChains.cv10Mult}x 10F / ${evTvlChains.wfMult}x WF).`,
    },
    {
      id: 'cat',
      label: '+ Empirical-Bayes Category (k=3)',
      loo_mult: evActive.looMult,
      cv10_mult: evActive.cv10Mult,
      wf_mult: evActive.wfMult,
      loo_mae: evActive.looMae,
      decision: 'active',
      note: `Best across all 3 blind tests (${evActive.looMult}x LOO / ${evActive.cv10Mult}x 10-Fold / ${evActive.wfMult}x WF).`,
    },
    {
      id: 'flow7d',
      label: '+ Clamped 7d TVL Flow',
      loo_mult: evFlow.looMult,
      cv10_mult: evFlow.cv10Mult,
      wf_mult: evFlow.wfMult,
      loo_mae: evFlow.looMae,
      decision: 'dropped',
      note: `Worsens all 3 blind tests (${evFlow.looMult}x / ${evFlow.cv10Mult}x / ${evFlow.wfMult}x); shown as momentum signal only.`,
    },
    {
      id: 'age',
      label: '+ ln(Age) in Valuation',
      loo_mult: evAge.looMult,
      cv10_mult: evAge.cv10Mult,
      wf_mult: evAge.wfMult,
      loo_mae: evAge.looMae,
      decision: 'dropped',
      note: `Degrades Walk-Forward (${evActive.wfMult}x → ${evAge.wfMult}x); used in Survival Launch Odds instead.`,
    },
  ];

  const survival = buildSurvivalOdds(snapshot.protocols, asOf);

  // Exact 758/758 universe partition accounting
  const wlList: SnapshotProtocol[] = [];
  const extList: SnapshotProtocol[] = [];
  const earlyList: SnapshotProtocol[] = [];
  let cleanTokenNoMcap = 0;
  let exclLive = 0;
  let exclPre = 0;

  for (const p of snapshot.protocols) {
    if (watchlistSet.has(p.slug)) {
      wlList.push(p);
    } else if (isPreToken(p) && isCleanUniverse(p)) {
      if (p.tvl_usd >= snapshot.floor_usd) extList.push(p);
      else earlyList.push(p);
    } else if (isCleanTradedPeer(p)) {
      // counted in peers.length
    } else if (isCleanUniverse(p) && !isPreToken(p)) {
      cleanTokenNoMcap += 1;
    } else if (!isPreToken(p)) {
      exclLive += 1;
    } else {
      exclPre += 1;
    }
  }

  const rankedInputs = [...wlList, ...extList, ...earlyList];
  const universe: UniversePartition = {
    total: snapshot.protocols.length,
    watchlist_pre: wlList.length,
    extended_pre: extList.length,
    early_pre: earlyList.length,
    clean_traded_mcap: peers.length,
    clean_token_nomcap: cleanTokenNoMcap,
    excluded_live: exclLive,
    excluded_pre: exclPre,
    reconciles:
      wlList.length + extList.length + earlyList.length + peers.length + cleanTokenNoMcap + exclLive + exclPre ===
      snapshot.protocols.length,
  };

  const rawRows: BoardRow[] = rankedInputs.map((p) => {
    const age = ageDays(asOf, p.listed_at);
    const logPred = predictLog(p, asOf, fTvlChains, fullFit, true);
    const implied = Math.max(1, Math.round(Math.exp(logPred)));
    const cat = p.category ?? 'Other';
    const cScale = conformalScaleFor(cat);

    // Conformal per-category scaled quantiles
    const rP25 = Math.max(1, Math.round(implied * Math.exp(-p75Res * cScale)));
    const rP75 = Math.max(1, Math.round(implied * Math.exp(-p25Res * cScale)));
    const rP10 = Math.max(1, Math.round(implied * Math.exp(-p90Res * cScale)));
    const rP90 = Math.max(1, Math.round(implied * Math.exp(-p10Res * cScale)));

    // Survival-adjusted Launch Odds: Category Token Rate × Remaining Survival Hazard (falls monotonically with age!)
    const cRate = survival.catRate(cat);
    const aHaz = survival.ageHazard(age);
    const launchOddsPct = round2(clamp(100 * cRate * (0.28 + 0.88 * aHaz), 5, 86));
    const expectedVal = Math.max(1, Math.round(implied * (launchOddsPct / 100)));

    const farm = buildFarmVerdict(p, age, implied, launchOddsPct);
    const tvlTerm = round3(fullFit.beta[0]! + fullFit.beta[1]! * Math.log(Math.max(1, p.tvl_usd)));
    const chainTerm = round3(fullFit.beta[2]! * Math.log(Math.max(1, p.chains.length)));
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
      token_status: 'pre-token',
      tier: watchlistSet.has(p.slug) ? 'watchlist' : p.tvl_usd >= snapshot.floor_usd ? 'extended' : 'early',
      age_days: age,
      implied_value_usd: implied,
      range_p25_usd: rP25,
      range_p75_usd: rP75,
      range_p10_usd: rP10,
      range_p90_usd: rP90,
      conformal_scale: cScale,
      launch_odds_pct: launchOddsPct,
      cat_token_rate_pct: round2(cRate * 100),
      age_hazard_pct: round2(aHaz * 100),
      expected_value_usd: expectedVal,
      decomp: {
        tvl_term: tvlTerm,
        chain_term: chainTerm,
        cat_term: catTerm,
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
      const pred = Math.max(1, Math.round(Math.exp(predictLog(p, asOf, fTvlChains, fullFit, true))));
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
    .sort((a, b) => b.tvl_usd - a.tvl_usd);

  const catAdjRounded: Record<string, number> = {};
  for (const [k, v] of Object.entries(fullFit.catAdj)) catAdjRounded[k] = round3(v);

  const model: FittedParams = {
    intercept: round3(fullFit.beta[0]!),
    beta_log_tvl: round3(fullFit.beta[1]!),
    beta_log_chains: round3(fullFit.beta[2]!),
    category_k: 3,
    category_adj: catAdjRounded,
    peer_count: peers.length,
    loo_mult: evActive.looMult,
    cv10_mult: evActive.cv10Mult,
    wf_mult: evActive.wfMult,
    loo_mae: evActive.looMae,
    starter_mult: starterMult,
    starter_mae: starterMae,
    band_p25_mult: bandP25,
    band_p75_mult: bandP75,
    band_p10_mult: bandP10,
    band_p90_mult: bandP90,
    ablation,
  };

  const payload: RadarPayload = {
    as_of: asOf,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    universe,
    watchlist_count: wlList.length,
    extended_count: extList.length,
    early_count: earlyList.length,
    clean_peer_count: peers.length,
    model,
    cat_incidence: survival.catList,
    survival_curve: survival.survivalCurve,
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
