# young-doctor-ticket-watch

Watches ticket availability for **«Записки юного врача»** (*A Young Doctor's Notebook*, Belarusian
State Puppet Theatre) and sends a Telegram message when there is something new to act on.

Tickets for this play are posted rarely and sell out fast, so a GitHub Actions cron polls both
ticket systems every 30 minutes. No dependencies, no service, no database — one script and a
four-line `state.json`.

```
node check.js                  # check once; notifies only if there is something new
node --test                    # parser / predicate / state tests
FORCE_NOTIFY=1 node check.js   # send a message regardless, to prove the Telegram path works
```

## Setup

1. **Create a bot**: message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. **Find your chat id**: send any message to your new bot, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `result[0].message.chat.id`.
3. **Store both as repo secrets** (run these yourself so the token stays out of any transcript):
   ```bash
   gh secret set TELEGRAM_BOT_TOKEN --repo RainbowInHell/young-doctor-ticket-watch
   gh secret set TELEGRAM_CHAT_ID  --repo RainbowInHell/young-doctor-ticket-watch
   ```
4. Confirm end to end: `gh workflow run check.yml && gh run watch`.

## What triggers a message

Two sources, queried in parallel; either one failing cannot blind the other. They use **different**
triggers, because their "nothing on sale" states differ.

| Source | Trigger | Repeats? |
|---|---|---|
| puppet-minsk.by | a **new** performance date appears (a show id not in `state.json`) | once per new date |
| bycard.by | its `calendar` is non-empty | every run while true |

`state.json` exists only because the theatre page *already* lists dates (29 & 30 Sep), so
"dates exist" is permanently true and would notify every 30 minutes forever. bycard needs no state:
its calendar is empty today, so "not empty" is already a change.

### 1. bycard.by — clean JSON, no anti-bot

```
GET https://abws.bycard.by/api/v3/pages/events/zapiski-yunogo-vracha-2   → 200 application/json
```

`calendar` is an array of `{count, date}`, empty while nothing is on sale. Verified against an
event that *is* on sale (`damy-i-gusary` → `[{"count":1,"date":"2026-10-15"}]`).

- ⚠️ `performance.isSelling` is `1` even with an empty calendar. **Not a usable signal.**
- `cityId` is deliberately omitted: this is a touring Brest production, so a date in any city counts.
- The `hg-security` JavaScript anti-bot only guards the `bycard.by` **frontend**. Calling
  `abws.bycard.by` directly avoids it entirely — no cookies, no browser, no HTML parsing.
  (Endpoint found in the Nuxt 2 chunk `/_nuxt/02d0ab92aa0ab502f263.js`.)

### 2. puppet-minsk.by — the list of performances

Each performance is one `<div class="date-item">` holding the date and a link carrying a tce.by
show id. Show ids are **scraped, never hardcoded** — a newly posted date *is* a new id appearing
here, and that is exactly what gets compared against `state.json`.

The page once returned HTTP 200 with the dates block missing entirely. The script therefore rejects
any response without a `dates-wrapper` container instead of reading it as "zero dates" — otherwise
2 → 0 → 2 would look like two brand-new dates and fire a false alert.

### 3. tce.by — seat counts, best-effort only

```
GET https://tce.by/index.php?view=shows&action=ticket&kind=json&base=<base>&data=<showId>
```

`{data, attr, success}`. On `success: true`, `data` holds **only the sellable seats**, so
`success === true && data.length > 0` is the whole predicate. Nothing on sale returns
`{"success":false,"data":"Операция не принесла результата."}`.

**⚠️ Verified unreachable from GitHub Actions** (`UND_ERR_SOCKET` on every attempt, with both a bot
and a browser User-Agent) and from a home connection (`UND_ERR_CONNECT_TIMEOUT`). Only a commercial
scraping proxy got through. So seat counts are effectively unavailable and each run logs
`NOTE: every tce.by call failed`. The calls cost ~1.5s each and are kept because this is the only
source of real seat data if the network path ever opens up.

Other landmines, all verified:

- Served as `Content-Type: text/html` **even for JSON** → parse the body, never `res.json()`.
- A `success: true` payload has never been observed (this seller had no inventory at all across ids
  4925–4957). Field names come from reading `https://tce.by/js/main.js`, not from a real response —
  so the script only ever reads `data.length` and never touches `x`/`y`/`pzone_id`.
- tce.by runs [Anubis](https://github.com/TecharoHQ/anubis) proof-of-work, which challenges
  *browser-shaped* requests only. The script sends a plain non-browser `User-Agent` on purpose —
  do not "improve" it into a Chrome UA.

## Operating notes

- **`state.json` is committed by the workflow**, and only when the date set actually changes — so
  the history stays clean and each change is visible as a commit. Hence `permissions: contents: write`.
- **A missing or corrupt `state.json` never fires alerts.** It is recorded silently and the next run
  compares against it, so a lost state can't produce a burst of false "new date" messages.
- **Exit codes**: `1` only when *both* sources fail (total blindness → GitHub emails you about the
  red run). One source failing logs loudly and still exits 0.
- **Cron is best-effort.** GitHub delays or drops scheduled runs under load, hence the `:07/:37`
  offset instead of `:00/:30`.
- **Public repo ⇒ scheduled workflows are auto-disabled after 60 days with no repository activity.**
  Largely self-mitigating here, since a changed date set produces a commit. If you get that email
  from GitHub, click re-enable.
