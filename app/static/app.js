/* AEDI console — all data comes from the Flask API, which in turn calls the
   real pipeline / evaluation / fixtures modules. Nothing here is mocked. */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = (u, o) => fetch(u, o).then(r => r.json());
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const pct = v => v == null ? 'n/a' : Math.round(v * 100) + '%';
const inr = v => 'INR ' + Math.round(v).toLocaleString('en-IN');
const nice = s => String(s ?? '').replace(/_/g, ' ');

let HEALTH = null, CASES = [], SEL = null, FILTER = 'all', QUERY = '';

/* ── tabs ── */
$$('#tabs button').forEach(b => b.onclick = () => {
  $$('#tabs button').forEach(x => x.classList.toggle('active', x === b));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'evaluation') loadEval();
  if (b.dataset.tab === 'adversarial') loadAdversarial();
});

/* ── boot ── */
(async function boot() {
  HEALTH = await api('/api/health');
  const st = $('#status');
  st.className = 'status ' + HEALTH.mode;
  $('#status-text').textContent = HEALTH.mode === 'live'
    ? `LIVE · ${HEALTH.model}`
    : 'REPLAY · no API key — deterministic + committed results';

  // default both split pickers to whichever split actually has predictions
  const withPreds = Object.entries(HEALTH.splits).find(([, v]) => v.has_predictions);
  if (withPreds) { $('#case-split').value = withPreds[0]; $('#eval-split').value = withPreds[0]; }
  for (const [name, v] of Object.entries(HEALTH.splits)) {
    const o = $(`#case-split option[value="${name}"]`);
    if (o) o.textContent = `${name} (${v.cases} cases${v.has_predictions ? '' : ' · no predictions'})`;
  }
  renderKpis();
  loadCases();
})();

/* ── overview KPIs (computed from the live evaluation endpoint) ── */
async function renderKpis() {
  const el = $('#kpis');
  el.innerHTML = '<div class="loading">computing…</div>';
  const split = $('#eval-split').value;
  const m = await api('/api/metrics?split=' + split);
  if (!m.available) { el.innerHTML = `<div class="loading">${esc(m.message)}</div>`; return; }
  const a = m.blocks[0];
  el.innerHTML = `
    <div class="kpi ok"><span>False positives</span><b>${a.cost.n_false_positive}</b>
      <small>contested a case that should have been accepted</small></div>
    <div class="kpi ok"><span>False negatives</span><b>${a.cost.n_false_negative}</b>
      <small>accepted a case that was winnable</small></div>
    <div class="kpi"><span>Coverage</span><b>${pct(a.coverage)}</b>
      <small>decided automatically, not routed to a human</small></div>
    <div class="kpi warn"><span>Bypassed reviews</span><b>${a.cost.n_bypassed_review}</b>
      <small>the disclosed gap — risky cases auto-decided anyway</small></div>`;
  IMPACT = m; renderImpact();
}

/* Impact projector. Every rate below is measured on the split currently
   selected; only the volume and minutes-per-review are the viewer's input. */
let IMPACT = null;
function renderImpact() {
  if (!IMPACT) return;
  const agent = IMPACT.blocks[0], allrev = IMPACT.blocks[2];
  const vol = Math.max(1, +$('#vol').value || 0);
  const mins = Math.max(1, +$('#mins').value || 0);

  const perCaseAgent = agent.cost.cost_per_100_inr / 100;
  const perCaseToday = allrev.cost.cost_per_100_inr / 100;   // review every dispute
  const saveMonth = (perCaseToday - perCaseAgent) * vol;
  const reviewed = Math.round(vol * (1 - agent.coverage));
  const hoursSaved = Math.round((vol - reviewed) * mins / 60);
  const exposure = agent.cost.bypassed_review_exposure_per_100_inr / 100 * vol;

  $('#impact-out').innerHTML = `
    <div class="iout"><span>Auto-decided</span><b>${(vol - reviewed).toLocaleString('en-IN')}</b></div>
    <div class="iout"><span>Still sent to a human</span><b>${reviewed.toLocaleString('en-IN')}</b></div>
    <div class="iout save"><span>Analyst hours freed / month</span><b>${hoursSaved.toLocaleString('en-IN')}</b></div>
    <div class="iout save"><span>Review cost avoided / month</span><b>${inr(saveMonth)}</b></div>
    <div class="iout risk"><span>Unpriced risk carried / month</span><b>${inr(exposure)}</b></div>`;

  $('#impact-note').innerHTML =
    `Measured on <b>${IMPACT.split}</b> (n=${agent.n}): coverage <b>${pct(agent.coverage)}</b>, ` +
    `<b>${inr(perCaseAgent)}</b>/dispute versus <b>${inr(perCaseToday)}</b> to review every one by hand. ` +
    `The amber number is the honest counterweight — the modelled exposure from risky cases the agent ` +
    `auto-decided instead of escalating. It is deliberately not netted off the saving.`;
}
['#vol', '#mins'].forEach(s => { const el = $(s); if (el) el.oninput = renderImpact; });

/* ── case explorer ── */
$('#case-split').onchange = () => { SEL = null; loadCases(); };
$('#case-search').oninput = e => { QUERY = e.target.value.toLowerCase(); renderList(); };
$$('#case-filters button').forEach(b => b.onclick = () => {
  $$('#case-filters button').forEach(x => x.classList.toggle('active', x === b));
  FILTER = b.dataset.f; renderList();
});

async function loadCases() {
  $('#caselist').innerHTML = '<div class="loading">loading…</div>';
  const d = await api('/api/cases?split=' + $('#case-split').value);
  CASES = d.cases; renderList();
}

function visible() {
  return CASES.filter(c => {
    if (FILTER === 'risk' && !c.risk_flags.length) return false;
    if (FILTER === 'disagree' && c.agrees !== false) return false;
    if (!QUERY) return true;
    return (c.case_id + ' ' + c.merchant_id + ' ' + c.reason_code).toLowerCase().includes(QUERY);
  });
}

function renderList() {
  const rows = visible();
  $('#caselist').innerHTML = rows.length ? rows.map(c => `
    <div class="crow ${SEL === c.case_id ? 'sel' : ''}" data-id="${c.case_id}">
      <div class="crow-top">
        <span class="crow-id">${c.case_id}</span>
        <span class="crow-amt">${Number(c.amount).toLocaleString('en-IN')} ${c.currency}</span>
      </div>
      <div class="crow-bot">
        <span class="tag t-rc">${c.reason_code}</span>
        ${c.ground_truth ? `<span class="tag t-${c.ground_truth}">${nice(c.ground_truth)}</span>` : ''}
        ${c.risk_flags.length ? `<span class="tag t-risk">${c.risk_flags.length} risk</span>` : ''}
        ${c.agrees === false ? '<span class="x">✕ disagrees</span>'
          : c.agrees === true ? '<span class="ok">✓</span>' : ''}
      </div>
    </div>`).join('') : '<div class="loading">no cases match</div>';

  $$('.crow').forEach(r => r.onclick = () => selectCase(r.dataset.id));
}

async function selectCase(id) {
  SEL = id; renderList();
  const pane = $('#casedetail');
  pane.innerHTML = '<div class="loading">loading case…</div>';
  const split = $('#case-split').value;
  const d = await api(`/api/case/${split}/${id}`);
  const s = d.signals, c = d.case, m = s.merchant || {};
  const req = new Set(s.required_types), present = new Set(s.present_types);

  pane.innerHTML = `
    <div class="panel">
      <div class="decision-hd" style="margin-bottom:16px">
        <h4 style="font-size:20px">${c.case_id}</h4>
        <span class="tag t-rc">${c.reason_code} · ${esc(d.reason_requirement.network || '')}</span>
        ${d.ground_truth ? `<span class="tag t-${d.ground_truth}">truth: ${nice(d.ground_truth)}</span>` : ''}
      </div>
      <div class="dgrid">
        <div>
          <h3>Transaction</h3>
          <dl class="kv">
            <dt>Disputed amount</dt><dd>${Number(c.amount).toLocaleString('en-IN')} ${c.currency}</dd>
            <dt>Original amount</dt><dd>${Number(c.original_amount).toLocaleString('en-IN')} ${c.currency}</dd>
            <dt>Date</dt><dd>${c.transaction_date}</dd>
            <dt>Method</dt><dd>${c.payment_method}</dd>
            <dt>Dispute</dt><dd>${esc(d.reason_requirement.description || '—')}</dd>
          </dl>
        </div>
        <div>
          <h3>Merchant ${c.merchant_id}</h3>
          <dl class="kv">
            <dt>Chargeback rate 30d</dt><dd>${m.chargeback_rate_30d ?? '—'}</dd>
            <dt>Chargeback rate 90d</dt><dd>${m.chargeback_rate_90d ?? '—'}</dd>
            <dt>Transactions 30d</dt><dd>${m.total_transactions_30d ?? '—'}</dd>
            <dt>Prior contest win rate</dt><dd>${m.prior_contest_win_rate ?? '—'}</dd>
            <dt>Flags</dt><dd>${esc(m.history_flags || 'none')}</dd>
          </dl>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>Deterministic risk signals <span class="hint">— computed by risk_signals.py, never by the model</span></h3>
      <div class="signals">
        <div class="sig ${s.evidence_sufficiency === 'sufficient' ? 'off' : 'on'}">
          <span>Evidence sufficiency</span><b>${nice(s.evidence_sufficiency)}</b></div>
        <div class="sig ${s.amount_anomaly ? 'on' : 'off'}">
          <span>Amount anomaly</span><b>${s.amount_anomaly}</b></div>
        <div class="sig ${s.merchant_repeat_pattern ? 'on' : 'off'}">
          <span>Merchant repeat pattern</span><b>${s.merchant_repeat_pattern}</b></div>
      </div>
    </div>

    <div class="panel">
      <h3>Evidence submitted <span class="hint">— IDs assigned by the pipeline, not the model</span></h3>
      <div class="reqline">
        ${[...req].map(t => `<span class="tag ${present.has(t) ? 't-contest' : 't-risk'}">
            ${present.has(t) ? '✓' : '✕'} ${t}</span>`).join('') || '<span class="tag t-miss">no requirement on file</span>'}
      </div>
      <div id="evlist">
        ${s.evidence_items.length ? s.evidence_items.map(e => `
          <div class="evrow" data-ev="${e.evidence_id}">
            <span class="evid">${e.evidence_id}</span>
            <div><div class="evtype">${esc(e.type)}</div><div class="evdesc">${esc(e.description)}</div></div>
          </div>`).join('') : '<div class="hint">No evidence submitted at all.</div>'}
      </div>
    </div>

    <div class="panel">
      <h3>Merchant narrative <span class="hint">— untrusted input</span></h3>
      <div class="narrative">${esc(c.merchant_narrative || '[no narrative submitted]')}</div>
    </div>

    <div class="panel">
      <h3>Run the agent</h3>
      <div class="runbar">
        <button class="btn" id="run-replay">▶ Replay committed decision</button>
        <button class="btn ghost" id="run-live" ${HEALTH.live_capable ? '' : 'disabled'}>
          ⚡ Run live${HEALTH.live_capable ? '' : ' (needs GROQ_API_KEY)'}</button>
        <span class="hint" id="run-hint"></span>
      </div>
      <div id="runout"></div>
    </div>`;

  $('#run-replay').onclick = () => runAgent(split, id, 'replay');
  const rl = $('#run-live'); if (rl && HEALTH.live_capable) rl.onclick = () => runAgent(split, id, 'live');
}

async function runAgent(split, case_id, mode) {
  const out = $('#runout'), hint = $('#run-hint');
  $$('.runbar .btn').forEach(b => b.disabled = true);
  hint.textContent = mode === 'live' ? 'calling the model…' : 'replaying…';
  out.innerHTML = '';

  let d;
  try {
    d = await api('/api/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ split, case_id, mode })
    });
  } catch (e) { d = { error: String(e) }; }

  $$('.runbar .btn').forEach(b => b.disabled = false);
  if (!HEALTH.live_capable) { const r = $('#run-live'); if (r) r.disabled = true; }
  hint.textContent = '';

  if (d.error) { out.innerHTML = `<div class="unavailable">${esc(d.error)}</div>`; return; }

  // highlight the evidence the agent actually cited
  $$('#evlist .evrow').forEach(r => r.classList.toggle('cited', d.cited_evidence_ids.includes(r.dataset.ev)));

  const r = d.result;
  out.innerHTML = `
    <ul class="trace">${d.trace.map((t, i) => `
      <li style="animation-delay:${i * 0.13}s">
        <span class="badge ${t.kind === 'deterministic' ? 'det' : t.kind === 'cache' ? 'cache' : 'model'}">${t.kind}</span>
        <div><b>${esc(t.step)}</b><p>${esc(t.detail)}</p></div>
      </li>`).join('')}</ul>

    <div class="decision ${r.decision}" style="animation:fade .4s ${d.trace.length * 0.13}s both">
      <div class="decision-hd">
        <h4>${nice(r.decision)}</h4>
        ${d.ground_truth ? `<span class="verdict ${d.agrees ? 'match' : 'miss'}">
          ${d.agrees ? '✓ matches ground truth' : '✕ ground truth: ' + nice(d.ground_truth)}</span>` : ''}
        <span class="tag t-rc">${d.source === 'live' ? 'live model call' : 'committed run'}</span>
        <div class="conf"><span>confidence</span><b>${r.confidence != null ? r.confidence.toFixed(2) : '—'}</b></div>
      </div>
      <div class="reqline">
        <span class="tag t-rc">sufficiency: ${nice(r.evidence_sufficiency)}</span>
        ${(r.risk_flags || []).map(f => `<span class="tag t-risk">${f}</span>`).join('')}
        ${d.cited_evidence_ids.map(e => `<span class="tag t-contest">cited ${e}</span>`).join('') ||
          '<span class="tag t-miss">no evidence cited</span>'}
      </div>
      <div class="reason">${esc(r.reason)}</div>
    </div>`;
}

/* ── evaluation ── */
$('#eval-split').onchange = () => { loadEval(); renderKpis(); };

async function loadEval() {
  const body = $('#evalbody');
  body.innerHTML = '<div class="loading">running the evaluation harness…</div>';
  const m = await api('/api/metrics?split=' + $('#eval-split').value);
  if (!m.available) {
    body.innerHTML = `<div class="unavailable">${esc(m.message)}<br>
      <code>python code/main.py --input dataset/${m.split}/cases.csv --output dataset/${m.split}/output.csv</code></div>`;
    return;
  }
  const D = m.decision_values;
  body.innerHTML = m.blocks.map(b => {
    const total = Object.values(b.matrix).reduce((s, r) => s + Object.values(r).reduce((a, x) => a + x, 0), 0);
    return `
    <div class="panel evalblock">
      <div class="evalhd"><h3>${esc(b.name)}</h3><small>n = ${b.n} scored</small></div>
      <div class="evalgrid">
        <div>
          <table class="cm">
            <tr><th></th>${D.map(p => `<th>${nice(p)}</th>`).join('')}</tr>
            ${D.map(a => `<tr><th class="rowh">${nice(a)}</th>${D.map(p => {
              const v = b.matrix[a][p];
              const cls = a === p ? 'diag' : (v > 0 && a !== 'manual_review' ? 'err' : '');
              return `<td class="${cls} ${v === 0 ? 'zero' : ''}">${v}</td>`;
            }).join('')}</tr>`).join('')}
          </table>
          <p class="note">rows = ground truth, columns = predicted · ${total} cases plotted</p>
        </div>
        <div class="metrics">
          ${['contest', 'accept_liability'].map(cls => {
            const pr = b.precision_recall[cls];
            return `
            <div class="metric"><span><i>${nice(cls)} precision</i><b>${pct(pr.precision)}</b></span>
              <div class="bar"><i style="width:${(pr.precision || 0) * 100}%"></i></div></div>
            <div class="metric"><span><i>${nice(cls)} recall</i><b>${pct(pr.recall)}</b></span>
              <div class="bar g"><i style="width:${(pr.recall || 0) * 100}%"></i></div></div>`;
          }).join('')}
          <div class="metric"><span><i>coverage</i><b>${pct(b.coverage)}</b></span>
            <div class="bar"><i style="width:${b.coverage * 100}%"></i></div></div>
        </div>
      </div>
      <div class="costs">
        <div class="cost"><span>Cost / 100 cases</span><b>${inr(b.cost.cost_per_100_inr)}</b></div>
        <div class="cost"><span>False positives</span><b>${b.cost.n_false_positive}</b></div>
        <div class="cost"><span>False negatives</span><b>${b.cost.n_false_negative}</b></div>
        <div class="cost"><span>Routed to review</span><b>${b.cost.n_manual_review}</b></div>
        <div class="cost"><span>Bypassed reviews</span><b>${b.cost.n_bypassed_review}</b></div>
        <div class="cost"><span>Bonus: unpriced exposure / 100</span><b>${inr(b.cost.bypassed_review_exposure_per_100_inr)}</b></div>
      </div>
    </div>`;
  }).join('') + `
    <div class="panel">
      <h3>Cost model assumptions — stated, not hidden</h3>
      <p class="lede">False positive (contested what should have been accepted) = flat
        <b>${inr(m.cost_model.false_positive_inr)}</b> of wasted representment effort. False negative
        (accepted a winnable case) = the transaction amount itself, read per case. Manual review =
        <b>${inr(m.cost_model.manual_review_inr)}</b> of analyst time. The "bonus" row prices bypassed
        reviews at <b>${pct(m.cost_model.bypassed_exposure_rate)}</b> of the transaction amount — a stated
        assumption, deliberately kept out of the primary cost number so it can never be silently
        absorbed into it.</p>
    </div>`;
}

/* ── injection playground ── */
async function runPlayground() {
  const text = $('#play-text').value.trim();
  const out = $('#play-out'), hint = $('#play-hint'), btn = $('#play-run');
  if (!text) { hint.textContent = 'write something first'; return; }
  btn.disabled = true; hint.textContent = 'running against the real pipeline…'; out.innerHTML = '';

  const d = await api('/api/injection-test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ narrative: text })
  }).catch(e => ({ error: String(e) }));

  btn.disabled = false; hint.textContent = '';
  if (d.error) { out.innerHTML = `<div class="unavailable">${esc(d.error)}</div>`; return; }

  const r = d.result, held = d.held_the_line;
  out.innerHTML = `
    <div class="verdictbox ${held ? 'held' : 'broke'}">
      <h4>${held ? '✓ Held the line' : '✕ The narrative moved the decision'}</h4>
      <div class="reqline">
        <span class="tag t-${r.decision}">${nice(r.decision)}</span>
        ${d.flagged_injection ? '<span class="tag t-risk">prompt_injection_attempt</span>' : ''}
        ${(r.risk_flags || []).filter(f => f !== 'prompt_injection_attempt')
            .map(f => `<span class="tag t-rc">${f}</span>`).join('')}
        <span class="tag t-rc">confidence ${r.confidence}</span>
      </div>
      <div class="reason">${esc(r.reason)}</div>
    </div>`;
}

/* ── adversarial ── */
let ADV_LOADED = false;
async function loadAdversarial() {
  if (ADV_LOADED) return; ADV_LOADED = true;
  const body = $('#advbody');
  body.innerHTML = '<div class="loading">loading fixtures…</div>';
  const d = await api('/api/adversarial');
  const s = d.summary;

  const sel = $('#play-preset');
  sel.innerHTML = '<option value="">load a real fixture…</option>'
    + '<optgroup label="attacks — should be flagged">'
    + d.attacks.map(f => `<option value="${esc(f.narrative)}">${f.id} · ${esc(f.category)}</option>`).join('')
    + '</optgroup><optgroup label="benign controls — should NOT be flagged">'
    + d.controls.map(f => `<option value="${esc(f.narrative)}">${f.id} · ${esc(f.category)}</option>`).join('')
    + '</optgroup>';
  sel.onchange = () => { if (sel.value) $('#play-text').value = sel.value; };
  $('#play-run').onclick = runPlayground;
  if (!HEALTH.live_capable) $('#play-hint').textContent = 'needs a GROQ_API_KEY — see RUNNING.md';
  body.innerHTML = `
    <div class="kpis">
      <div class="kpi ok"><span>Defense rate</span><b>${pct(s.defense_rate)}</b>
        <small>${s.n_attacks}/${s.n_attacks} attack fixtures correctly flagged</small></div>
      <div class="kpi ok"><span>Control false positives</span><b>${pct(s.control_false_positive_rate)}</b>
        <small>0/${s.n_controls} benign fixtures wrongly flagged</small></div>
      <div class="kpi"><span>Attack fixtures</span><b>${s.n_attacks}</b>
        <small>publicly-documented injection categories</small></div>
      <div class="kpi"><span>Benign controls</span><b>${s.n_controls}</b>
        <small>same vocabulary, no actual instruction</small></div>
    </div>
    <p class="note" style="margin:-6px 0 18px">${esc(s.note)}</p>
    <div class="fixgrid">
      <div class="panel"><h3>Attack fixtures <span class="hint">— must be flagged</span></h3>
        ${d.attacks.map(f => `<div class="fix">
          <div class="fix-hd"><span class="fix-id">${f.id}</span>
            <span class="tag t-risk">${esc(f.category)}</span></div>
          <p>${esc(f.narrative)}</p></div>`).join('')}
      </div>
      <div class="panel"><h3>Benign controls <span class="hint">— must NOT be flagged</span></h3>
        ${d.controls.map(f => `<div class="fix">
          <div class="fix-hd"><span class="fix-id">${f.id}</span>
            <span class="tag t-contest">${esc(f.category || 'control')}</span></div>
          <p>${esc(f.narrative)}</p></div>`).join('')}
      </div>
    </div>`;
}
