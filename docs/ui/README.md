# UI design mock

`UI.png` and `mock.html` are the design reference used for the M1 restyle
(and as a forward-looking spec for later milestones). `mock.html` is a static
Tailwind + FontAwesome page — useful as a token/layout reference only; it is
**not** wired into the app (see "What was not adopted" below).

## The four screens

1. **Today** — home screen: big "Today" title, a row of colored quick-add
   tiles, and a chronological timeline (time gutter + rail + colored dot per
   entry).
2. **Log Meal** — a bottom sheet with an iOS-style pinned header
   (Cancel / title / Save) and a collapsible "Add Meal Detail" section for
   the less-frequently-needed fields.
3. **Explore Trends** — the Phase-4 Plot Builder: pick an outcome (Y-axis),
   a series/label (X-axis, e.g. foods/ingredients), a date range, and see a
   histogram/scatter of the outcome vs. that series.
4. **Export GI Report** — the Phase-4 GI-ready PDF export: config + a live
   preview of the generated report (weight chart, vomit analysis, suspect
   foods table, other findings).

## What was adopted (M1 restyle: screens 1–2)

- Color tokens: paper `#faf6f0`, white cards, warm neutral borders, chip
  idle/selected (`#efe7db` / `#dcd1be`), and the five event accent colors
  (meal `#419665`, vomit `#df473c`, stool `#8b5a2b`, sleep `#3b7dc4`,
  factor `#8e52c7`) — extended with five derived colors (med, gassiness,
  activity, symptoms, weight) in the same muted-saturated family, defined as
  CSS variables in `src/index.css`.
- Layout: rounded-xl (~12px) cards/tiles, 32px sheet-top radius, bold
  28–30px screen titles, 11px uppercase section labels, colored quick-add
  tiles in a 3×3 grid, a timeline with a time gutter + continuous rail +
  colored dot per entry, and an iOS-style pinned sheet header
  (Cancel / bold title / Save) with Delete moved to the bottom of the sheet
  body.
- The "Add Meal Detail" collapsible pattern from screen 2, implemented as
  MealSheet's "More detail" section (collapsed by default on add,
  auto-expanded on edit if any of its fields already has a value).

## What was deliberately not adopted

This is an offline-first PWA with a hard no-new-dependencies,
no-network-assets constraint, so the following from `mock.html` were **not**
brought in:

- **Tailwind CSS** (loaded via CDN in the mock) — restyled with plain CSS
  variables/rules in `src/index.css` instead.
- **FontAwesome** icons (also CDN) — kept the app's existing emoji icon
  style (no icon font, no SVG sprite dependency).
- **Google Fonts "SF Pro Display"** webfont — kept the system font stack
  (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`), which
  already renders as SF on iOS/iPhone without a network fetch.

## Screens 3–4 are future specs, not built yet

**Explore Trends** and **Export GI Report** are the Phase-4 (M2) Plot
Builder and GI report export, per `CLAUDE.md`'s milestone list. They are
design references for that future work — nothing in the current M1 restyle
implements them.
