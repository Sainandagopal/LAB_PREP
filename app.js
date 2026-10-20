'use strict';
const $ = (s, r = document) => r.querySelector(s);
let storeKey = 'labprep.v2'; // becomes labprep.u.<id> while signed in (a per-account cache of the server copy)
const CODE_KEY = 'labprep.code';
const LAST_SUBJECT_KEY = 'labprep.subject';
const MAX_MB = 20;
const MAX_SUBJECTS = 100;
const DEFAULT_SUBJECT = 'General';
const COLORS = ['#0F766E', '#2563EB', '#9333EA', '#DB2777', '#EA580C', '#CA8A04', '#16A34A', '#0891B2', '#DC2626', '#4F46E5'];

/* ---------- small helpers ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3800);
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function fmtDate(iso) { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } }
function avg(nums) { return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null; }
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

/* ---------- storage (this browser only) ---------- */
let items = [];
let subjects = []; // { id, name, color }
const newestFirst = (a, b) => (String(b.createdAt) > String(a.createdAt) ? 1 : String(b.createdAt) < String(a.createdAt) ? -1 : 0);
function normalizeData() {
  subjects = subjects.filter((s) => s && s.id && s.name);
  // Migrate older saves, where an experiment only carried a subject name.
  for (const it of items) {
    if (it.subjectId && subjects.some((s) => s.id === it.subjectId)) continue;
    it.subjectId = subjectByName(it.subject || DEFAULT_SUBJECT, true).id;
  }
  items.forEach((it) => {
    it.steps = it.steps || []; it.viva = it.viva || []; it.requirements = it.requirements || []; it.keyPoints = it.keyPoints || [];
    it.codeBlocks = it.codeBlocks || []; it.stepsDone = it.stepsDone || {}; it.scores = it.scores || {}; it.figures = it.figures || [];
    it.terms = it.terms || []; it.logic = it.logic || []; it.mistakes = it.mistakes || []; it.expectedOutput = it.expectedOutput || '';
  });
}
function readCache() {
  let data = {};
  try { data = JSON.parse(localStorage.getItem(storeKey) || '{}') || {}; } catch { data = {}; }
  return { items: Array.isArray(data.items) ? data.items : [], subjects: Array.isArray(data.subjects) ? data.subjects : [], dirty: !!data.dirty };
}
function loadData() {
  const c = readCache();
  items = c.items; subjects = c.subjects;
  normalizeData();
}
function writeCache(dirty) {
  try { localStorage.setItem(storeKey, JSON.stringify({ v: 3, subjects, items, dirty: !!dirty })); return true; }
  catch {
    if (!account.user) toast('Browser storage is full or blocked, so changes will not be remembered. Delete old experiments to free space.');
    return false;
  }
}
function saveData() {
  rev++;
  const ok = writeCache(!!account.user); // signed in: the cache is "unsynced" until the server confirms
  if (account.user) scheduleSync();
  return ok;
}
const findItem = (id) => items.find((x) => x.id === id);
const subjectById = (id) => subjects.find((s) => s.id === id);
function subjectByName(name, create) {
  const n = cleanName(name);
  let s = subjects.find((x) => sameName(x.name, n));
  if (!s && create) {
    s = { id: uid(), name: n || DEFAULT_SUBJECT, color: COLORS[subjects.length % COLORS.length] };
    subjects.push(s);
  }
  return s;
}
const countIn = (id) => items.filter((i) => i.subjectId === id).length;
const subjectOf = (it) => subjectById(it.subjectId) || { name: DEFAULT_SUBJECT, color: COLORS[0], id: '' };

/* ---------- API ---------- */
let status = { ai: false, needsCode: false };
let account = { enabled: false, user: null, note: '', limit: 60 };
let rev = 0;
function askCode() {
  return new Promise((resolve) => {
    const dlg = $('#codeDialog');
    const form = $('#codeForm');
    const cancel = $('#codeCancel');
    const finish = (val) => { form.onsubmit = null; cancel.onclick = null; dlg.onclose = null; if (dlg.open) dlg.close(); resolve(val); };
    form.onsubmit = (e) => { e.preventDefault(); finish($('#codeInput').value.trim()); };
    cancel.onclick = () => finish('');
    dlg.onclose = () => finish('');
    $('#codeInput').value = '';
    dlg.showModal();
  });
}
async function api(url, { method = 'GET', json, form, signal } = {}, retried = false) {
  const headers = { 'x-labprep': '1' };
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
  if (res.status === 401 && data.code === 'login' && account.enabled) {
    account.user = null; renderAcct();
    if (!$('#authDialog').open) openAuth('signin');
    const e = new Error('Please sign in to continue.'); e.status = 401; throw e;
  }
  if (res.status === 401 && status.needsCode && !retried) {
    const entered = await askCode();
    if (entered) {
      try { localStorage.setItem(CODE_KEY, entered); } catch {}
      return api(url, { method, json, form, signal }, true);
    }
  }
  if (!res.ok) { const e = new Error(data.error || `The server returned an error (${res.status}).`); e.status = res.status; throw e; }
  return data;
}

/* ---------- AI status pill + info dialog ---------- */
async function loadStatus() {
  const pill = $('#aiPill');
  try {
    status = await api('/api/status');
    pill.className = 'ai-pill ' + (status.ai ? (status.busy ? 'busy' : 'on') : '');
    pill.textContent = status.ai ? (status.busy ? 'AI busy' : 'AI on') : 'AI off';
    account.enabled = !!(status.accounts && status.accounts.enabled);
    account.note = (status.accounts && status.accounts.note) || '';
    if (status.accounts && status.accounts.maxExperiments) account.limit = status.accounts.maxExperiments;
    account.user = status.user || null;
  } catch {
    pill.className = 'ai-pill err';
    pill.textContent = 'Server unreachable';
  }
  renderAcct();
  if (!$('#pdfInput').files || !$('#pdfInput').files[0]) setFile(null);
}
function acctInfoHtml() {
  if (account.enabled) return `<h3 class="dlg-h">Accounts</h3><p class="muted">Sign-in and cloud saving are on.${account.user ? ` You are signed in as <b>${esc(account.user.email)}</b>.` : ''}</p>`;
  return `<h3 class="dlg-h">Accounts</h3><p class="muted">Off. ${esc(account.note || '')} To let people sign in and keep their experiments on every device, add a free Neon database (the README shows how).</p>`;
}
function openInfo() {
  const names = (status.expected || ['AI_API_KEY', 'GEMINI_API_KEY']).map((n) => `<code>${esc(n)}</code>`).join(', ');
  if (status.ai) {
    $('#infoTitle').textContent = 'AI is on';
    $('#infoBody').innerHTML = `<p>Summaries, steps and viva questions are written by <b>${esc(status.model || 'the AI model')}</b>, and your typed viva answers are graded by it.</p>
      <p class="muted">Key found in <code>${esc(status.keyVar || '')}</code>. Press the test button to confirm the key really works.</p>
      ${status.readsPdf ? '<p class="muted">Scanned pages, diagrams and tables in your PDFs are read by the AI too.</p>' : '<p class="muted">Scanned PDFs and diagrams need a Gemini key.</p>'}
      <div id="testOut" class="test-out" hidden></div>${acctInfoHtml()}`;
  } else {
    const seen = (status.seen || []).length ? `<p class="muted">Settings the server can see that look related: ${status.seen.map((n) => `<code>${esc(n)}</code>`).join(', ')}. None of them is a name the site reads.</p>` : '';
    $('#infoTitle').textContent = 'AI is off';
    $('#infoBody').innerHTML = `<p>The site still works without it, but the summary, steps and viva marking are only basic. To turn the AI on:</p>
      <ol><li>Open your service on Render, then <b>Environment</b>.</li>
        <li>Add a variable named <code>GEMINI_API_KEY</code> and paste your Gemini key as its value.</li>
        <li>Save. Render redeploys. Reload this page.</li></ol>
      <p class="muted">The site reads any of these names: ${names}.</p>${seen}
      <div id="testOut" class="test-out" hidden></div>${acctInfoHtml()}`;
  }
  $('#infoTest').hidden = false;
  $('#infoDialog').showModal();
}
$('#aiPill').onclick = openInfo;
$('#infoTest').onclick = async () => {
  const out = $('#testOut');
  const btn = $('#infoTest');
  if (!out) return;
  btn.disabled = true;
  out.hidden = false;
  out.className = 'test-out';
  out.textContent = 'Testing the connection. This can take up to a minute on the first try…';
  try {
    const r = await api('/api/ai-test');
    if (r.ok) {
      out.className = 'test-out ok';
      out.textContent = `Working. Connected to ${r.model || 'the model'}. Reload the page and upload a PDF.`;
    } else {
      out.className = 'test-out bad';
      const det = Array.isArray(r.details) && r.details.length ? '<ul>' + r.details.map((d) => `<li>${esc(d)}</li>`).join('') + '</ul>' : '';
      out.innerHTML = `<b>Not working yet.</b> ${esc(r.error || 'The AI did not answer.')}${det}`;
    }
  } catch (err) {
    out.className = 'test-out bad';
    out.textContent = err.message;
  }
  btn.disabled = false;
  loadStatus();
};

/* ---------- small text dialog (add / rename subject) ---------- */
function askText({ title, label, value = '', ok = 'Save', validate, type = 'text', raw = false, maxlength = 40 }) {
  return new Promise((resolve) => {
    const dlg = $('#textDialog');
    const form = $('#textForm');
    const input = $('#textInput');
    const err = $('#textError');
    $('#textTitle').textContent = title;
    $('#textLabel').textContent = label;
    $('#textOk').textContent = ok;
    input.type = type;
    input.maxLength = maxlength;
    input.autocomplete = type === 'password' ? 'current-password' : 'off';
    input.value = value;
    err.hidden = true;
    let done = false;
    const finish = (v) => { if (done) return; done = true; form.onsubmit = null; $('#textCancel').onclick = null; dlg.onclose = null; if (dlg.open) dlg.close(); resolve(v); };
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = raw ? input.value : cleanName(input.value);
      const problem = !v ? (raw ? 'Type it first.' : 'Type a name first.') : validate ? validate(v) : '';
      if (problem) { err.textContent = problem; err.hidden = false; input.focus(); return; }
      finish(v);
    };
    $('#textCancel').onclick = () => finish(null);
    dlg.onclose = () => finish(null);
    dlg.showModal();
    input.focus();
    input.select();
  });
}

/* ---------- accounts + cloud sync ---------- */
let synced = { subjects: '[]', items: new Map() }; // what the server is known to hold
let syncTimer = null, syncing = false, syncState = 'saved', retryDelay = 4000;

function setSyncState(st) {
  syncState = st;
  const el = $('#syncState');
  if (el) el.textContent = st === 'saved' ? 'All changes saved' : st === 'saving' ? 'Saving…' : 'Could not save yet. Retrying…';
}
function snapshot() { return { subjects: JSON.stringify(subjects.map((s) => ({ id: s.id, name: s.name, color: s.color }))), items: new Map(items.map((i) => [i.id, JSON.stringify(i)])) }; }
function scheduleSync(delay = 500) {
  clearTimeout(syncTimer);
  setSyncState('saving');
  syncTimer = setTimeout(pushNow, delay);
}
async function pushNow() {
  if (!account.user) return;
  if (syncing) { scheduleSync(800); return; }
  syncing = true;
  const startRev = rev;
  const now = snapshot();
  const upsert = [], remove = [];
  for (const [id, json] of now.items) if (synced.items.get(id) !== json) upsert.push(JSON.parse(json));
  for (const id of synced.items.keys()) if (!now.items.has(id)) remove.push(id);
  const subjectsChanged = now.subjects !== synced.subjects;
  if (!upsert.length && !remove.length && !subjectsChanged) {
    syncing = false;
    if (rev === startRev) { writeCache(false); setSyncState('saved'); }
    return;
  }
  try {
    await api('/api/sync', { method: 'POST', json: { ...(subjectsChanged ? { subjects: JSON.parse(now.subjects) } : {}), upsert, remove } });
    synced = now;
    retryDelay = 4000;
    syncing = false;
    if (rev === startRev) { writeCache(false); setSyncState('saved'); } else scheduleSync(200);
  } catch (err) {
    syncing = false;
    setSyncState('error');
    if (err.status === 401) return; // the sign-in dialog is already open
    if (err.status && err.status < 500 && err.status !== 429) { toast(err.message); return; } // retrying would not help
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushNow, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 60000);
  }
}
window.addEventListener('beforeunload', (e) => { if (account.user && syncState !== 'saved') { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && account.user && syncState !== 'saved') { clearTimeout(syncTimer); pushNow(); } });

// Loads the account's library. If this browser holds edits the server has not confirmed, those win and are pushed.
async function initAccountData() {
  const cache = readCache();
  let d;
  try { d = await api('/api/library'); }
  catch (err) {
    if (err.status !== 401) toast('Could not reach your account. Showing the copy saved on this device.');
    return;
  }
  if (d.limits && d.limits.experiments) account.limit = d.limits.experiments;
  const serverItems = Array.isArray(d.items) ? d.items : [];
  const serverSubjects = (Array.isArray(d.subjects) ? d.subjects : []).map((s) => ({ id: s.id, name: s.name, color: s.color }));
  synced = { subjects: JSON.stringify(serverSubjects), items: new Map(serverItems.map((i) => [i.id, JSON.stringify(i)])) };
  if (cache.dirty) {
    items = cache.items; subjects = cache.subjects; normalizeData();
    await pushNow();
  } else {
    items = serverItems.sort(newestFirst); subjects = serverSubjects; normalizeData();
    writeCache(false);
    setSyncState('saved');
  }
}

// Experiments saved in this browser before the person signed in are offered to the account once.
async function maybeImportLocal() {
  if (!account.user) return;
  const flag = 'labprep.imp.' + account.user.id;
  try { if (localStorage.getItem(flag)) return; } catch {}
  let local = {};
  try { local = JSON.parse(localStorage.getItem('labprep.v2') || '{}') || {}; } catch { return; }
  const li = Array.isArray(local.items) ? local.items : [];
  if (!li.length) return;
  try { localStorage.setItem(flag, '1'); } catch {}
  if (!confirm(`This browser has ${li.length} experiment${li.length === 1 ? '' : 's'} saved from before you signed in. Add ${li.length === 1 ? 'it' : 'them'} to your account?`)) return;
  const old = Array.isArray(local.subjects) ? local.subjects : [];
  const nameOf = (it) => { const s = old.find((x) => x.id === it.subjectId); return s ? s.name : (it.subject || DEFAULT_SUBJECT); };
  let added = 0;
  for (const it of li) {
    if (items.some((x) => x.id === it.id) || items.length >= account.limit) continue;
    const sub = subjectByName(nameOf(it), true);
    items.push({ ...it, subjectId: sub.id });
    added++;
  }
  normalizeData();
  items.sort(newestFirst);
  saveData();
  try { localStorage.removeItem('labprep.v2'); } catch {}
  toast(added ? `Added ${added} experiment${added === 1 ? '' : 's'} to your account.` : 'Nothing could be added.');
}

function renderAcct() {
  const el = $('#acct');
  const hint = $('#signinHint');
  if (!account.enabled) { el.innerHTML = ''; hint.hidden = true; return; }
  if (account.user) {
    const e = account.user.email;
    el.innerHTML = `<details class="menu acct-menu"><summary class="btn outline sm" aria-label="Account menu"><span class="avatar">${esc(e[0].toUpperCase())}</span><span class="acct-email">${esc(e)}</span></summary>
      <div class="menu-list"><div class="menu-email">${esc(e)}</div><div class="menu-sync" id="syncState"></div>
      <button type="button" data-acct="logout">Sign out</button><button type="button" class="danger-t" data-acct="delete">Delete account</button></div></details>`;
    hint.hidden = true;
    setSyncState(syncState);
  } else {
    el.innerHTML = '<button class="btn outline sm" type="button" data-acct="signin">Sign in</button>';
    hint.hidden = false;
  }
}

function openAuth(mode = 'register', after) {
  const dlg = $('#authDialog');
  let m = mode;
  const err = $('#authError');
  const paint = () => {
    $('#authTitle').textContent = m === 'signin' ? 'Sign in' : 'Create your account';
    $('#authLead').textContent = m === 'signin' ? 'Welcome back. Your subjects and experiments will load.' : 'Save your subjects and experiments to your account and open them on any phone or computer.';
    $('#authOk').textContent = m === 'signin' ? 'Sign in' : 'Create account';
    $('#authSwitchText').textContent = m === 'signin' ? 'New here?' : 'Already have an account?';
    $('#authSwitch').textContent = m === 'signin' ? 'Create an account' : 'Sign in';
    $('#authPass').autocomplete = m === 'signin' ? 'current-password' : 'new-password';
    $('#authPassHint').hidden = m === 'signin';
    err.hidden = true;
  };
  paint();
  $('#authSwitch').onclick = () => { m = m === 'signin' ? 'register' : 'signin'; paint(); };
  $('#authCancel').onclick = () => dlg.close();
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#authEmail').value.trim(), password = $('#authPass').value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(email)) { err.textContent = 'Enter a valid email address.'; err.hidden = false; return; }
    if (m === 'register' && password.length < 8) { err.textContent = 'Use a password with at least 8 characters.'; err.hidden = false; return; }
    if (!password) { err.textContent = 'Enter your password.'; err.hidden = false; return; }
    const ok = $('#authOk');
    ok.disabled = true;
    err.hidden = true;
    try {
      const d = await api(m === 'signin' ? '/api/auth/login' : '/api/auth/register', { method: 'POST', json: { email, password } });
      $('#authPass').value = '';
      dlg.close();
      await onSignedIn(d.user);
      if (after) after();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { ok.disabled = false; }
  };
  if (!dlg.open) dlg.showModal();
  $('#authEmail').focus();
}

function resetState() {
  Object.keys(sessions).forEach((k) => delete sessions[k]);
  items = []; subjects = []; filter = 'all';
  synced = { subjects: '[]', items: new Map() };
  clearTimeout(syncTimer); syncing = false; syncState = 'saved';
}
async function onSignedIn(user) {
  resetState();
  account.user = user;
  storeKey = 'labprep.u.' + user.id;
  loadData();
  renderAcct();
  route();
  await initAccountData();
  await maybeImportLocal();
  route();
  loadStatus();
}
async function signOut() {
  if (syncState !== 'saved') { clearTimeout(syncTimer); await pushNow(); }
  const id = account.user && account.user.id;
  try { await api('/api/auth/logout', { method: 'POST', json: {} }); } catch {}
  try { if (id) localStorage.removeItem('labprep.u.' + id); } catch {}
  afterSignedOut();
  toast('Signed out.');
}
function afterSignedOut() {
  resetState();
  account.user = null;
  storeKey = 'labprep.v2';
  renderAcct();
  if (location.hash !== '#/' && location.hash !== '') location.hash = '#/'; else route();
}
async function deleteAccount() {
  const password = await askText({ title: 'Delete your account', label: 'Type your password to confirm. Your subjects and experiments will be deleted for good.', ok: 'Delete account', type: 'password', raw: true, maxlength: 200 });
  if (!password) return;
  try {
    await api('/api/account/delete', { method: 'POST', json: { password } });
    const id = account.user && account.user.id;
    try { if (id) { localStorage.removeItem('labprep.u.' + id); localStorage.removeItem('labprep.imp.' + id); } } catch {}
    afterSignedOut();
    toast('Your account was deleted.');
  } catch (err) { toast(err.message); }
}
document.addEventListener('click', (e) => {
  const open = document.querySelector('.acct-menu[open]');
  if (open && !e.target.closest('.acct-menu')) open.open = false;
  const b = e.target.closest('[data-acct]');
  if (!b) return;
  if (open) open.open = false;
  const a = b.dataset.acct;
  if (a === 'signin') openAuth('signin');
  else if (a === 'register') openAuth('register');
  else if (a === 'logout') signOut();
  else if (a === 'delete') deleteAccount();
});

/* ---------- subject management ---------- */
let filter = 'all'; // 'all' or a subject id

async function addSubject() {
  if (subjects.length >= MAX_SUBJECTS) { toast(`You can have up to ${MAX_SUBJECTS} subjects.`); return; }
  const name = await askText({
    title: 'New subject', label: 'Subject name', ok: 'Add subject',
    validate: (v) => (subjects.some((s) => sameName(s.name, v)) ? 'You already have a subject with that name.' : '')
  });
  if (!name) return;
  const s = subjectByName(name, true);
  saveData();
  filter = s.id;
  $('#subjectInput').value = s.name;
  renderHome();
  toast(`Added “${s.name}”.`);
}
async function renameSubject(id) {
  const s = subjectById(id);
  if (!s) return;
  const name = await askText({
    title: 'Rename subject', label: 'Subject name', value: s.name, ok: 'Rename',
    validate: (v) => (subjects.some((x) => x.id !== s.id && sameName(x.name, v)) ? 'You already have a subject with that name.' : '')
  });
  if (!name || name === s.name) return;
  s.name = name;
  saveData();
  renderHome();
  toast('Subject renamed.');
}
function deleteSubject(id) {
  const s = subjectById(id);
  if (!s) return;
  const n = countIn(id);
  const msg = n
    ? `Delete the subject “${s.name}”?\n\nIts ${n} experiment${n === 1 ? '' : 's'} will not be deleted. ${n === 1 ? 'It moves' : 'They move'} to “${DEFAULT_SUBJECT}”.`
    : `Delete the subject “${s.name}”?`;
  if (!confirm(msg)) return;
  let target = null;
  if (n) {
    target = subjects.find((x) => x.id !== id && sameName(x.name, DEFAULT_SUBJECT)) || null;
    if (!target) {
      // Reuse the slot instead of creating a duplicate if the deleted subject is itself "General".
      target = sameName(s.name, DEFAULT_SUBJECT) ? null : subjectByName(DEFAULT_SUBJECT, true);
    }
    if (!target) { toast('This is your General subject. Move its experiments to another subject first.'); return; }
    items.forEach((i) => { if (i.subjectId === id) i.subjectId = target.id; });
  }
  subjects = subjects.filter((x) => x.id !== id);
  saveData();
  filter = target ? target.id : 'all';
  renderHome();
  toast('Subject deleted.');
}

function renderSubjectBar() {
  const chips = [`<button class="chip" type="button" data-filter="all" aria-pressed="${filter === 'all'}">All <span class="count">${items.length}</span></button>`]
    .concat(subjects.map((s) => `<button class="chip" type="button" data-filter="${esc(s.id)}" aria-pressed="${filter === s.id}"><span class="dot" style="background:${esc(s.color)}"></span>${esc(s.name)} <span class="count">${countIn(s.id)}</span></button>`));
  chips.push('<button class="chip add" type="button" data-act="addsubject">+ New subject</button>');
  $('#subjectBar').innerHTML = chips.join('');
  const tools = $('#subjectTools');
  const cur = filter === 'all' ? null : subjectById(filter);
  tools.hidden = !cur;
  if (cur) {
    tools.innerHTML = `<span class="dot" style="background:${esc(cur.color)}"></span><strong>${esc(cur.name)}</strong><span>·</span>
      <button class="btn ghost sm" type="button" data-act="rename">Rename</button>
      <button class="btn ghost sm" type="button" data-act="delsubject">Delete subject</button>`;
  }
  $('#subjectOptions').innerHTML = subjects.map((s) => `<option value="${esc(s.name)}"></option>`).join('');
}

/* ---------- home: upload + library ---------- */
let busy = false;

function rememberSubject(name) { try { localStorage.setItem(LAST_SUBJECT_KEY, name); } catch {} }
function suggestSubject() {
  const cur = filter !== 'all' && subjectById(filter);
  if (cur) return cur.name;
  try { const last = localStorage.getItem(LAST_SUBJECT_KEY); if (last) return last; } catch {}
  return '';
}

function setFile(file) {
  const input = $('#pdfInput');
  if (file) {
    try { const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; } catch {}
  }
  const f = input.files && input.files[0];
  $('#drop').classList.toggle('has-file', !!f);
  $('#dropTitle').textContent = f ? f.name : 'Drop your experiment PDF here';
  $('#dropHint').textContent = f ? `${(f.size / 1024 / 1024).toFixed(2)} MB. Choose a subject, then Analyze experiment.` : (status.readsPdf ? `or click to browse. PDF up to ${MAX_MB} MB. Scans and diagrams are read by AI.` : `or click to browse. Text-based PDF, up to ${MAX_MB} MB.`);
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
  if (account.enabled && !account.user) { openAuth('register', () => $('#uploadForm').requestSubmit()); return; }
  if (account.user && items.length >= account.limit) return showUploadError(`Your account can hold ${account.limit} experiments. Delete some you no longer need first.`);
  if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return showUploadError('That file is not a PDF.');
  if (f.size > MAX_MB * 1024 * 1024) return showUploadError(`That PDF is larger than ${MAX_MB} MB.`);
  const typed = cleanName($('#subjectInput').value);
  if (typed && !subjects.some((s) => sameName(s.name, typed)) && subjects.length >= MAX_SUBJECTS) return showUploadError(`You already have ${MAX_SUBJECTS} subjects. Pick an existing one.`);
  busy = true;
  $('#analyzeBtn').disabled = true;
  showUploadError('');
  setProgress(true, 'Uploading the PDF…');
  const timers = [
    setTimeout(() => setProgress(true, 'Reading the text from your PDF…'), 2000),
    setTimeout(() => setProgress(true, 'Writing the summary, steps and viva questions together…'), 5000),
    setTimeout(() => setProgress(true, 'Almost there. If the AI is busy, the site switches to another model by itself.'), 20000),
    setTimeout(() => setProgress(true, 'Still working. Long manuals, and a free server that was asleep, take a little longer.'), 40000)
  ];
  const ctl = new AbortController();
  const abortTimer = setTimeout(() => ctl.abort(), 4 * 60 * 1000);
  try {
    const form = new FormData();
    form.append('pdf', f, f.name);
    const d = await api('/api/analyze', { method: 'POST', form, signal: ctl.signal });
    const subj = subjectByName(typed || DEFAULT_SUBJECT, true);
    rememberSubject(subj.name);
    const item = {
      id: uid(), subjectId: subj.id, createdAt: new Date().toISOString(), size: f.size,
      name: d.name || f.name, title: d.title || f.name, aim: d.aim || '', summary: d.summary || '', requirements: d.requirements || [],
      keyPoints: d.keyPoints || [], terms: d.terms || [], logic: d.logic || [], mistakes: d.mistakes || [], expectedOutput: d.expectedOutput || '',
      steps: d.steps || [], viva: d.viva || [], figures: d.figures || [], codeBlocks: d.codeBlocks || [], text: d.text || '',
      pages: d.pages || 0, truncated: !!d.truncated, provider: d.provider || 'offline', note: d.note || '',
      stepsDone: {}, completed: false, scores: {}, bestAvg: null
    };
    if (account.user && JSON.stringify(item).length > 690 * 1024) throw new Error('This PDF is too long to save to your account. Split it into smaller parts and upload them separately.');
    items.unshift(item);
    saveData();
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
  if (filter !== 'all' && !subjectById(filter)) filter = 'all';
  renderSubjectBar();
  const lib = $('.library');
  lib.hidden = (account.enabled && !account.user) || (!items.length && !subjects.length);
  $('#libNote').textContent = account.user ? 'Saved to your account. Sign in on any device to see them.' : 'Everything is saved in this browser only. Using another device or clearing site data starts a fresh list.';
  const shown = items.filter((i) => filter === 'all' || i.subjectId === filter);
  const cur = filter === 'all' ? null : subjectById(filter);
  $('#libTitle').textContent = cur ? cur.name : 'Your experiments';
  $('#list').innerHTML = shown.length ? shown.map((i) => {
    const sub = subjectOf(i);
    const done = Object.values(i.stepsDone || {}).filter(Boolean).length;
    const pct = i.steps.length ? Math.round((done / i.steps.length) * 100) : 0;
    const best = i.bestAvg == null ? '' : `Viva ${i.bestAvg.toFixed(1)}/10`;
    return `<article class="card-item">
      <div class="tagline"><span class="tag" style="background:${esc(sub.color)}1A;color:${esc(sub.color)}"><span class="dot" style="background:${esc(sub.color)}"></span>${esc(sub.name)}</span><span>${esc(fmtDate(i.createdAt))}</span></div>
      <h3><a href="#/exp/${esc(i.id)}/summary">${esc(i.title)}</a></h3>
      <div class="mini-meter" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <div class="card-foot"><span>${done} of ${i.steps.length} steps${best ? ' · ' + esc(best) : ''}${i.completed ? ' · <span class="done-flag">Completed</span>' : ''}</span><button class="btn ghost sm del" type="button" data-del="${esc(i.id)}" aria-label="Delete ${esc(i.title)}">Delete</button></div>
    </article>`;
  }).join('') : `<div class="empty"><b>${items.length ? 'Nothing in this subject yet' : 'No experiments yet'}</b>${items.length ? 'Upload a PDF above and choose this subject.' : 'Upload your first experiment PDF above. It will show up here.'}</div>`;
  // Keep the subject box in step with what the person is looking at.
  const box = $('#subjectInput');
  if (!box.dataset.touched) box.value = suggestSubject();
}
$('#subjectInput').addEventListener('input', () => { $('#subjectInput').dataset.touched = '1'; });
$('#subjectBar').onclick = (e) => {
  if (e.target.closest('[data-act="addsubject"]')) return addSubject();
  const b = e.target.closest('[data-filter]');
  if (b) { filter = b.dataset.filter; delete $('#subjectInput').dataset.touched; renderHome(); }
};
$('#subjectTools').onclick = (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'rename') renameSubject(filter);
  else if (b.dataset.act === 'delsubject') deleteSubject(filter);
};
$('#list').onclick = (e) => {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  const it = findItem(b.dataset.del);
  if (it && confirm(`Delete “${it.title}” ${account.user ? 'from your account' : 'from this browser'}?`)) { items = items.filter((x) => x.id !== it.id); saveData(); renderHome(); toast('Experiment deleted.'); }
};

/* ---------- experiment view ---------- */
const TABS = [['summary', 'Summary'], ['steps', 'Steps'], ['viva', 'Viva'], ['source', 'Source']];
const sessions = {};
let currentId = null, currentTab = 'summary';

function codeBox(code, label, key) {
  return `<div class="codewrap"><div class="codehead"><span>${esc(label)}</span><button type="button" data-copy="${esc(key)}">Copy</button></div><pre class="code"><code>${esc(code)}</code></pre></div>`;
}

function renderExperiment(id, tab) {
  const it = findItem(id);
  if (!it) { location.hash = '#/'; return; }
  currentId = id;
  currentTab = TABS.some((t) => t[0] === tab) ? tab : 'summary';
  $('#home').hidden = true;
  const root = $('#experiment');
  root.hidden = false;
  const sub = subjectOf(it);
  const badge = it.provider === 'ai' ? '<span class="badge ai">Written by AI</span>' : '<span class="badge basic">Basic draft, no AI</span>';
  const options = subjects.map((s) => `<option value="${esc(s.id)}" ${s.id === it.subjectId ? 'selected' : ''}>${esc(s.name)}</option>`).join('') + '<option value="__new">+ New subject…</option>';
  root.innerHTML = `
    <a class="crumb" href="#/">&larr; All experiments</a>
    <div class="exp-head">
      <h1>${esc(it.title)}</h1>
      <div class="exp-actions">
        <button class="btn outline sm" type="button" data-act="complete">${it.completed ? 'Completed ✓' : 'Mark completed'}</button>
        <details class="menu"><summary class="btn outline sm" aria-label="More actions">More</summary>
          <div class="menu-list"><button type="button" data-act="reanalyze">Re-analyze</button><button type="button" class="danger-t" data-act="delete">Delete experiment</button></div>
        </details>
      </div>
    </div>
    <div class="meta-row">
      <label class="subject-pick"><span class="dot" style="background:${esc(sub.color)}"></span><select id="moveSubject" aria-label="Subject">${options}</select></label>
      ${badge}<span>${it.pages ? it.pages + ' page' + (it.pages === 1 ? '' : 's') : ''}</span>
    </div>
    ${it.note ? `<p class="note">${esc(it.note)}${it.provider !== 'ai' && status.ai && it.text ? ' <button class="btn primary sm" type="button" data-act="reanalyze">Try AI again</button>' : ''}</p>` : ''}
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

function paras(text) {
  return String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p class="prose">${esc(p)}</p>`).join('');
}
function summaryHtml(it) {
  return `<div class="panel">
    <div class="aim"><small>AIM</small><p>${esc(it.aim || it.title)}</p></div>
    <h2>Summary</h2>
    ${paras(it.summary)}
    ${it.requirements.length ? `<h2>What you need</h2><ul class="pills">${it.requirements.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    ${it.terms.length ? `<h2>Key terms</h2><dl class="terms">${it.terms.map((t) => `<div><dt>${esc(t.term)}</dt><dd>${esc(t.meaning)}</dd></div>`).join('')}</dl>` : ''}
    ${it.logic.length ? `<h2>How it works</h2><ol class="logic">${it.logic.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>` : ''}
    ${it.expectedOutput ? `<h2>Expected output</h2><pre class="code expected"><code>${esc(it.expectedOutput)}</code></pre>` : ''}
    ${it.keyPoints.length ? `<h2>Points to remember</h2><ul class="points">${it.keyPoints.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>` : ''}
    ${it.mistakes.length ? `<h2>Common mistakes</h2><ul class="points mistakes">${it.mistakes.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>` : ''}
    ${it.figures.length ? `<h2>Diagrams and figures</h2><div class="figs">${it.figures.map((f) => `<div class="fig"><b>${esc(f.title)}</b><p>${esc(f.description)}</p></div>`).join('')}</div>` : ''}
    <div class="nextrow"><button class="btn primary" type="button" data-tab="steps">Continue to steps</button></div>
  </div>`;
}

function stepsHtml(it) {
  const done = it.steps.filter((_, i) => it.stepsDone[i]).length;
  const pct = it.steps.length ? Math.round((done / it.steps.length) * 100) : 0;
  if (!it.steps.length) return '<div class="panel"><p>No steps were found for this experiment. Try Re-analyze from the More menu.</p></div>';
  return `<div class="panel">
    <div class="stepbar"><strong>${done} of ${it.steps.length} done</strong><div class="meter" aria-hidden="true"><span style="width:${pct}%"></span></div><button class="btn ghost sm" type="button" data-act="resetsteps">Clear ticks</button></div>
    <ol class="steps">${it.steps.map((s, i) => `<li class="step ${it.stepsDone[i] ? 'done' : ''}">
      <label><input type="checkbox" data-step="${i}" ${it.stepsDone[i] ? 'checked' : ''}><span class="st-title"><span class="st-num">${i + 1}.</span>${esc(s.title)}</span>${s.detail && s.detail !== s.title ? `<p class="st-detail">${esc(s.detail)}</p>` : ''}</label>
      ${s.code ? codeBox(s.code, 'Code or command', 'step:' + i) : ''}
    </li>`).join('')}</ol>
    <div class="nextrow"><button class="btn primary" type="button" data-tab="viva">Continue to viva</button></div>
  </div>`;
}

function sourceHtml(it) {
  return `<div class="panel">
    <h2>Text read from your PDF</h2>
    <p class="muted">This is exactly what the site read. If something looks wrong here, the summary and steps may be off too.</p>
    <p><button class="btn outline sm" type="button" data-copy="text">Copy all text</button></p>
    <pre class="text">${esc(it.text || 'No text was saved.')}</pre>
    ${it.codeBlocks.length ? `<h2>Code found in the PDF</h2>${it.codeBlocks.map((b, i) => codeBox(b.code, `${b.title} (${b.language})`, 'block:' + i)).join('')}` : ''}
  </div>`;
}

/* ----- viva ----- */
const levelLabel = { basic: 'Basic', concept: 'Concept', applied: 'Applied' };

function vivaHtml(it) {
  if (!it.viva.length) return '<div class="panel"><p>No viva questions were generated for this experiment. Try Re-analyze from the More menu.</p></div>';
  const s = sessions[it.id];
  if (!s) return vivaIntroHtml(it);
  if (s.phase === 'done') return vivaDoneHtml(it, s);
  return vivaQuestionHtml(it, s);
}

function vivaIntroHtml(it) {
  const all = it.viva.map((v, i) => `<div class="qa"><b>${i + 1}. ${esc(v.q)}</b><p>${esc(v.a)}</p></div>`).join('');
  return `<div class="panel">
    <div class="viva-intro">
      <h2>Viva practice</h2>
      <p class="muted">${it.viva.length} questions, one at a time, like an examiner would ask them. Type or say your answer, check it, and see the model answer.</p>
      ${it.bestAvg != null ? `<p><strong>Best score so far: ${it.bestAvg.toFixed(1)} out of 10</strong></p>` : ''}
      <div class="viva-opts">
        <button class="btn primary" type="button" data-act="vivastart">Start viva</button>
        ${status.ai ? '<button class="btn outline" type="button" data-act="vivamore">Add more questions</button>' : ''}
        <label class="check"><input type="checkbox" id="shuffle" checked> Shuffle</label>
      </div>
    </div>
    <details class="qa-all"><summary>Read all questions and answers</summary>${all}</details>
  </div>`;
}

function followUpHtml(q) {
  return q.followUp && q.followUp.q ? `<details class="followup"><summary>The examiner may ask next: ${esc(q.followUp.q)}</summary><p class="model">${esc(q.followUp.a)}</p></details>` : '';
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
        ${g.feedback ? `<h4>FEEDBACK</h4><p>${esc(g.feedback)}</p>` : ''}
        ${g.note ? `<p class="muted">${esc(g.note)}</p>` : ''}
        ${g.strengths && g.strengths.length ? `<h4>YOU GOT RIGHT</h4><ul class="strengths">${g.strengths.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
        ${g.missing && g.missing.length ? `<h4>YOU COULD ADD</h4><ul class="missing">${g.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
        ${g.improved ? `<h4>A STRONGER VERSION OF YOUR ANSWER</h4><p class="model">${esc(g.improved)}</p>` : ''}
        <h4>MODEL ANSWER</h4><p class="model">${esc(q.a)}</p>
        ${followUpHtml(q)}
      </div></div>`;
  } else if (s.phase === 'revealed') {
    grade = `<div class="grade"><div class="grade-body"><h4>MODEL ANSWER</h4><p class="model">${esc(q.a)}</p>${followUpHtml(q)}</div></div>`;
  }
  const last = s.pos >= total - 1;
  const lock = s.phase === 'checking' ? 'disabled' : '';
  return `<div class="panel">
    <div class="vq-top"><span>Question ${s.pos + 1} of ${total}</span><span class="level">${esc(levelLabel[q.level] || 'Concept')}</span></div>
    <div class="vq-bar"><span style="width:${Math.round(((s.pos + (answered ? 1 : 0)) / total) * 100)}%"></span></div>
    <p class="vq">${esc(q.q)}</p>
    ${q.hint && !answered ? `<details class="hint"><summary>Need a hint?</summary><p>${esc(q.hint)}</p></details>` : ''}
    <textarea id="answer" class="answer-box" aria-label="Your answer" ${answered || s.phase === 'checking' ? 'readonly' : ''} placeholder="Answer the way you would say it to the examiner.">${esc(s.draft)}</textarea>
    <div class="vq-actions">
      ${answered
        ? `<button class="btn primary" type="button" data-act="vivanext">${last ? 'See my result' : 'Next question'}</button>`
        : `<button class="btn primary" type="button" data-act="vivacheck" ${lock}>${s.phase === 'checking' ? 'Checking…' : 'Check my answer'}</button>
           <button class="btn outline" type="button" data-act="vivareveal" ${lock}>Show answer</button>
           <button class="btn ghost" type="button" data-act="vivaskip" ${lock}>Skip</button>
           ${speech ? '<button class="btn outline mic" type="button" data-act="mic" aria-pressed="false">Speak</button>' : ''}`}
    </div>
    ${grade}
    <div class="vq-actions" style="margin-top:22px"><button class="btn ghost sm" type="button" data-act="vivaquit">End practice</button></div>
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
  const cls = mean != null && mean >= 7 ? 'good' : mean != null && mean >= 4 ? 'mid' : 'low';
  return `<div class="panel">
    <h2>Your result</h2>
    <p class="score ${cls} result-big">${mean == null ? '—' : mean.toFixed(1)}<small> / 10 average</small></p>
    <p>${esc(verdict)}</p>
    <table class="result-table"><tbody>${rows}</tbody></table>
    <div class="vq-actions">
      ${weak.length ? `<button class="btn primary" type="button" data-act="vivaweak">Practise ${weak.length} weaker question${weak.length === 1 ? '' : 's'}</button>` : ''}
      <button class="btn outline" type="button" data-act="vivastart">Start again</button>
      ${status.ai ? '<button class="btn outline" type="button" data-act="vivamore">Add more questions</button>' : ''}
      <button class="btn ghost" type="button" data-act="vivaquit">Back</button>
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
  saveData();
}

let recognition = null;
function stopMic() { try { recognition && recognition.stop(); } catch {} recognition = null; }
function toggleMic(btn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  if (recognition) { stopMic(); btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); btn.textContent = 'Speak'; return; }
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
    recognition.onerror = () => { stopMic(); btn.classList.remove('on'); btn.textContent = 'Speak'; toast('The microphone could not be used. Allow microphone access, or type your answer.'); };
    recognition.onend = () => { recognition = null; btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); btn.textContent = 'Speak'; };
    recognition.start();
    btn.classList.add('on');
    btn.setAttribute('aria-pressed', 'true');
    btn.textContent = 'Stop';
  } catch { recognition = null; toast('Speech input is not available in this browser. Type your answer instead.'); }
}

async function checkCurrent(it, s) {
  const area = $('#answer');
  s.draft = area ? area.value : s.draft;
  if (!s.draft.trim()) { toast('Write or say an answer first, or choose Show answer.'); return; }
  stopMic();
  const idx = s.order[s.pos];
  const q = it.viva[idx];
  s.phase = 'checking';
  renderTab();
  try {
    const r = await api('/api/viva/check', { method: 'POST', json: { question: q.q, modelAnswer: q.a, keywords: q.keywords || [], userAnswer: s.draft } });
    s.last = r;
    recordResult(it, s, idx, r.score);
    s.phase = 'graded';
    saveData();
  } catch (err) {
    s.phase = 'answer';
    toast(err.message);
  }
  if (sessions[it.id] === s && currentId === it.id && currentTab === 'viva') renderTab();
}

async function reanalyze(it) {
  if (!it.text) { toast('There is no saved text to analyze.'); return; }
  const hasProgress = Object.values(it.stepsDone || {}).some(Boolean) || Object.keys(it.scores || {}).length > 0;
  if ((it.provider === 'ai' || hasProgress) && !confirm('Re-analyze this experiment? The summary, steps and viva questions will be rewritten. Your ticked steps and viva scores are cleared.')) return;
  toast('Re-analyzing. This takes about 20 to 40 seconds…');
  try {
    const d = await api('/api/reanalyze', { method: 'POST', json: { name: it.name, text: it.text } });
    Object.assign(it, {
      title: d.title || it.title, aim: d.aim || '', summary: d.summary || '', requirements: d.requirements || [], keyPoints: d.keyPoints || [],
      terms: d.terms || [], logic: d.logic || [], mistakes: d.mistakes || [], expectedOutput: d.expectedOutput || '',
      steps: d.steps || [], viva: d.viva || [], figures: d.figures && d.figures.length ? d.figures : it.figures, codeBlocks: d.codeBlocks || it.codeBlocks, provider: d.provider || 'offline', note: d.note || '',
      stepsDone: {}, scores: {}, bestAvg: null
    });
    delete sessions[it.id];
    saveData();
    if (currentId === it.id) renderExperiment(it.id, currentTab); // do not yank the user back if they already left
    toast(d.provider === 'ai' ? 'Re-analyzed with AI.' : 'The AI could not be used this time. The basic draft is shown.');
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
    saveData();
    delete sessions[it.id];
    if (currentId === it.id && currentTab === 'viva') renderTab();
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
  const menu = $('#experiment .menu');
  if (menu && menu.open && !e.target.closest('summary')) menu.open = false;
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
  if (a === 'complete') { it.completed = !it.completed; saveData(); renderExperiment(it.id, currentTab); }
  else if (a === 'delete') { if (confirm(`Delete “${it.title}” ${account.user ? 'from your account' : 'from this browser'}?`)) { items = items.filter((x) => x.id !== it.id); delete sessions[it.id]; saveData(); location.hash = '#/'; toast('Experiment deleted.'); } }
  else if (a === 'reanalyze') reanalyze(it);
  else if (a === 'resetsteps') { it.stepsDone = {}; saveData(); renderTab(); }
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
$('#experiment').addEventListener('change', async (e) => {
  const it = findItem(currentId);
  if (!it) return;
  if (e.target.id === 'moveSubject') {
    let val = e.target.value;
    if (val === '__new') {
      if (subjects.length >= MAX_SUBJECTS) { toast(`You can have up to ${MAX_SUBJECTS} subjects.`); e.target.value = it.subjectId; return; }
      const name = await askText({
        title: 'New subject', label: 'Subject name', ok: 'Add and move',
        validate: (v) => (subjects.some((s) => sameName(s.name, v)) ? 'You already have a subject with that name. Pick it from the list.' : '')
      });
      if (!name) { e.target.value = it.subjectId; return; }
      val = subjectByName(name, true).id;
    }
    if (val !== it.subjectId && subjectById(val)) {
      it.subjectId = val;
      saveData();
      toast(`Moved to ${subjectById(val).name}.`);
    }
    if (currentId === it.id) renderExperiment(it.id, currentTab);
    return;
  }
  const cb = e.target.closest('[data-step]');
  if (!cb) return;
  it.stepsDone[cb.dataset.step] = cb.checked;
  saveData();
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

async function init() {
  setFile(null);
  await loadStatus(); // tells us whether accounts are on and who is signed in
  storeKey = account.user ? 'labprep.u.' + account.user.id : 'labprep.v2';
  loadData();
  if (!account.user) writeCache(false); // saves any migration of old data
  route();
  if (account.user) {
    await initAccountData();
    await maybeImportLocal();
    route();
  }
}
init();
