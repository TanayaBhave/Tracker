# Baby Tracker — Full Build Plan (finish M1 → sync → deploy → nutrition → growth → insights)

## Context

Local-first PWA for tracking a baby's feeding/symptoms ahead of a pediatric GI appointment. M1 (local logging) is nearly done. The user wants: (1) the app usable on both iPhones ASAP — compressed schedule, parallel sub-agents; (2) a **nutrition tracker**: per-ingredient nutrition from USDA FoodData Central, UPC camera scanning for 365-brand products (zxing-wasm), daily macro pie chart + micronutrient %-of-DRI vs NIH/AAP recommendations; (3) **growth charts**: WHO boys weight-for-age at **corrected age** (live chart) + Fenton 2013 preterm chart (historical view of early weights). Baby: 13 months actual, born 34 weeks → ~11.5 months corrected.

**Locked decisions:** build order = data model + sync + deploy first, analysis after (data logged from day 1 must be structured); USDA FDC via a server-side proxy (hides API key, free SQLite caching); camera barcode scan in first nutrition release; WHO LMS + Fenton data embedded as static JSON fetched from primary sources at build time (never from model memory).

**Current state (verified):** React 19 + Vite 8 + TS, Dexie 4, PWA configured, recharts installed/unused, oxlint. No git repo, no node_modules, no tests (Playwright installed). All 9 quick-add sheets exist; Meal/Vomit/Stool/Med/Sleep have edit+soft-delete; Timeline tappable. **Key gap:** meal ingredients are a comma string inside `notes`; `ingredients`/`foodCatalog` tables unused. Remaining M1: Factors UI, edit parity on Weight/Gas/Activity/Symptom sheets.

**Wall-clock strategy:** ~10–13h to end of Phase 3 (deployed, syncing, nutrition + growth live) with parallel sub-agents; Phase 4 (Plot Builder/PDF) is day 2.

---

## Phase 0 — Bootstrap + data model v2 (serial, ~30–45 min)

1. `git init` + initial commit; `npm install`; verify dev/build/lint pass.
2. **Human task (start now, async):** request USDA API key at fdc.nal.usda.gov/api-key-signup.html; confirm Tailscale on home server + both iPhones.
3. **Foundation commit (freezes file-ownership boundaries for parallel work):**
   - `src/db.ts` → schema v2 (below).
   - Extract `Settings` from `App.tsx` into `src/components/Settings.tsx` with stubs `BabyProfileSettings.tsx` (W1) and `SyncSettings.tsx` (W2).
   - Split `src/components/sheets.tsx` into `src/components/sheets/{MealSheet,VomitSheet,StoolSheet,MedSheet,DailySheets,SleepSheet,WeightSheet,SymptomSheet}.tsx` + `index.ts` re-exports (mechanical; prevents all later merge conflicts).
   - `vite.config.ts`: add `server.proxy = { '/api': 'http://localhost:8080' }`; add `'**/*.wasm'` to workbox globPatterns.

### Data model v2 (`src/db.ts`)

- `NutrientProfile` (per 100 g/ml): kcal, protein_g, fat_g, carbs_g, fiber_g, iron_mg, calcium_mg, zinc_mg, vitD_ug, vitC_mg, vitA_ug_rae, potassium_mg, sodium_mg, folate_ug, vitB12_ug.
- `FoodItem` += `catalogId?: string` (link to FoodCatalogItem for nutrition).
- `FoodCatalogItem` += `brand?`, `upc?` (normalized GTIN), `fdcId?`, `per100?: NutrientProfile`, `nutritionSource?: 'usda'|'manual'|'none'`, `servingGrams?`, `lastFetchedAt?`.
- New synced singleton `AppSettings` (table `settings`, id `'baby'`): `dob`, `gestWeeksAtBirth` (34), `gestDaysAtBirth`, `sex`, `associationWindowHours` (default 2).
- Schema: `version(2).stores({ foodCatalog: 'id, name, upc, fdcId, updatedAt, deleted', settings: 'id, updatedAt, deleted' })` + `.upgrade()` migration parsing `"Ingredients: x, y — notes"` strings out of meal notes into deduped `Ingredient` records + `foodItems[0].ingredientIds`; bump `updatedAt` on migrated meals so migration results sync (convergent under LWW when both phones migrate).
- Export `SYNC_TABLES = ['meals','meds','vomits','stools','gassiness','activity','sleep','weights','symptoms','factors','factorEvents','ingredients','foodCatalog','settings']`.
- Device-local (localStorage, never synced): `deviceLabel`, `syncUrl`, `syncToken`, `syncCursor`, `lastPushedAt`, `lastSyncAt`.

---

## Phase 1 — PARALLEL: 3 sub-agents, zero shared files (~3h wall-clock)

### W1 — Structured-ingredient UI + baby profile (M)
**Owns:** `sheets/MealSheet.tsx`, `IngredientPicker.tsx` (new), `BabyProfileSettings.tsx`, `Timeline.tsx`, `sheets/{Weight,Daily,Symptom}Sheet.tsx`.
- `IngredientPicker`: chip multi-select over `db.ingredients` (useLiveQuery) + autocomplete free-text that creates `Ingredient` records on the fly (case-insensitive dedupe). In/out: `string[]` ids.
- `MealSheet`: replace comma-string state with `ingredientIds`; stop writing `Ingredients:` into notes. Food-name autocomplete from `foodCatalog`; selection autofills category/unit/ingredients + sets `catalogId`. "Save as dish" checkbox upserts a `FoodCatalogItem`. Leave a marked slot for the Phase-3 Scan button.
- `BabyProfileSettings`: DOB, gestation weeks (default 34) + days, sex → `settings` singleton.
- Edit+soft-delete parity for Weight/Gas/Activity/Symptom sheets (mirror MedSheet pattern; Weight edit needed for back-entering historical weights).

### W2 — Sync server + client engine (L)
**Owns:** `server/**` (new), `src/sync.ts`, `SyncSettings.tsx`, `src/main.tsx` (1 line).
- Server: Fastify + better-sqlite3, plain ESM, no build step (`server/index.js`, `sync.js`, `db.js`, empty `usda.js` registered now so Phase 3 never touches index.js). `@fastify/static` serves `server/public` with SPA fallback; `Cache-Control: no-cache` on `index.html`/`sw.js` (iOS SW update flow), long cache on hashed assets.
- SQLite: `records(tbl, id, updatedAt, deleted, payload JSON, serverSeq, PK(tbl,id))` + seq index; `meta(k,v)`; `usda_cache(url, payload, fetchedAt)`. `DB_PATH` default `/data/baby.sqlite`.
- **Cursor = server change counter `serverSeq`** (clock-skew immune); `updatedAt` only for LWW.
- `POST /api/sync` (Bearer `SYNC_TOKEN`): request `{clientId, since, changes:[{tbl, rows:[...]}]}` → response `{serverSeq, changes}` (rows with `serverSeq > since`, minus ids just pushed). One transaction; accept iff `incoming.updatedAt > existing.updatedAt`; accepted rows get new serverSeq; `tbl` validated against SYNC_TABLES; pull capped 1000. Plus `GET /api/health`.
- Client (`src/sync.ts`): dirty = `where('updatedAt').above(lastPushedAt)` per table (no schema change, all writes already bump updatedAt). `syncNow()`: push dirty + pull since cursor → `bulkPut` guarded by client-side LWW in one rw transaction → advance `syncCursor`/`lastPushedAt`. Known benign echo quirk accepted (server strict-greater makes it a no-op). Triggers: app start, `online`, visibility, 3s-debounced after save, 60s interval. `useSyncStatus()` hook `{state, lastSyncAt, pendingCount}`.
- Base URL: `localStorage.syncUrl` or same-origin (prod single origin; dev via vite proxy).

### W3 — Docker/deploy scaffolding (S)
**Owns:** `Dockerfile`, `docker-compose.yml`, `.env.example`, `deploy.md`.
- Multi-stage Dockerfile: node:22-alpine build (`npm ci && npm run build`) → runtime stage copies `server/` + `dist`→`./public`; `ENV DB_PATH=/data/baby.sqlite PORT=8080`; `CMD ["node","index.js"]`.
- Compose: single `app` service, port 8080, `./data:/data` volume, `env_file: .env` (`SYNC_TOKEN`, `USDA_API_KEY`).
- HTTPS: host-level `tailscale serve --bg https / http://localhost:8080` (valid cert, mandatory for iOS PWA + camera). Tailnet-only, **no Funnel**.

---

## Phase 2 — Integrate + deploy + two-phone verification (serial, ~1.5–2h)

1. Merge W1–W3; `npm run build && npm run lint`.
2. Add Charts placeholder tab now (`App.tsx` nav + `ChartsScreen.tsx` with "Nutrition" and "Growth" slots) so Phase 3 agents never touch App.tsx.
3. Playwright smoke net (`tests/smoke.spec.ts`): load, add meal w/ 2 ingredients, timeline shows it, reload persists, edit + delete work. Runs against `npm run preview`.
4. Deploy: `docker compose up --build` on home server, `.env` set, tailscale serve.
5. Both iPhones: Safari → Add to Home Screen → set device name + token.
6. **Verify:** A→B propagation; airplane-mode offline logging + persistence + late sync; concurrent-edit LWW; delete propagation; v1→v2 meal migration (structured chips, no `Ingredients:` prefix); SW update on redeploy.
7. **Real daily logging starts here.** User back-enters historical weights (chart lands in Phase 3).
8. Commit, tag `v0.2-synced`.

---

## Phase 3 — PARALLEL: Nutrition ∥ Growth (~4h wall-clock)

**Cross-workstream contract (agree up front):** `correctedAgeMonths(dob, gestWeeks, gestDays, onDate?): number` in `src/growth/age.ts` (W5 owns, W4 imports).

### W4 — Nutrition pipeline (L)
**Owns:** `server/usda.js`, `src/nutrition/{usdaMap,usdaClient,intake,dri}.ts`, `BarcodeScanner.tsx`, `FoodLookupSheet.tsx`, `NutritionDay.tsx`, `sheets/MealSheet.tsx`, ChartsScreen Nutrition slot. `npm i zxing-wasm`.
- Server proxy (Bearer-guarded): `GET /api/usda/search?q=` → FDC `/v1/foods/search` (dataType Branded,Foundation,SR Legacy; barcode = GTIN as query with dataType=Branded); `GET /api/usda/food/:fdcId`. Check/write `usda_cache` (cache forever).
- UPC lookup order: local `foodCatalog.where('upc')` (offline repeat-purchase hit) → remote raw → zero-padded-13 → stripped leading zeros.
- `usdaMap.ts`: USDA nutrient id→profile key table (1008→kcal, 1003→protein_g, 1004→fat_g, 1005→carbs_g, 1079→fiber_g, 1089→iron_mg, 1087→calcium_mg, 1095→zinc_mg, 1114→vitD_ug w/ IU/40 fallback, 1162→vitC_mg, 1106→vitA_ug_rae RAE only, 1092→potassium_mg, 1093→sodium_mg, 1177/1190→folate_ug prefer DFE, 1178→vitB12_ug). Values are per-100g already; `normalizeUsdaFood(json) → {per100, servingGrams, brand, name, fdcId, upc}`.
- Scanner: full-screen sheet, `getUserMedia({video:{facingMode:'environment'}})`, canvas frame-grab ~300ms, dynamic `import('zxing-wasm/reader')` `readBarcodes` (EAN-13/UPC-A/UPC-E/EAN-8) — keeps ~1MB wasm out of main bundle. On hit → `FoodLookupSheet` pick-list → upsert catalog item + set `catalogId`. Camera behind explicit tap (per-session iOS permission). **Test on real iPhone EARLY, not last.**
- `intake.ts`: `computeDailyIntake(dateStr)` = Σ over day's meals of `per100 × amountConsumed/100` + `coverage` stat ("based on 4 of 6 items").
- `dri.ts`: static brackets `infant7_12` / `child1_3` selected by corrected age; **verify every value against NIH ODS fact sheets via WebFetch at build time, cite source URL per row.**
- `NutritionDay.tsx`: date picker → macro-kcal pie (protein×4/carbs×4/fat×9, total kcal center) → micro list with %DRI horizontal bars (cap 150% + overflow marker), raw amounts always shown, corrected-age bracket + coverage shown, "pattern-spotting, not medical advice" banner.

### W5 — Growth charts (M)
**Owns:** `src/growth/{age,lms,whoWfaBoys,fentonBoys}.ts`, `GrowthChart.tsx`, ChartsScreen Growth slot.
- `age.ts`: corrected age = chronological − (280 − gestDays-at-birth) days, ÷30.4375; `postmenstrualAgeWeeks()` for Fenton.
- `lms.ts`: z = `((v/M)^L − 1)/(L·S)` (L→0: `ln(v/M)/S`); inverse `valueFromZ`; percentile via erf-approx CDF; monthly L/M/S interpolation.
- `whoWfaBoys.ts`: months 0–24 LMS, **fetched at build time from CDC-hosted WHO data (cdc.gov/growthcharts/who_charts.htm) via WebFetch — never typed from memory**; cite URL + date in header.
- `fentonBoys.ts`: P3/10/50/90/97 weekly kg, PMA 22–50wk, from Fenton 2013 supplementary tables (BMC Pediatrics 13:59, open access; free for non-commercial use — note in header).
- `GrowthChart.tsx`: reads settings + weights (lb→kg ×0.45359237). Toggle: **WHO (primary)** — ComposedChart, X=corrected months 0–24, P3/15/50/85/97 lines (z=−1.881/−1.036/0/1.036/1.881) + weight Scatter; header stat "8.4 kg — 22nd percentile (z −0.77) at 11.6 mo corrected". **Fenton (historical)** — X=PMA 22–50wk, only weights with PMA≤50 render. Empty states → link to Settings; ">2 weeks since last weigh-in" reminder chip.

**Phase 3 verify:** real 365 UPC scan on iPhone (then airplane-mode rescan = offline hit); hand-check daily totals vs `per100×1.2` for a 120g item; DRI bracket boundary with fake DOB; percentile spot-check vs online WHO calculator (<1 point tolerance); Fenton shows only early weights; extend Playwright smoke to Charts tab; redeploy + both phones update.

---

## Phase 4 — M2 insights (day 2, L, parallelizable W6a/b/c)

- **W6a** `src/insights/engine.ts`: association-window correlation (exposures/outcomes/rate per ingredient/tag/texture, raw counts always), duration-factor pre/post baseline. Pure functions.
- **W6b** Plot Builder UI + saved views (Dexie v3 `savedViews` table added to SYNC_TABLES + server whitelist in same commit).
- **W6c** GI-ready PDF: print-stylesheet HTML report route + `window.print()` (cheapest iOS-workable) — weight trend, vomit summary, suspect table, stool gaps, symptom timeline, red flags.
- Factors CRUD screen (remaining M1 item) lands here too.

## Phase 5 — Polish (S)
Sync-status pill in top bar, red-flag copy pass, descriptive-not-diagnostic audit, CLAUDE.md update, final tag. Also copy this roadmap into the repo as `docs/ROADMAP.md`.

---

## File-ownership map (merge-conflict prevention)

| Phase | Agent | Owns exclusively |
|---|---|---|
| 0 | serial | db.ts, Settings/sheets split, vite.config.ts, git init |
| 1 | W1 | MealSheet, IngredientPicker, BabyProfileSettings, Timeline, Weight/Daily/Symptom sheets |
| 1 | W2 | server/**, sync.ts, SyncSettings, main.tsx |
| 1 | W3 | Dockerfile, compose, .env.example, deploy.md |
| 2 | serial | App.tsx (Charts tab), ChartsScreen, tests/**, deploy |
| 3 | W4 | server/usda.js, src/nutrition/**, scanner/lookup/NutritionDay, MealSheet |
| 3 | W5 | src/growth/**, GrowthChart |
| 4 | W6a/b/c | src/insights/**, report route |

## Risks
1. WHO/Fenton/DRI tables must come from primary sources via WebFetch during implementation — never model memory.
2. zxing-wasm camera on iOS: test on a real iPhone early in Phase 3.
3. Dexie v2 `upgrade()` runs on both phones — designed convergent under LWW, but test against real v1 data before the Phase 2 deploy (live records exist).
4. Blockers only the user can clear: USDA API key signup, Tailscale on server, running `docker compose` on the home server, on-iPhone testing.
