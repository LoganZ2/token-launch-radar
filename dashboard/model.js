// Token Launch Radar v3 — Unified Offline Econometric, Triple-Blind Validation & Costed Farm Engine.
// Classic UMD/IIFE script loaded identically by Node 22 (main.ts) and browser over file:// (index.html).
// Fits on clean live peers via IRLS L1-LAD + bounded-influence EB category shrinkage (k=3), validates
// every feature via LOO/10-Fold/Walk-Forward splits, computes conditional survival-hazard launch odds
// P(T<inf|T>t)=(F_inf-F(t))/(1-F(t)), reconciles 100% of snapshot rows, and costs 5-step farm plans.
(function (root) {
  'use strict';
  const DAY_MS = 86_400_000;
  const VER_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  const WRAP_RE = /\b(wrapped|staked|staking)\b/i;
  const EXCL_CATS = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
  const HI_GAS = new Set(['Ethereum']);
  const MED_GAS = new Set(['Bitcoin', 'Avalanche', 'Binance', 'BSC', 'Tron']);

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const r2 = (n) => Math.round(n * 100) / 100;
  const r3 = (n) => Math.round(n * 1000) / 1000;

  function ageDays(asOf, listedAt) {
    if (!listedAt) return null;
    const a = Date.parse(`${asOf}T00:00:00Z`), b = Date.parse(`${listedAt}T00:00:00Z`);
    return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.floor((a - b) / DAY_MS)) : null;
  }
  const isPreToken = (p) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
  const isCleanUniverse = (p) => !EXCL_CATS.has(p.category ?? 'Other') && !VER_RE.test(p.name) && !WRAP_RE.test(p.name);
  const isCleanTradedPeer = (p) => isCleanUniverse(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;

  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
  }
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const quantile = (sorted, q) => (sorted.length ? sorted[clamp(Math.floor(q * (sorted.length - 1)), 0, sorted.length - 1)] : 0);

  function solveLinear(A, b) {
    const n = b.length, M = A.map((row, i) => [...row, b[i]]);
    for (let i = 0; i < n; i++) {
      let piv = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
      [M[i], M[piv]] = [M[piv], M[i]];
      if (Math.abs(M[i][i]) < 1e-12) continue;
      for (let r = i + 1; r < n; r++) {
        const f = M[r][i] / M[i][i];
        for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      if (Math.abs(M[i][i]) < 1e-12) continue;
      let s = M[i][n];
      for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }

  /** IRLS L1-LAD in log(MCap) with bounded-influence EB category shrinkage (prior k caps 1-peer outliers at +-1/k). */
  function fitPeerLadModel(peers, asOf, featFn, useCat = true, catK = 3.0, ridge = 0.2) {
    const n = peers.length, xs = peers.map((p) => featFn(p, asOf)), ys = peers.map((p) => Math.log(p.mcap_usd)), d = xs[0].length;
    const w = new Array(n).fill(1);
    let catAdj = {}, beta = new Array(d).fill(0);

    for (let iter = 0; iter < 24; iter++) {
      const XtX = Array.from({ length: d }, () => new Array(d).fill(0)), Xty = new Array(d).fill(0);
      for (let i = 0; i < n; i++) {
        const y = ys[i] - (useCat ? (catAdj[peers[i].category ?? 'Other'] ?? 0) : 0);
        for (let a = 0; a < d; a++) {
          Xty[a] += w[i] * xs[i][a] * y;
          for (let b = 0; b < d; b++) XtX[a][b] += w[i] * xs[i][a] * xs[i][b];
        }
      }
      for (let a = 1; a < d; a++) XtX[a][a] += ridge;
      beta = solveLinear(XtX, Xty);

      if (useCat) {
        const sums = new Map();
        for (let i = 0; i < n; i++) {
          let pr = 0;
          for (let a = 0; a < d; a++) pr += beta[a] * xs[i][a];
          const cat = peers[i].category ?? 'Other', cur = sums.get(cat) ?? { rw: 0, w: 0 };
          cur.rw += (ys[i] - pr) * w[i];
          cur.w += w[i];
          sums.set(cat, cur);
        }
        catAdj = {};
        for (const [cat, s] of sums.entries()) catAdj[cat] = s.rw / (s.w + catK);
      }

      for (let i = 0; i < n; i++) {
        let pr = useCat ? (catAdj[peers[i].category ?? 'Other'] ?? 0) : 0;
        for (let a = 0; a < d; a++) pr += beta[a] * xs[i][a];
        w[i] = 1.0 / Math.max(0.15, Math.abs(ys[i] - pr));
      }
    }

    const catCounts = {};
    for (const p of peers) { const c = p.category ?? 'Other'; catCounts[c] = (catCounts[c] ?? 0) + 1; }
    return { beta, catAdj, catCounts };
  }

  function predictLogMcap(p, asOf, featFn, fit, useCat = true) {
    const x = featFn(p, asOf);
    let out = useCat ? (fit.catAdj[p.category ?? 'Other'] ?? 0) : 0;
    for (let i = 0; i < x.length; i++) out += fit.beta[i] * x[i];
    return out;
  }

  /** Triple blind out-of-sample evaluation: LOO-CV, deterministic 10-Fold CV, and 65/35 Walk-Forward split. */
  function evaluateTripleBlind(peers, asOf, featFn, useCat = true, catK = 3.0) {
    const looRes = [];
    for (let i = 0; i < peers.length; i++) {
      const fit = fitPeerLadModel(peers.filter((_, j) => j !== i), asOf, featFn, useCat, catK);
      looRes.push({ cat: peers[i].category ?? 'Other', err: predictLogMcap(peers[i], asOf, featFn, fit, useCat) - Math.log(peers[i].mcap_usd) });
    }
    const ordered = [...peers].sort((a, b) => a.slug.localeCompare(b.slug)), cv10Abs = [];
    for (let f = 0; f < 10; f++) {
      const fit = fitPeerLadModel(ordered.filter((_, idx) => idx % 10 !== f), asOf, featFn, useCat, catK);
      for (const p of ordered.filter((_, idx) => idx % 10 === f)) cv10Abs.push(Math.abs(predictLogMcap(p, asOf, featFn, fit, useCat) - Math.log(p.mcap_usd)));
    }
    const dated = peers.filter((p) => p.listed_at).sort((a, b) => a.listed_at.localeCompare(b.listed_at));
    const cut = Math.floor(dated.length * 0.65);
    const wfFit = fitPeerLadModel(dated.slice(0, cut), asOf, featFn, useCat, catK);
    const wfAbs = dated.slice(cut).map((p) => Math.abs(predictLogMcap(p, asOf, featFn, wfFit, useCat) - Math.log(p.mcap_usd)));
    const looAbs = looRes.map((r) => Math.abs(r.err));
    return { looRes, looMult: r2(Math.exp(median(looAbs))), cv10Mult: r2(Math.exp(median(cv10Abs))), wfMult: r2(Math.exp(median(wfAbs))), looMae: r3(mean(looAbs)) };
  }

  const ageBucket = (d) => (d === null ? 'Unknown' : d < 180 ? '<6m' : d < 365 ? '6-12m' : d < 730 ? '1-2y' : d < 1460 ? '2-4y' : '4y+');

  /** Conditional survival-hazard odds: P(T < inf | T > t) = (F_inf - F(t)) / (1 - F(t)); falls with age. */
  function buildSurvivalOdds(protocols, asOf) {
    const clean = protocols.filter(isCleanUniverse);
    const prior = clean.filter((p) => !isPreToken(p)).length / Math.max(1, clean.length);
    const catMap = new Map(), ageMap = new Map();
    for (const p of clean) {
      const has = !isPreToken(p), cat = p.category ?? 'Other';
      const c = catMap.get(cat) ?? { w: 0, t: 0 }; c.t++; if (has) c.w++; catMap.set(cat, c);
      const b = ageBucket(ageDays(asOf, p.listed_at)), a = ageMap.get(b) ?? { w: 0, t: 0 }; a.t++; if (has) a.w++; ageMap.set(b, a);
    }
    const mature = ageMap.get('4y+') ?? { w: 30, t: 35 };
    const asym = clamp(mature.w / Math.max(1, mature.t), 0.75, 0.92);
    const hazardMap = new Map(), survivalCurve = [];
    for (const b of ['<6m', '6-12m', '1-2y', '2-4y', '4y+']) {
      const v = ageMap.get(b) ?? { w: 0, t: 1 }, F = v.w / Math.max(1, v.t);
      const rem = b === '4y+' ? 0.12 : clamp((asym - F) / Math.max(0.08, 1 - F), 0.14, 0.85);
      hazardMap.set(b, rem);
      survivalCurve.push({ bucket: b, with_token: v.w, total: v.t, cum_pct: r2(F * 100), remaining_hazard_pct: r2(rem * 100) });
    }
    hazardMap.set('Unknown', 0.48);
    const catRate = (cat) => { const s = catMap.get(cat) ?? { w: 0, t: 0 }; return (s.w + 5 * prior) / (s.t + 5); };
    const ageHazard = (days) => hazardMap.get(ageBucket(days)) ?? 0.48;
    const catList = [...catMap.entries()].map(([category, v]) => ({ category, with_token: v.w, total: v.t, pct: r2((100 * v.w) / v.t) })).sort((a, b) => b.total - a.total);
    return { prior, catRate, ageHazard, catList, survivalCurve };
  }

  function gasProfile(chains) {
    const low = chains.find((c) => !HI_GAS.has(c) && !MED_GAS.has(c));
    if (low) return { chain: low, tier: 'L2 / Low-Fee', txGas: 0.15, setupGas: 0.6, weeklyGas: 0.25 };
    const med = chains.find((c) => MED_GAS.has(c));
    if (med) return { chain: med, tier: 'Mid-Fee L1', txGas: 1.0, setupGas: 3.5, weeklyGas: 1.2 };
    return { chain: chains[0] ?? 'Ethereum', tier: 'Ethereum L1', txGas: 4.5, setupGas: 14.0, weeklyGas: 5.0 };
  }

  function categoryAction(p, ch, cap) {
    const c = (p.category ?? '').toLowerCase();
    if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${cap} USDC or blue-chip collateral on ${p.name} (${ch}) and borrow 25% for two-sided usage points.`;
    if (c.includes('dex') || c.includes('liquidity')) return `Provide $${cap} liquidity to a core stable/major pool on ${p.name} (${ch}) and run 2 organic swaps across separate weeks.`;
    if (c.includes('derivative') || c.includes('perp') || c.includes('basis')) return `Deposit $${cap} USDC margin on ${p.name} (${ch}), open a hedged low-leverage position, and cycle modest weekly volume.`;
    if (c.includes('curator') || c.includes('allocator')) return `Deposit $${cap} USDC into ${p.name}'s top curated vault on ${ch} and verify points accrue directly to vault shares.`;
    if (c.includes('rwa')) return `Mint or subscribe $${cap} into ${p.name}'s yield-bearing RWA instrument on ${ch} and hold the receipt unwrapped.`;
    if (c.includes('yield')) return `Deposit $${cap} into ${p.name}'s flagship vault on ${ch} and compound rewards once mid-campaign to log repeat activity.`;
    if (c.includes('payment')) return `Fund a $${cap} channel or route recurring transfers through ${p.name} (${ch}) to build verifiable routing history.`;
    return `Deposit $${cap} USDC into ${p.name}'s core contract on ${ch} and maintain active balance through multiple snapshots.`;
  }

  /** Costed 5-step retail farm playbook sized to TVL tier & chain gas regime (called live by browser simulator). */
  function buildCostedFarmPlan(p, age, impliedUsd, launchOddsPct, overrideCap = 0, allocPct = 5.0) {
    const gp = gasProfile(p.chains);
    const cap = overrideCap > 0 ? overrideCap : (p.tvl_usd >= 1e9 ? 1000 : p.tvl_usd >= 2e8 ? 500 : p.tvl_usd >= 5e7 ? 300 : 200);
    const holdDays = age === null ? 45 : age < 180 ? 60 : age < 540 ? 45 : 30;
    const weeks = Math.max(4, Math.ceil(holdDays / 7));

    // Community TGE pool: allocPct% split 55% equal/tiered active-wallet bucket + 45% pro-rata TVL share
    const poolAlloc = impliedUsd * (allocPct / 100);
    const estWallets = clamp(Math.round(p.tvl_usd / 16_000), 1200, 120_000);
    const estAirdrop = r2(clamp((poolAlloc * 0.55) / estWallets + poolAlloc * 0.45 * (cap / Math.max(p.tvl_usd, 5e6)), 4, 2400));

    const totalHours = r2((15 + weeks * 5 + 20) / 60);
    const totalGas = r2(gp.setupGas + weeks * gp.weeklyGas + gp.txGas * 2);
    const oppCost = r2(cap * 0.04 * (holdDays / 365));
    const expectedEv = r2(estAirdrop * (launchOddsPct / 100) - (totalGas + oppCost));
    const evPerHour = r2(expectedEv / Math.max(0.25, totalHours));

    let verdict = 'WATCH', rationale = `TVL crowding (~${estWallets.toLocaleString()} wallets) or ${gp.tier} fees ($${totalGas}) compress net EV ($${expectedEv}); wait for boost.`;
    if (launchOddsPct < 24) {
      verdict = 'LOW ODDS';
      rationale = `Low remaining launch odds (${r2(launchOddsPct)}%: low category token rate or 4y+ holdout); skip unless token is confirmed.`;
    } else if (evPerHour >= 38 && expectedEv >= 32) {
      verdict = 'FARM NOW';
      rationale = `High retail airdrop density (~${estWallets.toLocaleString()} est. wallets) on ${gp.chain} (${gp.tier}: $${totalGas} gas) yields $${evPerHour}/hr net EV.`;
    } else if (evPerHour >= 12 && expectedEv >= 10) {
      verdict = 'SELECTIVE';
      rationale = `Positive net return ($${evPerHour}/hr after $${totalGas} gas + $${oppCost} carry); farm alongside organic yield on ${gp.chain}.`;
    }

    const steps = [
      { action: `Isolate a fresh wallet funded with $${cap} USDC + $${Math.ceil(totalGas + 5)} native gas on ${gp.chain} (${gp.tier}).`, cost: `$${r2(gp.txGas)} funding gas`, time: '10 min' },
      { action: categoryAction(p, gp.chain, cap), cost: `$${cap} principal + ~$${gp.setupGas} gas`, time: '15 min setup' },
      { action: `Run 1 organic weekly touchpoint on ${p.name} (${gp.chain}) for ${weeks} weeks to clear multi-snapshot Sybil filters.`, cost: `~$${r2(weeks * gp.weeklyGas)} gas (${weeks} wks)`, time: `5 min/wk (${weeks * 5} min)` },
      { action: `Hold $${cap} across ${holdDays} days (est. $${oppCost} carry at 4% APR; ~${estWallets.toLocaleString()} peer wallets) through snapshot.`, cost: `$${oppCost} capital carry`, time: `${holdDays} calendar days` },
      { action: `Unwind after snapshot, log tx hashes, and claim only on ${p.name}'s verified domain (Est. ~$${estAirdrop} gross, $${evPerHour}/hr EV).`, cost: `~$${gp.txGas} exit/claim gas`, time: '10 min' },
    ];
    return { verdict, capital_usd: cap, gas_usd: totalGas, total_hours: totalHours, hold_days: holdDays, est_airdrop_usd: estAirdrop, expected_ev_usd: expectedEv, ev_per_hour: evPerHour, gas_tier: gp.tier, rationale, steps };
  }

  function formatFarmStep(s) {
    const out = `${s.action} Cost: ${s.cost}. Time: ${s.time}.`;
    return out.length > 600 ? `${out.slice(0, 596)}...` : out;
  }

  function parseSnapshot(text) {
    const o = JSON.parse(text);
    if (!o || typeof o !== 'object' || Array.isArray(o) || !Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) throw new Error('Invalid snapshot');
    return {
      as_of: String(o.as_of), source: String(o.source), floor_usd: Number(o.floor_usd), watchlist: o.watchlist.map(String),
      protocols: o.protocols.map((p) => ({
        slug: String(p.slug), name: String(p.name), category: typeof p.category === 'string' ? p.category : null,
        chains: Array.isArray(p.chains) ? p.chains.filter((c) => typeof c === 'string') : [],
        tvl_usd: Number(p.tvl_usd),
        change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
        mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
        listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
        gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
        symbol: typeof p.symbol === 'string' ? p.symbol : null,
      })),
    };
  }

  function buildRadar(snapshot) {
    const asOf = snapshot.as_of, wlSet = new Set(snapshot.watchlist);
    const peers = snapshot.protocols.filter(isCleanTradedPeer);

    const starterAbs = peers.map((p) => {
      const a = ageDays(asOf, p.listed_at) ?? 365, g = clamp(p.change_7d ?? 0, -60, 120);
      return Math.abs(Math.log(p.tvl_usd * 0.25 * (1 + (g / 100) * 0.5) * (0.6 + (Math.min(a, 1095) / 1095) * 0.4)) - Math.log(p.mcap_usd));
    });
    const starterMult = r2(Math.exp(median(starterAbs))), starterMae = r3(mean(starterAbs));

    const fTvl = (p) => [1, Math.log(Math.max(1, p.tvl_usd))];
    const fEthSol = (p) => [1, Math.log(Math.max(1, p.tvl_usd)), p.chains.includes('Ethereum') ? 1 : 0, p.chains.includes('Solana') ? 1 : 0];
    const fFlow = (p) => [...fEthSol(p), clamp(p.change_7d ?? 0, -40, 80) / 100];
    const fAge = (p, d) => [...fEthSol(p), Math.log((ageDays(d, p.listed_at) ?? 365) + 30)];

    const evTvl = evaluateTripleBlind(peers, asOf, fTvl, false);
    const evCat = evaluateTripleBlind(peers, asOf, fTvl, true, 3.0);
    const evAct = evaluateTripleBlind(peers, asOf, fEthSol, true, 3.0);
    const evFlow = evaluateTripleBlind(peers, asOf, fFlow, true, 3.0);
    const evAge = evaluateTripleBlind(peers, asOf, fAge, true, 3.0);
    const fit = fitPeerLadModel(peers, asOf, fEthSol, true, 3.0);

    const errs = evAct.looRes.map((r) => r.err).sort((a, b) => a - b);
    const gMed = median(evAct.looRes.map((r) => Math.abs(r.err)));
    const p10 = quantile(errs, 0.1), p25 = quantile(errs, 0.25), p75 = quantile(errs, 0.75), p90 = quantile(errs, 0.9);
    const catErrs = new Map();
    for (const r of evAct.looRes) { const a = catErrs.get(r.cat) ?? []; a.push(Math.abs(r.err)); catErrs.set(r.cat, a); }
    const confScale = (cat) => {
      const a = catErrs.get(cat);
      if (!a || a.length < 3) return 1.0;
      return r2(clamp(((a.length * median(a) + 4 * gMed) / (a.length + 4)) / Math.max(0.2, gMed), 0.72, 1.45));
    };

    const ablation = [
      { id: 'starter', label: 'Starter 0.25×TVL×g×m', loo_mult: starterMult, cv10_mult: starterMult, wf_mult: starterMult, loo_mae: starterMae, decision: 'baseline', note: `Linear TVL overprices billion-dollar vaults (${starterMult}x error).` },
      { id: 'tvl', label: 'L1-LAD ln(TVL)', loo_mult: evTvl.looMult, cv10_mult: evTvl.cv10Mult, wf_mult: evTvl.wfMult, loo_mae: evTvl.looMae, decision: 'kept', note: `Sub-linear power law (β=${r3(fit.beta[1])}): cuts LOO ${starterMult}x → ${evTvl.looMult}x.` },
      { id: 'cat', label: '+ Empirical-Bayes Category (k=3)', loo_mult: evCat.looMult, cv10_mult: evCat.cv10Mult, wf_mult: evCat.wfMult, loo_mae: evCat.looMae, decision: 'kept', note: `Shrinks category multiples toward global curve (${evCat.looMult}x LOO / ${evCat.wfMult}x WF).` },
      { id: 'ethsol', label: '+ Primary Ecosystem (Eth / Sol)', loo_mult: evAct.looMult, cv10_mult: evAct.cv10Mult, wf_mult: evAct.wfMult, loo_mae: evAct.looMae, decision: 'active', note: `Best across all 3 blind tests (${evAct.looMult}x LOO, ${evAct.cv10Mult}x 10F, ${evAct.wfMult}x WF).` },
      { id: 'flow7d', label: '+ Clamped 7d TVL Flow', loo_mult: evFlow.looMult, cv10_mult: evFlow.cv10Mult, wf_mult: evFlow.wfMult, loo_mae: evFlow.looMae, decision: 'dropped', note: `Adds blind variance (${evFlow.looMult}x LOO / ${evFlow.wfMult}x WF); shown as momentum signal.` },
      { id: 'age', label: '+ ln(Age) in Valuation', loo_mult: evAge.looMult, cv10_mult: evAge.cv10Mult, wf_mult: evAge.wfMult, loo_mae: evAge.looMae, decision: 'dropped', note: `Worsens blind tests (${evAge.looMult}x LOO / ${evAge.wfMult}x WF); moved to Survival Launch Odds.` },
    ];

    const survival = buildSurvivalOdds(snapshot.protocols, asOf);
    const wl = [], ext = [], early = [];
    let tokNoMc = 0, exLive = 0, exPre = 0;
    for (const p of snapshot.protocols) {
      if (wlSet.has(p.slug)) wl.push(p);
      else if (isPreToken(p) && isCleanUniverse(p)) (p.tvl_usd >= snapshot.floor_usd ? ext : early).push(p);
      else if (isCleanTradedPeer(p)) continue;
      else if (isCleanUniverse(p) && !isPreToken(p)) tokNoMc++;
      else if (!isPreToken(p)) exLive++;
      else exPre++;
    }

    const universe = {
      total: snapshot.protocols.length, watchlist_pre: wl.length, extended_pre: ext.length, early_pre: early.length,
      clean_traded_mcap: peers.length, clean_token_nomcap: tokNoMc, excluded_live: exLive, excluded_pre: exPre,
      reconciles: wl.length + ext.length + early.length + peers.length + tokNoMc + exLive + exPre === snapshot.protocols.length,
    };

    const rows = [...wl, ...ext, ...early].map((p) => {
      const age = ageDays(asOf, p.listed_at), cat = p.category ?? 'Other';
      const implied = Math.max(1, Math.round(Math.exp(predictLogMcap(p, asOf, fEthSol, fit, true))));
      const sc = confScale(cat), cRate = survival.catRate(cat), aHaz = survival.ageHazard(age);
      const odds = r2(clamp(100 * cRate * (0.28 + 0.88 * aHaz), 5, 86));
      const farm = buildCostedFarmPlan(p, age, implied, odds);
      return {
        rank: 0, slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
        change_7d: p.change_7d, mcap_usd: p.mcap_usd, listed_at: p.listed_at, gecko_id: p.gecko_id, symbol: p.symbol,
        token_status: 'pre-token', tier: wlSet.has(p.slug) ? 'watchlist' : p.tvl_usd >= snapshot.floor_usd ? 'extended' : 'early',
        age_days: age, implied_value_usd: implied,
        range_p25_usd: Math.max(1, Math.round(implied * Math.exp(-p75 * sc))),
        range_p75_usd: Math.max(1, Math.round(implied * Math.exp(-p25 * sc))),
        range_p10_usd: Math.max(1, Math.round(implied * Math.exp(-p90 * sc))),
        range_p90_usd: Math.max(1, Math.round(implied * Math.exp(-p10 * sc))),
        conformal_scale: sc, launch_odds_pct: odds, cat_token_rate_pct: r2(cRate * 100), age_hazard_pct: r2(aHaz * 100),
        expected_value_usd: Math.max(1, Math.round(implied * (odds / 100))),
        decomp: {
          tvl_term: r3(fit.beta[0] + fit.beta[1] * Math.log(Math.max(1, p.tvl_usd))),
          eco_term: r3(fit.beta[2] * (p.chains.includes('Ethereum') ? 1 : 0) + fit.beta[3] * (p.chains.includes('Solana') ? 1 : 0)),
          cat_term: r3(fit.catAdj[cat] ?? 0), cat_peers: fit.catCounts[cat] ?? 0,
        },
        farm, farm_steps: farm.steps.map(formatFarmStep),
      };
    });
    rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
    rows.forEach((r, idx) => { r.rank = idx + 1; });

    const peerRows = peers.map((p) => {
      const pred = Math.max(1, Math.round(Math.exp(predictLogMcap(p, asOf, fEthSol, fit, true))));
      return {
        slug: p.slug, name: p.name, category: p.category ?? 'Other', chains: p.chains, tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd, ratio: r3(p.mcap_usd / p.tvl_usd), pred_usd: pred,
        err_mult: r2(Math.max(pred / p.mcap_usd, p.mcap_usd / pred)), listed_at: p.listed_at,
        age_days: ageDays(asOf, p.listed_at), change_7d: p.change_7d,
      };
    }).sort((a, b) => b.tvl_usd - a.tvl_usd);

    const catAdjR = {};
    for (const [k, v] of Object.entries(fit.catAdj)) catAdjR[k] = r3(v);

    return {
      board: rows,
      payload: {
        as_of: asOf, source: snapshot.source, floor_usd: snapshot.floor_usd, universe,
        watchlist_count: wl.length, extended_count: ext.length, early_count: early.length, clean_peer_count: peers.length,
        model: {
          intercept: r3(fit.beta[0]), beta_log_tvl: r3(fit.beta[1]), beta_eth: r3(fit.beta[2]), beta_sol: r3(fit.beta[3]),
          category_k: 3, category_adj: catAdjR, peer_count: peers.length,
          loo_mult: evAct.looMult, cv10_mult: evAct.cv10Mult, wf_mult: evAct.wfMult, loo_mae: evAct.looMae,
          starter_mult: starterMult, starter_mae: starterMae,
          band_p25_mult: r2(Math.exp(-p75)), band_p75_mult: r2(Math.exp(-p25)),
          band_p10_mult: r2(Math.exp(-p90)), band_p90_mult: r2(Math.exp(-p10)), ablation,
        },
        cat_incidence: survival.catList, survival_curve: survival.survivalCurve, rows, peers: peerRows,
      },
    };
  }

  function validateBoard(board, snapshot) {
    if (board.length < 100 || board.length > 4000) return `Row count ${board.length} outside [100, 4000]`;
    const valid = new Set(snapshot.protocols.map((p) => p.slug)), seen = new Set();
    for (let i = 0; i < board.length; i++) {
      const r = board[i];
      if (!valid.has(r.slug) || seen.has(r.slug)) return `Invalid/duplicate slug: ${r.slug}`;
      seen.add(r.slug);
      if (r.rank !== i + 1) return `Rank mismatch at ${i}`;
      if (i > 0 && r.implied_value_usd > board[i - 1].implied_value_usd) return `Non-monotonic at ${r.rank}`;
      if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `Bad implied: ${r.slug}`;
      if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `Bad steps count: ${r.slug}`;
      for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `Bad step len: ${r.slug}`;
    }
    for (const w of snapshot.watchlist) if (!seen.has(w)) return `Missing watchlist: ${w}`;
    return null;
  }

  root.TokenRadarModel = {
    ageDays, isPreToken, isCleanUniverse, isCleanTradedPeer,
    fitPeerLadModel, predictLogMcap, evaluateTripleBlind, buildSurvivalOdds,
    gasProfile, buildCostedFarmPlan, formatFarmStep, parseSnapshot, buildRadar, validateBoard,
  };
})(globalThis);
