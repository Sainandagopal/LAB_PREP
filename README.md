# LabPrep AI

A responsive lab-internal study website using **HTML, CSS, and browser JavaScript**, with a small **Node.js/Express JavaScript backend** for account authentication, private PDF storage, progress tracking, and optional AI integration.

## Features

- Five separate subject spaces (default labels are Subject 1–5).
- Multi-user registration and sign-in.
- Persistent PDF uploads (up to 15 MB per file) saved on the server.
- In-browser PDF reader.
- PDF text extraction for searchable study material.
- Summary, viva questions with suggested answers, and important-question generation.
- Multiple-choice practice quiz based on extracted text.
- Experiment/task tracker and quiz history.
- Mobile-responsive dashboard and library.

## Requirements

- Node.js 18 or newer (Node 20 LTS recommended)
- npm
- Internet connection only for Google Fonts or optional AI service; core app runs locally.

## Run locally

1. Extract the ZIP.
2. Open a terminal in the `LabPrepAI` folder.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Copy `.env.example` to `.env` and change `SESSION_SECRET` to a long random string.

   PowerShell:
   ```powershell
   Copy-Item .env.example .env
   ```

   macOS/Linux:
   ```bash
   cp .env.example .env
   ```

5. Start the website:

   ```bash
   npm start
   ```

6. Open **http://localhost:3000** in your browser and create an account.

The SQLite database is created in `data/labprep.sqlite`; uploaded PDF files are saved in `uploads/`. These persist across restarts on the same machine. Back up both folders to preserve your data.

## Optional AI generation

Without an AI API key, the app uses a built-in text-based fallback to draft summaries and question prompts. This is useful for testing, but is not equivalent to a capable generative AI model.

To enable AI-backed study material, edit `.env` on the server:

```env
AI_API_KEY=your_api_key
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

Restart the server after changing `.env`. Keep the API key private and never put it in `public/app.js`. API usage may incur charges. The AI endpoint must be compatible with the OpenAI Chat Completions API.

## Set your actual five subject names

The starter project labels the subjects “Subject 1” through “Subject 5”. To use your real subject names, edit the `SUBJECTS` array near the top of `server.js`, for example:

```js
const SUBJECTS = [
  { key: "subject1", name: "Java Programming Lab", subtitle: "Programs and viva preparation" },
  { key: "subject2", name: "DBMS Lab", subtitle: "SQL queries and practicals" },
  { key: "subject3", name: "DSA Lab", subtitle: "Algorithms and implementations" },
  { key: "subject4", name: "Python Lab", subtitle: "Exercises and output questions" },
  { key: "subject5", name: "Computer Networks Lab", subtitle: "Experiments and concepts" }
];
```

Existing records use stable keys (`subject1` to `subject5`), so changing display names does not lose stored PDFs or progress.

## Important production notes

This is a local starter app, not a hardened public production deployment. Before exposing it to the public internet:
- Use HTTPS and secure session cookies.
- Replace Express's default in-memory session store with a persistent session store.
- Add rate limiting, email verification, password reset, CSRF protection, and security monitoring.
- Configure backups, upload scanning, retention rules, and storage limits.
- Use a managed database and persistent file/object storage for multi-instance hosting.
- Set a strong random `SESSION_SECRET`.
- Review generated study material against your original manual; generated questions are practice aids, not guaranteed exam questions.

## Current limitations

- Scanned/image-only PDFs may not have extractable text. OCR is not included.
- The quiz generator is a simple starter implementation and can make imperfect distractors. Review questions and answers against your notes.
- AI generation requires an optional compatible API key; the app does not ship with one.
- Subject names are configured in `server.js` rather than through an admin UI.
