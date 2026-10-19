# LabPrep AI

Upload an experiment PDF from your lab manual and get:

1. **Summary** – the aim, a short plain-language summary, what you need, and points to remember.
2. **Steps** – an ordered plan to carry out the experiment yourself, with the code or commands for each step and tick boxes to track your progress.
3. **Viva** – questions asked one at a time. Type (or say) your answer, and it is checked and scored out of 10, with the model answer shown after every question.

Experiments are organised by subject you choose. Everything you create is stored **in your own browser**, so there are no accounts and nothing is lost when the free server restarts. (It also means experiments do not follow you to another phone or computer.)

## Folder layout

```
server.js          the whole backend
package.json
.node-version
public/
  index.html
  app.js
  styles.css
```

Keep the three website files inside the `public/` folder. If they are uploaded next to `server.js` instead, the server still finds them.
When you upload to GitHub, open your repository afterwards and check that you can see `server.js` **and** the `public` folder.

## Subjects

Create as many subjects as you like. There is no fixed list.

- When you upload a PDF, type any subject name in the Subject box (or pick one you already used). New names are created automatically; the same name in a different spelling or case reuses the existing subject.
- Under **Your experiments**, tap a subject chip to see only its experiments. The number on each chip is how many it holds.
- With a subject selected you can **Rename** or **Delete subject**. Deleting a subject never deletes its experiments; they move to **General**.
- On an experiment page, the subject drop-down at the top moves it to another subject, or to a new one.

## Deploy on Render

1. Put these files in a GitHub repository (without any key in them) and connect it to a Render **Web Service**.
2. Build command `npm install`, start command `npm start`. Needs Node 22.13 or newer (`.node-version` and `package.json` already ask for it; if Render complains, add an environment variable `NODE_VERSION` = `22.22.0`).
3. Add the AI key (next section), then **Manual Deploy → Deploy latest commit**.
4. Open the site. The pill at the top right says **AI on** when a key is found. Click it and press **Test AI connection** to prove the key really works.

The free Render plan sleeps after about 15 minutes without visitors, so the first upload after a break can take up to a minute.

## Turn on the AI (free, about five minutes)

Without a key the site still works, but it only rearranges the text of your PDF into a basic draft and checks viva answers by matching key words. With a key, an AI model writes the summary, the steps and the viva questions, and grades what you type by meaning.

1. Go to https://aistudio.google.com/apikey and create an API key (Google account needed; there is a free tier). Keys starting with `AIza` or `AQ.` both work.
2. In Render open your service → **Environment** → **Add Environment Variable**:
   - Key: `GEMINI_API_KEY` (exactly this, capital letters, no spaces)
   - Value: your key, with no quotes
3. Save. Render redeploys (wait until it says Live).
4. Open the site, click the **AI** pill at the top right, then **Test AI connection**. It says **Working** when everything is fine, or shows the exact message from Google if not.

Troubleshooting:
- Pill says **AI off**: the site cannot see a key. Open the pill; it lists look-alike variable names it found (a typo such as `GEMINI_API_KEY ` or `GEMENI_API_KEY` is the usual cause). The site also accepts `AI_API_KEY`, `GOOGLE_API_KEY` and `GOOGLE_AI_API_KEY`.
- Pill says **AI on** but the test fails: the key is wrong, expired, or has no quota. The test shows Google's message. Create a fresh key in AI Studio.
- You do not need to set `AI_MODEL`. The site picks a working Gemini Flash model itself.

Never paste your key into the code, GitHub, or a chat. If a key has been shared anywhere, delete it in AI Studio and create a new one.
Free-tier terms differ from paid ones, so check Google's terms before uploading anything confidential.

Other providers work too: set `AI_API_KEY`, `AI_BASE_URL` and `AI_MODEL` for any OpenAI-compatible service (OpenAI, Groq, OpenRouter, ...).

### Protect your AI quota

Anyone who finds your site can use it. Each visitor is limited per hour (see `.env.example`). To close it completely, set `ACCESS_CODE` in Render; visitors are then asked for that code once.

## Run it on your computer

```
npm install
npm start
```

Open http://localhost:3000. Copy `.env.example` to `.env` and export the variables, or set them in your shell, if you want the AI locally.

## What works and what does not

- Works: text-based PDFs (typed, or exported from Word or LaTeX), up to 20 MB and 120 pages. Code listings keep their indentation.
- Does not work: scanned or photographed pages. The site tells you when a PDF has no selectable text. Run OCR on it first.
- Diagrams and circuit images are not read, only text.
- AI output can be wrong. Check important details against your manual and your lab teacher's instructions.
