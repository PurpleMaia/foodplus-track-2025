# Hawaii Legislature Bill Scraper

This project is a web dashboard and scraper for tracking bills from the Hawaii State Legislature. It is built with [React](https://react.dev/) and [Vite](https://vitejs.dev/) and uses [Supabase](https://supabase.com/) for storage and API functions. A small [Express](https://expressjs.com/) server powers the scraper endpoint and serves the production build.

## Prerequisites

- [Node.js](https://nodejs.org/) (version 18 or later)
- [npm](https://www.npmjs.com/) (comes with Node.js)

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Start the development server**
   ```bash
   npm run dev
   ```
   The app will be available at `http://localhost:5173` by default.

3. **Build for production**
   ```bash
   npm run build
   ```
   After building you can start the Express server to serve the files:
   ```bash
   npm start
   ```
   You can also preview the built app directly with:
   ```bash
   npm run preview
   ```

4. **Lint the project** (optional but recommended)
   ```bash
   npm run lint
   ```

## Scripts

- `npm run dev` – start Vite in development mode
- `npm run build` – build the production bundle
- `npm run preview` – preview the built app locally
- `npm run lint` – run ESLint over the project
- `npm run cron:scrape` – run the full daily scrape → classify → notify pipeline
- `npm run scrape:recover` – run the same pipeline locally with a Playwright fallback (see below)
- `npm run scrape:dry-run` – scrape only, no DB writes and no emails (see below)
- `npm test` – run the backend test suite (`node --test`)
- `npm start` – start the Express server to serve the production build

## Recovery scraper (`scrape.js`)

`scrape.js` (repo root) is a **local** copy of the daily scrape pipeline that is
resilient to the Capitol data host going down. The deployed daily cron
(`npm run cron:scrape`) scrapes `data.capitol.hawaii.gov`; that host intermittently
returns **HTTP 500**. When it does, run `scrape.js` from your own machine and it
falls back to the `www.capitol.hawaii.gov` copy of the report via a real browser
(Playwright/Chromium), which clears the Cloudflare challenge a datacenter IP cannot.

Everything downstream of the list fetch — individual bill scrapes, status
classification, DB writes, follower notifications and deadline warnings — runs
through the exact same service code as the deployed cron, so the result is identical.

**When the Capitol site is down on their end, this is the script to run.**

### Dry run (no DB writes, no emails)

Verify the scrape works before running for real — fetches and parses the bill list,
then test-fetches a sample of individual bill pages, printing each URL and whether
it succeeded. **Writes nothing to the DB and sends no email.**

```bash
npm run scrape:dry-run
# or, to sample more individual pages per chamber:
node scrape.js --dry-run --individual-limit=20
```

Exits `0` if both chambers parsed bills and every sampled fetch succeeded, `1` otherwise.

### Full run (writes to DB, sends notifications)

Runs the real pipeline: data-URL scrape first, Playwright/www fallback on failure,
then saves bills and sends follower notifications + deadline warnings.

```bash
npm run scrape:recover
```

Requires `DATABASE_URL`, `OPENAI_API_KEY`, and `RESEND_API_KEY` (plus the other
notification vars) in your local `.env`. **This writes to the DB and sends real
emails to followers**, so run the dry run first to confirm the scrape works.

### Verify the app is healthy

After changing scraper code (or before trusting a recovery run), run the backend
test suite:

```bash
npm test
```

## Directory Structure

- `src/` – React application source code
- `supabase/` – Supabase functions and migrations
- `scripts/` – helper scripts
- `server/` – Express server and scraping route

## Environment Variables

Set the following environment variables to connect to your Supabase project:

```
VITE_SUPABASE_URL=<your-supabase-url>
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

These can be placed in a `.env` file at the project root.

---

Enjoy hacking on the Hawaii Legislature Bill Scraper!

