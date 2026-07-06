# Deploy runbook — home Linux server (tailnet-only)

One Docker container serves the API **and** the built PWA. The host port is
set by `APP_PORT` in `.env` (default **8081**; the container always listens
on 8080 internally — pick any free host port). HTTPS (mandatory for iOS PWA
install, the service worker, and camera access) is provided at the host level
by `tailscale serve`, tailnet-only — **no Funnel, nothing public**.

## 1. Prerequisites

- Docker Engine + the compose plugin (`docker compose version` works).
  Fresh box: <https://docs.docker.com/engine/install/> — then add yourself to
  the `docker` group or use `sudo`.
- Tailscale installed and logged in on the server **and both iPhones**
  (`tailscale status` shows all three).
- In the Tailscale admin console → **DNS**: MagicDNS **and** HTTPS
  certificates enabled (serve needs both to mint a valid cert).

## 2. Get the code + configure

```bash
git clone <repo-url> tracker && cd tracker
# or from your machine: scp -r ./Tracker user@server:~/tracker

cp .env.example .env
openssl rand -base64 32     # → paste as SYNC_TOKEN in .env
$EDITOR .env                # set APP_PORT to a free host port (default 8081);
                            # USDA_API_KEY can stay empty until the nutrition phase
```

## 3. Build + start

```bash
docker compose up -d --build
curl http://localhost:7676/api/health     # expect HTTP 200 (use your APP_PORT)
docker compose logs -f app                # if anything looks off
```

The SQLite database lands in `./data/baby.sqlite` (bind mount) and survives
rebuilds and restarts.

## 4. HTTPS via tailscale serve (tailnet-only)

<!--
Syntax verified 2026-07-05 against the official Tailscale docs:
- CLI reference: https://tailscale.com/kb/1242/tailscale-serve
  (same page as https://tailscale.com/docs/reference/tailscale-cli/serve)
- Examples: https://tailscale.com/docs/reference/examples/serve
Key facts from those docs: `--https=443` is the default listener; the target
may be given as `localhost:<port>` (plain-HTTP backend); `--bg` runs the
proxy persistently in the background until disabled; serve is tailnet-only —
public exposure is a separate command (`tailscale funnel`), which we do NOT use.
-->

```bash
tailscale serve --bg localhost:8081     # target = your APP_PORT
```

This terminates TLS with a real (Let's Encrypt) certificate and forwards
HTTPS :443 → `http://localhost:8081`, visible **only inside your tailnet**.
`--bg` keeps it running after you close the shell and across reboots.
If you get a permission error, prefix `sudo` (or set
`tailscale set --operator=$USER` once).

Check it:

```bash
tailscale serve status
# https://<hostname>.<tailnet-name>.ts.net/
#   |-- proxy http://localhost:7676
```

Your app URL is `https://<hostname>.<tailnet-name>.ts.net` — find the exact
name with `tailscale status` or in the admin console. Open it in a browser on
the tailnet and confirm the app loads with a padlock.

To turn it off later: `tailscale serve --https=443 localhost:7676 off`
(or nuke everything with `tailscale serve reset`).

## 5. Install on both iPhones

On **each** phone (must be on the tailnet, i.e. Tailscale app connected):

1. Safari → `https://<hostname>.<tailnet-name>.ts.net`.
2. Share button → **Add to Home Screen** → Add.
3. Open the **installed** app (home-screen icon, not the Safari tab).
4. Settings tab → set a **device name** (e.g. "Mom's phone" / "Dad's phone")
   and paste the **server token** (the `SYNC_TOKEN` value from `.env`).
   Leave the server URL blank — the app is served same-origin, so it syncs
   to the host it was loaded from.
5. Log a test event on phone A, wait a few seconds, confirm it appears on
   phone B.

> **iOS quirk:** Safari can purge IndexedDB for ordinary tabs after ~7 days
> of disuse. The installed home-screen PWA is treated better, but the real
> durability guarantee is server sync — every synced record lives in
> `./data/baby.sqlite` regardless of what the phone does.

## 6. Update / redeploy

```bash
cd ~/tracker
git pull
docker compose up -d --build
```

The PWA service worker is registered with `registerType: 'autoUpdate'`
(vite-plugin-pwa): phones pick up the new version automatically on next
open, but the new assets may only activate on the **second** launch — if a
phone looks stale, fully close the app (swipe away) and reopen once.

## 7. Backup

The entire dataset is the SQLite file plus its journal siblings:

```
./data/baby.sqlite        # main database
./data/baby.sqlite-wal    # write-ahead log (may not exist at any given moment)
./data/baby.sqlite-shm    # shared memory file (ditto)
```

Simple nightly copy (crontab -e):

```cron
15 3 * * * cp -a /home/YOU/tracker/data /home/YOU/backups/tracker-$(date +\%F)
```

or rsync to another machine:

```cron
15 3 * * * rsync -a /home/YOU/tracker/data/ backuphost:/backups/tracker/
```

Copy all three files together (they are one logical database). For a
guaranteed-consistent snapshot, `docker compose stop app`, copy, then
`docker compose start app` — at 3 AM nobody is logging feeds.

**Restore:** `docker compose stop app` → copy the backed-up `baby.sqlite`
(+ `-wal`/`-shm` if present) back into `./data/` → `docker compose start app`.

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| App loads but sync fails with **401** | Token on the phone ≠ `SYNC_TOKEN` in `.env` (typo, trailing whitespace, or `.env` edited without restart) | Re-paste the token on the phone; after editing `.env`, run `docker compose up -d` to recreate the container |
| `curl http://localhost:<APP_PORT>/api/health` fails | Container not running or crashed on boot; or the port is taken by another app | `docker compose ps`, then `docker compose logs app`; if the port is busy (`bind: address already in use`), pick a different `APP_PORT` in `.env`, `docker compose up -d`, and re-point tailscale serve at the new port |
| `https://…ts.net` shows cert warning or times out | MagicDNS/HTTPS not enabled in the admin console, or serve not running | Enable both under DNS in the admin console; `tailscale serve status`; re-run the serve command; first cert issuance can take ~30 s |
| Phone can't reach the URL at all | Phone's Tailscale app disconnected | Open Tailscale on the phone, toggle the connection on |
| Build fails inside `npm ci --omit=dev` mentioning `better-sqlite3`, `node-gyp`, or `prebuild` | Native-module compile hiccup / stale cached layer | `docker compose build --no-cache && docker compose up -d` — the image already ships python3/make/g++ in the deps stage, so a clean rebuild compiles it from source |
| Container healthy but page is stale after a deploy | iOS service worker holding old assets | Fully close the PWA and reopen (autoUpdate applies on next launch); confirm the server was actually rebuilt with `docker compose images` |
