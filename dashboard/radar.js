(() => {
  const DATA = window.RADAR_DATA;
  const app = document.getElementById('app');
  if (!DATA) {
    app.textContent = 'Missing offline radar dataset (data.js).';
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const state = {
    view: params.get('tier') || 'all', // all | watchlist | early | peers
    verdict: params.get('verdict') || 'ALL', // ALL | FARM NOW | SELECTIVE | WATCH | LOW ODDS
    category: params.get('cat') || 'ALL',
    chain: params.get('chain') || 'ALL',
    search: params.get('q') || '',
    sortKey: params.get('sort') || 'rank',
    sortDir: params.get('dir') || 'asc',
    selectedSlug: params.get('detail') || '',
    showAudit: params.get('audit') === '1',
    simCapital: Number(params.get('cap')) || 0, // 0 = use row default capital
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
    const sign = signed && n > 0 ? '+' : '';
    return `${sign}${n.toFixed(1)}%`;
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
      if (state.verdict !== 'ALL') {
        const norm = state.verdict.replace(/_/g, ' ');
        if (r.farm.verdict !== norm) return false;
      }
      if (state.category !== 'ALL' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'ALL' && !r.chains.includes(state.chain)) return false;
      if (q) {
        const hay = `${r.name} ${r.slug} ${r.category || ''} ${r.chains.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const dir = state.sortDir === 'desc' ? -1 : 1;
    list = [...list].sort((a, b) => {
      let va = 0;
      let vb = 0;
      if (state.sortKey === 'rank') { va = a.rank; vb = b.rank; }
      else if (state.sortKey === 'implied') { va = a.implied_value_usd; vb = b.implied_value_usd; }
      else if (state.sortKey === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (state.sortKey === 'change_7d') { va = a.change_7d ?? -999; vb = b.change_7d ?? -999; }
      else if (state.sortKey === 'age') { va = a.age_days ?? -1; vb = b.age_days ?? -1; }
      else if (state.sortKey === 'odds') { va = a.launch_odds_pct; vb = b.launch_odds_pct; }
      else if (state.sortKey === 'ev_hr') { va = recomputeFarm(a).evHr; vb = recomputeFarm(b).evHr; }
      else if (state.sortKey === 'expected') { va = a.expected_value_usd; vb = b.expected_value_usd; }
      if (va !== vb) return (va - vb) * dir;
      return a.rank - b.rank;
    });
    return list;
  }

  function nearestPeers(row) {
    const sameCat = DATA.peers.filter((p) => p.category === (row.category || 'Other'));
    const pool = sameCat.length >= 3 ? sameCat : DATA.peers;
    const logT = Math.log(Math.max(1, row.tvl_usd));
    return [...pool]
      .sort((a, b) => Math.abs(Math.log(a.tvl_usd) - logT) - Math.abs(Math.log(b.tvl_usd) - logT))
      .slice(0, 4);
  }

  function renderAuditPanel() {
    const m = DATA.model;
    const abRows = m.ablation
      .map(
        (a) => `<tr>
          <td><strong>${esc(a.label)}</strong><div style="color:var(--muted);font-size:10.4px">${esc(a.note)}</div></td>
          <td>${a.loo_mult.toFixed(2)}x</td>
          <td>${a.wf_mult.toFixed(2)}x</td>
          <td><span class="dec-badge dec-${esc(a.decision)}">${esc(a.decision)}</span></td>
        </tr>`,
      )
      .join('');

    const incRows = DATA.cat_incidence
      .slice(0, 8)
      .map(
        (c) => `<tr>
          <td>${esc(c.category)}</td>
          <td>${c.with_token}/${c.total}</td>
          <td style="color:${c.pct >= 55 ? 'var(--green)' : c.pct < 25 ? 'var(--rose)' : 'var(--amber)'}">${c.pct.toFixed(1)}%</td>
        </tr>`,
      )
      .join('');

    return `<section class="audit-panel">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="sec-h" style="margin:0">Double-Blind Peer Calibration &amp; Feature Ablation (N=${m.peer_count} Clean Traded Peers)</span>
        <span style="font-family:var(--mono);font-size:10.5px;color:var(--muted)">LOO IQR Band: [${m.band_p25_mult}x .. ${m.band_p75_mult}x] · P10–P90: [${m.band_p10_mult}x .. ${m.band_p90_mult}x]</span>
      </div>
      <div class="audit-grid">
        <div>
          <div class="formula-box">ln(Implied) = ${m.intercept} + ${m.beta_log_tvl}·ln(TVL) ${m.beta_log_chains >= 0 ? '+' : '−'} ${Math.abs(m.beta_log_chains)}·ln(Chains)${m.beta_flow_7d !== 0 ? ` + ${m.beta_flow_7d}·Flow7d` : ''} + EB_Cat(k=${m.category_k})</div>
          <table class="mini-table">
            <thead><tr><th>Specification</th><th>LOO Err</th><th>Walk-Fwd</th><th>Verdict</th></tr></thead>
            <tbody>${abRows}</tbody>
          </table>
        </div>
        <div>
          <div style="font-family:var(--mono);font-size:10.5px;color:var(--cyan);margin-bottom:5px">EMPIRICAL TOKEN INCIDENCE BY CATEGORY (N=437 CLEAN)</div>
          <table class="mini-table">
            <thead><tr><th>Category</th><th>Live / Total</th><th>Token Rate</th></tr></thead>
            <tbody>${incRows}</tbody>
          </table>
        </div>
      </div>
    </section>`;
  }

  function renderDetail(row) {
    const f = recomputeFarm(row);
    const peers = nearestPeers(row);
    const tvlUsd = Math.round(Math.exp(row.decomp.tvl_term));
    const chainMult = Math.exp(row.decomp.chain_term);
    const catMult = Math.exp(row.decomp.cat_term);
    const flowMult = Math.exp(row.decomp.flow_term);

    const peerHtml = peers
      .slice(0, 3)
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
            <span class="tier-tag ${row.tier === 'watchlist' ? 'tier-wl' : 'tier-early'}">${row.tier === 'watchlist' ? 'WATCHLIST' : 'EARLY RADAR'} · RANK #${row.rank}</span>
            <span class="verdict-badge ${verdictClass(row.farm.verdict)}">${esc(row.farm.verdict)}</span>
          </div>
          <div class="detail-title">${esc(row.name)}</div>
          <div style="font-size:11.2px;color:var(--muted);margin-top:2px">${esc(row.category || 'Other')} · Chains: ${esc(row.chains.slice(0, 5).join(', '))} · Listed ${esc(row.listed_at || 'unknown')} (${fmtAge(row.age_days)} pre-token)</div>
        </div>
        <button class="close-btn" data-action="close-detail">Close</button>
      </div>

      <div class="detail-kpis">
        <div class="dk">
          <div class="dk-l">Implied Value</div>
          <div class="dk-v" style="color:var(--teal)">${fmtUsd(row.implied_value_usd)}</div>
        </div>
        <div class="dk">
          <div class="dk-l">Honest IQR (50%)</div>
          <div class="dk-v" style="font-size:12px">${fmtUsd(row.range_p25_usd)}–${fmtUsd(row.range_p75_usd)}</div>
        </div>
        <div class="dk">
          <div class="dk-l">Launch Odds</div>
          <div class="dk-v" style="color:${row.launch_odds_pct >= 55 ? 'var(--green)' : row.launch_odds_pct < 25 ? 'var(--rose)' : 'var(--amber)'}">${row.launch_odds_pct.toFixed(1)}%</div>
        </div>
        <div class="dk">
          <div class="dk-l">Farm EV / Hr</div>
          <div class="dk-v" style="color:${f.evHr >= 20 ? 'var(--green)' : f.evHr >= 6 ? 'var(--cyan)' : 'var(--rose)'}">$${f.evHr.toFixed(1)}/hr</div>
        </div>
      </div>

      <div class="sec-h">Model Decomposition (Snapshot Figures Only)</div>
      <div class="decomp-grid">
        <div class="decomp-cell"><div style="color:var(--muted)">TVL Curve</div><strong>${fmtUsd(tvlUsd)}</strong></div>
        <div class="decomp-cell"><div style="color:var(--muted)">Chain Adj (${row.chains.length})</div><strong>${chainMult.toFixed(2)}x</strong></div>
        <div class="decomp-cell"><div style="color:var(--muted)">Cat EB (${row.decomp.cat_peers}p)</div><strong>${catMult.toFixed(2)}x</strong></div>
        <div class="decomp-cell"><div style="color:var(--muted)">7d Flow (${fmtPct(row.change_7d, true)})</div><strong>${flowMult.toFixed(2)}x</strong></div>
      </div>

      <div class="sec-h">Nearest Live Traded Peers (Reality Check)</div>
      <table class="mini-table">
        <thead><tr><th>Live Peer</th><th>TVL</th><th>Actual MCap</th><th>MC/TVL</th><th>Model Pred</th></tr></thead>
        <tbody>${peerHtml}</tbody>
      </table>

      <div class="sec-h">Costed Farm Playbook (${fmtUsd(f.cap)} Capital · $${row.farm.gas_usd} Gas · ${row.farm.total_hours}h · ${row.farm.hold_days}d Hold)</div>
      <div class="rationale-box">${esc(row.farm.rationale)} <strong>Risk-adj. net EV: $${f.ev.toFixed(1)}</strong> (Gross if launched: ~$${f.estAirdrop.toFixed(0)} at ${state.simAllocPct}% allocation; Cat rate ${row.cat_token_rate_pct}% / Age rate ${row.age_token_rate_pct}%).</div>
      <ol class="step-list">${stepHtml}</ol>
    </aside>`;
  }

  function renderPeersTable() {
    const q = state.search.trim().toLowerCase();
    const list = DATA.peers.filter((p) => {
      if (state.category !== 'ALL' && p.category !== state.category) return false;
      if (state.chain !== 'ALL' && !p.chains.includes(state.chain)) return false;
      if (q && !`${p.name} ${p.category} ${p.chains.join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });

    const rowsHtml = list
      .slice(0, 60)
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
        <span><strong>${list.length} Clean Live-Token Peers</strong> (strictly separated from the pre-token radar; used to fit &amp; blind-test the model)</span>
        <span>Median LOO Error: ${DATA.model.loo_mult}x vs Starter ${DATA.model.starter_mult}x</span>
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

    const bodyRows = rows
      .slice(0, selectedRow ? 18 : 25)
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
            <div class="val-main" style="color:${r.launch_odds_pct >= 55 ? 'var(--green)' : r.launch_odds_pct < 25 ? 'var(--rose)' : 'var(--amber)'}">${r.launch_odds_pct.toFixed(0)}%</div>
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
          <div class="brand-kicker">Token Launch Radar · Offline Quantitative Desk · Snapshot ${esc(DATA.as_of)}</div>
          <h1 class="brand-title">Pre-Token Protocol Valuations &amp; Costed Farm Verdicts</h1>
          <div class="brand-sub">Huber-IRLS log-TVL + chain + Empirical-Bayes category model calibrated on ${DATA.clean_peer_count} clean traded peers; live tokens strictly isolated.</div>
        </div>
        <div class="top-badges">
          <span class="chip ok">Watchlist Coverage: <strong>${DATA.watchlist_count}/${DATA.watchlist_count} (100%)</strong></span>
          <span class="chip">Pre-Token Ranked: <strong>${DATA.rows.length}</strong> (${DATA.early_count} early + ${DATA.extended_count} ext)</span>
          <span class="chip">Live Peers Separated: <strong>${DATA.clean_peer_count}</strong></span>
        </div>
      </header>

      <section class="integrity-strip">
        <div class="kpi-card">
          <div class="kpi-label">LOO Blind Error (N=${DATA.model.peer_count})</div>
          <div class="kpi-val teal">${DATA.model.loo_mult.toFixed(2)}x <span style="font-size:11.5px;color:var(--muted)">vs ${DATA.model.starter_mult}x</span></div>
          <div class="kpi-meta">Starter cut by ${Math.round((1 - DATA.model.loo_mult / DATA.model.starter_mult) * 100)}% (MAE ${DATA.model.loo_mae})</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Walk-Forward Blind Test</div>
          <div class="kpi-val cyan">${DATA.model.wf_mult.toFixed(2)}x <span style="font-size:11.5px;color:var(--muted)">out-of-time</span></div>
          <div class="kpi-meta">Oldest 65% fit → newest 35% blind</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Honest Valuation Band</div>
          <div class="kpi-val">${DATA.model.band_p25_mult}x – ${DATA.model.band_p75_mult}x</div>
          <div class="kpi-meta">Empirical LOO 50% IQR on every row</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Actionable Farm Queue</div>
          <div class="kpi-val teal">${farmNowCount} Farm Now · ${selectiveCount} Sel</div>
          <div class="kpi-meta">${lowOddsCount} flagged Low Odds (e.g. Curators 13%)</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Pre-Token TVL Tracked</div>
          <div class="kpi-val amber">${fmtUsd(totalBoardTvl)}</div>
          <div class="kpi-meta">${DATA.universe_total} scanned = ${DATA.rows.length} pre + ${DATA.clean_peer_count} peers + ${DATA.excluded_count} excl</div>
        </div>
      </section>

      <section class="controls">
        <div class="ctrl-group">
          <button class="tab-btn ${state.view === 'all' ? 'active' : ''}" data-view="all">All Pre-Token (${DATA.rows.length})</button>
          <button class="tab-btn ${state.view === 'watchlist' ? 'active' : ''}" data-view="watchlist">Watchlist (${DATA.watchlist_count})</button>
          <button class="tab-btn ${state.view === 'early' ? 'active' : ''}" data-view="early">Early &lt;$50M (${DATA.early_count})</button>
          <button class="tab-btn ${state.view === 'peers' ? 'active' : ''}" data-view="peers">Live Peers (${DATA.clean_peer_count})</button>
          <button class="tab-btn ${state.showAudit ? 'active' : ''}" data-action="toggle-audit">${state.showAudit ? 'Hide' : 'Show'} Model Audit</button>
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

      ${state.showAudit ? renderAuditPanel() : ''}

      <section class="workspace ${selectedRow && state.view !== 'peers' ? 'has-detail' : ''}">
        ${
          state.view === 'peers'
            ? renderPeersTable()
            : `<div class="table-wrap">
                <div class="table-head-bar">
                  <span>Showing <strong>${Math.min(rows.length, selectedRow ? 18 : 25)}</strong> of <strong>${rows.length}</strong> matching pre-token protocols · Click any row for valuation waterfall, live peers &amp; 5-step farm plan</span>
                  <span>Sorted by <strong>${esc(state.sortKey)}</strong> (${esc(state.sortDir)})</span>
                </div>
                <table class="board-table">
                  <thead>
                    <tr>
                      <th data-sort="rank">Rank${arrow('rank')}</th>
                      <th>Protocol / Category / Chains</th>
                      <th class="num" data-sort="tvl">TVL &amp; 7d Δ${arrow('tvl')}</th>
                      <th class="num" data-sort="implied">Implied Value &amp; IQR${arrow('implied')}</th>
                      <th class="num" data-sort="odds">Launch Odds${arrow('odds')}</th>
                      <th class="num" data-sort="ev_hr">Farm Verdict${arrow('ev_hr')}</th>
                    </tr>
                  </thead>
                  <tbody>${bodyRows || '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--muted)">No protocols match the active filter.</td></tr>'}</tbody>
                </table>
              </div>`
        }
        ${selectedRow && state.view !== 'peers' ? renderDetail(selectedRow) : ''}
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
        if (state.view === 'peers') state.view = 'all';
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
    const toggleAudit = app.querySelector('[data-action="toggle-audit"]');
    if (toggleAudit) toggleAudit.addEventListener('click', () => { state.showAudit = !state.showAudit; render(); });
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
