# LabPrep AI

Responsive study portal with subject folders, PDF upload/preview, an experiment tracker, practice questions, and document-based study material generation.

## PDF study workspace

After signing in and uploading a PDF, open one of its three options:

- **Step by Step** — turns the PDF's practical procedure or project instructions into an ordered implementation plan.
- **Summary & Viva** — presents a simple summary, important points, and viva questions with answers.
- **Text** — shows the extracted PDF text and detected code blocks. Use **Copy Text** to copy the extracted text or **Copy Code** to copy a code block while preserving indentation.

Text-based PDFs are supported through `pdf-parse`. A scanned/image-only PDF may require OCR; the site explains when no selectable text is found.

## Folder layout

Keep `index.html`, `app.js` and `styles.css` inside the `public/` folder next to `server.js` (push the whole folder to GitHub). If they are uploaded in the project root instead, the server still serves exactly those three files.

## Run locally

1. Install Node.js 18 or newer.
2. In this folder run `npm install`.
3. Copy `.env.example` to `.env` and set a long random `SESSION_SECRET`.
4. Run `npm start`.
5. Open `http://localhost:3000`.

## Enable AI-generated study content (recommended)

The app reads the extracted PDF text on the server. To generate stronger, context-aware implementation steps and viva answers, configure these server environment variables (for example, under Render **Environment**):

- `AI_API_KEY` — your provider API key.
- `AI_BASE_URL` — defaults to `https://api.openai.com/v1`.
- `AI_MODEL` — defaults to `gpt-4o-mini`.

Keep the key only in server environment variables; never put it in `public/app.js`. Without an API key, the application uses a built-in text-based fallback. AI provider errors also fall back to that draft and display a notice. Very long PDFs are processed in text chunks.

## Deploy on Render

1. Upload/extract the project into your GitHub repository.
2. In Render choose **New + → Web Service** and connect the repository.
3. Build command: `npm install`; Start command: `npm start`.
4. Add `SESSION_SECRET` and (optionally) `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL` under Environment, then deploy.

## Storage note (important on Render)

Set the optional `STORAGE_DIR` environment variable to a persistent-disk path (for example `/var/data`) to keep data there instead of `./storage`.
On Render's **free** plan the filesystem is wiped whenever the service restarts, redeploys or spins down after being idle, so accounts, PDFs and progress will disappear. That is a hosting limit, not a bug; use a paid plan with a Persistent Disk, or move the data to an external database, if it must last.

Original note:

This starter stores uploads and user data under `storage/`. Render's default filesystem may be ephemeral: PDFs and user data can disappear after a restart or redeploy. Use a persistent disk or external database/object storage for data that must survive restarts. Review session settings and authentication before production use.
