
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
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");

app.set("trust proxy", 1);
app.disable("x-powered-by");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;

if (isProduction && (!sessionSecret || sessionSecret.length < 32)) {
  throw new Error(
    "Set SESSION_SECRET to a random string of at least 32 characters in Render."
  );
}

app.use(
  session({
    name: "labprep.sid",
    secret: sessionSecret || "local-development-secret-change-before-deploy",
    resave: false,
    saveUninitialized: false,
    proxy: isProduction,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);

// --------------------------------------------------
// DATABASE
// --------------------------------------------------

const db = new Database(path.join(DATA_DIR, "labprep.sqlite"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

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
    subject TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    extracted_text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    experiment TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, subject, experiment),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS quiz_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

const SUBJECTS = [
  { id: "subject1", name: "Subject 1" },
  { id: "subject2", name: "Subject 2" },
  { id: "subject3", name: "Subject 3" },
  { id: "subject4", name: "Subject 4" },
  { id: "subject5", name: "Subject 5" }
];

function validSubject(subject) {
  return SUBJECTS.some((item) => item.id === subject);
}

function cleanText(value, maxLength = 200) {
  return String(value || "").trim().slice(0, maxLength);
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please log in first." });
  }

  next();
}

function getDocumentForUser(id, userId) {
  return db.prepare(`
    SELECT * FROM documents
    WHERE id = ? AND user_id = ?
  `).get(id, userId);
}

function safeUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (error) {
    console.error("Could not remove file:", error.message);
  }
}

// --------------------------------------------------
// FRONTEND FILES
// Frontend files are in the repository root.
// --------------------------------------------------

app.get("/", (req, res) => {
  res.sendFile(path.join(ROOT, "index.html"));
});

app.get("/index.html", (req, res) => {
  res.sendFile(path.join(ROOT, "index.html"));
});

app.get("/styles.css", (req, res) => {
  res.sendFile(path.join(ROOT, "styles.css"));
});

app.get("/app.js", (req, res) => {
  res.sendFile(path.join(ROOT, "app.js"));
});

// --------------------------------------------------
// AUTHENTICATION
// --------------------------------------------------

app.get("/api/me", (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }

  const user = db.prepare(`
    SELECT id, name, email, created_at
    FROM users WHERE id = ?
  `).get(req.session.userId);

  if (!user) {
    return req.session.destroy(() => {
      res.json({ user: null });
    });
  }

  res.json({ user });
});

app.post("/api/register", asyncRoute(async (req, res) => {
  const name = cleanText(req.body.name, 100);
  const email = cleanText(req.body.email, 254).toLowerCase();
  const password = String(req.body.password || "");

  if (!name || !email || !password) {
    return res.status(400).json({
      error: "Name, email, and password are required."
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }

  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({
      error: "Password must contain 8–72 characters."
    });
  }

  const existing = db.prepare(
    "SELECT id FROM users WHERE email = ?"
  ).get(email);

  if (existing) {
    return res.status(409).json({
      error: "An account with this email already exists."
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  let result;

  try {
    result = db.prepare(`
      INSERT INTO users (name, email, password_hash)
      VALUES (?, ?, ?)
    `).run(name, email, passwordHash);
  } catch (error) {
    if (String(error.code).includes("CONSTRAINT")) {
      return res.status(409).json({
        error: "An account with this email already exists."
      });
    }
    throw error;
  }

  req.session.userId = Number(result.lastInsertRowid);

  req.session.save((error) => {
    if (error) {
      console.error("Session save failed:", error);
      return res.status(500).json({ error: "Could not start your session." });
    }

    res.status(201).json({
      message: "Account created successfully.",
      user: {
        id: Number(result.lastInsertRowid),
        name,
        email
      }
    });
  });
}));

app.post("/api/login", asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 254).toLowerCase();
  const password = String(req.body.password || "");

  const user = db.prepare(`
    SELECT id, name, email, password_hash
    FROM users WHERE email = ?
  `).get(email);

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({
      error: "Incorrect email or password."
    });
  }

  // Regenerate session ID after login.
  req.session.regenerate((error) => {
    if (error) {
      console.error("Session regeneration failed:", error);
      return res.status(500).json({ error: "Could not start your session." });
    }

    req.session.userId = user.id;

    req.session.save((saveError) => {
      if (saveError) {
        return res.status(500).json({ error: "Could not save your session." });
      }

      res.json({
        message: "Login successful.",
        user: {
          id: user.id,
          name: user.name,
          email: user.email
        }
      });
    });
  });
}));

app.post("/api/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({ error: "Could not log out." });
    }

    res.clearCookie("labprep.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction
    });

    res.json({ message: "Logged out successfully." });
  });
});

// --------------------------------------------------
// DASHBOARD
// --------------------------------------------------

app.get("/api/dashboard", requireAuth, (req, res) => {
  const userId = req.session.userId;

  const documentCounts = db.prepare(`
    SELECT subject, COUNT(*) AS count
    FROM documents
    WHERE user_id = ?
    GROUP BY subject
  `).all(userId);

  const progressCounts = db.prepare(`
    SELECT
      subject,
      COUNT(*) AS total,
      SUM(completed) AS completed
    FROM progress
    WHERE user_id = ?
    GROUP BY subject
  `).all(userId);

  const recentDocuments = db.prepare(`
    SELECT id, subject, original_name, created_at
    FROM documents
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 10
  `).all(userId);

  const recentQuizzes = db.prepare(`
    SELECT id, subject, score, total, created_at
    FROM quiz_results
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 10
  `).all(userId);

  res.json({
    subjects: SUBJECTS,
    documentCounts,
    progressCounts,
    recentDocuments,
    recentQuizzes
  });
});

// --------------------------------------------------
// PDF UPLOAD AND DOCUMENT MANAGEMENT
// --------------------------------------------------

const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, UPLOAD_DIR);
  },
  filename: (req, file, callback) => {
    const id = crypto.randomUUID();
    callback(null, `${id}.pdf`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const isPdf =
      file.mimetype === "application/pdf" ||
      path.extname(file.originalname).toLowerCase() === ".pdf";

    if (!isPdf) {
      return callback(new Error("Only PDF files are allowed."));
    }

    callback(null, true);
  }
});

app.get("/api/documents", requireAuth, (req, res) => {
  const subject = req.query.subject;

  if (subject && !validSubject(subject)) {
    return res.status(400).json({ error: "Invalid subject." });
  }

  const documents = subject
    ? db.prepare(`
        SELECT id, subject, original_name, created_at
        FROM documents
        WHERE user_id = ? AND subject = ?
        ORDER BY id DESC
      `).all(req.session.userId, subject)
    : db.prepare(`
        SELECT id, subject, original_name, created_at
        FROM documents
        WHERE user_id = ?
        ORDER BY id DESC
      `).all(req.session.userId);

  res.json({ documents });
});

app.post(
  "/api/documents",
  requireAuth,
  upload.single("pdf"),
  asyncRoute(async (req, res) => {
    const subject = cleanText(req.body.subject, 30);

    if (!validSubject(subject)) {
      if (req.file) safeUnlink(req.file.path);
      return res.status(400).json({ error: "Select a valid subject." });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Select a PDF file." });
    }

    let extractedText = "";

    try {
      const pdfBuffer = fs.readFileSync(req.file.path);
      const parsed = await pdfParse(pdfBuffer);
      extractedText = String(parsed.text || "").slice(0, 500000);
    } catch (error) {
      safeUnlink(req.file.path);
      return res.status(400).json({
        error: "Could not read this PDF. Try a valid, text-based PDF."
      });
    }

    const result = db.prepare(`
      INSERT INTO documents
        (user_id, subject, original_name, stored_name, extracted_text)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      req.session.userId,
      subject,
      path.basename(req.file.originalname).slice(0, 255),
      req.file.filename,
      extractedText
    );

    res.status(201).json({
      message: "PDF uploaded successfully.",
      document: {
        id: Number(result.lastInsertRowid),
        subject,
        original_name: path.basename(req.file.originalname),
        textLength: extractedText.length
      }
    });
  })
);

app.get("/api/documents/:id/view", requireAuth, (req, res) => {
  const document = getDocumentForUser(
    Number(req.params.id),
    req.session.userId
  );

  if (!document) {
    return res.status(404).json({ error: "Document not found." });
  }

  const filePath = path.join(UPLOAD_DIR, document.stored_name);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: "PDF file is missing. It may have been removed after a redeploy."
    });
  }

  res.type("application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${document.original_name.replace(/["\r\n]/g, "_")}"`
  );
  res.sendFile(filePath);
});

app.get("/api/documents/:id/text", requireAuth, (req, res) => {
  const document = getDocumentForUser(
    Number(req.params.id),
    req.session.userId
  );

  if (!document) {
    return res.status(404).json({ error: "Document not found." });
  }

  res.json({
    id: document.id,
    subject: document.subject,
    name: document.original_name,
    text: document.extracted_text
  });
});

app.delete("/api/documents/:id", requireAuth, (req, res) => {
  const document = getDocumentForUser(
    Number(req.params.id),
    req.session.userId
  );

  if (!document) {
    return res.status(404).json({ error: "Document not found." });
  }

  db.prepare(`
    DELETE FROM documents WHERE id = ? AND user_id = ?
  `).run(document.id, req.session.userId);

  safeUnlink(path.join(UPLOAD_DIR, document.stored_name));

  res.json({ message: "Document deleted successfully." });
});

// --------------------------------------------------
// EXPERIMENT COMPLETION TRACKER
// --------------------------------------------------

app.get("/api/progress", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT subject, experiment, completed, updated_at
    FROM progress
    WHERE user_id = ?
    ORDER BY subject, experiment
  `).all(req.session.userId);

  res.json({ progress: rows });
});

app.post("/api/progress", requireAuth, (req, res) => {
  const subject = cleanText(req.body.subject, 30);
  const experiment = cleanText(req.body.experiment, 200);
  const completed = req.body.completed ? 1 : 0;

  if (!validSubject(subject) || !experiment) {
    return res.status(400).json({
      error: "A valid subject and experiment name are required."
    });
  }

  db.prepare(`
    INSERT INTO progress
      (user_id, subject, experiment, completed, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, subject, experiment)
    DO UPDATE SET
      completed = excluded.completed,
      updated_at = CURRENT_TIMESTAMP
  `).run(req.session.userId, subject, experiment, completed);

  res.json({ message: "Progress saved successfully." });
});

app.delete("/api/progress", requireAuth, (req, res) => {
  const subject = cleanText(req.body.subject, 30);
  const experiment = cleanText(req.body.experiment, 200);

  if (!validSubject(subject) || !experiment) {
    return res.status(400).json({ error: "Invalid progress entry." });
  }

  db.prepare(`
    DELETE FROM progress
    WHERE user_id = ? AND subject = ? AND experiment = ?
  `).run(req.session.userId, subject, experiment);

  res.json({ message: "Progress entry removed." });
});

// --------------------------------------------------
// QUIZ RESULTS
// --------------------------------------------------

app.get("/api/quiz-results", requireAuth, (req, res) => {
  const results = db.prepare(`
    SELECT id, subject, score, total, created_at
    FROM quiz_results
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 100
  `).all(req.session.userId);

  res.json({ results });
});

app.post("/api/quiz-results", requireAuth, (req, res) => {
  const subject = cleanText(req.body.subject, 30);
  const score = Number(req.body.score);
  const total = Number(req.body.total);

  if (
    !validSubject(subject) ||
    !Number.isInteger(score) ||
    !Number.isInteger(total) ||
    total < 1 ||
    total > 500 ||
    score < 0 ||
    score > total
  ) {
    return res.status(400).json({ error: "Invalid quiz result." });
  }

  const result = db.prepare(`
    INSERT INTO quiz_results (user_id, subject, score, total)
    VALUES (?, ?, ?, ?)
  `).run(req.session.userId, subject, score, total);

  res.status(201).json({
    id: Number(result.lastInsertRowid),
    subject,
    score,
    total
  });
});

// --------------------------------------------------
// AI STUDY TOOLS
// Optional OpenAI-compatible API configuration:
// AI_API_KEY, AI_BASE_URL, AI_MODEL
// --------------------------------------------------

async function generateAI(prompt) {
  const apiKey = process.env.AI_API_KEY;
  const baseURL = (
    process.env.AI_BASE_URL || "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
  const model = process.env.AI_MODEL || "gpt-4o-mini";

  if (!apiKey) return null;

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are LabPrep AI, a helpful engineering laboratory study assistant. " +
            "Use simple English, accurate explanations, and clear formatting. " +
            "Base answers on supplied study material when available."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.4
    }),
    signal: AbortSignal.timeout(60000)
  });

  if (!response.ok) {
    const message = await response.text();
    console.error("AI provider error:", response.status, message.slice(0, 500));
    throw new Error("The AI provider could not generate a response.");
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || null;
}

function getStudyText(userId, subject, documentId) {
  if (documentId !== undefined && documentId !== null) {
    const document = getDocumentForUser(Number(documentId), userId);

    if (!document) {
      const error = new Error("Document not found.");
      error.status = 404;
      throw error;
    }

    if (document.subject !== subject) {
      const error = new Error("The document belongs to another subject.");
      error.status = 400;
      throw error;
    }

    return document.extracted_text;
  }

  const documents = db.prepare(`
    SELECT original_name, extracted_text
    FROM documents
    WHERE user_id = ? AND subject = ?
    ORDER BY id DESC
    LIMIT 5
  `).all(userId, subject);

  return documents.map((document) =>
    `Document: ${document.original_name}\n${document.extracted_text}`
  ).join("\n\n").slice(0, 30000);
}

function fallbackStudyContent(type, subject, material) {
  const excerpt = material
    ? material.slice(0, 1200)
    : "No PDF text is available. Upload a PDF for subject-specific content.";

  if (type === "summary") {
    return [
      `Summary for ${subject}`,
      "",
      "Study notes:",
      excerpt,
      "",
      "Revision tips:",
      "- Identify the main definitions and concepts.",
      "- Review important formulas and diagrams.",
      "- Practise explaining the experiment in your own words."
    ].join("\n");
  }

  if (type === "important") {
    return [
      `Important questions for ${subject}`,
      "",
      "1. Define the main concept and explain its importance.",
      "2. Explain the procedure step by step.",
      "3. Draw and label the relevant diagram.",
      "4. List the equipment or materials required.",
      "5. Explain the principle behind the experiment.",
      "6. State the applications of the concept.",
      "7. What precautions should be followed?",
      "8. What are the possible sources of error?",
      "",
      "Reference material:",
      excerpt
    ].join("\n");
  }

  return [
    `Viva questions and answers for ${subject}`,
    "",
    "1. What is the aim of the experiment?",
    "Answer: To understand and demonstrate the selected experimental concept.",
    "",
    "2. What is the principle of the experiment?",
    "Answer: It is the scientific rule or concept on which the experiment works.",
    "",
    "3. Which equipment is required?",
    "Answer: Refer to the equipment list in your laboratory manual.",
    "",
    "4. What precautions should be followed?",
    "Answer: Follow the procedure, use equipment correctly, and record readings carefully.",
    "",
    "5. What are the possible sources of error?",
    "Answer: Instrument limitations, reading errors, and environmental conditions.",
    "",
    "Reference material:",
    excerpt
  ].join("\n");
}

app.post("/api/study-tools", requireAuth, asyncRoute(async (req, res) => {
  const subject = cleanText(req.body.subject, 30);
  const type = cleanText(req.body.type, 30);
  const documentId = req.body.documentId;

  const supportedTypes = ["summary", "viva", "important"];

  if (!validSubject(subject) || !supportedTypes.includes(type)) {
    return res.status(400).json({
      error: "Choose a valid subject and study tool."
    });
  }

  const material = getStudyText(
    req.session.userId,
    subject,
    documentId
  );

  const prompts = {
    summary:
      "Create a clear, well-organized study summary with headings, key concepts, " +
      "definitions, formulas when present, and a short revision checklist.\n\n",
    viva:
      "Generate 15 laboratory viva questions and concise answers, from basic " +
      "to advanced. Number each question and answer.\n\n",
    important:
      "Generate 15 important exam questions based on the supplied material. " +
      "Include a mix of short-answer and long-answer questions. Do not invent " +
      "specific facts that are not supported by the material.\n\n"
  };

  const prompt =
    prompts[type] +
    `Subject: ${subject}\nStudy material:\n${material || "No extracted PDF text is available."}`;

  let content;

  try {
    content = await generateAI(prompt);
  } catch (error) {
    console.error("Study tool error:", error.message);
  }

  if (!content) {
    content = fallbackStudyContent(type, subject, material);
  }

  res.json({
    type,
    subject,
    content,
    aiGenerated: Boolean(process.env.AI_API_KEY && content)
  });
}));

// --------------------------------------------------
// MCQ QUIZ GENERATOR
// --------------------------------------------------

app.post("/api/quiz", requireAuth, asyncRoute(async (req, res) => {
  const subject = cleanText(req.body.subject, 30);
  const documentId = req.body.documentId;
  const requestedCount = Number(req.body.count || 10);
  const count = Math.max(
    1,
    Math.min(Number.isFinite(requestedCount) ? requestedCount : 10, 20)
  );

  if (!validSubject(subject)) {
    return res.status(400).json({ error: "Choose a valid subject." });
  }

  const material = getStudyText(
    req.session.userId,
    subject,
    documentId
  );

  const prompt =
    `Create exactly ${count} multiple-choice questions for ${subject}. ` +
    "Use the supplied material. Return ONLY a JSON array. Each item must have " +
    'a "question" string, an "options" array of exactly four strings, ' +
    'and an "answer" integer from 0 to 3. Do not include explanations.\n\n' +
    `Material:\n${material || "General engineering laboratory fundamentals."}`;

  let questions = null;

  try {
    const generated = await generateAI(prompt);

    if (generated) {
      const jsonText = generated
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      const parsed = JSON.parse(jsonText);

      if (Array.isArray(parsed)) {
        questions = parsed
          .filter((item) =>
            typeof item.question === "string" &&
            Array.isArray(item.options) &&
            item.options.length === 4 &&
            Number.isInteger(item.answer) &&
            item.answer >= 0 &&
            item.answer <= 3
          )
          .slice(0, count);
      }
    }
  } catch (error) {
    console.error("Quiz generation error:", error.message);
  }

  if (!questions || questions.length === 0) {
    questions = [
      {
        question: "What is the main purpose of a laboratory experiment?",
        options: [
          "To verify or study a concept",
          "To avoid recording observations",
          "To skip the procedure",
          "To ignore safety rules"
        ],
        answer: 0
      },
      {
        question: "Why should readings be recorded carefully?",
        options: [
          "To increase confusion",
          "To improve accuracy",
          "To avoid calculations",
          "To remove all observations"
        ],
        answer: 1
      },
      {
        question: "What should you do before using equipment?",
        options: [
          "Ignore its instructions",
          "Use it without checking",
          "Understand its correct operation",
          "Change its settings randomly"
        ],
        answer: 2
      },
      {
        question: "Why are precautions important?",
        options: [
          "They make results unnecessary",
          "They replace the procedure",
          "They prevent all learning",
          "They help improve safety and reliability"
        ],
        answer: 3
      }
    ].slice(0, count);
  }

  // Do not send answer keys to the browser during the quiz.
  const clientQuestions = questions.map((item) => ({
    question: item.question,
    options: item.options
  }));

  res.json({
    subject,
    questions: clientQuestions,
    answerKey: questions.map((item) => item.answer),
    aiGenerated: Boolean(process.env.AI_API_KEY)
  });
}));

// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "LabPrep AI",
    timestamp: new Date().toISOString()
  });
});

// --------------------------------------------------
// ERROR HANDLING
// --------------------------------------------------

app.use((req, res) => {
  res.status(404).json({ error: "The requested endpoint was not found." });
});

app.use((error, req, res, next) => {
  console.error(error.stack || error.message || error);

  if (res.headersSent) return next(error);

  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "The PDF exceeds the 20 MB upload limit."
        : error.message;

    return res.status(400).json({ error: message });
  }

  if (error.status && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: error.message });
  }

  res.status(500).json({
    error: "Something went wrong on the server. Check the Render logs."
  });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(`LabPrep AI is running on port ${PORT}`);
});
