# Hawaii Legislature Bill Scraper

This project is a web dashboard and scraper for tracking bills from the Hawaii State Legislature. It is built with [React](https://react.dev/) and [Vite](https://vitejs.dev/) and uses [Supabase](https://supabase.com/) for storage and API functions.

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
   You can preview the built app with:
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
- `npm run scrape` – run the scraper script (requires a `server/scraper.js` file)

## Directory Structure

- `src/` – React application source code
- `supabase/` – Supabase functions and migrations
- `scripts/` – helper scripts

## Environment Variables

Set the following environment variables to connect to your Supabase project:

```
VITE_SUPABASE_URL=<your-supabase-url>
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

These can be placed in a `.env` file at the project root.

---

Enjoy hacking on the Hawaii Legislature Bill Scraper!

