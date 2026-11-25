(() => {
  'use strict';
  const D = window.RADAR_DATA, M = globalThis.TokenRadarModel, app = document.getElementById('app');
  if (!D || !M) { app.textContent = 'Missing offline radar dataset (data.js) or model engine (model.js).'; return; }

  const q0 = new URLSearchParams(window.location.search);
  const st = {
    view: q0.get('tier') || 'all', verdict: q0.get('verdict') || 'ALL',
    cat: q0.get('cat') || 'ALL', chain: q0.get('chain') || 'ALL', q: q0.get('q') || '',
    sort: q0.get('sort') || 'rank', dir: q0.get('dir') || 'asc', slug: q0.get('detail') || '',
    cap: Number(q0.get('cap')) || 0, alloc: Number(q0.get('alloc')) || 5.0,
  };

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const usd = (n) => {
    if (n == null || !Number.isFinite(n)) return '—';
    const a = Math.abs(n), sg = n < 0 ? '-' : '';
    return a >= 1e9 ? `${sg}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${sg}$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${sg}$${(a / 1e3).toFixed(1)}K` : `${sg}$${Math.round(a)}`;
  };
  const pct = (n, sgn = false) => (n == null || !Number.isFinite(n) ? '—' : `${sgn && n > 0 ? '+' : ''}${n.toFixed(1)}%`);
  const ageStr = (d) => (d == null ? 'n/a' : d >= 730 ? `${(d / 365).toFixed(1)}y` : d >= 60 ? `${Math.round(d / 30)}m` : `${d}d`);
  const vCls = (v) => (v === 'FARM NOW' ? 'vb-farm' : v === 'SELECTIVE' ? 'vb-sel' : v === 'WATCH' ? 'vb-watch' : 'vb-low');
  const oClr = (p) => (p >= 45 ? 't-green' : p < 24 ? 't-rose' : 't-amber');
  const eClr = (v) => (v >= 38 ? 't-green' : v >= 12 ? 't-cyan' : 't-rose');
  const farmOf = (r) => (st.cap === 0 && st.alloc === 5.0 ? r.farm : M.buildCostedFarmPlan(r, r.age_days, r.implied_value_usd, r.launch_odds_pct, st.cap, st.alloc));

  const cats = [...new Set(D.rows.map((r) => r.category || 'Other'))].sort();
  const chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();
  const u = D.universe;
  const cleanN = u.watchlist_pre + u.extended_pre + u.early_pre + u.clean_traded_mcap + u.clean_token_nomcap;
  const hazHi = Math.round(D.survival_curve[0]?.remaining_hazard_pct ?? 80);
  const hazLo = Math.round(D.survival_curve[D.survival_curve.length - 1]?.remaining_hazard_pct ?? 12);
  const bigCats = D.cat_incidence.filter((c) => c.total >= 8);
  const loC = [...bigCats].sort((a, b) => a.pct - b.pct)[0], hiC = [...bigCats].sort((a, b) => b.pct - a.pct)[0];
  const catNote = loC && hiC ? `${loC.category} ${Math.round(loC.pct)}% vs ${hiC.category} ${Math.round(hiC.pct)}%` : 'Falls with age';

  function filtered() {
    const q = st.q.trim().toLowerCase(), wantV = st.verdict.replace(/_/g, ' ');
    const list = D.rows.filter((r) => {
      if (st.view === 'watchlist' && r.tier !== 'watchlist') return false;
      if (st.view === 'early' && r.tier !== 'early') return false;
      if (st.verdict !== 'ALL' && farmOf(r).verdict !== wantV) return false;
      if (st.cat !== 'ALL' && (r.category || 'Other') !== st.cat) return false;
      if (st.chain !== 'ALL' && !r.chains.includes(st.chain)) return false;
      if (q && !`${r.name} ${r.slug} ${r.category || ''} ${r.chains.join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const dir = st.dir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => {
      let va = a.rank, vb = b.rank;
      if (st.sort === 'implied') { va = a.implied_value_usd; vb = b.implied_value_usd; }
      else if (st.sort === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (st.sort === 'odds') { va = a.launch_odds_pct; vb = b.launch_odds_pct; }
      else if (st.sort === 'ev_hr') { va = farmOf(a).ev_per_hour; vb = farmOf(b).ev_per_hour; }
      else if (st.sort === 'age') { va = a.age_days ?? -1; vb = b.age_days ?? -1; }
      return va !== vb ? (va - vb) * dir : a.rank - b.rank;
    });
  }

  function nearPeers(row) {
    const sc = D.peers.filter((p) => p.category === (row.category || 'Other'));
    const pool = sc.length >= 3 ? sc : D.peers, lt = Math.log(Math.max(1, row.tvl_usd));
    return [...pool].sort((a, b) => Math.abs(Math.log(a.tvl_usd) - lt) - Math.abs(Math.log(b.tvl_usd) - lt)).slice(0, 3);
  }

  function svgCal() {
    const W = 740, H = 112, pL = 42, pR = 12, pT = 14, pB = 18;
    const x0 = Math.log10(5e6), x1 = Math.log10(6e9), y0 = Math.log10(5e5), y1 = Math.log10(3e9);
    const sx = (v) => pL + ((Math.log10(Math.max(5e6, Math.min(6e9, v))) - x0) / (x1 - x0)) * (W - pL - pR);
    const sy = (v) => H - pB - ((Math.log10(Math.max(5e5, Math.min(3e9, v))) - y0) / (y1 - y0)) * (H - pT - pB);
    const m = D.model, c = [], up = [], lo = [];
    for (let i = 0; i <= 18; i++) {
      const t = Math.pow(10, x0 + (i / 18) * (x1 - x0)), y = Math.exp(m.intercept + m.beta_log_tvl * Math.log(t));
      c.push(`${sx(t).toFixed(1)},${sy(y).toFixed(1)}`);
      up.push(`${sx(t).toFixed(1)},${sy(y * m.band_p75_mult).toFixed(1)}`);
      lo.unshift(`${sx(t).toFixed(1)},${sy(y * m.band_p25_mult).toFixed(1)}`);
    }
    const pDots = D.peers.map((p) => `<circle cx="${sx(p.tvl_usd).toFixed(1)}" cy="${sy(p.mcap_usd).toFixed(1)}" r="2.5" fill="#38bdf8" opacity=".65"/>`).join('');
    const wDots = D.rows.filter((r) => r.tier === 'watchlist').slice(0, 18).map((r) => `<circle cx="${sx(r.tvl_usd).toFixed(1)}" cy="${sy(r.implied_value_usd).toFixed(1)}" r="3.2" fill="#f59e0b" stroke="#0a0f17" stroke-width=".8"/>`).join('');
    const xt = [[1e7, '$10M'], [1e8, '$100M'], [1e9, '$1B']].map(([v, l]) => `<line x1="${sx(v)}" y1="${pT}" x2="${sx(v)}" y2="${H - pB}" stroke="#1b273b"/><text x="${sx(v)}" y="${H - 5}" text-anchor="middle" fill="#8b9bb4" font-size="9">${l}</text>`).join('');
    const yt = [[1e6, '$1M'], [1e7, '$10M'], [1e8, '$100M'], [1e9, '$1B']].map(([v, l]) => `<line x1="${pL}" y1="${sy(v)}" x2="${W - pR}" y2="${sy(v)}" stroke="#1b273b"/><text x="${pL - 5}" y="${sy(v) + 3}" text-anchor="end" fill="#8b9bb4" font-size="9">${l}</text>`).join('');
    return `<svg class="svg-mono" viewBox="0 0 ${W} ${H}" width="100%" height="112" role="img" aria-label="Calibration">${xt}${yt}<polygon points="${up.join(' ')} ${lo.join(' ')}" fill="rgba(45,212,191,.13)"/><polyline points="${c.join(' ')}" fill="none" stroke="#2dd4bf" stroke-width="2"/>${pDots}${wDots}<circle cx="${pL + 8}" cy="7" r="2.8" fill="#38bdf8"/><text x="${pL + 15}" y="10" fill="#cbd5e1" font-size="9">${D.clean_peer_count} Live Peers</text><circle cx="${pL + 112}" cy="7" r="3" fill="#f59e0b"/><text x="${pL + 119}" y="10" fill="#f59e0b" font-size="9">Watchlist Pre-Token</text><line x1="${pL + 245}" y1="7" x2="${pL + 260}" y2="7" stroke="#2dd4bf" stroke-width="2"/><text x="${pL + 265}" y="10" fill="#2dd4bf" font-size="9">L1-LAD + 50% IQR</text></svg>`;
  }

  function svgSurv() {
    const W = 500, H = 112, pL = 34, pR = 12, pT = 16, pB = 19, bks = D.survival_curve, bw = (W - pL - pR) / bks.length;
    const sy = (v) => H - pB - (v / 100) * (H - pT - pB);
    const bars = bks.map((b, i) => {
      const x = pL + i * bw + 10, w = Math.max(14, bw * 0.34), yc = sy(b.cum_pct), yh = sy(b.remaining_hazard_pct);
      return `<rect x="${x.toFixed(1)}" y="${yc.toFixed(1)}" width="${w.toFixed(1)}" height="${(H - pB - yc).toFixed(1)}" rx="2" fill="#38bdf8" opacity=".55"/><rect x="${(x + w + 4).toFixed(1)}" y="${yh.toFixed(1)}" width="${w.toFixed(1)}" height="${(H - pB - yh).toFixed(1)}" rx="2" fill="#34d399"/><text x="${(x + w + 2).toFixed(1)}" y="${H - 5}" text-anchor="middle" fill="#cbd5e1" font-size="9">${esc(b.bucket)}</text><text x="${(x + w + 4 + w / 2).toFixed(1)}" y="${(yh - 2.5).toFixed(1)}" text-anchor="middle" fill="#34d399" font-size="8.6" font-weight="700">${Math.round(b.remaining_hazard_pct)}%</text>`;
    }).join('');
    const gr = [0, 50, 100].map((v) => `<line x1="${pL}" y1="${sy(v)}" x2="${W - pR}" y2="${sy(v)}" stroke="#1b273b"/><text x="${pL - 5}" y="${sy(v) + 3}" text-anchor="end" fill="#8b9bb4" font-size="8.8">${v}%</text>`).join('');
    return `<svg class="svg-mono" viewBox="0 0 ${W} ${H}" width="100%" height="112" role="img" aria-label="Survival hazard">${gr}${bars}<rect x="${pL + 4}" y="2" width="7" height="7" rx="1" fill="#38bdf8" opacity=".65"/><text x="${pL + 14}" y="9" fill="#cbd5e1" font-size="8.8">Have Token F(t)</text><rect x="${pL + 124}" y="2" width="7" height="7" rx="1" fill="#34d399"/><text x="${pL + 134}" y="9" fill="#34d399" font-size="8.8">Remaining Launch Hazard (falls w/ age)</text></svg>`;
  }

  function peersHtml(limit = 50) {
    const q = st.q.trim().toLowerCase();
    const list = D.peers.filter((p) => (st.cat === 'ALL' || p.category === st.cat) && (st.chain === 'ALL' || p.chains.includes(st.chain)) && (!q || `${p.name} ${p.category} ${p.chains.join(' ')}`.toLowerCase().includes(q)));
    const trs = list.slice(0, limit).map((p, i) => `<tr><td class="rank-num">${i + 1}</td><td><div class="proto-name">${esc(p.name)}</div><div class="proto-meta">${esc(p.category)} · ${esc(p.chains.slice(0, 3).join(', '))}</div></td><td class="num">${usd(p.tvl_usd)}</td><td class="num b-w">${usd(p.mcap_usd)}</td><td class="num">${p.ratio.toFixed(2)}x</td><td class="num t-teal">${usd(p.pred_usd)}</td><td class="num ${p.err_mult <= 2.5 ? 't-green' : p.err_mult <= 5 ? 't-amber' : 't-rose'}">${p.err_mult.toFixed(2)}x</td><td class="num">${ageStr(p.age_days)}</td></tr>`).join('');
    return `<div class="table-wrap"><div class="table-head-bar"><span><strong>${list.length} Clean Live-Token Peers</strong> (strictly separated from pre-token radar; used for calibration &amp; blind tests)</span><span>LOO ${D.model.loo_mult}x · 10F ${D.model.cv10_mult}x · WF ${D.model.wf_mult}x (vs Starter ${D.model.starter_mult}x)</span></div><table class="board-table"><thead><tr><th>#</th><th>Live Protocol</th><th class="num">TVL</th><th class="num">Actual MCap</th><th class="num">MC/TVL</th><th class="num">Model Pred</th><th class="num">Mult Err</th><th class="num">Age</th></tr></thead><tbody>${trs}</tbody></table></div>`;
  }

  function auditHtml() {
    const m = D.model;
    const ab = m.ablation.map((a) => `<tr><td><strong>${esc(a.label)}</strong><div class="sub-note">${esc(a.note)}</div></td><td>${a.loo_mult.toFixed(2)}x</td><td>${a.cv10_mult.toFixed(2)}x</td><td>${a.wf_mult.toFixed(2)}x</td><td><span class="dec-badge dec-${esc(a.decision)}">${esc(a.decision)}</span></td></tr>`).join('');
    const inc = D.cat_incidence.slice(0, 10).map((c) => `<tr><td>${esc(c.category)}</td><td>${c.with_token}/${c.total}</td><td class="${c.pct >= 55 ? 't-green' : c.pct < 25 ? 't-rose' : 't-amber'}">${c.pct.toFixed(1)}%</td><td class="mono t-muted">${(m.category_adj[c.category] ?? 0) >= 0 ? '+' : ''}${(m.category_adj[c.category] ?? 0).toFixed(2)}</td></tr>`).join('');
    const parts = [
      [u.watchlist_pre, 'Watchlist Pre-Token', 't-amber'], [u.extended_pre, 'Extended ≥$50M Pre', 't-cyan'],
      [u.early_pre, 'Early <$50M Pre', 't-teal'], [u.clean_traded_mcap, 'Clean Traded Peers', 't-green'],
      [u.clean_token_nomcap, 'Token (No MCap)', ''], [u.excluded_live, 'Excl. Live Infra', 't-muted'], [u.excluded_pre, 'Excl. Pre Infra', 't-muted'],
    ].map(([n, l, c]) => `<div class="part-cell"><div class="part-n ${c}">${n}</div><div class="part-l">${esc(l)}</div></div>`).join('');
    return `<section class="audit-panel"><div class="flex-between"><span class="sec-h m0">${u.total} / ${u.total} Snapshot Reconciliation (${u.reconciles ? 'EXACT MATCH ✓' : 'MISMATCH'})</span><span class="mono sm t-teal">${u.watchlist_pre}+${u.extended_pre}+${u.early_pre} ranked (${D.rows.length}) + ${u.clean_traded_mcap}+${u.clean_token_nomcap} clean live + ${u.excluded_live}+${u.excluded_pre} excluded = ${u.total}</span></div><div class="partition-grid">${parts}</div><div class="audit-grid mt10"><div><div class="formula-box">ln(Implied) = ${m.intercept} + ${m.beta_log_tvl}·ln(TVL) ${m.beta_eth >= 0 ? '+' : '−'} ${Math.abs(m.beta_eth)}·Eth ${m.beta_sol >= 0 ? '+' : '−'} ${Math.abs(m.beta_sol)}·Sol + EB_Cat(k=${m.category_k})</div><table class="mini-table"><thead><tr><th>Triple-Blind Feature Ablation (N=${m.peer_count} Clean Peers)</th><th>LOO</th><th>10-Fold</th><th>Walk-Fwd</th><th>Status</th></tr></thead><tbody>${ab}</tbody></table></div><div><div class="mono sm t-cyan mb5">CATEGORY TOKEN INCIDENCE &amp; EB LOG-MULTIPLIER (N=${cleanN} CLEAN)</div><table class="mini-table"><thead><tr><th>Category</th><th>Live / All</th><th>Token %</th><th>EB Adj</th></tr></thead><tbody>${inc}</tbody></table></div></div></section><div class="mt10">${peersHtml(4)}</div>`;
  }

  function detailHtml(r) {
    const f = farmOf(r), ps = nearPeers(r);
    const pTr = ps.map((p) => `<tr><td><strong>${esc(p.name)}</strong> <span class="sub-note">(${esc(p.category)})</span></td><td>${usd(p.tvl_usd)}</td><td>${usd(p.mcap_usd)}</td><td>${p.ratio.toFixed(2)}x</td><td>${usd(p.pred_usd)}</td></tr>`).join('');
    const sLi = f.steps.map((s, i) => `<li class="step-item"><div class="step-act"><strong>Step ${i + 1}:</strong> ${esc(s.action)}</div><div class="step-meta"><span>Cost: ${esc(s.cost)}</span><span>Time: ${esc(s.time)}</span></div></li>`).join('');
    return `<aside class="detail-card"><div class="detail-head"><div><div class="tag-row"><span class="tier-tag ${r.tier === 'watchlist' ? 'tier-wl' : 'tier-early'}">${r.tier === 'watchlist' ? 'WATCHLIST' : r.tier === 'extended' ? 'EXTENDED' : 'EARLY'} · RANK #${r.rank}</span><span class="verdict-badge ${vCls(f.verdict)}">${esc(f.verdict)}</span></div><div class="detail-title">${esc(r.name)}</div><div class="detail-sub">${esc(r.category || 'Other')} · Chains: ${esc(r.chains.slice(0, 5).join(', '))} · Listed ${esc(r.listed_at || 'unknown')} (${ageStr(r.age_days)} pre-token)</div></div><button class="close-btn" data-action="close">Close</button></div><div class="detail-kpis"><div class="dk"><div class="dk-l">Implied Value</div><div class="dk-v t-teal">${usd(r.implied_value_usd)}</div></div><div class="dk"><div class="dk-l">Conformal IQR (${r.conformal_scale}x)</div><div class="dk-v sm-v">${usd(r.range_p25_usd)}–${usd(r.range_p75_usd)}</div></div><div class="dk"><div class="dk-l">Survival Odds</div><div class="dk-v ${oClr(r.launch_odds_pct)}">${r.launch_odds_pct.toFixed(1)}%</div></div><div class="dk"><div class="dk-l">Farm EV / Hr</div><div class="dk-v ${eClr(f.ev_per_hour)}">$${f.ev_per_hour.toFixed(1)}/hr</div></div></div><div class="sec-h">L1-LAD Valuation Decomposition (dashboard/model.js)</div><div class="decomp-grid"><div class="decomp-cell"><div class="t-muted">TVL Power Law</div><strong>${usd(Math.round(Math.exp(r.decomp.tvl_term)))}</strong></div><div class="decomp-cell"><div class="t-muted">Ecosystem Adj</div><strong>${Math.exp(r.decomp.eco_term).toFixed(2)}x</strong></div><div class="decomp-cell"><div class="t-muted">Cat EB (${r.decomp.cat_peers}p)</div><strong>${Math.exp(r.decomp.cat_term).toFixed(2)}x</strong></div><div class="decomp-cell"><div class="t-muted">Age Hazard</div><strong>${r.age_hazard_pct}%</strong></div></div><div class="sec-h">Nearest Clean Live Traded Peers (Reality Check)</div><table class="mini-table"><thead><tr><th>Live Peer</th><th>TVL</th><th>Actual MCap</th><th>MC/TVL</th><th>Model Pred</th></tr></thead><tbody>${pTr}</tbody></table><div class="sec-h">Costed 5-Step Farm Playbook (${usd(f.capital_usd)} Cap · $${f.gas_usd} Gas · ${f.total_hours}h · ${f.hold_days}d)</div><div class="rationale-box">${esc(f.rationale)} <strong>Net EV: $${f.expected_ev_usd.toFixed(1)}</strong> (Gross ~$${f.est_airdrop_usd.toFixed(0)} at ${st.alloc}% pool; Cat ${r.cat_token_rate_pct}% × Hazard ${r.age_hazard_pct}%).</div><ol class="step-list">${sLi}</ol></aside>`;
  }

  function render() {
    const rows = filtered(), sel = st.slug ? D.rows.find((r) => r.slug === st.slug) : null;
    const nFarm = D.rows.filter((r) => farmOf(r).verdict === 'FARM NOW').length;
    const nSel = D.rows.filter((r) => farmOf(r).verdict === 'SELECTIVE').length;
    const nLow = D.rows.filter((r) => farmOf(r).verdict === 'LOW ODDS').length;
    const totTvl = D.rows.reduce((s, r) => s + r.tvl_usd, 0);
    const arr = (k) => (st.sort === k ? (st.dir === 'asc' ? ' ▲' : ' ▼') : '');
    const maxI = Math.max(1, ...D.rows.map((r) => r.implied_value_usd));
    const showCh = st.view === 'all' && !sel && st.verdict === 'ALL' && st.cat === 'ALL' && st.chain === 'ALL' && !st.q;
    const capN = sel ? 10 : showCh ? 8 : 11;

    const trs = rows.slice(0, capN).map((r) => {
      const f = farmOf(r), bw = Math.max(6, Math.round((Math.log(r.implied_value_usd) / Math.log(maxI)) * 100));
      const gc = r.change_7d == null ? 'neu' : r.change_7d >= 0 ? 'pos' : 'neg';
      return `<tr class="${sel?.slug === r.slug ? 'selected' : ''}" data-slug="${esc(r.slug)}"><td class="rank-num">#${r.rank}</td><td><div class="proto-name">${esc(r.name)} <span class="tier-tag ${r.tier === 'watchlist' ? 'tier-wl' : 'tier-early'}">${r.tier === 'watchlist' ? 'WL' : r.tier === 'extended' ? 'EXT' : 'EARLY'}</span></div><div class="proto-meta">${esc(r.category || 'Other')} · ${esc(r.chains.slice(0, 3).join(', '))}</div></td><td class="num"><div class="val-main">${usd(r.tvl_usd)}</div><div class="val-range ${gc}">${pct(r.change_7d, true)} 7d</div></td><td class="num"><div class="val-main t-teal">${usd(r.implied_value_usd)}</div><div class="val-range">${usd(r.range_p25_usd)}–${usd(r.range_p75_usd)}</div><div class="bar-track"><div class="bar-fill" style="width:${bw}%"></div></div></td><td class="num"><div class="val-main ${oClr(r.launch_odds_pct)}">${r.launch_odds_pct.toFixed(0)}%</div><div class="val-range">${ageStr(r.age_days)} pre-TGE</div></td><td class="num"><div><span class="verdict-badge ${vCls(f.verdict)}">${esc(f.verdict)}</span></div><div class="val-range">$${f.ev_per_hour.toFixed(1)}/hr · $${f.gas_usd} gas</div></td></tr>`;
    }).join('');

    const opt = (arrL, cur, allLbl) => `<option value="ALL">${allLbl} (${arrL.length})</option>` + arrL.map((c) => `<option value="${esc(c)}" ${cur === c ? 'selected' : ''}>${esc(c)}</option>`).join('');

    app.innerHTML = `<header class="topbar"><div><div class="brand-kicker">Token Launch Radar v3 · Offline Quantitative Desk · Snapshot ${esc(D.as_of)}</div><h1 class="brand-title">Pre-Token Valuations, Survival Launch Odds &amp; Farm Verdicts</h1><div class="brand-sub">Shared L1-LAD model (dashboard/model.js) tested blind 3 ways on ${D.clean_peer_count} clean live peers; zero hardcoded names.</div></div><div class="top-badges"><span class="chip ok">Watchlist: <strong>${D.watchlist_count}/${D.watchlist_count} (100%)</strong></span><span class="chip">Pre-Token Ranked: <strong>${D.rows.length}</strong></span><span class="chip">Accounted: <strong>${u.total}/${u.total} ✓</strong></span></div></header>` +
      `<div class="selfcheck-bar"><span class="sc-item"><span class="sc-ok">✓</span> ${D.watchlist_count}/${D.watchlist_count} Watchlist</span><span class="sc-item"><span class="sc-ok">✓</span> 0 Live Mixed (${D.clean_peer_count} Peers)</span><span class="sc-item"><span class="sc-ok">✓</span> Blind: LOO ${D.model.loo_mult}x · 10F ${D.model.cv10_mult}x · WF ${D.model.wf_mult}x (vs ${D.model.starter_mult}x)</span><span class="sc-item"><span class="sc-ok">✓</span> Survival Odds (${hazHi}%→${hazLo}%)</span><span class="sc-item"><span class="sc-ok">✓</span> 100% Costed $/hr Plans</span><span class="sc-item"><span class="sc-ok">✓</span> ${u.total}/${u.total} · Offline</span></div>` +
      `<section class="integrity-strip"><div class="kpi-card"><div class="kpi-label">Triple Blind Error (N=${D.model.peer_count})</div><div class="kpi-val t-teal">${D.model.loo_mult.toFixed(2)}x <span class="kpi-sub">LOO · ${D.model.wf_mult.toFixed(2)}x WF</span></div><div class="kpi-meta">10-Fold ${D.model.cv10_mult.toFixed(2)}x vs Starter ${D.model.starter_mult}x</div></div><div class="kpi-card"><div class="kpi-label">Conformal IQR Band</div><div class="kpi-val t-cyan">${D.model.band_p25_mult}x – ${D.model.band_p75_mult}x</div><div class="kpi-meta">Per-category LOO error scale</div></div><div class="kpi-card"><div class="kpi-label">Survival Launch Odds</div><div class="kpi-val">${hazHi}% → ${hazLo}%</div><div class="kpi-meta">${esc(catNote)}</div></div><div class="kpi-card"><div class="kpi-label">Costed Farm Queue</div><div class="kpi-val t-teal">${nFarm} Farm · ${nSel} Sel</div><div class="kpi-meta">${nLow} Low Odds (skip unless TGE set)</div></div><div class="kpi-card"><div class="kpi-label">Pre-Token TVL Tracked</div><div class="kpi-val t-amber">${usd(totTvl)}</div><div class="kpi-meta">${D.rows.length} pre + ${u.clean_traded_mcap + u.clean_token_nomcap} live + ${u.excluded_live + u.excluded_pre} excl = ${u.total}</div></div></section>` +
      `<section class="controls"><div class="ctrl-group"><button class="tab-btn ${st.view === 'all' ? 'active' : ''}" data-view="all">All Pre-Token (${D.rows.length})</button><button class="tab-btn ${st.view === 'watchlist' ? 'active' : ''}" data-view="watchlist">Watchlist (${D.watchlist_count})</button><button class="tab-btn ${st.view === 'early' ? 'active' : ''}" data-view="early">Early &lt;$50M (${D.early_count})</button><button class="tab-btn ${st.view === 'peers' ? 'active' : ''}" data-view="peers">Live Peers (${D.clean_peer_count})</button><button class="tab-btn ${st.view === 'audit' ? 'active' : ''}" data-view="audit">Model Audit &amp; ${u.total} Map</button></div><div class="ctrl-group"><button class="pill-btn ${st.verdict === 'ALL' ? 'active' : ''}" data-v="ALL">All</button><button class="pill-btn v-farm ${st.verdict.replace(/_/g, ' ') === 'FARM NOW' ? 'active' : ''}" data-v="FARM NOW">Farm Now</button><button class="pill-btn v-sel ${st.verdict === 'SELECTIVE' ? 'active' : ''}" data-v="SELECTIVE">Selective</button><button class="pill-btn v-watch ${st.verdict === 'WATCH' ? 'active' : ''}" data-v="WATCH">Watch</button><button class="pill-btn v-low ${st.verdict.replace(/_/g, ' ') === 'LOW ODDS' ? 'active' : ''}" data-v="LOW ODDS">Low Odds</button></div><div class="ctrl-group"><input class="input search" id="qIn" type="search" placeholder="Filter protocol, chain..." value="${esc(st.q)}"/><select class="select" id="catS">${opt(cats, st.cat, 'All Categories')}</select><select class="select" id="chS">${opt(chains, st.chain, 'All Chains')}</select><select class="select" id="capS"><option value="0" ${st.cap === 0 ? 'selected' : ''}>Cap: Auto</option><option value="250" ${st.cap === 250 ? 'selected' : ''}>Cap: $250</option><option value="1000" ${st.cap === 1000 ? 'selected' : ''}>Cap: $1,000</option><option value="5000" ${st.cap === 5000 ? 'selected' : ''}>Cap: $5,000</option></select><select class="select" id="alS"><option value="3" ${st.alloc === 3 ? 'selected' : ''}>TGE: 3%</option><option value="5" ${st.alloc === 5 ? 'selected' : ''}>TGE: 5%</option><option value="8" ${st.alloc === 8 ? 'selected' : ''}>TGE: 8%</option></select></div></section>` +
      (showCh ? `<section class="charts-row"><div class="chart-card"><div class="chart-head"><span class="chart-title">Empirical Valuation Curve (Log TVL vs Log MCap)</span><span class="chart-sub">β_TVL=${D.model.beta_log_tvl} · Eth=${D.model.beta_eth} · Sol=${D.model.beta_sol} · EB-Cat(k=${D.model.category_k})</span></div>${svgCal()}</div><div class="chart-card"><div class="chart-head"><span class="chart-title">Token Survival Hazard by Age</span><span class="chart-sub">Remaining odds fall w/ age</span></div>${svgSurv()}</div></section>` : '') +
      `<section class="workspace ${sel && st.view !== 'peers' && st.view !== 'audit' ? 'has-detail' : ''}">${st.view === 'audit' ? auditHtml() : st.view === 'peers' ? peersHtml(60) : `<div class="table-wrap"><div class="table-head-bar"><span>Showing <strong>${Math.min(rows.length, capN)}</strong> of <strong>${rows.length}</strong> matching pre-token protocols · Click any row for breakdown, live peers &amp; 5-step plan</span><span>Sorted by <strong>${esc(st.sort)}</strong> (${esc(st.dir)})</span></div><table class="board-table"><thead><tr><th data-s="rank">Rank${arr('rank')}</th><th>Protocol / Category / Chains</th><th class="num" data-s="tvl">TVL &amp; 7d Δ${arr('tvl')}</th><th class="num" data-s="implied">Implied &amp; Conformal IQR${arr('implied')}</th><th class="num" data-s="odds">Survival Odds${arr('odds')}</th><th class="num" data-s="ev_hr">Farm Verdict${arr('ev_hr')}</th></tr></thead><tbody>${trs || '<tr><td colspan="6" class="empty-cell">No protocols match the active filter.</td></tr>'}</tbody></table></div>`}${sel && st.view !== 'peers' && st.view !== 'audit' ? detailHtml(sel) : ''}</section>` +
      `<footer class="footer-note"><span>Data source: sealed DefiLlama snapshot (${esc(D.as_of)}). Zero network calls. Shared engine: dashboard/model.js.</span><span>Pre-token = no gecko_id, symbol, or mcap in snapshot.</span></footer>`;

    app.querySelectorAll('[data-view]').forEach((el) => el.addEventListener('click', () => { st.view = el.getAttribute('data-view'); render(); }));
    app.querySelectorAll('[data-v]').forEach((el) => el.addEventListener('click', () => { st.verdict = el.getAttribute('data-v'); if (st.view === 'peers' || st.view === 'audit') st.view = 'all'; render(); }));
    app.querySelectorAll('[data-s]').forEach((el) => el.addEventListener('click', () => { const k = el.getAttribute('data-s'); st.dir = st.sort === k ? (st.dir === 'asc' ? 'desc' : 'asc') : (k === 'rank' ? 'asc' : 'desc'); st.sort = k; render(); }));
    app.querySelectorAll('tbody tr[data-slug]').forEach((tr) => tr.addEventListener('click', () => { st.slug = tr.getAttribute('data-slug'); render(); }));
    app.querySelector('[data-action="close"]')?.addEventListener('click', () => { st.slug = ''; render(); });
    document.getElementById('qIn')?.addEventListener('input', (e) => { st.q = e.target.value; render(); });
    document.getElementById('catS')?.addEventListener('change', (e) => { st.cat = e.target.value; render(); });
    document.getElementById('chS')?.addEventListener('change', (e) => { st.chain = e.target.value; render(); });
    document.getElementById('capS')?.addEventListener('change', (e) => { st.cap = Number(e.target.value); render(); });
    document.getElementById('alS')?.addEventListener('change', (e) => { st.alloc = Number(e.target.value); render(); });
  }
  render();
})();
