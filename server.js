const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "labprep.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    subject_key TEXT NOT NULL,
    title TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    text_content TEXT NOT NULL DEFAULT '',
    uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    subject_key TEXT NOT NULL,
    item_key TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, subject_key, item_key),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS quiz_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    subject_key TEXT NOT NULL,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  name: "labprep.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(express.static(path.join(ROOT, "public")));

const SUBJECTS = [
  { key: "subject1", name: "Subject 1", subtitle: "Add your first lab subject" },
  { key: "subject2", name: "Subject 2", subtitle: "Organize manuals and records" },
  { key: "subject3", name: "Subject 3", subtitle: "Revise experiments and concepts" },
  { key: "subject4", name: "Subject 4", subtitle: "Prepare for practical viva" },
  { key: "subject5", name: "Subject 5", subtitle: "Track your revision progress" }
];

function safeUser(user) {
  return user ? { id: user.id, name: user.name, email: user.email } : null;
}
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Please sign in to continue." });
  next();
}
function getUser(req) {
  return db.prepare("SELECT id,name,email FROM users WHERE id=?").get(req.session.userId);
}
function getOwnedDoc(id, userId) {
  return db.prepare("SELECT * FROM documents WHERE id=? AND user_id=?").get(id, userId);
}
function cleanTitle(s) {
  return String(s || "").trim().replace(/[<>]/g, "").slice(0, 100);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, crypto.randomUUID() + ".pdf")
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const isPdf = file.mimetype === "application/pdf" || path.extname(file.originalname).toLowerCase() === ".pdf";
    cb(isPdf ? null : new Error("Only PDF files are allowed."), isPdf);
  }
});

app.get("/api/me", (req, res) => {
  res.json({ user: safeUser(getUser(req)), subjects: SUBJECTS });
});

app.post("/api/register", async (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 60);
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (name.length < 2) return res.status(400).json({ error: "Enter your name (at least 2 characters)." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8) return res.status(400).json({ error: "Use a password with at least 8 characters." });
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)").run(name, email, hash);
    req.session.userId = result.lastInsertRowid;
    res.json({ user: safeUser(getUser(req)) });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return res.status(409).json({ error: "An account with that email already exists." });
    res.status(500).json({ error: "Could not create your account." });
  }
});

app.post("/api/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  req.session.userId = user.id;
  res.json({ user: safeUser(user) });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("labprep.sid");
    res.json({ ok: true });
  });
});

app.get("/api/dashboard", requireAuth, (req, res) => {
  const userId = req.session.userId;
  const docs = db.prepare("SELECT id,subject_key,title,original_name,uploaded_at FROM documents WHERE user_id=? ORDER BY uploaded_at DESC").all(userId);
  const progress = db.prepare("SELECT subject_key,item_key,done FROM progress WHERE user_id=?").all(userId);
  const quizResults = db.prepare("SELECT subject_key,score,total,created_at FROM quiz_results WHERE user_id=? ORDER BY id DESC LIMIT 5").all(userId);
  const counts = Object.fromEntries(SUBJECTS.map(s => [s.key, docs.filter(d => d.subject_key === s.key).length]));
  res.json({ subjects: SUBJECTS, documents: docs, progress, quizResults, counts });
});

app.post("/api/documents", requireAuth, (req, res, next) => {
  upload.single("pdf")(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed." });
    try {
      if (!req.file) return res.status(400).json({ error: "Choose a PDF file to upload." });
      const subjectKey = String(req.body.subject_key || "");
      if (!SUBJECTS.some(s => s.key === subjectKey)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "Choose one of the five subjects." });
      }
      let extracted = "";
      try {
        const buffer = fs.readFileSync(req.file.path);
        const parsed = await pdfParse(buffer);
        extracted = String(parsed.text || "").slice(0, 250000);
      } catch (_) {
        extracted = "";
      }
      const title = cleanTitle(req.body.title) || path.basename(req.file.originalname, path.extname(req.file.originalname)).slice(0, 100);
      const result = db.prepare(`INSERT INTO documents(user_id,subject_key,title,original_name,stored_name,text_content)
        VALUES(?,?,?,?,?,?)`).run(req.session.userId, subjectKey, title, req.file.originalname.slice(0, 200), path.basename(req.file.filename), extracted);
      res.json({ ok: true, id: result.lastInsertRowid, extractedText: Boolean(extracted) });
    } catch (e) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      next(e);
    }
  });
});

app.get("/api/documents/:id/file", requireAuth, (req, res) => {
  const doc = getOwnedDoc(Number(req.params.id), req.session.userId);
  if (!doc) return res.status(404).json({ error: "PDF not found." });
  const filePath = path.join(UPLOAD_DIR, path.basename(doc.stored_name));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Stored PDF file is missing." });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(doc.original_name)}"`);
  res.sendFile(filePath);
});

app.get("/api/documents/:id/text", requireAuth, (req, res) => {
  const doc = getOwnedDoc(Number(req.params.id), req.session.userId);
  if (!doc) return res.status(404).json({ error: "Document not found." });
  res.json({ id: doc.id, title: doc.title, text: doc.text_content || "" });
});

app.delete("/api/documents/:id", requireAuth, (req, res) => {
  const doc = getOwnedDoc(Number(req.params.id), req.session.userId);
  if (!doc) return res.status(404).json({ error: "Document not found." });
  db.prepare("DELETE FROM documents WHERE id=? AND user_id=?").run(doc.id, req.session.userId);
  const filePath = path.join(UPLOAD_DIR, path.basename(doc.stored_name));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ ok: true });
});

app.post("/api/progress", requireAuth, (req, res) => {
  const subjectKey = String(req.body.subject_key || "");
  const itemKey = cleanTitle(req.body.item_key);
  const done = req.body.done ? 1 : 0;
  if (!SUBJECTS.some(s => s.key === subjectKey) || !itemKey) return res.status(400).json({ error: "Invalid progress item." });
  db.prepare(`INSERT INTO progress(user_id,subject_key,item_key,done) VALUES(?,?,?,?)
    ON CONFLICT(user_id,subject_key,item_key) DO UPDATE SET done=excluded.done`).run(req.session.userId, subjectKey, itemKey, done);
  res.json({ ok: true });
});

app.post("/api/quiz-results", requireAuth, (req, res) => {
  const subjectKey = String(req.body.subject_key || "");
  const score = Math.max(0, Math.min(1000, Number(req.body.score) || 0));
  const total = Math.max(1, Math.min(1000, Number(req.body.total) || 1));
  if (!SUBJECTS.some(s => s.key === subjectKey)) return res.status(400).json({ error: "Invalid subject." });
  db.prepare("INSERT INTO quiz_results(user_id,subject_key,score,total) VALUES(?,?,?,?)").run(req.session.userId, subjectKey, score, total);
  res.json({ ok: true });
});

function splitSentences(text) {
  return String(text || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 35 && s.length < 500);
}
function fallbackStudy(text, mode) {
  const sentences = splitSentences(text).slice(0, 120);
  const keywords = [...new Set((text.match(/\b[A-Z][A-Za-z-]{3,}\b/g) || []).filter(w => !["This","That","These","Those","Figure","Table","Experiment","Procedure","Result","Conclusion"].includes(w)))].slice(0, 30);
  if (!sentences.length) {
    return mode === "viva"
      ? "This PDF does not contain extractable text. Try a text-based PDF, or use the PDF reader to study it."
      : "No extractable PDF text was found. Scanned PDFs may need OCR before summaries and questions can be generated.";
  }
  if (mode === "summary") {
    return "STUDY SUMMARY\n\n" + sentences.slice(0, 8).map((s, i) => `${i + 1}. ${s}`).join("\n\n") +
      (keywords.length ? "\n\nKEY TERMS TO REVIEW\n" + keywords.join(", ") : "");
  }
  if (mode === "important") {
    return "IMPORTANT QUESTIONS TO PRACTICE\n\n" + sentences.slice(0, 10).map((s, i) => `${i + 1}. Explain or define: ${s}`).join("\n\n");
  }
  return "VIVA PRACTICE QUESTIONS\n\n" + sentences.slice(0, 10).map((s, i) => `${i + 1}. Explain this concept in your own words: ${s}\nSuggested answer: ${s}`).join("\n\n");
}
async function aiStudy(text, mode, title) {
  const key = process.env.AI_API_KEY;
  if (!key) return { result: fallbackStudy(text, mode), provider: "built-in" };
  const baseUrl = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.AI_MODEL || "gpt-4o-mini";
  const instructions = {
    viva: "Create 10 useful lab viva questions with concise correct answers. Use only the supplied source; say if it does not contain the answer.",
    summary: "Create a clear student-friendly revision summary with headings, key definitions, steps, formulas if present, and a short list of takeaways. Do not invent details.",
    important: "Create 10 likely practical/lab internal questions from the source. Mix definitions, procedure, principle, observations, result, applications and troubleshooting where relevant. Do not claim certainty about exam questions."
  };
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a careful lab-exam study assistant. Ground all content in the supplied source. Be accurate and concise." },
        { role: "user", content: `${instructions[mode]}\nDocument title: ${title}\n\nSOURCE TEXT:\n${String(text).slice(0, 18000)}` }
      ],
      temperature: 0.3
    })
  });
  if (!response.ok) throw new Error("AI provider request failed.");
  const data = await response.json();
  return { result: data.choices?.[0]?.message?.content || fallbackStudy(text, mode), provider: "ai" };
}
app.post("/api/study-tools", requireAuth, async (req, res) => {
  const id = Number(req.body.document_id);
  const mode = String(req.body.mode || "");
  if (!["viva", "summary", "important"].includes(mode)) return res.status(400).json({ error: "Unknown study tool." });
  const doc = getOwnedDoc(id, req.session.userId);
  if (!doc) return res.status(404).json({ error: "Document not found." });
  try {
    const out = await aiStudy(doc.text_content, mode, doc.title);
    res.json(out);
  } catch (e) {
    res.status(502).json({ error: "AI generation failed. Check your API settings and try again." });
  }
});

app.get("/api/quiz/:subjectKey", requireAuth, (req, res) => {
  const subjectKey = req.params.subjectKey;
  if (!SUBJECTS.some(s => s.key === subjectKey)) return res.status(400).json({ error: "Invalid subject." });
  const docs = db.prepare("SELECT id,title,text_content FROM documents WHERE user_id=? AND subject_key=? ORDER BY id DESC").all(req.session.userId, subjectKey);
  const text = docs.map(d => d.title + ". " + d.text_content).join("\n").slice(0, 250000);
  const sentences = splitSentences(text);
  const words = [...new Set((text.match(/\b[a-zA-Z]{5,}\b/g) || []).map(w => w.toLowerCase()))].filter(w => !["which","their","there","these","those","about","should","would","could","using","where","when","after","before","figure","table","result","procedure","experiment"].includes(w));
  const questions = [];
  const selected = sentences.slice(0, 8);
  selected.forEach((sentence, i) => {
    const candidates = sentence.match(/\b[A-Z][a-zA-Z-]{3,}\b/g) || [];
    const answer = candidates.find(w => !["This","That","These","Those","When","Where","Which","Figure","Table"].includes(w)) || (sentence.split(" ")[0] || "Concept").replace(/[^\w-]/g, "");
    const prompt = sentence.length > 130 ? sentence.slice(0, 125) + "…" : sentence;
    const wrong = words.filter(w => w.toLowerCase() !== answer.toLowerCase()).slice(i, i + 3);
    while (wrong.length < 3) wrong.push(["voltage","method","system","process"][wrong.length % 4]);
    const options = [answer, ...wrong.slice(0, 3)].sort(() => Math.random() - 0.5);
    questions.push({ question: `According to your uploaded notes, which term best matches this statement?\n“${prompt}”`, options, answer });
  });
  if (!questions.length) {
    return res.json({ questions: [
      { question: "What should you do before using a lab instrument?", options: ["Read the procedure and safety guidance", "Skip all instructions", "Guess the settings", "Ignore precautions"], answer: "Read the procedure and safety guidance" },
      { question: "What is a good way to prepare for a viva?", options: ["Explain concepts in your own words", "Memorize only page numbers", "Avoid practice", "Skip the experiment principle"], answer: "Explain concepts in your own words" }
    ], note: "Upload a text-based PDF to generate questions from your notes." });
  }
  res.json({ questions });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(PORT, () => console.log(`LabPrep AI running at http://localhost:${PORT}`));
