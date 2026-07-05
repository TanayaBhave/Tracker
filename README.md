# Baby Feeding & Symptom Tracker — M1

Offline-first PWA for logging one baby's feeding, reflux, and related symptoms, built to produce clean data for a pediatric GI appointment. **M1 = local-only.** Data is stored on-device in IndexedDB. Sync to your home server (M3) and charts/PDF (M2) come next.

> Pattern-spotting tool, not medical advice. It does not diagnose.

## Run it

    npm install
    npm run dev      # local dev at http://localhost:5173

Build + preview a production bundle:

    npm run build
    npm run preview

## Install on your iPhone (M1 testing)

PWAs need HTTPS to install on iOS. Easiest paths:
- Tailscale (recommended): run `npm run dev -- --host` and reach it over your tailnet. Use Tailscale Serve to put HTTPS in front so install/offline work fully.
- Or build and serve `dist/` behind any HTTPS reverse proxy (Caddy does this in one line).

Then in iOS Safari: Share -> Add to Home Screen. Installing matters: iOS can purge a non-installed site's IndexedDB after ~7 days. Real durability arrives with server sync in M3.

## What's here (M1)

- Quick-add: Meal (ingredients, texture, feeding pace, eating signs, burped yes/no/partial, reaction), Vomit (severity, forcefulness, appearance, body position, with red-flag warnings for projectile/bile/blood), Nappy/stool (consistency + straining), Medication, Sleep, daily Gassiness (less/regular/more), daily Activity (less/regular/more), daily Symptom flags, Weight.
- Today timeline + History (pick any day).
- Settings: device label (tags who logged what, for later sync), local data counts.
- Installable, works fully offline.

## Architecture

- src/db.ts        Dexie schema + record types. Every record has id, createdAt, updatedAt, deleted, enteredBy so M3 sync (last-write-wins, soft deletes) drops in without migration.
- src/components/sheets.tsx   one quick-add sheet per event type.
- src/components/Timeline.tsx live day view.
- src/App.tsx      shell, tabs, sheet routing.

## Next milestones

- M2 - Insights + PDF: Plot Builder, ingredient/texture correlation, days-since-last-stool overlay, GI-ready PDF. Recharts already installed.
- M3 - Sync: Node + SQLite container, /sync endpoint, shared-token auth, client sync layer.
- M4 - Deploy: docker-compose, HTTPS via Tailscale, install on both phones.

See CLAUDE.md for the full spec.
