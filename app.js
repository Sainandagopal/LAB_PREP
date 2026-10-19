'use strict';
const $ = (s, r = document) => r.querySelector(s);
const SUBJECTS = ['Physics', 'Chemistry', 'Data Structures', 'Java', 'DBMS', 'Other'];
const STORE_KEY = 'labprep.v2';
const CODE_KEY = 'labprep.code';
const MAX_MB = 20;

/* ---------- small helpers ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3500);
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function fmtDate(iso) { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } }
function avg(nums) { return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null; }

/* ---------- storage (browser only) ---------- */
let items = [];
function loadItems() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    items = Array.isArray(data.items) ? data.items : [];
  } catch { items = []; }
}
function saveItems() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ v: 2, items })); return true; }
  catch {
    toast('Browser storage is full or blocked, so this experiment will not be remembered. Delete old experiments to free space.');
    return false;
  }
}
const findItem = (id) => items.find((x) => x.id === id);

/* ---------- API ---------- */
let status = { ai: false, needsCode: false };
function askCode() {
  return new Promise((resolve) => {
    const dlg = $('#codeDialog');
    const form = $('#codeForm');
    const cancel = $('#codeCancel');
    const finish = (val) => { form.onsubmit = null; cancel.onclick = null; dlg.close(); resolve(val); };
    form.onsubmit = (e) => { e.preventDefault(); finish($('#codeInput').value.trim()); };
    cancel.onclick = () => finish('');
    $('#codeInput').value = '';
    dlg.showModal();
  });
}
async function api(url, { method = 'GET', json, form, signal } = {}, retried = false) {
  const headers = {};
  let code = '';
  try { code = localStorage.getItem(CODE_KEY) || ''; } catch {}
  if (code) headers['x-access-code'] = code;
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  let res;
  try { res = await fetch(url, { method, headers, body, signal }); }
  catch (err) {
    if (err && err.name === 'AbortError') throw new Error('This is taking too long. Please try again.');
    throw new Error('Could not reach the server. Check your internet connection. If the site was idle, wait a minute for it to wake up and try again.');
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && status.needsCode && !retried) {
    const entered = await askCode();
    if (entered) {
      try { localStorage.setItem(CODE_KEY, entered); } catch {}
      return api(url, { method, json, form, signal }, true);
    }
  }
  if (!res.ok) throw new Error(data.error || `The server returned an error (${res.status}).`);
  return data;
}

async function loadStatus() {
  const pill = $('#aiPill');
  try {
    status = await api('/api/status');
    pill.className = 'pill ' + (status.ai ? 'on' : 'off');
    pill.textContent = status.ai ? 'AI is on' : 'AI is off';
  } catch {
    pill.className = 'pill off';
    pill.textContent = 'Server unreachable';
  }
}
function showInfo(title, html) {
  $('#infoTitle').textContent = title;
  $('#infoBody').innerHTML = html;
  $('#infoDialog').showModal();
}
$('#aiPill').onclick = () => {
  if (status.ai) {
    showInfo('AI is on', `<p>Summaries, steps and viva questions are written by the AI model <b>${esc(status.model || '')}</b>, and your typed viva answers are graded by it.</p>`);
  } else {
    showInfo('AI is off', '<p>The site still works: it reads your PDF and builds a basic summary, steps and viva questions straight from the text. Answers are checked by matching key terms.</p><p>For proper summaries, better steps and answers that are graded on meaning, the site owner adds a free AI key in the hosting settings. The README explains how, in about five minutes.</p>');
  }
};

/* ---------- home: upload + library ---------- */
let filter = 'All';
let busy = false;

function fillSubjects() {
  $('#subjectSelect').innerHTML = SUBJECTS.map((s) => `<option>${esc(s)}</option>`).join('');
  try { const last = localStorage.getItem('labprep.subject'); if (last && SUBJECTS.includes(last)) $('#subjectSelect').value = last; } catch {}
}
$('#subjectSelect').onchange = () => { try { localStorage.setItem('labprep.subject', $('#subjectSelect').value); } catch {} };

function setFile(file) {
  const input = $('#pdfInput');
  if (file) {
    try { const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; } catch {}
  }
  const f = input.files && input.files[0];
  $('#drop').classList.toggle('has-file', !!f);
  $('#dropTitle').textContent = f ? f.name : 'Choose a PDF or drop it here';
  $('#dropHint').textContent = f ? `${(f.size / 1024 / 1024).toFixed(2)} MB. Choose Analyze experiment to continue.` : `Text-based PDF, up to ${MAX_MB} MB. Scanned images are not supported.`;
  showUploadError('');
}
function showUploadError(msg) {
  const el = $('#uploadError');
  el.textContent = msg;
  el.hidden = !msg;
}
$('#pdfInput').onchange = () => setFile(null);
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) setFile(f); });

function setProgress(on, text) {
  $('#progress').hidden = !on;
  if (text) $('#progressText').textContent = text;
}

$('#uploadForm').onsubmit = async (e) => {
  e.preventDefault();
  if (busy) return;
  const f = $('#pdfInput').files && $('#pdfInput').files[0];
  if (!f) return showUploadError('Choose a PDF file first.');
  if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return showUploadError('That file is not a PDF.');
  if (f.size > MAX_MB * 1024 * 1024) return showUploadError(`That PDF is larger than ${MAX_MB} MB.`);
  busy = true;
  $('#analyzeBtn').disabled = true;
  showUploadError('');
  setProgress(true, 'Uploading the PDF…');
  const timers = [
    setTimeout(() => setProgress(true, 'Reading the text from your PDF…'), 2500),
    setTimeout(() => setProgress(true, 'Writing the summary, steps and viva questions…'), 7000),
    setTimeout(() => setProgress(true, 'Still working. Long manuals, and a free server that was asleep, take a little longer.'), 25000)
  ];
  const ctl = new AbortController();
  const abortTimer = setTimeout(() => ctl.abort(), 4 * 60 * 1000);
  try {
    const form = new FormData();
    form.append('pdf', f, f.name);
    const d = await api('/api/analyze', { method: 'POST', form, signal: ctl.signal });
    const item = {
      id: uid(), subject: $('#subjectSelect').value, createdAt: new Date().toISOString(), size: f.size,
      name: d.name || f.name, title: d.title || f.name, aim: d.aim || '', summary: d.summary || '', requirements: d.requirements || [],
      keyPoints: d.keyPoints || [], steps: d.steps || [], viva: d.viva || [], codeBlocks: d.codeBlocks || [], text: d.text || '',
      pages: d.pages || 0, truncated: !!d.truncated, provider: d.provider || 'offline', note: d.note || '',
      stepsDone: {}, completed: false, scores: {}, bestAvg: null
    };
    items.unshift(item);
    saveItems();
    $('#pdfInput').value = '';
    setFile(null);
    location.hash = `#/exp/${item.id}/summary`;
  } catch (err) {
    showUploadError(err.message);
  } finally {
    timers.forEach(clearTimeout);
    clearTimeout(abortTimer);
    setProgress(false);
    busy = false;
    $('#analyzeBtn').disabled = false;
  }
};

function renderHome() {
  const present = ['All', ...SUBJECTS.filter((s) => items.some((i) => i.subject === s))];
  if (!present.includes(filter)) filter = 'All';
  $('#filters').innerHTML = items.length > 1 ? present.map((s) => `<button class="chip" type="button" data-filter="${esc(s)}" aria-pressed="${s === filter}">${esc(s)}</button>`).join('') : '';
  const shown = items.filter((i) => filter === 'All' || i.subject === filter);
  $('#list').innerHTML = shown.length ? shown.map((i) => {
    const done = Object.values(i.stepsDone || {}).filter(Boolean).length;
    const best = i.bestAvg == null ? '' : `<span>Best viva score ${i.bestAvg.toFixed(1)} / 10</span>`;
    return `<article class="item">
      <h3><a href="#/exp/${esc(i.id)}/summary">${esc(i.title)}</a></h3>
      <div class="actions"><a class="secondary small" style="text-decoration:none;display:inline-flex;align-items:center" href="#/exp/${esc(i.id)}/summary">Open</a><button class="danger small" type="button" data-del="${esc(i.id)}">Delete</button></div>
      <div class="meta"><span class="tag">${esc(i.subject)}</span><span>${esc(fmtDate(i.createdAt))}</span><span>${done} of ${i.steps.length} steps done</span>${best}${i.completed ? '<span class="done-flag">Completed</span>' : ''}</div>
    </article>`;
  }).join('') : `<div class="empty">${items.length ? 'No experiments in this subject yet.' : 'Nothing here yet. Upload your first experiment PDF above and it will appear in this list.'}</div>`;
}
$('#filters').onclick = (e) => { const b = e.target.closest('[data-filter]'); if (b) { filter = b.dataset.filter; renderHome(); } };
$('#list').onclick = (e) => {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  const it = findItem(b.dataset.del);
  if (it && confirm(`Delete “${it.title}” from this browser?`)) { items = items.filter((x) => x.id !== it.id); saveItems(); renderHome(); toast('Experiment deleted.'); }
};

/* ---------- experiment view ---------- */
const TABS = [['summary', 'Summary'], ['steps', 'Steps'], ['viva', 'Viva'], ['source', 'Source text']];
const sessions = {};
let currentId = null, currentTab = 'summary';

function codeBox(code, label, key) {
  return `<div class="codewrap"><div class="codehead"><span>${esc(label)}</span><button type="button" data-copy="${esc(key)}">Copy code</button></div><pre class="code"><code>${esc(code)}</code></pre></div>`;
}

function renderExperiment(id, tab) {
  const it = findItem(id);
  if (!it) { location.hash = '#/'; return; }
  currentId = id;
  currentTab = TABS.some((t) => t[0] === tab) ? tab : 'summary';
  $('#home').hidden = true;
  const root = $('#experiment');
  root.hidden = false;
  const badge = it.provider === 'ai' ? '<span class="badge ai">Written by AI</span>' : '<span class="badge offline">Basic draft, no AI</span>';
  root.innerHTML = `
    <div class="crumbs"><a class="plain" href="#/" style="text-decoration:none">Back to all experiments</a></div>
    <div class="exp-head">
      <div><h1>${esc(it.title)}</h1><p class="meta" style="margin:8px 0 0"><span class="tag">${esc(it.subject)}</span>${badge}<span>${it.pages ? it.pages + ' page' + (it.pages === 1 ? '' : 's') : ''}</span></p></div>
      <div class="exp-tools">
        <button class="secondary small" type="button" data-act="complete">${it.completed ? 'Mark as not completed' : 'Mark as completed'}</button>
        <button class="secondary small" type="button" data-act="reanalyze">Re-analyze</button>
        <button class="danger small" type="button" data-act="delete">Delete</button>
      </div>
    </div>
    ${it.note ? `<p class="note">${esc(it.note)}</p>` : ''}
    ${it.truncated ? '<p class="note">This PDF is very long, so only the first part of it was read.</p>' : ''}
    <div class="tabs" role="tablist">${TABS.map(([k, label]) => `<button class="tab" role="tab" type="button" data-tab="${k}" aria-selected="${k === currentTab}">${label}</button>`).join('')}</div>
    <div id="tabBody"></div>`;
  renderTab();
  window.scrollTo({ top: 0 });
}

function renderTab() {
  const it = findItem(currentId);
  if (!it) return;
  const body = $('#tabBody');
  if (currentTab === 'summary') body.innerHTML = summaryHtml(it);
  else if (currentTab === 'steps') body.innerHTML = stepsHtml(it);
  else if (currentTab === 'viva') body.innerHTML = vivaHtml(it);
  else body.innerHTML = sourceHtml(it);
  document.querySelectorAll('#experiment .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === currentTab)));
}

function summaryHtml(it) {
  return `<div class="page">
    <h2>Aim</h2>
    <p class="aim"><mark>${esc(it.aim || it.title)}</mark></p>
    <h2>Summary</h2>
    <p class="prose">${esc(it.summary)}</p>
    ${it.requirements.length ? `<h2>What you need</h2><ul class="reqs">${it.requirements.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    ${it.keyPoints.length ? `<h2>Points to remember</h2><ul class="points">${it.keyPoints.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>` : ''}
    <div class="nextrow"><button class="primary" type="button" data-tab="steps">Continue to steps</button></div>
  </div>`;
}

function stepsHtml(it) {
  const done = it.steps.filter((_, i) => it.stepsDone[i]).length;
  const pct = it.steps.length ? Math.round((done / it.steps.length) * 100) : 0;
  return `<div class="page record">
    <div class="stepbar"><strong>${done} of ${it.steps.length} steps done</strong><div class="meter" aria-hidden="true"><span style="width:${pct}%"></span></div><button class="plain small" type="button" data-act="resetsteps">Clear ticks</button></div>
    <ol class="steps">${it.steps.map((s, i) => `<li class="step ${it.stepsDone[i] ? 'done' : ''}">
      <label><input type="checkbox" data-step="${i}" ${it.stepsDone[i] ? 'checked' : ''}><span class="st-title">${esc(s.title)}</span>${s.detail && s.detail !== s.title ? `<p class="st-detail">${esc(s.detail)}</p>` : ''}</label>
      ${s.code ? codeBox(s.code, 'Code or command for this step', 'step:' + i) : ''}
    </li>`).join('')}</ol>
    <div class="nextrow"><button class="primary" type="button" data-tab="viva">Continue to viva</button></div>
  </div>`;
}

function sourceHtml(it) {
  return `<div class="page">
    <h2>Text read from your PDF</h2>
    <p class="muted">This is exactly what the site read. If something looks wrong here, the summary and steps may be off too.</p>
    <p><button class="secondary small" type="button" data-copy="text">Copy all text</button></p>
    <pre class="text">${esc(it.text || 'No text was saved.')}</pre>
    ${it.codeBlocks.length ? `<h2>Code found in the PDF</h2>${it.codeBlocks.map((b, i) => codeBox(b.code, `${b.title} (${b.language})`, 'block:' + i)).join('')}` : ''}
  </div>`;
}

/* ----- viva ----- */
const levelLabel = { basic: 'Basic', concept: 'Concept', applied: 'Applied' };

function vivaHtml(it) {
  if (!it.viva.length) return '<div class="page"><p>No viva questions were generated for this experiment. Try Re-analyze.</p></div>';
  const s = sessions[it.id];
  if (!s) return vivaIntroHtml(it);
  if (s.phase === 'done') return vivaDoneHtml(it, s);
  return vivaQuestionHtml(it, s);
}

function vivaIntroHtml(it) {
  const scored = Object.values(it.scores || {});
  const all = it.viva.map((v, i) => `<div class="qa"><b>${i + 1}. ${esc(v.q)}</b><p>${esc(v.a)}</p></div>`).join('');
  return `<div class="page">
    <div class="viva-intro">
      <h2>Viva practice</h2>
      <p>You will get ${it.viva.length} questions, one at a time, like an examiner would ask them. Type or say your answer, then check it. You see the model answer after every question.</p>
      ${it.bestAvg != null ? `<p><strong>Your best score so far: ${it.bestAvg.toFixed(1)} out of 10.</strong>${scored.length ? ` Questions answered before: ${scored.length}.` : ''}</p>` : ''}
      <div class="opts"><label><input type="checkbox" id="shuffle" checked> Shuffle the questions</label></div>
      <button class="primary" type="button" data-act="vivastart">Start viva</button>
      ${status.ai ? '<button class="secondary" type="button" data-act="vivamore" style="margin-left:8px">Add more questions</button>' : ''}
    </div>
    <details><summary>Read all questions and answers</summary>${all}</details>
  </div>`;
}

function vivaQuestionHtml(it, s) {
  const idx = s.order[s.pos];
  const q = it.viva[idx];
  const total = s.order.length;
  const answered = s.phase === 'graded' || s.phase === 'revealed';
  const g = s.last;
  const speech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  let grade = '';
  if (s.phase === 'graded' && g) {
    const cls = g.score >= 7 ? 'good' : g.score >= 4 ? 'mid' : 'low';
    grade = `<div class="grade" aria-live="polite">
      <div class="grade-head"><div class="score ${cls}">${g.score}<small> / 10</small></div><strong>${esc(g.verdict)}</strong></div>
      <div class="grade-body">
        ${g.feedback ? `<h4>Feedback</h4><p>${esc(g.feedback)}</p>` : ''}
        ${g.note ? `<p class="muted">${esc(g.note)}</p>` : ''}
        ${g.missing && g.missing.length ? `<h4>You could add</h4><ul class="missing">${g.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
        <h4>Model answer</h4><p class="model">${esc(g.improved || q.a)}</p>
      </div></div>`;
  } else if (s.phase === 'revealed') {
    grade = `<div class="grade"><div class="grade-body"><h4>Model answer</h4><p class="model">${esc(q.a)}</p></div></div>`;
  }
  const last = s.pos >= total - 1;
  return `<div class="page">
    <div class="vq-top"><span>Question ${s.pos + 1} of ${total}</span><span class="level">${esc(levelLabel[q.level] || 'Concept')}</span></div>
    <div class="vq-bar"><span style="width:${Math.round(((s.pos + (answered ? 1 : 0)) / total) * 100)}%"></span></div>
    <p class="vq">${esc(q.q)}</p>
    <label class="field" for="answer">Your answer</label>
    <textarea id="answer" class="answer-box" ${answered || s.phase === 'checking' ? 'readonly' : ''} placeholder="Answer the way you would say it to the examiner.">${esc(s.draft)}</textarea>
    <div class="vq-actions">
      ${answered
        ? `<button class="primary" type="button" data-act="vivanext">${last ? 'See my result' : 'Next question'}</button>`
        : `<button class="primary" type="button" data-act="vivacheck" ${s.phase === 'checking' ? 'disabled' : ''}>${s.phase === 'checking' ? 'Checking…' : 'Check my answer'}</button>
           <button class="secondary" type="button" data-act="vivareveal" ${s.phase === 'checking' ? 'disabled' : ''}>Show the answer</button>
           <button class="plain" type="button" data-act="vivaskip" ${s.phase === 'checking' ? 'disabled' : ''}>Skip</button>
           ${speech ? '<button class="secondary mic" type="button" data-act="mic" aria-pressed="false">Speak your answer</button>' : ''}`}
    </div>
    ${grade}
    <div class="vq-actions" style="margin-top:22px"><button class="plain small" type="button" data-act="vivaquit">End this practice</button></div>
  </div>`;
}

function vivaDoneHtml(it, s) {
  const rows = s.order.map((idx, n) => {
    const r = s.results[idx];
    return `<tr><td class="n">${r == null ? 'Skipped' : r + ' / 10'}</td><td>${n + 1}. ${esc(it.viva[idx].q)}</td></tr>`;
  }).join('');
  const nums = s.order.map((i) => s.results[i]).filter((r) => typeof r === 'number');
  const mean = avg(nums);
  const weak = s.order.filter((i) => s.results[i] == null || s.results[i] < 7);
  const verdict = mean == null ? 'You skipped every question.' : mean >= 8 ? 'You are viva ready for this experiment.' : mean >= 5 ? 'A good start. Go over the weaker questions once more.' : 'Read the summary and steps again, then retry.';
  return `<div class="page">
    <h2>Your result</h2>
    <p class="score ${mean != null && mean >= 7 ? 'good' : mean != null && mean >= 4 ? 'mid' : 'low'}" style="font-size:2.4rem">${mean == null ? '—' : mean.toFixed(1)}<small> / 10 average</small></p>
    <p>${esc(verdict)}</p>
    <table class="result-table"><tbody>${rows}</tbody></table>
    <div class="vq-actions">
      ${weak.length ? `<button class="primary" type="button" data-act="vivaweak">Practise the ${weak.length} weaker question${weak.length === 1 ? '' : 's'}</button>` : ''}
      <button class="secondary" type="button" data-act="vivastart">Start again</button>
      ${status.ai ? '<button class="secondary" type="button" data-act="vivamore">Add more questions</button>' : ''}
      <button class="plain" type="button" data-act="vivaquit">Back to the question list</button>
    </div>
  </div>`;
}

function newSession(it, order) {
  sessions[it.id] = { order, pos: 0, results: {}, phase: 'answer', draft: '', last: null };
}
function shuffled(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function recordResult(it, s, idx, score) {
  s.results[idx] = score;
  if (typeof score === 'number') it.scores[it.viva[idx].q] = score;
}
function finishSession(it, s) {
  s.phase = 'done';
  const nums = s.order.map((i) => s.results[i]).filter((r) => typeof r === 'number');
  const mean = avg(nums);
  if (mean != null && (it.bestAvg == null || mean > it.bestAvg)) it.bestAvg = mean;
  saveItems();
}

let recognition = null;
function stopMic() { try { recognition && recognition.stop(); } catch {} recognition = null; }
function toggleMic(btn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  if (recognition) { stopMic(); btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); btn.textContent = 'Speak your answer'; return; }
  try {
    recognition = new SR();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.continuous = true;
    recognition.onresult = (e) => {
      const area = $('#answer');
      if (!area) return;
      let said = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) said += e.results[i][0].transcript + ' ';
      if (said) area.value = (area.value ? area.value.replace(/\s*$/, ' ') : '') + said.trim();
    };
    recognition.onerror = () => { stopMic(); btn.classList.remove('on'); btn.textContent = 'Speak your answer'; toast('The microphone could not be used. Allow microphone access, or type your answer.'); };
    recognition.onend = () => { recognition = null; btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); btn.textContent = 'Speak your answer'; };
    recognition.start();
    btn.classList.add('on');
    btn.setAttribute('aria-pressed', 'true');
    btn.textContent = 'Stop listening';
  } catch { recognition = null; toast('Speech input is not available in this browser. Type your answer instead.'); }
}

async function checkCurrent(it, s) {
  const area = $('#answer');
  s.draft = area ? area.value : s.draft;
  if (!s.draft.trim()) { toast('Write or say an answer first, or choose Show the answer.'); return; }
  stopMic();
  const idx = s.order[s.pos];
  const q = it.viva[idx];
  s.phase = 'checking';
  renderTab();
  try {
    const r = await api('/api/viva/check', { method: 'POST', json: { question: q.q, modelAnswer: q.a, userAnswer: s.draft } });
    s.last = r;
    recordResult(it, s, idx, r.score);
    s.phase = 'graded';
    saveItems();
  } catch (err) {
    s.phase = 'answer';
    toast(err.message);
  }
  if (sessions[it.id] === s && currentId === it.id && currentTab === 'viva') renderTab();
}

async function reanalyze(it) {
  if (!it.text) { toast('There is no saved text to analyze.'); return; }
  if (!confirm('Re-analyze this experiment? The summary, steps and viva questions will be rewritten. Your ticked steps and viva scores are cleared.')) return;
  toast('Re-analyzing…');
  try {
    const d = await api('/api/reanalyze', { method: 'POST', json: { name: it.name, text: it.text } });
    Object.assign(it, {
      title: d.title || it.title, aim: d.aim || '', summary: d.summary || '', requirements: d.requirements || [], keyPoints: d.keyPoints || [],
      steps: d.steps || [], viva: d.viva || [], codeBlocks: d.codeBlocks || it.codeBlocks, provider: d.provider || 'offline', note: d.note || '',
      stepsDone: {}, scores: {}, bestAvg: null
    });
    delete sessions[it.id];
    saveItems();
    if (currentId === it.id) renderExperiment(it.id, currentTab); // do not yank the user back if they already left
    toast('Re-analyzed.');
  } catch (err) { toast(err.message); }
}

async function moreQuestions(it) {
  toast('Writing more questions…');
  try {
    const d = await api('/api/viva/more', { method: 'POST', json: {
      title: it.title, summary: it.summary, steps: it.steps.map((s) => s.title), text: it.text, existing: it.viva.map((v) => v.q)
    } });
    const have = new Set(it.viva.map((v) => v.q.toLowerCase()));
    const fresh = d.viva.filter((v) => !have.has(v.q.toLowerCase()));
    it.viva.push(...fresh);
    saveItems();
    delete sessions[it.id];
    renderTab();
    toast(`${fresh.length} new question${fresh.length === 1 ? '' : 's'} added.`);
  } catch (err) { toast(err.message); }
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); toast('Copied.'); return; }
  } catch {}
  const box = document.createElement('textarea');
  box.value = text; box.setAttribute('readonly', ''); box.style.position = 'fixed'; box.style.opacity = '0';
  document.body.appendChild(box); box.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  box.remove();
  toast(ok ? 'Copied.' : 'Copying was blocked by the browser. Select the text and copy it by hand.');
}

/* ----- one click handler for the experiment view ----- */
$('#experiment').addEventListener('click', (e) => {
  const it = findItem(currentId);
  if (!it) return;
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) { location.hash = `#/exp/${it.id}/${tabBtn.dataset.tab}`; return; }
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    const key = copy.dataset.copy;
    if (key === 'text') return copyText(it.text);
    const [kind, n] = key.split(':');
    const code = kind === 'step' ? it.steps[Number(n)]?.code : it.codeBlocks[Number(n)]?.code;
    return copyText(code || '');
  }
  const act = e.target.closest('[data-act]');
  if (!act) return;
  const a = act.dataset.act;
  const s = sessions[it.id];
  if (a === 'complete') { it.completed = !it.completed; saveItems(); renderExperiment(it.id, currentTab); }
  else if (a === 'delete') { if (confirm(`Delete “${it.title}” from this browser?`)) { items = items.filter((x) => x.id !== it.id); delete sessions[it.id]; saveItems(); location.hash = '#/'; toast('Experiment deleted.'); } }
  else if (a === 'reanalyze') reanalyze(it);
  else if (a === 'resetsteps') { it.stepsDone = {}; saveItems(); renderTab(); }
  else if (a === 'vivastart') { const sh = $('#shuffle'); newSession(it, sh && !sh.checked ? it.viva.map((_, i) => i) : shuffled(it.viva.length)); renderTab(); }
  else if (a === 'vivaweak' && s) { const weak = s.order.filter((i) => s.results[i] == null || s.results[i] < 7); if (weak.length) { newSession(it, weak); renderTab(); } }
  else if (a === 'vivacheck' && s) checkCurrent(it, s);
  else if (a === 'vivareveal' && s) { stopMic(); const area = $('#answer'); if (area) s.draft = area.value; recordResult(it, s, s.order[s.pos], 0); s.phase = 'revealed'; renderTab(); }
  else if (a === 'vivaskip' && s) { stopMic(); const idx = s.order[s.pos]; s.results[idx] = null; s.draft = ''; s.last = null; s.phase = 'answer'; if (s.pos >= s.order.length - 1) finishSession(it, s); else s.pos++; renderTab(); }
  else if (a === 'vivanext' && s) { stopMic(); s.draft = ''; s.last = null; s.phase = 'answer'; if (s.pos >= s.order.length - 1) finishSession(it, s); else s.pos++; renderTab(); }
  else if (a === 'vivaquit') { stopMic(); delete sessions[it.id]; renderTab(); }
  else if (a === 'vivamore') moreQuestions(it);
  else if (a === 'mic') toggleMic(act);
});
$('#experiment').addEventListener('change', (e) => {
  const cb = e.target.closest('[data-step]');
  const it = findItem(currentId);
  if (!cb || !it) return;
  it.stepsDone[cb.dataset.step] = cb.checked;
  saveItems();
  const scroll = window.scrollY;
  renderTab();
  window.scrollTo({ top: scroll });
});
$('#experiment').addEventListener('keydown', (e) => {
  if (e.target.id === 'answer' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    const it = findItem(currentId), s = it && sessions[it.id];
    if (s && s.phase === 'answer') { e.preventDefault(); checkCurrent(it, s); }
  }
});
$('#experiment').addEventListener('input', (e) => {
  if (e.target.id === 'answer') { const it = findItem(currentId), s = it && sessions[it.id]; if (s) s.draft = e.target.value; }
});

/* ---------- router ---------- */
function route() {
  stopMic();
  const m = /^#\/exp\/([^/]+)(?:\/(\w+))?/.exec(location.hash);
  if (m) { renderExperiment(m[1], m[2] || 'summary'); return; }
  currentId = null;
  $('#experiment').hidden = true;
  $('#home').hidden = false;
  renderHome();
  window.scrollTo({ top: 0 });
}
// Same experiment, different tab: only swap the tab body so typed answers and scroll position survive.
window.addEventListener('hashchange', () => {
  const m = /^#\/exp\/([^/]+)(?:\/(\w+))?/.exec(location.hash);
  if (m && m[1] === currentId && !$('#experiment').hidden) {
    currentTab = TABS.some((t) => t[0] === m[2]) ? m[2] : 'summary';
    renderTab();
    window.scrollTo({ top: 0 });
  } else route();
});

loadItems();
fillSubjects();
setFile(null);
route();
loadStatus();
