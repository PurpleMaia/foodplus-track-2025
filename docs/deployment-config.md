# Deployment Configuration

What must be configured on each Dokku app so a deploy actually works — and how prod
(`main` → production) differs from local dev and the `dev` → sandbox app.

Deploy is **push-to-deploy via Dokku** (`.github/workflows/`): pushing `dev` deploys to the
sandbox app (`foodplus-dev`), pushing `main` deploys to production. A push auto-deploys, so
config must already be in place on the target app *before* you push.

---

## 1. Environment variables (Dokku `config:set`)

Local dev reads these from `.env` in the main checkout. **Dokku does NOT read `.env`** — each
app needs its vars set with `dokku config:set <app> KEY=VALUE`. Set them on the sandbox app and,
separately, on the production app.

| Variable | Required? | Used by | Notes / prod vs. sandbox |
|---|---|---|---|
| `DATABASE_URL` | **Required** | Kysely (`db/kysely/client.js`) | **Different per env** — sandbox and prod must point at their own Postgres/Supabase DBs. Never share. |
| `PLAYWRIGHT_BROWSERS_PATH` | **Required** | Bill-list Playwright fallback | Set to `/app/.cache/ms-playwright` on **every** app. Without it the build downloads Chromium to a path the runtime can't find. See §3. |
| `RESEND_API_KEY` | Required for email | Notifications (`server/services/notifications/`) | Enables status digests, deadline warnings, and the scrape-fallback alerts. If unset, email is skipped (logged, non-fatal). |
| `ALERT_EMAIL` | Recommended | `cron-alerts.js` | Where cron/scrape alerts go. Defaults to `data@purplemaia.org` if unset. **Prod should point at the real ops address, not a personal one.** |
| `ALERT_FROM` | Optional | notifications | From-address. Defaults to `Food+ Alerts <onboarding@resend.dev>` (a Resend test sender). **Prod should use a verified domain sender**, not the resend.dev default. |
| `OPENAI_API_KEY` | Required for food classifier | `llmService.js` | Food-related classifier only (NOT the bill-stage classifier, which is deterministic). |
| `OPENAI_BASE_URL` | Required for food classifier | `llmService.js` | Base URL for the OpenAI-compatible endpoint. |
| `VLLM` / `LLM` | Required for food classifier | `llmService.js` | Model name (`VLLM` takes precedence over `LLM`). |
| `VITE_SUPABASE_URL` | Required (frontend build) | SPA | Baked in at **build** time (Vite). Must be present when the build runs. Different per env. |
| `VITE_SUPABASE_ANON_KEY` | Required (frontend build) | SPA | Baked in at build time. Different per env. |
| `APP_URL` | Optional | `bill-updates-digest.js` | Base URL used in email links. Defaults to `https://foodplus.purplemaia.org`. **Sandbox should override to the sandbox URL** so links don't point at prod. |
| `PORT` | Optional | `server/index.js` | Defaults to 3000. Dokku sets this automatically; usually leave unset. |
| `DB_POOL_MAX` | Optional | `db/kysely/client.js` | Max Postgres pool connections. Defaults to 10. |

### Set them:

```bash
# On the Dokku host, per app (repeat for the production app name):
dokku config:set foodplus-dev \
  PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright \
  DATABASE_URL=... \
  RESEND_API_KEY=... \
  ALERT_EMAIL=... \
  OPENAI_API_KEY=... OPENAI_BASE_URL=... VLLM=... \
  VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... \
  APP_URL=...
```

`config:set` triggers a rebuild automatically. Dokku exposes config vars to the **build**
environment too (the `Adding BUILD_ENV to build environment` build-log line), so build-time needs
(`VITE_*`, `PLAYWRIGHT_BROWSERS_PATH`) are covered by the same command.

---

## 2. Buildpacks (Playwright browser support)

The bill-list scraper falls back to a real browser when `data.capitol.hawaii.gov`'s report page
returns HTTP 500 (a recurring upstream crash). That requires Chromium + its system libraries on
the Dokku image. Three repo files make this work:

- **`.buildpacks`** — runs `heroku-buildpack-apt` **before** `heroku-buildpack-nodejs`.
- **`Aptfile`** — the system `.so` libraries Chromium needs to launch on Ubuntu 24.04 / heroku-24
  (libnss3, libgbm1, libatk*t64, libasound2t64, …). The apt buildpack installs these without root.
- **`package.json` `postinstall`** — `playwright install chromium` (downloads the browser binary).
  **Do NOT use `--with-deps`** — that shells out to `apt-get` and needs root, which fails on the
  herokuish build user (`su: Authentication failure` → build rejected). The Aptfile provides the
  deps instead.

`.buildpacks` is honored only if no buildpacks are pinned on the app. To be explicit, pin them on
the Dokku host:

```bash
dokku buildpacks:clear foodplus-dev
dokku buildpacks:add foodplus-dev https://github.com/heroku/heroku-buildpack-apt
dokku buildpacks:add foodplus-dev https://github.com/heroku/heroku-buildpack-nodejs
```

---

## 3. The Playwright browser-path gotcha (why `PLAYWRIGHT_BROWSERS_PATH` is required)

Playwright caches browsers in `$HOME/.cache/ms-playwright`. On herokuish, `$HOME` is `/tmp/build`
at **build** time but `/app` at **runtime**, and only `/app` is preserved into the runtime slug.
So a browser downloaded by `postinstall` lands in `/tmp/build/.cache/...` and is discarded — at
runtime Playwright looks in `/app/.cache/ms-playwright` and fails with:

```
browserType.launch: Executable doesn't exist at /app/.cache/ms-playwright/chromium_headless_shell-XXXX/...
```

Setting **`PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright`** pins a single absolute path used at
both build and run time, so the downloaded browser survives into the slug and is found at launch.

---

## 4. Scheduled cron

`app.json` declares a `@daily` cron running `npm run cron:scrape` (scrape → classify → notify).
This is picked up by the Dokku cron/scheduler on deploy. There is **no local scheduler** — running
the dev server does not fire the cron; run `npm run cron:scrape` manually to test locally.

---

## 5. Quick pre-deploy checklist (per app)

- [ ] `DATABASE_URL` set to *this env's* database (not shared across envs)
- [ ] `PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright` set
- [ ] Buildpacks pinned: apt first, then nodejs
- [ ] `RESEND_API_KEY` set; `ALERT_EMAIL` / `ALERT_FROM` point at the right (prod-appropriate) addresses
- [ ] `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `VLLM` set (food classifier)
- [ ] `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` set (needed at build time)
- [ ] `APP_URL` overridden on sandbox so email links don't point at prod
- [ ] After first deploy: run a manual scrape and confirm the Playwright fallback launches (force it
      by watching a run where `data` 500s, or check the "www URL passed" alert email)
