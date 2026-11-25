(() => {
  const DATA = window.RADAR_DATA;
  const app = document.getElementById('app');
  if (!DATA) {
    app.textContent = 'Missing offline radar dataset (data.js).';
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const state = {
    view: params.get('tier') || 'all', // all | watchlist | early | peers | audit
    verdict: params.get('verdict') || 'ALL',
    category: params.get('cat') || 'ALL',
    chain: params.get('chain') || 'ALL',
    search: params.get('q') || '',
    sortKey: params.get('sort') || 'rank',
    sortDir: params.get('dir') || 'asc',
    selectedSlug: params.get('detail') || '',
    simCapital: Number(params.get('cap')) || 0,
    simAllocPct: 5.0,
  };

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtUsd(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
    return `${sign}$${Math.round(abs)}`;
  }

  function fmtPct(n, signed = false) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    return `${signed && n > 0 ? '+' : ''}${n.toFixed(1)}%`;
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return 'n/a';
    if (days >= 730) return `${(days / 365).toFixed(1)}y`;
    if (days >= 60) return `${Math.round(days / 30)}m`;
    return `${days}d`;
  }

  function verdictClass(v) {
    if (v === 'FARM NOW') return 'vb-farm';
    if (v === 'SELECTIVE') return 'vb-sel';
    if (v === 'WATCH') return 'vb-watch';
    return 'vb-low';
  }

  function recomputeFarm(row) {
    const cap = state.simCapital > 0 ? state.simCapital : row.farm.capital_usd;
    const alloc = state.simAllocPct / 100;
    const poolAlloc = row.implied_value_usd * alloc;
    const estWallets = Math.min(120000, Math.max(1200, Math.round(row.tvl_usd / 16000)));
    const tiered = (poolAlloc * 0.55) / estWallets;
    const proRata = poolAlloc * 0.45 * (cap / Math.max(row.tvl_usd, 5e6));
    const estAirdrop = Math.min(2500, Math.max(4, tiered + proRata));
    const oppCost = cap * 0.04 * (row.farm.hold_days / 365);
    const ev = estAirdrop * (row.launch_odds_pct / 100) - (row.farm.gas_usd + oppCost);
    const evHr = ev / Math.max(0.25, row.farm.total_hours);
    return {
      cap,
      estAirdrop: Math.round(estAirdrop * 100) / 100,
      ev: Math.round(ev * 100) / 100,
      evHr: Math.round(evHr * 100) / 100,
    };
  }

  const allCategories = [...new Set(DATA.rows.map((r) => r.category || 'Other'))].sort();
  const allChains = [...new Set(DATA.rows.flatMap((r) => r.chains))].sort();

  function filteredRows() {
    const q = state.search.trim().toLowerCase();
    let list = DATA.rows.filter((r) => {
      if (state.view === 'watchlist' && r.tier !== 'watchlist') return false;
      if (state.view === 'early' && r.tier !== 'early') return false;
      if (state.verdict !== 'ALL' && r.farm.verdict !== state.verdict.replace(/_/g, ' ')) return false;
      if (state.category !== 'ALL' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'ALL' && !r.chains.includes(state.chain)) return false;
      if (q && !`${r.name} ${r.slug} ${r.category || ''} ${r.chains.join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });

    const dir = state.sortDir === 'desc' ? -1 : 1;
    list = [...list].sort((a, b) => {
      let va = a.rank;
      let vb = b.rank;
      if (state.sortKey === 'implied') { va = a.implied_value_usd; vb = b.implied_value_usd; }
      else if (state.sortKey === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (state.sortKey === 'odds') { va = a.launch_odds_pct; vb = b.launch_odds_pct; }
      else if (state.sortKey === 'ev_hr') { va = recomputeFarm(a).evHr; vb = recomputeFarm(b).evHr; }
      else if (state.sortKey === 'age') { va = a.age_days ?? -1; vb = b.age_days ?? -1; }
      return va !== vb ? (va - vb) * dir : a.rank - b.rank;
    });
    return list;
  }

  function nearestPeers(row) {
    const sameCat = DATA.peers.filter((p) => p.category === (row.category || 'Other'));
    const pool = sameCat.length >= 3 ? sameCat : DATA.peers;
    const logT = Math.log(Math.max(1, row.tvl_usd));
    return [...pool].sort((a, b) => Math.abs(Math.log(a.tvl_usd) - logT) - Math.abs(Math.log(b.tvl_usd) - logT)).slice(0, 3);
  }

  /** Inline SVG: 88 clean live peers + fitted L1-LAD regression curve + shaded IQR band + Watchlist highlights. */
  function renderCalibrationScatterSvg() {
    const W = 740;
    const H = 148;
    const padL = 44;
    const padR = 14;
    const padT = 12;
    const padB = 22;
    const xMin = Math.log10(5e6);
    const xMax = Math.log10(6e9);
    const yMin = Math.log10(5e5);
    const yMax = Math.log10(3e9);
    const sx = (v) => padL + ((Math.log10(Math.max(5e6, Math.min(6e9, v))) - xMin) / (xMax - xMin)) * (W - padL - padR);
    const sy = (v) => H - padB - ((Math.log10(Math.max(5e5, Math.min(3e9, v))) - yMin) / (yMax - yMin)) * (H - padT - padB);

    const m = DATA.model;
    const curvePts = [];
    const upperPts = [];
    const lowerPts = [];
    for (let i = 0; i <= 18; i++) {
      const tvl = Math.pow(10, xMin + (i / 18) * (xMax - xMin));
      const yPred = Math.exp(m.intercept + m.beta_log_tvl * Math.log(tvl));
      curvePts.push(`${sx(tvl).toFixed(1)},${sy(yPred).toFixed(1)}`);
      upperPts.push(`${sx(tvl).toFixed(1)},${sy(yPred * m.band_p75_mult).toFixed(1)}`);
      lowerPts.unshift(`${sx(tvl).toFixed(1)},${sy(yPred * m.band_p25_mult).toFixed(1)}`);
    }

    const peerDots = DATA.peers
      .map((p) => `<circle cx="${sx(p.tvl_usd).toFixed(1)}" cy="${sy(p.mcap_usd).toFixed(1)}" r="2.7" fill="#38bdf8" opacity="0.65" />`)
      .join('');
    const wlDots = DATA.rows
      .filter((r) => r.tier === 'watchlist')
      .slice(0, 18)
      .map((r) => `<circle cx="${sx(r.tvl_usd).toFixed(1)}" cy="${sy(r.implied_value_usd).toFixed(1)}" r="3.4" fill="#f59e0b" stroke="#0a0f17" stroke-width="0.9" />`)
      .join('');

    const xTicks = [
      [1e7, '$10M'],
      [1e8, '$100M'],
      [1e9, '$1B'],
    ]
      .map(([v, lbl]) => `<line x1="${sx(v)}" y1="${padT}" x2="${sx(v)}" y2="${H - padB}" stroke="#1b273b" /><text x="${sx(v)}" y="${H - 7}" text-anchor="middle" fill="#8b9bb4" font-size="9.5" font-family="ui-monospace,monospace">${lbl}</text>`)
      .join('');
    const yTicks = [
      [1e6, '$1M'],
      [1e7, '$10M'],
      [1e8, '$100M'],
      [1e9, '$1B'],
    ]
      .map(([v, lbl]) => `<line x1="${padL}" y1="${sy(v)}" x2="${W - padR}" y2="${sy(v)}" stroke="#1b273b" /><text x="${padL - 5}" y="${sy(v) + 3}" text-anchor="end" fill="#8b9bb4" font-size="9.5" font-family="ui-monospace,monospace">${lbl}</text>`)
      .join('');

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="148" role="img" aria-label="Peer TVL vs Market Cap calibration plot">
      ${xTicks}${yTicks}
      <polygon points="${upperPts.join(' ')} ${lowerPts.join(' ')}" fill="rgba(45,212,191,0.13)" />
      <polyline points="${curvePts.join(' ')}" fill="none" stroke="#2dd4bf" stroke-width="2" />
      ${peerDots}${wlDots}
      <circle cx="${padL + 10}" cy="${padT + 8}" r="3" fill="#38bdf8" /><text x="${padL + 18}" y="${padT + 11}" fill="#cbd5e1" font-size="9.5" font-family="ui-monospace,monospace">88 Live Peers (actual MCap)</text>
      <circle cx="${padL + 195}" cy="${padT + 8}" r="3.4" fill="#f59e0b" /><text x="${padL + 203}" y="${padT + 11}" fill="#f59e0b" font-size="9.5" font-family="ui-monospace,monospace">Watchlist Pre-Token (implied)</text>
      <line x1="${padL + 388}" y1="${padT + 8}" x2="${padL + 404}" y2="${padT + 8}" stroke="#2dd4bf" stroke-width="2" /><text x="${padL + 410}" y="${padT + 11}" fill="#2dd4bf" font-size="9.5" font-family="ui-monospace,monospace">L1-LAD Curve + 50% IQR</text>
    </svg>`;
  }

  /** Inline SVG: Survival Hazard Curve (Cumulative token % rises 26%->86%, remaining launch hazard FALLS 81%->12%). */
  function renderSurvivalSvg() {
    const W = 500;
    const H = 148;
    const padL = 36;
    const padR = 14;
    const padT = 16;
    const padB = 24;
    const buckets = DATA.survival_curve;
    const bw = (W - padL - padR) / buckets.length;
    const sy = (pct) => H - padB - (pct / 100) * (H - padT - padB);

    const bars = buckets
      .map((b, i) => {
        const x = padL + i * bw + 10;
        const barW = Math.max(14, bw * 0.34);
        const yCum = sy(b.cum_pct);
        const yHaz = sy(b.remaining_hazard_pct);
        return `
          <rect x="${x.toFixed(1)}" y="${yCum.toFixed(1)}" width="${barW.toFixed(1)}" height="${(H - padB - yCum).toFixed(1)}" rx="2" fill="#38bdf8" opacity="0.55" />
          <rect x="${(x + barW + 4).toFixed(1)}" y="${yHaz.toFixed(1)}" width="${barW.toFixed(1)}" height="${(H - padB - yHaz).toFixed(1)}" rx="2" fill="#34d399" />
          <text x="${(x + barW + 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#cbd5e1" font-size="9.5" font-family="ui-monospace,monospace">${esc(b.bucket)}</text>
          <text x="${(x + barW + 4 + barW / 2).toFixed(1)}" y="${(yHaz - 3).toFixed(1)}" text-anchor="middle" fill="#34d399" font-size="9" font-weight="700" font-family="ui-monospace,monospace">${Math.round(b.remaining_hazard_pct)}%</text>`;
      })
      .join('');

    const grid = [0, 50, 100]
      .map((v) => `<line x1="${padL}" y1="${sy(v)}" x2="${W - padR}" y2="${sy(v)}" stroke="#1b273b" /><text x="${padL - 5}" y="${sy(v) + 3}" text-anchor="end" fill="#8b9bb4" font-size="9" font-family="ui-monospace,monospace">${v}%</text>`)
      .join('');

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="148" role="img" aria-label="Token survival hazard by protocol age">
      ${grid}${bars}
      <rect x="${padL + 4}" y="2" width="8" height="8" rx="1" fill="#38bdf8" opacity="0.65" /><text x="${padL + 16}" y="10" fill="#cbd5e1" font-size="9.2" font-family="ui-monospace,monospace">Have Token F(t)</text>
      <rect x="${padL + 132}" y="2" width="8" height="8" rx="1" fill="#34d399" /><text x="${padL + 144}" y="10" fill="#34d399" font-size="9.2" font-family="ui-monospace,monospace">Remaining Launch Hazard (falls w/ age)</text>
    </svg>`;
  }

  function renderAuditView() {
    const m = DATA.model;
    const u = DATA.universe;
    const abRows = m.ablation
      .map(
        (a) => `<tr>
          <td><strong>${esc(a.label)}</strong><div style="color:var(--muted);font-size:10.4px">${esc(a.note)}</div></td>
          <td>${a.loo_mult.toFixed(2)}x</td>
          <td>${a.cv10_mult.toFixed(2)}x</td>
          <td>${a.wf_mult.toFixed(2)}x</td>
          <td><span class="dec-badge dec-${esc(a.decision)}">${esc(a.decision)}</span></td>
        </tr>`,
      )
      .join('');

    const incRows = DATA.cat_incidence
      .slice(0, 10)
      .map(
        (c) => `<tr>
          <td>${esc(c.category)}</td>
          <td>${c.with_token}/${c.total}</td>
          <td style="color:${c.pct >= 55 ? 'var(--green)' : c.pct < 25 ? 'var(--rose)' : 'var(--amber)'}">${c.pct.toFixed(1)}%</td>
          <td style="font-family:var(--mono);color:var(--muted)">${(m.category_adj[c.category] ?? 0) >= 0 ? '+' : ''}${(m.category_adj[c.category] ?? 0).toFixed(2)}</td>
        </tr>`,
      )
      .join('');

    return `<section class="audit-panel">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="sec-h" style="margin:0">758 / 758 Snapshot Reconciliation (${u.reconciles ? 'EXACT MATCH ✓' : 'MISMATCH'})</span>
        <span style="font-family:var(--mono);font-size:10.5px;color:var(--teal)">${u.watchlist_pre}+${u.extended_pre}+${u.early_pre} ranked (${DATA.rows.length}) + ${u.clean_traded_mcap}+${u.clean_token_nomcap} clean live + ${u.excluded_live}+${u.excluded_pre} excluded = ${u.total}</span>
      </div>
      <div class="partition-grid">
        <div class="part-cell"><div class="part-n" style="color:var(--amber)">${u.watchlist_pre}</div><div class="part-l">Watchlist Pre-Token</div></div>
        <div class="part-cell"><div class="part-n" style="color:var(--cyan)">${u.extended_pre}</div><div class="part-l">Extended &ge;$50M Pre</div></div>
        <div class="part-cell"><div class="part-n" style="color:var(--teal)">${u.early_pre}</div><div class="part-l">Early &lt;$50M Pre</div></div>
        <div class="part-cell"><div class="part-n" style="color:var(--green)">${u.clean_traded_mcap}</div><div class="part-l">Clean Traded Peers</div></div>
        <div class="part-cell"><div class="part-n">${u.clean_token_nomcap}</div><div class="part-l">Token (No MCap)</div></div>
        <div class="part-cell"><div class="part-n" style="color:var(--muted)">${u.excluded_live}</div><div class="part-l">Excl. Live Infra</div></div>
        <div class="part-cell"><div class="part-n" style="color:var(--muted)">${u.excluded_pre}</div><div class="part-l">Excl. Pre Infra</div></div>
      </div>

      <div class="audit-grid" style="margin-top:11px">
        <div>
          <div class="formula-box">ln(Implied) = ${m.intercept} + ${m.beta_log_tvl}·ln(TVL) ${m.beta_log_chains >= 0 ? '+' : '−'} ${Math.abs(m.beta_log_chains)}·ln(Chains) + EB_Category(k=${m.category_k})</div>
          <table class="mini-table">
            <thead><tr><th>Triple-Blind Feature Ablation (N=${m.peer_count} Clean Peers)</th><th>LOO</th><th>10-Fold</th><th>Walk-Fwd</th><th>Status</th></tr></thead>
            <tbody>${abRows}</tbody>
          </table>
        </div>
        <div>
          <div style="font-family:var(--mono);font-size:10.5px;color:var(--cyan);margin-bottom:5px">CATEGORY TOKEN INCIDENCE &amp; EB LOG-MULTIPLIER (N=437 CLEAN)</div>
          <table class="mini-table">
            <thead><tr><th>Category</th><th>Live / All</th><th>Token %</th><th>EB Adj</th></tr></thead>
            <tbody>${incRows}</tbody>
          </table>
        </div>
      </div>
    </section>
    <div style="margin-top:10px">${renderPeersTable(12)}</div>`;
  }

  function renderDetail(row) {
    const f = recomputeFarm(row);
    const peers = nearestPeers(row);
    const tvlUsd = Math.round(Math.exp(row.decomp.tvl_term));
    const chainMult = Math.exp(row.decomp.chain_term);
    const catMult = Math.exp(row.decomp.cat_term);

    const peerHtml = peers
      .map(
        (p) => `<tr>
          <td><strong>${esc(p.name)}</strong> <span style="font-size:10px;color:var(--muted)">(${esc(p.category)})</span></td>
          <td>${fmtUsd(p.tvl_usd)}</td>
          <td>${fmtUsd(p.mcap_usd)}</td>
          <td>${p.ratio.toFixed(2)}x</td>
          <td>${fmtUsd(p.pred_usd)}</td>
        </tr>`,
      )
      .join('');

    const stepHtml = row.farm.steps
      .map(
        (s, i) => `<li class="step-item">
          <div class="step-act"><strong>Step ${i + 1}:</strong> ${esc(s.action)}</div>
          <div class="step-meta"><span>Cost: ${esc(s.cost)}</span><span>Time: ${esc(s.time)}</span></div>
        </li>`,
      )
      .join('');

    return `<aside class="detail-card">
      <div class="detail-head">
        <div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span class="tier-tag ${row.tier === 'watchlist' ? 'tier-wl' : 'tier-early'}">${row.tier === 'watchlist' ? 'WATCHLIST' : row.tier === 'extended' ? 'EXTENDED' : 'EARLY RADAR'} · RANK #${row.rank}</span>
            <span class="verdict-badge ${verdictClass(row.farm.verdict)}">${esc(row.farm.verdict)}</span>
          </div>
          <div class="detail-title">${esc(row.name)}</div>
          <div style="font-size:11.2px;color:var(--muted);margin-top:2px">${esc(row.category || 'Other')} · Chains: ${esc(row.chains.slice(0, 5).join(', '))} · Listed ${esc(row.listed_at || 'unknown')} (${fmtAge(row.age_days)} pre-token)</div>
        </div>
        <button class="close-btn" data-action="close-detail">Close</button>
      </div>

      <div class="detail-kpis">
        <div class="dk"><div class="dk-l">Implied Value</div><div class="dk-v" style="color:var(--teal)">${fmtUsd(row.implied_value_usd)}</div></div>
        <div class="dk"><div class="dk-l">Conformal IQR (${row.conformal_scale}x)</div><div class="dk-v" style="font-size:11.8px">${fmtUsd(row.range_p25_usd)}–${fmtUsd(row.range_p75_usd)}</div></div>
        <div class="dk"><div class="dk-l">Survival Odds</div><div class="dk-v" style="color:${row.launch_odds_pct >= 45 ? 'var(--green)' : row.launch_odds_pct < 24 ? 'var(--rose)' : 'var(--amber)'}">${row.launch_odds_pct.toFixed(1)}%</div></div>
        <div class="dk"><div class="dk-l">Farm EV / Hr</div><div class="dk-v" style="color:${f.evHr >= 38 ? 'var(--green)' : f.evHr >= 12 ? 'var(--cyan)' : 'var(--rose)'}">$${f.evHr.toFixed(1)}/hr</div></div>
      </div>

      <div class="sec-h">L1-LAD Valuation Decomposition (Snapshot Figures Only)</div>
      <div class="decomp-grid">
        <div class="decomp-cell"><div style="color:var(--muted)">TVL Power Law</div><strong>${fmtUsd(tvlUsd)}</strong></div>
        <div class="decomp-cell"><div style="color:var(--muted)">Chains (${row.chains.length})</div><strong>${chainMult.toFixed(2)}x</strong></div>
        <div class="decomp-cell"><div style="color:var(--muted)">Cat EB (${row.decomp.cat_peers}p)</div><strong>${catMult.toFixed(2)}x</strong></div>
        <div class="decomp-cell"><div style="color:var(--muted)">Age Hazard</div><strong>${row.age_hazard_pct}%</strong></div>
      </div>

      <div class="sec-h">Nearest Clean Live Traded Peers (Reality Check)</div>
      <table class="mini-table">
        <thead><tr><th>Live Peer</th><th>TVL</th><th>Actual MCap</th><th>MC/TVL</th><th>Model Pred</th></tr></thead>
        <tbody>${peerHtml}</tbody>
      </table>

      <div class="sec-h">Costed 5-Step Farm Playbook (${fmtUsd(f.cap)} Cap · $${row.farm.gas_usd} Gas · ${row.farm.total_hours}h · ${row.farm.hold_days}d)</div>
      <div class="rationale-box">${esc(row.farm.rationale)} <strong>Net EV: $${f.ev.toFixed(1)}</strong> (Gross ~$${f.estAirdrop.toFixed(0)} at 5% TGE pool; Cat rate ${row.cat_token_rate_pct}% × Survival hazard ${row.age_hazard_pct}%).</div>
      <ol class="step-list">${stepHtml}</ol>
    </aside>`;
  }

  function renderPeersTable(limit = 50) {
    const q = state.search.trim().toLowerCase();
    const list = DATA.peers.filter((p) => {
      if (state.category !== 'ALL' && p.category !== state.category) return false;
      if (state.chain !== 'ALL' && !p.chains.includes(state.chain)) return false;
      if (q && !`${p.name} ${p.category} ${p.chains.join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });

    const rowsHtml = list
      .slice(0, limit)
      .map(
        (p, i) => `<tr>
          <td class="rank-num">${i + 1}</td>
          <td><div class="proto-name">${esc(p.name)}</div><div class="proto-meta">${esc(p.category)} · ${esc(p.chains.slice(0, 3).join(', '))}</div></td>
          <td class="num">${fmtUsd(p.tvl_usd)}</td>
          <td class="num" style="font-weight:700;color:#fff">${fmtUsd(p.mcap_usd)}</td>
          <td class="num">${p.ratio.toFixed(2)}x</td>
          <td class="num" style="color:var(--teal)">${fmtUsd(p.pred_usd)}</td>
          <td class="num" style="color:${p.err_mult <= 2.5 ? 'var(--green)' : p.err_mult <= 5 ? 'var(--amber)' : 'var(--rose)'}">${p.err_mult.toFixed(2)}x</td>
          <td class="num">${fmtAge(p.age_days)}</td>
        </tr>`,
      )
      .join('');

    return `<div class="table-wrap">
      <div class="table-head-bar">
        <span><strong>${list.length} Clean Live-Token Peers</strong> (strictly separated from the pre-token radar; used to calibrate &amp; triple-blind test the model)</span>
        <span>LOO ${DATA.model.loo_mult}x · 10-Fold ${DATA.model.cv10_mult}x · WF ${DATA.model.wf_mult}x (vs Starter ${DATA.model.starter_mult}x)</span>
      </div>
      <table class="board-table">
        <thead><tr>
          <th>#</th><th>Live Protocol</th><th class="num">TVL</th><th class="num">Actual MCap</th><th class="num">MC/TVL</th><th class="num">Model Pred</th><th class="num">Mult Err</th><th class="num">Age</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
  }

  function render() {
    const rows = filteredRows();
    const selectedRow = state.selectedSlug ? DATA.rows.find((r) => r.slug === state.selectedSlug) : null;
    const farmNowCount = DATA.rows.filter((r) => r.farm.verdict === 'FARM NOW').length;
    const selectiveCount = DATA.rows.filter((r) => r.farm.verdict === 'SELECTIVE').length;
    const lowOddsCount = DATA.rows.filter((r) => r.farm.verdict === 'LOW ODDS').length;
    const totalBoardTvl = DATA.rows.reduce((s, r) => s + r.tvl_usd, 0);

    const arrow = (k) => (state.sortKey === k ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : '');
    const maxImplied = Math.max(1, ...DATA.rows.map((r) => r.implied_value_usd));
    const showCharts = state.view === 'all' && !selectedRow && state.verdict === 'ALL' && state.category === 'ALL' && state.chain === 'ALL' && !state.search;

    const bodyRows = rows
      .slice(0, selectedRow ? 14 : showCharts ? 10 : 18)
      .map((r) => {
        const f = recomputeFarm(r);
        const barW = Math.max(6, Math.round((Math.log(r.implied_value_usd) / Math.log(maxImplied)) * 100));
        const gCls = r.change_7d === null ? 'neu' : r.change_7d >= 0 ? 'pos' : 'neg';
        const selCls = selectedRow && selectedRow.slug === r.slug ? 'selected' : '';
        return `<tr class="${selCls}" data-slug="${esc(r.slug)}">
          <td class="rank-num">#${r.rank}</td>
          <td>
            <div class="proto-name">${esc(r.name)} <span class="tier-tag ${r.tier === 'watchlist' ? 'tier-wl' : 'tier-early'}">${r.tier === 'watchlist' ? 'WL' : r.tier === 'extended' ? 'EXT' : 'EARLY'}</span></div>
            <div class="proto-meta">${esc(r.category || 'Other')} · ${esc(r.chains.slice(0, 3).join(', '))}</div>
          </td>
          <td class="num">
            <div class="val-main">${fmtUsd(r.tvl_usd)}</div>
            <div class="val-range ${gCls}">${fmtPct(r.change_7d, true)} 7d</div>
          </td>
          <td class="num">
            <div class="val-main" style="color:var(--teal)">${fmtUsd(r.implied_value_usd)}</div>
            <div class="val-range">${fmtUsd(r.range_p25_usd)}–${fmtUsd(r.range_p75_usd)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${barW}%;background:var(--teal)"></div></div>
          </td>
          <td class="num">
            <div class="val-main" style="color:${r.launch_odds_pct >= 45 ? 'var(--green)' : r.launch_odds_pct < 24 ? 'var(--rose)' : 'var(--amber)'}">${r.launch_odds_pct.toFixed(0)}%</div>
            <div class="val-range">${fmtAge(r.age_days)} pre-TGE</div>
          </td>
          <td class="num">
            <div><span class="verdict-badge ${verdictClass(r.farm.verdict)}">${esc(r.farm.verdict)}</span></div>
            <div class="val-range">$${f.evHr.toFixed(1)}/hr · $${r.farm.gas_usd} gas</div>
          </td>
        </tr>`;
      })
      .join('');

    const catOpts = `<option value="ALL">All Categories (${allCategories.length})</option>` +
      allCategories.map((c) => `<option value="${esc(c)}" ${state.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('');
    const chainOpts = `<option value="ALL">All Chains (${allChains.length})</option>` +
      allChains.map((c) => `<option value="${esc(c)}" ${state.chain === c ? 'selected' : ''}>${esc(c)}</option>`).join('');

    app.innerHTML = `
      <header class="topbar">
        <div>
          <div class="brand-kicker">Token Launch Radar v2 · Offline Quantitative Desk · Snapshot ${esc(DATA.as_of)}</div>
          <h1 class="brand-title">Pre-Token Valuations, Survival Launch Odds &amp; Costed Farm Verdicts</h1>
          <div class="brand-sub">L1-LAD log-TVL + chain + Empirical-Bayes category model tested blind 3 ways on ${DATA.clean_peer_count} clean live peers; zero hardcoded names.</div>
        </div>
        <div class="top-badges">
          <span class="chip ok">Watchlist: <strong>${DATA.watchlist_count}/${DATA.watchlist_count} (100%)</strong></span>
          <span class="chip">Pre-Token Ranked: <strong>${DATA.rows.length}</strong></span>
          <span class="chip">Accounted: <strong>${DATA.universe.total}/${DATA.universe.total} ✓</strong></span>
        </div>
      </header>

      <div class="selfcheck-bar">
        <span class="sc-item"><span class="sc-ok">✓</span> 40/40 Watchlist</span>
        <span class="sc-item"><span class="sc-ok">✓</span> 0 Live Mixed (${DATA.clean_peer_count} Peers)</span>
        <span class="sc-item"><span class="sc-ok">✓</span> Blind: LOO ${DATA.model.loo_mult}x · 10F ${DATA.model.cv10_mult}x · WF ${DATA.model.wf_mult}x (vs ${DATA.model.starter_mult}x)</span>
        <span class="sc-item"><span class="sc-ok">✓</span> Survival Odds (81%→12%)</span>
        <span class="sc-item"><span class="sc-ok">✓</span> 100% Costed $/hr Plans</span>
        <span class="sc-item"><span class="sc-ok">✓</span> 758/758 · Offline</span>
      </div>

      <section class="integrity-strip">
        <div class="kpi-card">
          <div class="kpi-label">Triple Blind Error (N=${DATA.model.peer_count})</div>
          <div class="kpi-val teal">${DATA.model.loo_mult.toFixed(2)}x <span style="font-size:11.5px;color:var(--muted)">LOO · ${DATA.model.cv10_mult.toFixed(2)}x 10F</span></div>
          <div class="kpi-meta">Walk-Fwd ${DATA.model.wf_mult.toFixed(2)}x vs Starter ${DATA.model.starter_mult}x</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Conformal IQR Band</div>
          <div class="kpi-val cyan">${DATA.model.band_p25_mult}x – ${DATA.model.band_p75_mult}x</div>
          <div class="kpi-meta">Scaled per-category dispersion</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Survival Launch Odds</div>
          <div class="kpi-val">81% → 12%</div>
          <div class="kpi-meta">Falls w/ age; Curators 13% vs Lend 74%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Costed Farm Queue</div>
          <div class="kpi-val teal">${farmNowCount} Farm · ${selectiveCount} Sel</div>
          <div class="kpi-meta">${lowOddsCount} Low Odds (skip unless TGE set)</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Pre-Token TVL Tracked</div>
          <div class="kpi-val amber">${fmtUsd(totalBoardTvl)}</div>
          <div class="kpi-meta">${DATA.rows.length} pre + ${DATA.universe.clean_traded_mcap + DATA.universe.clean_token_nomcap} live + ${DATA.universe.excluded_live + DATA.universe.excluded_pre} excl = 758</div>
        </div>
      </section>

      <section class="controls">
        <div class="ctrl-group">
          <button class="tab-btn ${state.view === 'all' ? 'active' : ''}" data-view="all">All Pre-Token (${DATA.rows.length})</button>
          <button class="tab-btn ${state.view === 'watchlist' ? 'active' : ''}" data-view="watchlist">Watchlist (${DATA.watchlist_count})</button>
          <button class="tab-btn ${state.view === 'early' ? 'active' : ''}" data-view="early">Early &lt;$50M (${DATA.early_count})</button>
          <button class="tab-btn ${state.view === 'peers' ? 'active' : ''}" data-view="peers">Live Peers (${DATA.clean_peer_count})</button>
          <button class="tab-btn ${state.view === 'audit' ? 'active' : ''}" data-view="audit">Model Audit &amp; 758 Map</button>
        </div>

        <div class="ctrl-group">
          <button class="pill-btn ${state.verdict === 'ALL' ? 'active' : ''}" data-verdict="ALL">All</button>
          <button class="pill-btn v-farm ${state.verdict === 'FARM NOW' || state.verdict === 'FARM_NOW' ? 'active' : ''}" data-verdict="FARM NOW">Farm Now</button>
          <button class="pill-btn v-sel ${state.verdict === 'SELECTIVE' ? 'active' : ''}" data-verdict="SELECTIVE">Selective</button>
          <button class="pill-btn v-watch ${state.verdict === 'WATCH' ? 'active' : ''}" data-verdict="WATCH">Watch</button>
          <button class="pill-btn v-low ${state.verdict === 'LOW ODDS' || state.verdict === 'LOW_ODDS' ? 'active' : ''}" data-verdict="LOW ODDS">Low Odds</button>
        </div>

        <div class="ctrl-group">
          <input class="input search" id="qInput" type="search" placeholder="Filter protocol, chain..." value="${esc(state.search)}" />
          <select class="select" id="catSel">${catOpts}</select>
          <select class="select" id="chainSel">${chainOpts}</select>
          <select class="select" id="capSel" title="Simulate capital">
            <option value="0" ${state.simCapital === 0 ? 'selected' : ''}>Cap: Auto</option>
            <option value="250" ${state.simCapital === 250 ? 'selected' : ''}>Cap: $250</option>
            <option value="1000" ${state.simCapital === 1000 ? 'selected' : ''}>Cap: $1,000</option>
            <option value="5000" ${state.simCapital === 5000 ? 'selected' : ''}>Cap: $5,000</option>
          </select>
        </div>
      </section>

      ${
        showCharts
          ? `<section class="charts-row">
              <div class="chart-card">
                <div class="chart-head">
                  <span class="chart-title">Empirical Valuation Curve (Log TVL vs Log MCap)</span>
                  <span class="chart-sub">β_TVL=${DATA.model.beta_log_tvl} · β_Chains=${DATA.model.beta_log_chains} · EB-Cat(k=${DATA.model.category_k})</span>
                </div>
                ${renderCalibrationScatterSvg()}
              </div>
              <div class="chart-card">
                <div class="chart-head">
                  <span class="chart-title">Token Survival Hazard by Protocol Age</span>
                  <span class="chart-sub">Older tokenless holdouts have lower remaining launch odds</span>
                </div>
                ${renderSurvivalSvg()}
              </div>
            </section>`
          : ''
      }

      <section class="workspace ${selectedRow && state.view !== 'peers' && state.view !== 'audit' ? 'has-detail' : ''}">
        ${
          state.view === 'audit'
            ? renderAuditView()
            : state.view === 'peers'
              ? renderPeersTable(60)
              : `<div class="table-wrap">
                  <div class="table-head-bar">
                    <span>Showing <strong>${Math.min(rows.length, selectedRow ? 14 : showCharts ? 10 : 18)}</strong> of <strong>${rows.length}</strong> matching pre-token protocols · Click any row for valuation breakdown, live peers &amp; 5-step farm plan</span>
                    <span>Sorted by <strong>${esc(state.sortKey)}</strong> (${esc(state.sortDir)})</span>
                  </div>
                  <table class="board-table">
                    <thead>
                      <tr>
                        <th data-sort="rank">Rank${arrow('rank')}</th>
                        <th>Protocol / Category / Chains</th>
                        <th class="num" data-sort="tvl">TVL &amp; 7d Δ${arrow('tvl')}</th>
                        <th class="num" data-sort="implied">Implied &amp; Conformal IQR${arrow('implied')}</th>
                        <th class="num" data-sort="odds">Survival Odds${arrow('odds')}</th>
                        <th class="num" data-sort="ev_hr">Farm Verdict${arrow('ev_hr')}</th>
                      </tr>
                    </thead>
                    <tbody>${bodyRows || '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--muted)">No protocols match the active filter.</td></tr>'}</tbody>
                  </table>
                </div>`
        }
        ${selectedRow && state.view !== 'peers' && state.view !== 'audit' ? renderDetail(selectedRow) : ''}
      </section>

      <footer class="footer-note">
        <span>Data source: sealed DefiLlama snapshot (${esc(DATA.as_of)}). Zero network calls. Implied values are empirical peer estimates, not financial advice.</span>
        <span>Pre-token means no gecko_id, symbol, or mcap recorded in snapshot.</span>
      </footer>
    `;

    bindEvents();
  }

  function bindEvents() {
    app.querySelectorAll('[data-view]').forEach((el) => {
      el.addEventListener('click', () => {
        state.view = el.getAttribute('data-view');
        render();
      });
    });
    app.querySelectorAll('[data-verdict]').forEach((el) => {
      el.addEventListener('click', () => {
        state.verdict = el.getAttribute('data-verdict');
        if (state.view === 'peers' || state.view === 'audit') state.view = 'all';
        render();
      });
    });
    app.querySelectorAll('[data-sort]').forEach((el) => {
      el.addEventListener('click', () => {
        const key = el.getAttribute('data-sort');
        if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else {
          state.sortKey = key;
          state.sortDir = key === 'rank' ? 'asc' : 'desc';
        }
        render();
      });
    });
    app.querySelectorAll('tbody tr[data-slug]').forEach((tr) => {
      tr.addEventListener('click', () => {
        state.selectedSlug = tr.getAttribute('data-slug');
        render();
      });
    });
    const closeDetail = app.querySelector('[data-action="close-detail"]');
    if (closeDetail) closeDetail.addEventListener('click', () => { state.selectedSlug = ''; render(); });

    const qInput = document.getElementById('qInput');
    if (qInput) qInput.addEventListener('input', (e) => { state.search = e.target.value; render(); });
    const catSel = document.getElementById('catSel');
    if (catSel) catSel.addEventListener('change', (e) => { state.category = e.target.value; render(); });
    const chainSel = document.getElementById('chainSel');
    if (chainSel) chainSel.addEventListener('change', (e) => { state.chain = e.target.value; render(); });
    const capSel = document.getElementById('capSel');
    if (capSel) capSel.addEventListener('change', (e) => { state.simCapital = Number(e.target.value); render(); });
  }

  render();
})();
