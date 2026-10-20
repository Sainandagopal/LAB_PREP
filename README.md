# LabPrep AI

Upload an experiment PDF from your lab manual and get:

1. **Summary** – the aim, a plain-language summary, key terms, how it works inside, the expected output, points to remember and common mistakes.
2. **Steps** – an ordered plan to carry out the experiment yourself, with the code or commands for each step and tick boxes to track your progress.
3. **Viva** – 12 questions asked one at a time, easy to hard, each with a hint. Type (or say) your answer; it is marked out of 10 against the model answer and its must-have points, with what you got right, what you missed, a stronger version of your answer, and the follow-up an examiner would ask next.

Experiments are organised by subject you choose. Without a database, everything you create is stored **in your own browser** (nothing is lost when the free server restarts, but experiments do not follow you to another device). With a free Neon database added, people can sign in and their experiments follow them everywhere.

## Folder layout

```
server.js          the backend
accounts.js        sign-in and cloud saving (needs DATABASE_URL to switch on)
package.json
.node-version
public/
  index.html
  app.js
  styles.css
```

Keep the three website files inside the `public/` folder. If they are uploaded next to `server.js` instead, the server still finds them.
When you upload to GitHub, open your repository afterwards and check that you can see `server.js`, `accounts.js` **and** the `public` folder.

## Scanned PDFs and diagrams

With the Gemini key set, the PDF itself is sent to Gemini, so it can:

- read **scanned or photographed** manuals (the Source tab then shows the AI's transcription of the pages);
- describe **diagrams, circuits, flowcharts, graphs and tables**. They appear under *Diagrams and figures* on the Summary tab.

Code from text PDFs is still taken from the PDF's own text, so indentation stays exact. PDFs over about 14 MB are read as text only. Without a Gemini key, scanned PDFs are refused with a message saying so.

## Accounts and saving to the cloud (free, about five minutes)

By default every visitor's experiments live only in their own browser. To let people **sign in and keep their subjects and experiments on every phone and computer**, add a free Neon database:

1. Go to https://neon.com, create a free account and a new project (pick the region closest to you).
2. On the project page press **Connect** and copy the connection string. It starts with `postgresql://` and contains `neon.tech`.
3. In Render open your service, then **Environment** and add `DATABASE_URL` with that string as its value. Save and wait for the redeploy.
4. Open the site and click the **AI** pill. Under *Accounts* it should say **Sign-in and cloud saving are on**. If it says Off, it also says why.

Then:
- Visitors press **Sign in** (or just press *Analyze*, which asks them to create an account). Email and password; there is no email reset, so tell your friends to pick a password they will remember.
- Uploading and the AI now need a sign-in, so strangers cannot use up your Gemini quota.
- Experiments a person saved in the browser before signing in are offered to their account once.
- Each account holds up to 60 experiments (`MAX_EXPERIMENTS_PER_USER`), and the site accepts up to 500 accounts (`MAX_USERS`) so the free database is not overrun.
- Passwords are stored only as salted scrypt hashes. As the site owner you can see emails and saved experiments in your Neon dashboard, so tell your users that. A person can delete their account, and all their data, from the account menu.
- Only Neon databases are supported (the site talks to Neon over plain HTTPS, so no extra packages are needed). The tables are created automatically.

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

### "AI quota or rate limit was reached"

The free Gemini tier gives every model its own small daily and per-minute allowance. The site now copes with this by itself:

- If one model is out of quota it moves on to the next Flash / Flash-Lite model straight away and remembers which ones are resting.
- Grading viva answers uses Flash-Lite first, so it does not compete with summaries for the same allowance.
- A summary uses two AI calls at once (summary + steps, and viva). A PDF you already analyzed is answered from a saved copy at no cost for about 6 hours.
- The PDF itself is only sent to Gemini when it is scanned or its text mentions figures, circuits or diagrams. Text manuals are sent as text, which is much faster.
- When every model is used up the page says so, shows the basic draft, and a **Try AI again** button appears on the experiment.
- The daily free allowance resets at midnight Pacific time. If you hit it often, create the key in a Google project with billing turned on (the cost for this site is tiny) or add a second key from another project.

Optional settings: `AI_SPLIT=0` (one AI call instead of two), `AI_CONCURRENCY=4` (how many AI calls run at once), `AI_MODEL` (force a model; the others are still used as backups).

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
