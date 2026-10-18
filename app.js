
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

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[c]));
}

function getSubjectKey(s) {
  return String(s?.key ?? s?.id ?? s?.subject_key ?? "");
}

function subject(key) {
  const value = String(key ?? "");
  return state.subjects.find(s =>
    getSubjectKey(s) === value ||
    String(s.name || "").toLowerCase() === value.toLowerCase()
  ) || { key: value, name: "Subject", subtitle: "Your study material" };
}

function toast(message, error = false) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error", error);
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3500);
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
    // The server did not return JSON.
  }

  if (!response.ok) {
    if (response.status === 401 && !url.includes("/api/me")) {
      showAuth();
    }
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

function normalizeDocument(doc) {
  const rawKey = doc.subject_key ?? doc.subject ?? doc.subject_id ?? "";
  const matched = state.subjects.find(s =>
    getSubjectKey(s) === String(rawKey) ||
    String(s.id ?? "") === String(rawKey) ||
    String(s.name || "").toLowerCase() === String(rawKey).toLowerCase()
  );

  return {
    ...doc,
    id: Number(doc.id),
    title: doc.title || doc.original_name || doc.filename || "Untitled PDF",
    original_name: doc.original_name || doc.originalName || doc.filename || "PDF file",
    subject_key: matched ? getSubjectKey(matched) : String(rawKey),
    uploaded_at: doc.uploaded_at || doc.created_at || doc.createdAt || ""
  };
}

async function refresh() {
  const dashboard = await api("/api/dashboard");

  state.subjects = (dashboard.subjects || state.subjects || []).map(s => ({
    ...s,
    key: getSubjectKey(s)
  }));

  let documentResponse;
  try {
    documentResponse = await api("/api/documents");
  } catch (error) {
    console.error("Could not load PDF library:", error);
    throw error;
  }

  const rawDocuments = Array.isArray(documentResponse)
    ? documentResponse
    : documentResponse.documents ||
      documentResponse.files ||
      documentResponse.items ||
      dashboard.documents ||
      dashboard.recentDocuments ||
      [];

  state.documents = rawDocuments.map(normalizeDocument);

  state.progress = (dashboard.progress || []).map(p => ({
    ...p,
    subject_key: String(p.subject_key ?? p.subject ?? p.subject_id ?? ""),
    item_key: p.item_key ?? p.experiment ?? "",
    done: Boolean(p.done ?? p.completed)
  }));

  state.quizResults =
    dashboard.quizResults ||
    dashboard.quiz_results ||
    [];

  state.counts = {};
  state.subjects.forEach(s => {
    const key = getSubjectKey(s);
    state.counts[key] = state.documents.filter(
      d => d.subject_key === key
    ).length;
  });

  renderAll();

  console.log("Loaded subjects:", state.subjects);
  console.log("Loaded PDFs:", state.documents);
}

function showAuth() {
  state.user = null;
  $("#authScreen")?.classList.remove("hidden");
  $("#appShell")?.classList.add("hidden");
}

function showApp(user) {
  state.user = user;
  $("#authScreen")?.classList.add("hidden");
  $("#appShell")?.classList.remove("hidden");

  const name = user.name || "Student";
  const first = name.trim().split(/\s+/)[0];

  if ($("#welcomeTitle")) $("#welcomeTitle").textContent = `Let's make today count, ${first}.`;
  if ($("#sideName")) $("#sideName").textContent = name;
  if ($("#sideEmail")) $("#sideEmail").textContent = user.email || "";
  if ($("#avatar")) $("#avatar").textContent = name.charAt(0).toUpperCase();
  if ($("#topAvatar")) $("#topAvatar").textContent = name.charAt(0).toUpperCase();
}

function setAuthMode(mode) {
  state.authMode = mode;

  $$(".auth-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.auth === mode)
  );

  if ($("#nameWrap")) $("#nameWrap").classList.toggle("hidden", mode !== "register");
  if ($("#name")) $("#name").required = mode === "register";
  if ($("#authTitle")) $("#authTitle").textContent =
    mode === "login" ? "Welcome back" : "Create your account";
  if ($("#authSubtitle")) $("#authSubtitle").textContent =
    mode === "login"
      ? "Sign in to continue your preparation."
      : "Set up your private lab study workspace.";
  if ($("#authSubmit")) $("#authSubmit").innerHTML =
    mode === "login" ? 'Sign in <span>→</span>' : 'Create account <span>→</span>';
  if ($("#password")) $("#password").autocomplete =
    mode === "login" ? "current-password" : "new-password";
  if ($("#authError")) $("#authError").textContent = "";
}

function fillSubjectSelects() {
  const options = state.subjects.map(s =>
    `<option value="${esc(getSubjectKey(s))}">${esc(s.name || getSubjectKey(s))}</option>`
  ).join("");

  if ($("#uploadSubject")) $("#uploadSubject").innerHTML = options;
  if ($("#quizSubject")) $("#quizSubject").innerHTML = options;
  if ($("#subjectFilter")) {
    $("#subjectFilter").innerHTML =
      '<option value="all">All subjects</option>' + options;
  }
}

function doneCount() {
  return state.progress.filter(p => p.done).length;
}

function renderAll() {
  fillSubjectSelects();
  renderOverview();
  renderLibrary();
  renderProgress();

  if ($("#libraryNavCount")) {
    $("#libraryNavCount").textContent = state.documents.length;
  }
}

function dateLabel(value) {
  if (!value) return "Recently";
  const date = new Date(
    String(value).includes("T") ? value : String(value).replace(" ", "T") + "Z"
  );

  return Number.isNaN(date.getTime())
    ? "Recently"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderOverview() {
  const total = state.documents.length;
  const subjectsReady = state.subjects.filter(s =>
    state.documents.some(d => d.subject_key === getSubjectKey(s))
  ).length;
  const done = doneCount();
  const totalItems = state.progress.length;
  const percent = totalItems ? Math.round(done / totalItems * 100) : 0;

  if ($("#statPdfs")) $("#statPdfs").textContent = total;
  if ($("#statSubjects")) $("#statSubjects").innerHTML = `${subjectsReady} <small>/ ${state.subjects.length}</small>`;
  if ($("#statDone")) $("#statDone").textContent = done;
  if ($("#statProgress")) $("#statProgress").textContent = percent + "%";
  if ($("#overallBar")) $("#overallBar").style.width = percent + "%";

  if ($("#subjectGrid")) {
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
  }

  const recent = state.documents.slice(0, 4);

  if ($("#recentList")) {
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
      : '<div class="empty-state">No PDFs yet. Upload your first lab manual to get started.</div>';
  }

  if ($("#focusTitle")) $("#focusTitle").textContent =
    total ? "Turn notes into revision" : "Start with one subject";
  if ($("#focusText")) $("#focusText").textContent =
    total
      ? "Open a PDF and generate viva questions or a quick summary."
      : "Upload your lab manual and turn it into a revision plan.";
  if ($("#focusAction")) {
    $("#focusAction").textContent = total ? "Open PDF library →" : "Upload your first PDF →";
    $("#focusAction").onclick = () => total ? navigate("library") : openUpload();
  }
}

function renderLibrary() {
  if (!$("#libraryList")) return;

  const query = ($("#searchInput")?.value || "").toLowerCase().trim();
  const filter = $("#subjectFilter")?.value || "all";

  const docs = state.documents.filter(d =>
    (filter === "all" || d.subject_key === filter) &&
    `${d.title} ${d.original_name} ${subject(d.subject_key).name}`
      .toLowerCase().includes(query)
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
    : `<div class="panel empty-state">${
        state.documents.length
          ? "No PDFs match your search."
          : "Your library is empty. Upload a PDF to begin."
      }</div>`;
}

function renderProgress() {
  if ($("#progressDone")) $("#progressDone").textContent = doneCount();
  if ($("#progressPending")) $("#progressPending").textContent =
    state.progress.length - doneCount();
  if ($("#progressQuizzes")) $("#progressQuizzes").textContent = state.quizResults.length;

  if ($("#progressSubjects")) {
    $("#progressSubjects").innerHTML = state.subjects.map(s => {
      const key = getSubjectKey(s);
      const items = state.progress.filter(p => p.subject_key === key);
      const done = items.filter(p => p.done).length;
      const percent = items.length ? Math.round(done / items.length * 100) : 0;

      return `
        <div class="progress-subject-row">
          <b>${esc(s.name)}</b>
          <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
          <span>${done}/${items.length}</span>
        </div>`;
    }).join("");
  }

  if ($("#quizHistory")) {
    $("#quizHistory").innerHTML = state.quizResults.length
      ? state.quizResults.map(r => `
        <div class="history-row">
          <div><b>${esc(subject(r.subject_key ?? r.subject).name)}</b>
          <div class="muted">${dateLabel(r.created_at)}</div></div>
          <span class="score-pill">${r.score}/${r.total} correct</span>
        </div>`).join("")
      : '<div class="empty-state">Your completed quizzes will appear here.</div>';
  }
}

function navigate(view) {
  state.view = view;

  $$(".view").forEach(v => v.classList.add("hidden"));
  $("#" + view + "View")?.classList.remove("hidden");

  $$(".nav-item[data-view]").forEach(b =>
    b.classList.toggle("active", b.dataset.view === view)
  );

  if ($("#breadcrumbName")) {
    $("#breadcrumbName").textContent = ({
      overview: "Overview",
      library: "PDF library",
      practice: "Practice quiz",
      progress: "My progress",
      subject: "Subject"
    })[view] || "Workspace";
  }

  $("#sidebar")?.classList.remove("open");
}

function openSubject(key) {
  state.subjectKey = String(key);
  state.subjectTab = "materials";

  const s = subject(key);
  const i = state.subjects.findIndex(x => getSubjectKey(x) === String(key));
  const c = colors[Math.max(0, i) % colors.length];

  if ($("#subjectHeader")) {
    $("#subjectHeader").innerHTML = `
      <div class="subject-icon" style="background:${c.bg};color:${c.fg}">${c.icon}</div>
      <div><div class="eyebrow blue-eyebrow">SUBJECT SPACE · 0${i + 1}</div>
      <h1>${esc(s.name)}</h1><p>${esc(s.subtitle || "")}</p></div>
      <div class="hero-spacer"></div>
      <button class="btn btn-primary" id="subjectUploadBtn">＋ Add PDF</button>`;
  }

  $$(".subject-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.subtab === "materials")
  );

  renderSubjectContent();
  navigate("subject");

  $("#subjectUploadBtn")?.addEventListener("click", () => openUpload(key));
}

function renderSubjectContent() {
  if (!$("#subjectContent")) return;

  const key = String(state.subjectKey);
  const docs = state.documents.filter(d => d.subject_key === key);
  const items = state.progress.filter(p => p.subject_key === key);

  if (state.subjectTab === "materials") {
    $("#subjectContent").innerHTML = `
      <div class="subject-content-grid">
        <section class="panel">
          <div class="panel-heading"><div><h2>Study materials</h2>
          <p class="muted">${docs.length} PDF${docs.length === 1 ? "" : "s"} saved in this subject.</p></div>
          <button class="text-button" id="subjectAddBtn">＋ Add PDF</button></div>
          ${docs.length ? docs.map(d => `
            <div class="recent-item"><div class="pdf-icon">PDF</div>
            <div class="recent-meta"><b>${esc(d.title)}</b>
            <span>${dateLabel(d.uploaded_at)}</span></div>
            <button class="small-btn primary-small" data-open="${d.id}">Open</button></div>
          `).join("") : '<div class="empty-state">No materials here yet. Add a PDF.</div>'}
        </section>
        <section class="panel"><h2>Revision tools</h2>
        <p class="muted">Open a PDF to create revision notes.</p>
        <button class="btn btn-outline btn-wide" id="subjectQuizBtn">Practice quiz →</button></section>
      </div>`;
  } else if (state.subjectTab === "tracker") {
    $("#subjectContent").innerHTML = `
      <div class="panel"><h2>Experiment tracker</h2>
      <p class="muted">${items.filter(p => p.done).length}/${items.length} done</p>
      <div class="tracker-list">${items.map(p => `
        <label class="tracker-item ${p.done ? "done" : ""}">
        <input type="checkbox" data-progress="${esc(p.item_key)}" ${p.done ? "checked" : ""}>
        <span>${esc(p.item_key)}</span></label>`).join("") ||
        '<div class="empty-state">No tracker items yet.</div>'}</div>
      <form id="trackerAddForm" class="tracker-add">
      <input id="trackerItem" maxlength="100" placeholder="Experiment or task" required>
      <button type="submit">Add</button></form></div>`;
  } else {
    $("#subjectContent").innerHTML = `
      <div class="panel"><h2>Practice this subject</h2>
      <p class="muted">${docs.length} PDF(s) available.</p>
      <button id="subjectStartQuiz" class="btn btn-primary">Start practice quiz →</button></div>`;
  }

  $("#subjectAddBtn")?.addEventListener("click", () => openUpload(key));

  const openQuiz = () => {
    navigate("practice");
    if ($("#quizSubject")) $("#quizSubject").value = key;
    startQuiz();
  };

  $("#subjectQuizBtn")?.addEventListener("click", openQuiz);
  $("#subjectStartQuiz")?.addEventListener("click", openQuiz);

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
      } catch (error) {
        toast(error.message, true);
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
    } catch (error) {
      toast(error.message, true);
    }
  });
}

function openUpload(subjectKey) {
  fillSubjectSelects();
  $("#uploadModal")?.classList.remove("hidden");
  if ($("#uploadError")) $("#uploadError").textContent = "";
  $("#uploadForm")?.reset();

  if (subjectKey != null && $("#uploadSubject")) {
    const key = String(subjectKey);
    if ([...$("#uploadSubject").options].some(o => o.value === key)) {
      $("#uploadSubject").value = key;
    }
  }

  if ($("#fileLabel")) $("#fileLabel").textContent = "Choose a PDF to upload";
}

function closeUpload() {
  $("#uploadModal")?.classList.add("hidden");
}

async function openReader(id) {
  const doc = state.documents.find(d => Number(d.id) === Number(id));
  if (!doc) {
    toast("PDF not found. Refresh the library and try again.", true);
    return;
  }

  state.activeDoc = doc;
  $("#readerTitle").textContent = doc.title;
  $("#readerSubtitle").textContent = subject(doc.subject_key).name;

  // Change this path if your server uses a different viewer route.
  $("#pdfFrame").src = `/api/documents/${doc.id}/view`;

  $("#outputTitle").textContent = "Make this PDF easier to revise";
  $("#outputContent").innerHTML =
    '<div class="output-empty">✦<span>Your revision notes will appear here.</span></div>';
  $("#outputSource").textContent = "";
  $("#readerModal").classList.remove("hidden");
}

function closeReader() {
  $("#readerModal")?.classList.add("hidden");
  if ($("#pdfFrame")) $("#pdfFrame").src = "about:blank";
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

  $$("[data-tool]", $("#readerModal")).forEach(b => b.disabled = true);

  try {
    const result = await api("/api/study-tools", {
      method: "POST",
      body: { document_id: state.activeDoc.id, mode }
    });

    $("#outputContent").textContent = result.result || "No result was returned.";
    $("#outputSource").textContent = result.provider === "ai"
      ? "Generated with your configured AI provider."
      : "Built-in text-based draft.";
  } catch (error) {
    $("#outputContent").textContent = error.message;
    toast(error.message, true);
  } finally {
    $$("[data-tool]", $("#readerModal")).forEach(b => b.disabled = false);
  }
}

async function deleteDoc(id) {
  const doc = state.documents.find(d => Number(d.id) === Number(id));
  if (!doc || !confirm(`Delete "${doc.title}" and its saved PDF?`)) return;

  try {
    await api(`/api/documents/${id}`, { method: "DELETE" });
    await refresh();
    if (state.view === "subject") renderSubjectContent();
    toast("PDF deleted.");
  } catch (error) {
    toast(error.message, true);
  }
}

function openDocTool(id, mode) {
  openReader(id).then(() => generateTool(mode));
}

async function startQuiz() {
  const key = $("#quizSubject")?.value;

  if (!key) {
    toast("Please select a subject first.", true);
    return;
  }

  $("#quizArea").innerHTML =
    '<div class="panel empty-state">Building your quiz…</div>';

  try {
    const data = await api(`/api/quiz/${encodeURIComponent(key)}`);

    state.quiz = {
      key,
      questions: data.questions || [],
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
    if (data.note) toast(data.note);
  } catch (error) {
    $("#quizArea").innerHTML =
      `<div class="panel empty-state">${esc(error.message)}</div>`;
  }
}

function renderQuizQuestion() {
  const quiz = state.quiz;
  if (!quiz) return;

  if (quiz.index >= quiz.questions.length) {
    finishQuiz();
    return;
  }

  const q = quiz.questions[quiz.index];
  const total = quiz.questions.length;

  $("#quizArea").innerHTML = `
    <div class="panel quiz-card">
      <div class="quiz-progress"><span>QUESTION ${quiz.index + 1} OF ${total}</span>
      <span>${Math.round(quiz.index / total * 100)}% complete</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${quiz.index / total * 100}%"></div></div>
      <h2 class="quiz-question">${esc(q.question)}</h2>
      <div class="quiz-options">${(q.options || []).map((option, i) => `
        <button class="quiz-option ${quiz.selected === option ? "selected" : ""}" data-option="${esc(option)}">
          <span class="option-letter">${String.fromCharCode(65 + i)}</span>
          <span>${esc(option)}</span>
        </button>`).join("")}</div>
      <div class="quiz-footer"><span class="muted">Choose one answer.</span>
      <button id="quizNext" class="btn btn-primary" ${quiz.selected === null ? "disabled" : ""}>
      ${quiz.index === total - 1 ? "Finish quiz" : "Next question"} →</button></div>
    </div>`;

  $$("[data-option]", $("#quizArea")).forEach(button => {
    button.addEventListener("click", () => {
      quiz.selected = button.dataset.option;
      renderQuizQuestion();
    });
  });

  $("#quizNext").addEventListener("click", () => {
    quiz.answers.push(quiz.selected);
    quiz.index++;
    quiz.selected = null;
    renderQuizQuestion();
  });
}

async function finishQuiz() {
  const quiz = state.quiz;
  const score = quiz.questions.reduce(
    (sum, q, i) => sum + (q.answer === quiz.answers[i] ? 1 : 0), 0
  );

  $("#quizArea").innerHTML = `
    <div class="panel result-wrap"><div class="quiz-symbol" style="margin:auto">✦</div>
    <h2 style="margin-top:17px">Practice complete!</h2>
    <div class="result-score">${score}/${quiz.questions.length}</div>
    <p class="muted">Quiz completed. Review your notes and try again.</p>
    <button id="retryQuiz" class="btn btn-primary">Try again →</button>
    <button id="reviewLibrary" class="btn btn-outline">Review PDFs</button></div>`;

  try {
    await api("/api/quiz-results", {
      method: "POST",
      body: {
        subject_key: quiz.key,
        score,
        total: quiz.questions.length
      }
    });
    await refresh();
  } catch (error) {
    console.error("Could not save quiz result:", error);
  }

  $("#retryQuiz").onclick = startQuiz;
  $("#reviewLibrary").onclick = () => navigate("library");
}

/* Authentication */

$("#authForm")?.addEventListener("submit", async e => {
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
    const data = await api(`/api/${state.authMode}`, {
      method: "POST",
      body
    });

    showApp(data.user);
    await refresh();
    toast(state.authMode === "login" ? "Welcome back!" : "Account created successfully.");
  } catch (error) {
    $("#authError").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$$(".auth-tab").forEach(b =>
  b.addEventListener("click", () => setAuthMode(b.dataset.auth))
);

$("#logoutBtn")?.addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST", body: {} });
  } catch (error) {
    console.error(error);
  }
  showAuth();
  setAuthMode("login");
});

/* Upload */

$("#quickUploadBtn")?.addEventListener("click", () => openUpload());
$("#libraryUploadBtn")?.addEventListener("click", () => openUpload());

$("#uploadForm")?.addEventListener("submit", async e => {
  e.preventDefault();

  const file = $("#pdfFile")?.files[0];
  const key = $("#uploadSubject")?.value;
  const errorBox = $("#uploadError");
  const button = $("#uploadSubmit");

  errorBox.textContent = "";

  const selected = state.subjects.find(s => getSubjectKey(s) === String(key));

  if (!selected) {
    errorBox.textContent = "Please select a valid subject. Refresh the page and try again.";
    return;
  }

  if (!file) {
    errorBox.textContent = "Please choose a PDF file.";
    return;
  }

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    errorBox.textContent = "Please choose a valid PDF file.";
    return;
  }

  if (file.size > 15 * 1024 * 1024) {
    errorBox.textContent = "The PDF must be smaller than 15 MB.";
    return;
  }

  const formData = new FormData();
  formData.append("pdf", file);
  formData.append("subject_key", getSubjectKey(selected));
  formData.append("subject", getSubjectKey(selected));
  formData.append("title", $("#uploadTitleInput")?.value.trim() || file.name);

  button.disabled = true;
  button.textContent = "Uploading…";

  try {
    const result = await api("/api/documents", {
      method: "POST",
      body: formData
    });

    console.log("Upload response:", result);

    await refresh();
    closeUpload();
    navigate("library");
    renderLibrary();

    toast("Upload request completed. Check your PDF library.");
  } catch (error) {
    console.error("Upload error:", error);
    errorBox.textContent = error.message || "Upload failed.";
  } finally {
    button.disabled = false;
    button.innerHTML = 'Upload and save <span>→</span>';
  }
});

$("#pdfFile")?.addEventListener("change", () => {
  $("#fileLabel").textContent =
    $("#pdfFile").files[0]?.name || "Choose a PDF to upload";
});

$("#dropzone")?.addEventListener("dragover", e => {
  e.preventDefault();
  $("#dropzone").style.borderColor = "#3157d5";
});

$("#dropzone")?.addEventListener("dragleave", () => {
  $("#dropzone").style.borderColor = "";
});

$("#dropzone")?.addEventListener("drop", e => {
  e.preventDefault();
  $("#dropzone").style.borderColor = "";

  const file = e.dataTransfer.files[0];

  if (file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    $("#pdfFile").files = e.dataTransfer.files;
    $("#fileLabel").textContent = file.name;
  } else {
    toast("Please drop a PDF file.", true);
  }
});

$$(".close-modal").forEach(b => b.addEventListener("click", closeUpload));
$("#uploadModal")?.addEventListener("click", e => {
  if (e.target === $("#uploadModal")) closeUpload();
});

/* Reader */

$$(".close-reader").forEach(b => b.addEventListener("click", closeReader));
$("#readerModal")?.addEventListener("click", e => {
  if (e.target === $("#readerModal")) closeReader();
});

$$("[data-tool]", $("#readerModal") || document).forEach(b =>
  b.addEventListener("click", () => generateTool(b.dataset.tool))
);

/* Navigation */

$$(".nav-item[data-view]").forEach(b =>
  b.addEventListener("click", () => navigate(b.dataset.view))
);

$$("[data-go]").forEach(b =>
  b.addEventListener("click", () => navigate(b.dataset.go))
);

$("#subjectGrid")?.addEventListener("click", e => {
  const card = e.target.closest("[data-subject]");
  if (card) openSubject(card.dataset.subject);
});

$("#searchInput")?.addEventListener("input", renderLibrary);
$("#subjectFilter")?.addEventListener("change", renderLibrary);

$("#libraryList")?.addEventListener("click", e => {
  const open = e.target.closest("[data-open]");
  const del = e.target.closest("[data-delete]");
  const tool = e.target.closest("[data-tool-open]");

  if (open) openReader(open.dataset.open);
  if (del) deleteDoc(del.dataset.delete);
  if (tool) openDocTool(tool.dataset.toolOpen, tool.dataset.tool);
});

$("#recentList")?.addEventListener("click", e => {
  const button = e.target.closest("[data-open]");
  if (button) openReader(button.dataset.open);
});

$("#subjectContent")?.addEventListener("click", e => {
  const button = e.target.closest("[data-open]");
  if (button) openReader(button.dataset.open);
});

$$(".subject-tab").forEach(b => {
  b.addEventListener("click", () => {
    state.subjectTab = b.dataset.subtab;
    $$(".subject-tab").forEach(x => x.classList.toggle("active", x === b));
    renderSubjectContent();
  });
});

$("#startQuizBtn")?.addEventListener("click", startQuiz);
$("#menuBtn")?.addEventListener("click", () => $("#sidebar")?.classList.toggle("open"));

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeUpload();
    closeReader();
    $("#sidebar")?.classList.remove("open");
  }
});

async function boot() {
  try {
    setAuthMode("login");
    const data = await api("/api/me");

    if (data.subjects) {
      state.subjects = data.subjects.map(s => ({
        ...s,
        key: getSubjectKey(s)
      }));
    }

    if (data.user) {
      showApp(data.user);
      await refresh();
    } else {
      showAuth();
    }
  } catch (error) {
    console.error("LabPrep startup error:", error);
    showAuth();
    toast("Could not connect to the server. Refresh and try again.", true);
  }
}

window.addEventListener("error", event => {
  console.error("LabPrep JavaScript error:", event.message);
});

boot();
