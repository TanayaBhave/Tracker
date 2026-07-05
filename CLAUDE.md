# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # start Vite dev server (http://localhost:5173)
npm run build     # tsc type-check + Vite production build
npm run lint      # oxlint (React + TypeScript rules; see .oxlintrc.json)
npm run preview   # serve the production build locally
```

No test runner is configured yet. Playwright is installed but has no test files.

## Architecture

**Current milestone: M1 (local-only PWA).** M2 (charts), M3 (sync backend), M4 (deploy) are not built yet.

### File map
- [src/db.ts](src/db.ts) — all TypeScript types, Dexie schema, and helpers (`newId`, `baseFields`, `nowLocalISO`, `todayStr`). Single source of truth for the data model.
- [src/App.tsx](src/App.tsx) — app shell: three tabs (Home / History / Settings) and sheet open/close state. `SHEETS` map dispatches to the correct sheet component.
- [src/components/Sheet.tsx](src/components/Sheet.tsx) — reusable bottom-sheet modal with backdrop, title, optional `warn` banner, and Save/Cancel actions.
- [src/components/Fields.tsx](src/components/Fields.tsx) — `Field` label wrapper; `ChipSelect` (single-select chip row, optionally clearable); `ChipMulti` (multi-select chip row). All quick-add forms are built from these.
- [src/components/Timeline.tsx](src/components/Timeline.tsx) — `useLiveQuery` over meals/vomits/stools/meds/sleep for a given `dateStr`; sorts descending by time.
- [src/components/sheets.tsx](src/components/sheets.tsx) — one exported sheet component per event type; each writes directly to Dexie on save.

### Key conventions
- `deleted`, `straining`, and `archived` are stored as `0 | 1` integers, **not booleans**, because Dexie can only index numbers (not booleans).
- For M1 simplicity, meal ingredients are stored as a plain comma-separated string appended to `notes`; the `Ingredient` catalog tables exist in Dexie but are not yet linked from UI.
- Daily records (gas, activity, weight, symptoms) use a `date: string` field; event records use `timestamp: string` (both ISO). Timeline only renders timestamped records.
- `nowLocalISO()` returns a `datetime-local`-compatible string (no timezone offset) suitable for `<input type="datetime-local">` defaults.

---

# Product spec — Baby Feeding & Symptom Tracker

## Project goal
A local-first Progressive Web App (PWA) to track one baby's feeding, medication, stool, vomiting, gassiness, sleep, and activity, so the parents (two iPhones) can log events quickly and later plot patterns. **Primary purpose: produce clean, relevant, GI-ready data for a pediatric gastroenterology appointment ~1 month out.** Key questions to illuminate: which foods/ingredients/textures correlate with vomiting; whether gassiness, physical activity, constipation (stool gaps), overfeeding, or car rides track with symptoms; and weight trajectory over the period.

## Hard constraints
- **No Xcode / Swift.** Build entirely with web tech. Target: installable PWA, "Add to Home Screen" on iOS Safari.
- **Offline-first.** App must open and log data with no network. Data persists locally (IndexedDB).
- **Self-hosted, low infra.** Single Docker container on a home Linux server. No managed cloud DB, no third-party accounts.
- **Two devices, one shared dataset.** Both iPhones see the same data. Start simple: any device can edit any entry (last-write-wins is acceptable for v1).
- **Reachable remotely** via Tailscale (preferred) or a reverse proxy with HTTPS. App must be served over HTTPS for PWA + service worker to work on iOS.

## Recommended stack
- **Frontend:** React + Vite + TypeScript. PWA via `vite-plugin-pwa` (Workbox service worker).
- **Local storage:** IndexedDB via **Dexie.js**. This is the source of truth on-device.
- **Charts:** Recharts.
- **Sync backend:** Node.js (Fastify or Express) + **SQLite** (file-backed). One container.
- **Sync strategy:** Local-first. Each record carries a UUID, `updatedAt` timestamp, and `deleted` flag (soft delete). Client pushes changed records since last sync and pulls server changes; conflicts resolved last-write-wins on `updatedAt`. Use a `/sync` endpoint that accepts a batch + a `since` cursor. No realtime needed; sync on app open, on save, and on a timer when online.
- **Auth:** single shared password / token in an env var, sent as a bearer header. This is a family app behind Tailscale; keep it minimal but not open.
- **Packaging:** `docker-compose.yml` that builds the frontend, serves static files, and runs the API. SQLite file mounted as a volume so data survives restarts.

> If a simpler path is wanted later, PocketBase (single Go binary, built-in SQLite + REST + auth) is a strong alternative backend that keeps the same local-first client. Note this as an option, don't build both.

## Data model
All records: `id` (uuid), `createdAt`, `updatedAt`, `deleted` (bool), `enteredBy` (device label string).

**Meal**
- `timestamp` (when meal started)
- `durationMinutes`
- `foodItems`: array of `{ name, category, amountGiven, amountConsumed, unit, ingredientIds[] }`
  - `category`: enum (puree, solid, finger-food, liquid, formula, breastmilk, other)
  - amounts in grams or ml; let user pick unit
  - `ingredientIds`: links to the Ingredient catalog so correlation can run at the **ingredient** level, not just the dish level (e.g. "sweet potato" appears across many meals)
- `texture`: enum (smooth-puree, mashed, lumpy, soft-solid, hard-solid, mixed) — you flagged texture as a suspected trigger, so make it first-class
- `notes`
- `reaction`: enum (none, fussy, gagged, vomited, refused) — quick tag at meal time

**Ingredient** (catalog)
- `name`, optional `tags[]` (e.g. dairy, acidic, high-fiber) — enables grouping in analysis

**MedicationDose**
- `timestamp`
- `medName`
- `doseAmount` + `doseUnit`
- `notes`

**VomitEvent**
- `timestamp`
- `severity`: enum (spit-up, moderate, large)
- `minutesAfterLastMeal` (auto-computed suggestion, editable)
- `linkedMealId` (optional)
- `notes`

**StoolEvent**
- `timestamp`
- `consistency`: enum (hard, formed, soft, loose, watery) — Bristol-style, kept simple
- `color` (optional enum)
- `notes`

**GassinessLog** (you want a simple daily read, not per-episode)
- `date`
- `level`: enum (less, regular, more) — three categories, one tap
- optionally allow multiple entries per day (morning/afternoon/evening) that roll up to a daily summary; default is one-per-day
- `notes`

**PhysicalActivityLog** (you suspect activity ↔ gassiness, e.g. more car time = less activity)
- `date`
- `level`: enum (less, regular, more) — mirrors gassiness for easy side-by-side plotting
- optional `activeMinutes` if you ever want a finer number
- `notes`

**SleepEvent**
- `startTime`, `endTime` (so duration is derived); allow open-ended (nap in progress)
- `quality`: enum (good, restless, poor) — optional
- `notes`

**Factor** (user-defined trackable labels — the extensibility you asked for)
- `name` (e.g. "Car ride", "Lack of sleep", "Teething", "New food")
- `kind`: enum
  - `instant` — a point in time (e.g. a bump, a dose-like event)
  - `duration` — has start/end (e.g. car ride)
  - `scale` — a 0–5 rating logged at a time (e.g. fussiness level)
- `unit` (optional, for scale/duration display)
- `archived` (bool)
> Sleep, car rides, etc. could all be modeled as Factors. To keep entry fast, **Sleep gets a dedicated screen** (above) since you log it often; everything else custom goes through generic Factors. Implementer's call whether to also fold Sleep into Factor under the hood — keep the UI dedicated either way.

**FactorEvent** (an instance of a Factor)
- `factorId`
- `timestamp` (or `startTime`/`endTime` if the Factor is `duration`)
- `value` (number, for `scale` kind; or duration minutes)
- `notes`

**FoodCatalog** (reusable dish dropdowns, not re-typed)
- `name`, `category`, `defaultUnit`, `ingredientIds[]` (a saved dish auto-fills its ingredients)

### Clinically-motivated optional trackers
These map to the common medical contributors to infant vomiting/reflux/gas on solids. Keep them optional and low-friction; they exist so patterns can be brought to the pediatrician.

**VomitEvent — add fields** (extend the existing model):
- `appearance`: enum (milky/undigested, partially digested, mucousy, bloody-streak, bile-green, other) — **bile-green or blood should prompt an in-app note to contact the doctor**; color/appearance is clinically important.
- `forcefulness`: enum (spit-up/effortless, moderate, projectile) — projectile vomiting is a specific red flag worth distinguishing.
- `bodyPosition`: enum (lying flat, upright, reclined, during/after feed, during car ride) — reflux is position-sensitive.

**Meal — add optional fields:**
- `timeSinceLastMealMin` (auto-derived) — meal spacing/over-feeding affects reflux.
- `pacePosition`: enum (paced/upright, fast, lying back) — feeding posture & pace matter for reflux.
- `oralMotorTags`: multi-select (ate-smoothly, gagged, coughed/choked, spit-food-out, pocketed-in-cheeks, trouble-swallowing, tongue-thrust) — **this is how oral-motor readiness is captured**: observable per-meal signs that, cross-referenced with `texture`, reveal whether difficulty tracks with lumpier/harder textures.
- `burped`: enum (yes, no, partial) — one-tap toggle after the meal. A missed burp traps air and is a common reflux/vomiting contributor; plottable against vomiting so the "couldn't get him to burp → vomited later" pattern surfaces.
- **Overfeeding flag (auto):** app marks a meal as "large" or "closely-spaced" relative to this baby's rolling baseline (amount consumed + timeSinceLastMeal), so overeating surfaces from data rather than manual judgment. Flag is then plottable against vomiting.

**StoolEvent — add:**
- `straining`: bool
- **`daysSinceLastStool` (auto-derived)** from the gap between stool timestamps — this is how constipation is tracked: a growing gap is the signal, and the plotter can overlay days-since-last-stool against vomiting frequency to test the constipation→vomiting lag you've observed.

**WeightLog** (track ~every 2 weeks; weight trajectory is the #1 thing the GI will assess)
- `date`, `weight`, `unit` (kg/lb)
- chart as a simple trend line; flag if no entry in >2 weeks as a gentle reminder.

**HydrationLog** (optional) — fluid intake; relevant to stool consistency/constipation, which can worsen discomfort and vomiting.

**SymptomFlags** (optional daily check — track if present): back-arching/Sandifer-like posturing, hoarse cry/cough, congestion, refusing food, excessive drooling/teething, fever, fewer wet diapers. These are the things a pediatrician asks about; logging presence/absence over time is genuinely useful.

> All of the above are optional and collapsible in the UI. Default entry stays fast; detail is opt-in.

## Key screens
1. **Today / Home** — chronological timeline of today's events; big quick-add buttons (Meal, Med, Vomit, Stool, Gas, Sleep, + any custom Factor).
2. **Quick-add sheets** — fast entry per event type; sensible defaults; one-tap "now" timestamp; meal sheet supports adding ingredients and texture.
3. **History** — scrollable list, filter by date range and type, edit/delete.
4. **Insights / Charts** (see below).
5. **Manage Factors** — create/edit/archive custom labels (Car ride, Lack of sleep, Teething…).
6. **Settings** — device label, sync server URL + token, food/ingredient catalog management, correlation window.

## Insights — the flexible plotter (core of this update)
A single **Plot Builder** screen, not a fixed set of charts:
- **Pick a date range.**
- **Pick an outcome** to measure on the Y axis: vomit frequency, gassiness severity/frequency, stool consistency, or any scale Factor.
- **Pick one or more series/labels** to compare against: foods, ingredients, ingredient tags, textures, sleep, car rides, or any Factor.
- **Pick a chart type:** bar/histogram (counts per bucket), or X–Y scatter/line (outcome vs a factor over time or per day).
- **Time bucketing:** per day or per week.

Concretely, support these views (all reachable from the builder):
- **Vomit/gas frequency per day** (bar histogram), optionally split by a chosen Factor.
- **Outcome vs label overlay**: e.g. daily vomit count line with car-ride days and poor-sleep days marked.
- **Ingredient/texture correlation table & chart**: for each ingredient, ingredient-tag, or texture, count meals containing it followed by vomit/gassiness within the window → ranked "suspect" list with rates.
- **Pre/post comparison for duration Factors**: vomit/gas rate in the N hours after a car ride vs baseline.

Keep the builder's selections shareable/saveable as named "saved views" so you don't rebuild a favorite chart each time.

## Analysis logic
- **Association window** (configurable, default 2h): an outcome event (vomit/gassiness) is "associated" with any meal/factor whose time falls within the window before it.
- **Ingredient & texture attribution**: associate the outcome with every ingredient, ingredient-tag, and texture of the meals in the window — this is what lets "sweet potato" or "lumpy texture" surface across different dishes.
- **Per label**, compute: exposures (meals/events containing it), associated outcomes, and rate (outcomes / exposures). **Always show raw counts next to rates** — small samples are noisy.
- **Duration factors** (car ride, sleep gap): compare outcome rate inside vs outside the affected window (baseline) so a raw count isn't mistaken for signal.
- Descriptive, not diagnostic. Label this clearly throughout — it spots patterns to discuss with a doctor, it does not establish cause.

## Build order (milestones)
1. **M1 — Local-only PWA.** React+Vite+Dexie. Core event types (Meal w/ ingredients + texture, Med, Vomit, Stool, Gassiness, Sleep), custom Factors, today view, quick-add, history, installable + offline. No server. *(Usable immediately.)*
2. **M2 — Charts & insights.** The Plot Builder + saved views, ingredient/texture correlation, duration-factor pre/post comparison, and **GI-ready PDF export**: a date-range summary built for the pediatric GI visit — weight trend, vomit frequency/forcefulness/appearance summary, suspect-food/ingredient/texture table, daily gassiness & activity, stool frequency + longest constipation gaps, oral-motor sign frequency, burp-success rate vs vomiting, symptom-flag timeline, and any red-flag events. One clean document to hand over.
3. **M3 — Sync backend.** Node+SQLite container, `/sync` endpoint, client sync layer, conflict handling, shared-token auth.
4. **M4 — Deploy.** docker-compose, HTTPS via Tailscale/reverse proxy, install on both phones, verify offline→online sync across devices.

## iOS PWA gotchas to handle
- Must be HTTPS (Tailscale Funnel or a cert via reverse proxy).
- Provide app icons + manifest + `apple-touch-icon`; set `display: standalone`.
- iOS purges IndexedDB after ~7 days of no use for non-installed sites — installing to Home Screen mitigates this, but **sync to server is the real durability guarantee**. Make sync reliable.
- Test service-worker update flow so a new deploy doesn't strand a stale cached app.

## Out of scope for v1
- Reminders/notifications (revisit later; iOS PWA push is limited).
- Multiple children / per-user accounts.
- CSV export is a cheap stretch goal alongside the PDF.

## Definition of done (v1)
Both iPhones can log all event types (incl. custom Factors) offline, data survives app restart, syncs to the home server when online, and the Plot Builder can chart any chosen outcome against any chosen label(s)/Factor(s) over a date range — including ingredient- and texture-level vomit/gassiness correlation. One `docker compose up` on the server runs everything.
