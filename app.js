
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const state = {
  user: null,
  subjects: [],
  documents: [],
  progress: [],
  quizResults: [],
  counts: {},
  view: "overview",
  subjectKey: null,
  subjectTab: "materials",
  activeDoc: null,
  authMode: "login",
  quiz: null
};

const colors = [
  { bg: "#edf0ff", fg: "#5368d5", icon: "⌘" },
  { bg: "#e5f7ef", fg: "#269a70", icon: "⌁" },
  { bg: "#fff0e5", fg: "#d98a45", icon: "⌬" },
  { bg: "#f2eaff", fg: "#9569cf", icon: "⌘" },
  { bg: "#e5f5fb", fg: "#3596b9", icon: "✳" }
];

function esc(s = "") {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function getSubjectKey(s) {
  return String(s?.key ?? s?.id ?? s?.subject_key ?? "");
}

function normalizeSubjectKey(key) {
  const value = String(key ?? "");
  const match = state.subjects.find(s =>
    getSubjectKey(s) === value ||
    String(s.name || "").toLowerCase() === value.toLowerCase()
  );
  return match ? getSubjectKey(match) : value;
}

function subject(key) {
  const normalized = normalizeSubjectKey(key);
  return state.subjects.find(s => getSubjectKey(s) === normalized) || {
    key: normalized,
    name: "Subject",
    subtitle: "Your study material"
  };
}

function toast(message, error = false) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = message;
  t.classList.toggle("error", error);
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 3200);
}

async function api(url, options = {}) {
  const opts = {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(options.headers || {})
    }
  };

  if (
    options.body &&
    !(options.body instanceof FormData) &&
    typeof options.body !== "string"
  ) {
    opts.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, opts);
  let data = {};

  try {
    data = await response.json();
  } catch {
    // Response was not JSON.
  }

  if (!response.ok) {
    if (response.status === 401 && !url.includes("/api/me")) {
      showAuth();
    }
    throw new Error(data.error || `Request failed (${response.status}).`);
  }

  return data;
}

async function refresh() {
  const d = await api("/api/dashboard");

  state.subjects = (d.subjects || []).map(s => ({
    ...s,
    key: getSubjectKey(s)
  }));

  state.documents = (d.documents || []).map(doc => ({
    ...doc,
    subject_key: normalizeSubjectKey(
      doc.subject_key ?? doc.subject ?? doc.subject_id
    ),
    uploaded_at: doc.uploaded_at ?? doc.created_at ?? "",
    original_name: doc.original_name ?? doc.originalName ?? ""
  }));

  state.progress = (d.progress || []).map(p => ({
    ...p,
    subject_key: normalizeSubjectKey(
      p.subject_key ?? p.subject ?? p.subject_id
    ),
    item_key: p.item_key ?? p.experiment ?? "",
    done: Boolean(p.done ?? p.completed)
  }));

  state.quizResults = (
    d.quizResults || d.quiz_results || []
  ).map(r => ({
    ...r,
    subject_key: normalizeSubjectKey(
      r.subject_key ?? r.subject ?? r.subject_id
    )
  }));

  state.counts = d.counts || {};
  renderAll();
}

function showAuth() {
  state.user = null;
  $("#authScreen").classList.remove("hidden");
  $("#appShell").classList.add("hidden");
}

function showApp(user) {
  state.user = user;
  $("#authScreen").classList.add("hidden");
  $("#appShell").classList.remove("hidden");

  const first = (user.name || "Student").trim().split(/\s+/)[0];
  $("#welcomeTitle").textContent = `Let's make today count, ${first}.`;
  $("#sideName").textContent = user.name || "Student";
  $("#sideEmail").textContent = user.email || "";
  $("#avatar").textContent = (user.name || "S").charAt(0).toUpperCase();
  $("#topAvatar").textContent = (user.name || "S").charAt(0).toUpperCase();
}

function setAuthMode(mode) {
  state.authMode = mode;
  $$(".auth-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.auth === mode)
  );

  $("#nameWrap").classList.toggle("hidden", mode !== "register");
  $("#name").required = mode === "register";
  $("#authTitle").textContent =
    mode === "login" ? "Welcome back" : "Create your account";
  $("#authSubtitle").textContent = mode === "login"
    ? "Sign in to continue your preparation."
    : "Set up your private lab study workspace.";

  $("#authSubmit").innerHTML = mode === "login"
    ? 'Sign in <span>→</span>'
    : 'Create account <span>→</span>';

  $("#password").autocomplete =
    mode === "login" ? "current-password" : "new-password";
  $("#authError").textContent = "";
}

function fillSubjectSelects() {
  const options = state.subjects.map(s => {
    const key = getSubjectKey(s);
    return `<option value="${esc(key)}">${esc(s.name || key)}</option>`;
  }).join("");

  $("#uploadSubject").innerHTML = options;
  $("#quizSubject").innerHTML = options;
  $("#subjectFilter").innerHTML =
    '<option value="all">All subjects</option>' + options;
}

function doneCount() {
  return state.progress.filter(p => p.done).length;
}

function allProgressItems() {
  return state.progress.length;
}

function renderAll() {
  fillSubjectSelects();
  renderOverview();
  renderLibrary();
  renderProgress();

  const navCount = $("#libraryNavCount");
  if (navCount) navCount.textContent = state.documents.length;
}

function renderOverview() {
  const total = state.documents.length;
  const subjectsReady = state.subjects.filter(s =>
    state.documents.some(d => d.subject_key === getSubjectKey(s))
  ).length;

  const done = doneCount();
  const totalItems = allProgressItems();
  const percent = totalItems ? Math.round(done / totalItems * 100) : 0;

  $("#statPdfs").textContent = total;
  $("#statSubjects").innerHTML = `${subjectsReady} <small>/ 5</small>`;
  $("#statDone").textContent = done;
  $("#statProgress").textContent = percent + "%";
  $("#overallBar").style.width = percent + "%";

  $("#subjectGrid").innerHTML = state.subjects.map((s, i) => {
    const c = colors[i % colors.length];
    const key = getSubjectKey(s);
    const count = state.counts[key] || 0;

    return `
      <article class="subject-card" data-subject="${esc(key)}">
        <div class="subject-card-top">
          <div class="subject-icon" style="background:${c.bg};color:${c.fg}">${c.icon}</div>
          <span class="subject-index">0${i + 1}</span>
        </div>
        <h3>${esc(s.name)}</h3>
        <p>${esc(s.subtitle || "")}</p>
        <div class="subject-card-foot">
          <span>${count} PDF${count === 1 ? "" : "s"}</span>
          <b>Open →</b>
        </div>
      </article>`;
  }).join("");

  const recent = state.documents.slice(0, 4);

  $("#recentList").innerHTML = recent.length
    ? recent.map(d => `
      <div class="recent-item">
        <div class="pdf-icon">PDF</div>
        <div class="recent-meta">
          <b>${esc(d.title)}</b>
          <span>${esc(subject(d.subject_key).name)} · ${dateLabel(d.uploaded_at)}</span>
        </div>
        <button class="recent-open" data-open="${d.id}" aria-label="Open PDF">↗</button>
      </div>`).join("")
    : `<div class="empty-state">No PDFs yet. Upload your first lab manual to get started.</div>`;

  $("#focusTitle").textContent = total
    ? "Turn notes into revision"
    : "Start with one subject";

  $("#focusText").textContent = total
    ? "Open a PDF and generate viva questions or a quick summary."
    : "Upload your lab manual and turn it into a revision plan.";

  $("#focusAction").textContent = total
    ? "Open PDF library →"
    : "Upload your first PDF →";

  $("#focusAction").onclick = () =>
    total ? navigate("library") : openUpload();
}

function dateLabel(date) {
  if (!date) return "Recently";
  const d = new Date(
    String(date).includes("T") ? date : String(date).replace(" ", "T") + "Z"
  );

  return isNaN(d)
    ? "Recently"
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderLibrary() {
  const q = ($("#searchInput")?.value || "").toLowerCase().trim();
  const filter = $("#subjectFilter")?.value || "all";

  const docs = state.documents.filter(d =>
    (filter === "all" || d.subject_key === filter) &&
    `${d.title} ${d.original_name} ${subject(d.subject_key).name}`
      .toLowerCase().includes(q)
  );

  $("#libraryList").innerHTML = docs.length
    ? docs.map(d => `
      <div class="library-row">
        <div class="pdf-icon">PDF</div>
        <div class="recent-meta">
          <b>${esc(d.title)}</b>
          <span>${esc(subject(d.subject_key).name)} · ${esc(d.original_name)} · ${dateLabel(d.uploaded_at)}</span>
        </div>
        <div class="library-actions">
          <button class="small-btn primary-small" data-open="${d.id}">Read & revise</button>
          <button class="small-btn" data-tool-open="${d.id}" data-tool="viva">Viva Q&amp;A</button>
          <button class="small-btn danger" data-delete="${d.id}">Delete</button>
        </div>
      </div>`).join("")
    : `<div class="panel empty-state">${state.documents.length
      ? "No PDFs match your search."
      : "Your library is empty. Upload a PDF to begin."}</div>`;
}

function renderProgress() {
  const items = state.progress;
  const done = doneCount();
  const pending = items.length - done;

  $("#progressDone").textContent = done;
  $("#progressPending").textContent = pending;
  $("#progressQuizzes").textContent = state.quizResults.length;

  $("#progressSubjects").innerHTML = state.subjects.map(s => {
    const key = getSubjectKey(s);
    const arr = items.filter(p => p.subject_key === key);
    const n = arr.filter(p => p.done).length;
    const percent = arr.length ? Math.round(n / arr.length * 100) : 0;

    return `
      <div class="progress-subject-row">
        <b>${esc(s.name)}</b>
        <div class="progress-track">
          <div class="progress-fill" style="width:${percent}%"></div>
        </div>
        <span>${n}/${arr.length}</span>
      </div>`;
  }).join("");

  $("#quizHistory").innerHTML = state.quizResults.length
    ? state.quizResults.map(r => `
      <div class="history-row">
        <div>
          <b>${esc(subject(r.subject_key).name)}</b>
          <div class="muted">${dateLabel(r.created_at)}</div>
        </div>
        <span class="score-pill">${r.score}/${r.total} correct</span>
      </div>`).join("")
    : `<div class="empty-state">Your completed quizzes will appear here.</div>`;
}

function navigate(view) {
  state.view = view;

  $$(".view").forEach(v => v.classList.add("hidden"));

  const target = $("#" + view + "View");
  if (target) target.classList.remove("hidden");

  $$(".nav-item[data-view]").forEach(b =>
    b.classList.toggle("active", b.dataset.view === view)
  );

  $("#breadcrumbName").textContent = ({
    overview: "Overview",
    library: "PDF library",
    practice: "Practice quiz",
    progress: "My progress",
    subject: "Subject"
  })[view] || "Workspace";

  $("#sidebar").classList.remove("open");
}

function openSubject(key) {
  state.subjectKey = normalizeSubjectKey(key);
  state.subjectTab = "materials";

  const s = subject(state.subjectKey);
  const i = state.subjects.findIndex(x =>
    getSubjectKey(x) === state.subjectKey
  );
  const c = colors[Math.max(0, i) % colors.length];

  $("#subjectHeader").innerHTML = `
    <div class="subject-icon" style="background:${c.bg};color:${c.fg}">${c.icon}</div>
    <div>
      <div class="eyebrow blue-eyebrow">SUBJECT SPACE · 0${i + 1}</div>
      <h1>${esc(s.name)}</h1>
      <p>${esc(s.subtitle || "")}</p>
    </div>
    <div class="hero-spacer"></div>
    <button class="btn btn-primary" id="subjectUploadBtn">＋ Add PDF</button>`;

  $$(".subject-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.subtab === "materials")
  );

  renderSubjectContent();
  navigate("subject");

  $("#subjectUploadBtn").onclick = () => openUpload(state.subjectKey);
}

function renderSubjectContent() {
  const key = state.subjectKey;
  const docs = state.documents.filter(d => d.subject_key === key);
  const items = state.progress.filter(p => p.subject_key === key);

  $("#subjectContent").innerHTML =
    state.subjectTab === "materials"
      ? `
        <div class="subject-content-grid">
          <section class="panel">
            <div class="panel-heading">
              <div>
                <h2>Study materials</h2>
                <p class="muted">${docs.length} PDF${docs.length === 1 ? "" : "s"} saved in this subject.</p>
              </div>
              <button class="text-button" id="subjectAddBtn">＋ Add PDF</button>
            </div>
            ${docs.length ? docs.map(d => `
              <div class="recent-item">
                <div class="pdf-icon">PDF</div>
                <div class="recent-meta">
                  <b>${esc(d.title)}</b>
                  <span>${dateLabel(d.uploaded_at)}</span>
                </div>
                <button class="small-btn primary-small" data-open="${d.id}">Open</button>
              </div>`).join("") :
              `<div class="empty-state">No materials here yet. Add your lab manual or experiment PDFs.</div>`}
          </section>
          <section class="panel">
            <div class="panel-heading">
              <div>
                <h2>Revision tools</h2>
                <p class="muted">Choose a PDF to get started.</p>
              </div>
            </div>
            <div class="empty-state">Open a PDF to create a summary, viva questions, and important questions from its content.</div>
            <button class="btn btn-outline btn-wide" id="subjectQuizBtn">Practice quiz →</button>
          </section>
        </div>`
      : state.subjectTab === "tracker"
        ? `
          <div class="panel">
            <div class="panel-heading">
              <div>
                <h2>Experiment tracker</h2>
                <p class="muted">Add experiments or tasks and tick them off as you revise.</p>
              </div>
              <span class="score-pill">${items.filter(p => p.done).length}/${items.length} done</span>
            </div>
            <div class="tracker-list">
              ${items.map(p => `
                <label class="tracker-item ${p.done ? "done" : ""}">
                  <input type="checkbox" data-progress="${esc(p.item_key)}" ${p.done ? "checked" : ""}>
                  <span>${esc(p.item_key)}</span>
                </label>`).join("") ||
                `<div class="empty-state">No tracker items yet. Add an experiment below.</div>`}
            </div>
            <form id="trackerAddForm" class="tracker-add">
              <input id="trackerItem" maxlength="100" placeholder="e.g. Experiment 1 — Verify Ohm's law" required>
              <button type="submit">Add</button>
            </form>
          </div>`
        : `
          <div class="panel">
            <div class="panel-heading">
              <div>
                <h2>Practice this subject</h2>
                <p class="muted">Questions use text extracted from your saved PDFs.</p>
              </div>
            </div>
            <p class="muted">${docs.length
              ? `${docs.length} PDF(s) available for question generation.`
              : "Upload a text-based PDF first for subject-specific questions."}</p>
            <button id="subjectStartQuiz" class="btn btn-primary">Start practice quiz →</button>
          </div>`;

  $("#subjectAddBtn")?.addEventListener("click", () => openUpload(key));

  $("#subjectQuizBtn")?.addEventListener("click", () => {
    navigate("practice");
    $("#quizSubject").value = key;
    startQuiz();
  });

  $("#subjectStartQuiz")?.addEventListener("click", () => {
    navigate("practice");
    $("#quizSubject").value = key;
    startQuiz();
  });

  $$("[data-progress]", $("#subjectContent")).forEach(input => {
    input.addEventListener("change", async () => {
      try {
        await api("/api/progress", {
          method: "POST",
          body: {
            subject_key: key,
            item_key: input.dataset.progress,
            done: input.checked
          }
        });
        await refresh();
        renderSubjectContent();
      } catch (e) {
        toast(e.message, true);
      }
    });
  });

  $("#trackerAddForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const item = $("#trackerItem").value.trim();
    if (!item) return;

    try {
      await api("/api/progress", {
        method: "POST",
        body: { subject_key: key, item_key: item, done: false }
      });
      await refresh();
      renderSubjectContent();
      toast("Tracker item saved.");
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function openUpload(subjectKey) {
  $("#uploadModal").classList.remove("hidden");
  $("#uploadError").textContent = "";
  $("#uploadForm").reset();

  fillSubjectSelects();

  if (subjectKey != null) {
    const key = normalizeSubjectKey(subjectKey);
    if ([...$("#uploadSubject").options].some(o => o.value === key)) {
      $("#uploadSubject").value = key;
    }
  }

  $("#fileLabel").textContent = "Choose a PDF to upload";
}

function closeUpload() {
  $("#uploadModal").classList.add("hidden");
}

async function openReader(id) {
  const d = state.documents.find(x => x.id === Number(id));
  if (!d) return;

  state.activeDoc = d;
  $("#readerTitle").textContent = d.title;
  $("#readerSubtitle").textContent = subject(d.subject_key).name;
  $("#pdfFrame").src = `/api/documents/${d.id}/file`;
  $("#outputTitle").textContent = "Make this PDF easier to revise";
  $("#outputContent").innerHTML =
    '<div class="output-empty">✦<span>Your revision notes will appear here.</span></div>';
  $("#outputSource").textContent = "";
  $("#readerModal").classList.remove("hidden");
}

function closeReader() {
  $("#readerModal").classList.add("hidden");
  $("#pdfFrame").src = "about:blank";
  state.activeDoc = null;
}

async function generateTool(mode) {
  if (!state.activeDoc) return;

  const labels = {
    summary: "Study summary",
    viva: "Viva questions & answers",
    important: "Important questions"
  };

  $("#outputTitle").textContent = labels[mode] || "Study tool";
  $("#outputContent").textContent = "Preparing study material…";
  $("#outputSource").textContent = "Using your uploaded PDF";

  $$("[data-tool]", $("#readerModal")).forEach(b => b.disabled = true);

  try {
    const d = await api("/api/study-tools", {
      method: "POST",
      body: { document_id: state.activeDoc.id, mode }
    });

    $("#outputContent").textContent = d.result;
    $("#outputSource").textContent = d.provider === "ai"
      ? "Generated with your configured AI provider. Review answers against your lab manual."
      : "Built-in text-based draft. For stronger AI generation, configure an AI API key on the server.";
  } catch (e) {
    $("#outputContent").textContent = e.message;
    toast(e.message, true);
  } finally {
    $$("[data-tool]", $("#readerModal")).forEach(b => b.disabled = false);
  }
}

async function deleteDoc(id) {
  const d = state.documents.find(x => x.id === Number(id));
  if (!d || !confirm(`Delete "${d.title}" and its saved PDF?`)) return;

  try {
    await api(`/api/documents/${id}`, { method: "DELETE" });
    await refresh();
    if (state.view === "subject") renderSubjectContent();
    toast("PDF deleted.");
  } catch (e) {
    toast(e.message, true);
  }
}

function openDocTool(id, mode) {
  openReader(id).then(() => generateTool(mode));
}

async function startQuiz() {
  const key = $("#quizSubject").value;
  if (!key) {
    toast("Please select a subject first.", true);
    return;
  }

  $("#quizArea").innerHTML =
    '<div class="panel empty-state">Building your quiz…</div>';

  try {
    const d = await api(`/api/quiz/${encodeURIComponent(key)}`);
    state.quiz = {
      key,
      questions: d.questions || [],
      index: 0,
      answers: [],
      selected: null
    };

    if (!state.quiz.questions.length) {
      $("#quizArea").innerHTML =
        '<div class="panel empty-state">No quiz questions are available for this subject yet.</div>';
      return;
    }

    renderQuizQuestion();
    if (d.note) toast(d.note);
  } catch (e) {
    $("#quizArea").innerHTML =
      `<div class="panel empty-state">${esc(e.message)}</div>`;
  }
}

function renderQuizQuestion() {
  const qz = state.quiz;
  if (!qz) return;

  const total = qz.questions.length;
  if (qz.index >= total) {
    finishQuiz();
    return;
  }

  const q = qz.questions[qz.index];

  $("#quizArea").innerHTML = `
    <div class="panel quiz-card">
      <div class="quiz-progress">
        <span>QUESTION ${qz.index + 1} OF ${total}</span>
        <span>${Math.round(qz.index / total * 100)}% complete</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width:${qz.index / total * 100}%"></div>
      </div>
      <h2 class="quiz-question">${esc(q.question)}</h2>
      <div class="quiz-options">
        ${(q.options || []).map((o, i) => `
          <button class="quiz-option ${qz.selected === o ? "selected" : ""}" data-option="${esc(o)}">
            <span class="option-letter">${String.fromCharCode(65 + i)}</span>
            <span>${esc(o)}</span>
          </button>`).join("")}
      </div>
      <div class="quiz-footer">
        <span class="muted">Choose one answer.</span>
        <button id="quizNext" class="btn btn-primary" ${qz.selected === null ? "disabled" : ""}>
          ${qz.index === total - 1 ? "Finish quiz" : "Next question"} →
        </button>
      </div>
    </div>`;

  $$("[data-option]", $("#quizArea")).forEach(b => {
    b.addEventListener("click", () => {
      qz.selected = b.dataset.option;
      renderQuizQuestion();
    });
  });

  $("#quizNext").addEventListener("click", () => {
    qz.answers.push(qz.selected);
    qz.index++;
    qz.selected = null;
    renderQuizQuestion();
  });
}

async function finishQuiz() {
  const qz = state.quiz;
  const score = qz.questions.reduce(
    (n, q, i) => n + (q.answer === qz.answers[i] ? 1 : 0),
    0
  );

  $("#quizArea").innerHTML = `
    <div class="panel result-wrap">
      <div class="quiz-symbol" style="margin:auto">✦</div>
      <h2 style="margin-top:17px">Practice complete!</h2>
      <div class="result-score">${score}/${qz.questions.length}</div>
      <p class="muted">${
        score === qz.questions.length
          ? "Excellent work — you got every question right."
          : score >= qz.questions.length / 2
            ? "Good effort. Review the concepts you missed and try again."
            : "Keep practicing. Revisit your lab notes and give it another go."
      }</p>
      <button id="retryQuiz" class="btn btn-primary">Try again →</button>
      <button id="reviewLibrary" class="btn btn-outline">Review PDFs</button>
    </div>`;

  try {
    await api("/api/quiz-results", {
      method: "POST",
      body: {
        subject_key: qz.key,
        score,
        total: qz.questions.length
      }
    });
    await refresh();
  } catch (e) {
    console.error("Could not save quiz result:", e);
  }

  $("#retryQuiz").onclick = startQuiz;
  $("#reviewLibrary").onclick = () => navigate("library");
}

/* Authentication */

$("#authForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("#authError").textContent = "";

  const body = {
    email: $("#email").value.trim(),
    password: $("#password").value
  };

  if (state.authMode === "register") {
    body.name = $("#name").value.trim();
  }

  const button = $("#authSubmit");
  button.disabled = true;

  try {
    const d = await api(`/api/${state.authMode}`, {
      method: "POST",
      body
    });

    showApp(d.user);
    await refresh();

    toast(
      state.authMode === "login"
        ? "Welcome back!"
        : "Account created successfully."
    );
  } catch (err) {
    $("#authError").textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

$$(".auth-tab").forEach(b =>
  b.addEventListener("click", () => setAuthMode(b.dataset.auth))
);

$("#logoutBtn").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST", body: {} });
  } catch {}
  showAuth();
  setAuthMode("login");
});

/* Upload controls */

$("#quickUploadBtn").addEventListener("click", () => openUpload());
$("#libraryUploadBtn").addEventListener("click", () => openUpload());

$("#uploadForm").addEventListener("submit", async e => {
  e.preventDefault();

  const file = $("#pdfFile").files[0];
  const selectedSubject = $("#uploadSubject").value;

  if (!selectedSubject) {
    $("#uploadError").textContent =
      "Please select a subject from the dropdown.";
    return;
  }

  const canonicalKey = normalizeSubjectKey(selectedSubject);
  const validSubject = state.subjects.some(
    s => getSubjectKey(s) === canonicalKey
  );

  if (!validSubject) {
    $("#uploadError").textContent =
      "The selected subject is not recognized. Refresh and try again.";
    return;
  }

  if (!file) {
    $("#uploadError").textContent = "Please choose a PDF file.";
    return;
  }

  if (
    file.type !== "application/pdf" &&
    !file.name.toLowerCase().endsWith(".pdf")
  ) {
    $("#uploadError").textContent = "Please choose a valid PDF file.";
    return;
  }

  if (file.size > 15 * 1024 * 1024) {
    $("#uploadError").textContent =
      "The PDF must be smaller than 15 MB.";
    return;
  }

  const fd = new FormData();
  fd.append("pdf", file);

  // Include both names while aligning frontend/backend validation.
  fd.append("subject", canonicalKey);
  fd.append("subject_key", canonicalKey);
  fd.append("title", $("#uploadTitleInput").value.trim());

  const button = $("#uploadSubmit");
  button.disabled = true;
  button.textContent = "Uploading…";
  $("#uploadError").textContent = "";

  try {
    const result = await api("/api/documents", {
      method: "POST",
      body: fd
    });

    await refresh();
    closeUpload();

    toast(
      result.extractedText
        ? "PDF uploaded and saved."
        : "PDF saved. Text extraction may not be available for scanned PDFs."
    );

    if (state.view === "subject") {
      renderSubjectContent();
    }
  } catch (err) {
    $("#uploadError").textContent =
      err.message || "Upload failed. Please try again.";
  } finally {
    button.disabled = false;
    button.innerHTML = 'Upload and save <span>→</span>';
  }
});

$("#pdfFile").addEventListener("change", () => {
  $("#fileLabel").textContent =
    $("#pdfFile").files[0]?.name || "Choose a PDF to upload";
});

$("#dropzone").addEventListener("dragover", e => {
  e.preventDefault();
  $("#dropzone").style.borderColor = "#3157d5";
});

$("#dropzone").addEventListener("dragleave", () => {
  $("#dropzone").style.borderColor = "";
});

$("#dropzone").addEventListener("drop", e => {
  e.preventDefault();
  $("#dropzone").style.borderColor = "";

  const f = e.dataTransfer.files[0];

  if (
    f &&
    (/pdf$/i.test(f.name) || f.type === "application/pdf")
  ) {
    $("#pdfFile").files = e.dataTransfer.files;
    $("#fileLabel").textContent = f.name;
  } else {
    toast("Please drop a PDF file.", true);
  }
});

$$(".close-modal").forEach(b =>
  b.addEventListener("click", closeUpload)
);

$("#uploadModal").addEventListener("click", e => {
  if (e.target === $("#uploadModal")) closeUpload();
});

/* Reader controls */

$$(".close-reader").forEach(b =>
  b.addEventListener("click", closeReader)
);

$("#readerModal").addEventListener("click", e => {
  if (e.target === $("#readerModal")) closeReader();
});

$$("[data-tool]", $("#readerModal")).forEach(b =>
  b.addEventListener("click", () => generateTool(b.dataset.tool))
);

/* Navigation */

$$(".nav-item[data-view]").forEach(b =>
  b.addEventListener("click", () => navigate(b.dataset.view))
);

$$("[data-go]").forEach(b =>
  b.addEventListener("click", () => navigate(b.dataset.go))
);

$("#subjectGrid").addEventListener("click", e => {
  const card = e.target.closest("[data-subject]");
  if (card) openSubject(card.dataset.subject);
});

$("#searchInput").addEventListener("input", renderLibrary);
$("#subjectFilter").addEventListener("change", renderLibrary);

$("#libraryList").addEventListener("click", e => {
  const open = e.target.closest("[data-open]");
  const del = e.target.closest("[data-delete]");
  const tool = e.target.closest("[data-tool-open]");

  if (open) openReader(open.dataset.open);
  if (del) deleteDoc(del.dataset.delete);
  if (tool) openDocTool(tool.dataset.toolOpen, tool.dataset.tool);
});

$("#recentList").addEventListener("click", e => {
  const b = e.target.closest("[data-open]");
  if (b) openReader(b.dataset.open);
});

$("#subjectContent").addEventListener("click", e => {
  const b = e.target.closest("[data-open]");
  if (b) openReader(b.dataset.open);
});

$$(".subject-tab").forEach(b => {
  b.addEventListener("click", () => {
    state.subjectTab = b.dataset.subtab;
    $$(".subject-tab").forEach(x =>
      x.classList.toggle("active", x === b)
    );
    renderSubjectContent();
  });
});

$("#startQuizBtn").addEventListener("click", startQuiz);
$("#menuBtn").addEventListener("click", () =>
  $("#sidebar").classList.toggle("open")
);

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeUpload();
    closeReader();
    $("#sidebar").classList.remove("open");
  }
});

async function boot() {
  try {
    setAuthMode("login");

    const d = await api("/api/me");
    state.subjects = (d.subjects || []).map(s => ({
      ...s,
      key: getSubjectKey(s)
    }));

    if (d.user) {
      showApp(d.user);
      await refresh();
    } else {
      showAuth();
    }
  } catch (e) {
    console.error("LabPrep startup error:", e);
    showAuth();
    toast("Could not connect to the server. Check the server deployment.", true);
  }
}

boot();
