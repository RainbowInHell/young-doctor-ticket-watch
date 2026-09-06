# young-doctor-ticket-watch

Watches ticket availability for **«Записки юного врача»** (*A Young Doctor's Notebook*, Belarusian
State Puppet Theatre) and sends a Telegram message **only when tickets are actually purchasable**.

Tickets for this play are posted rarely and sell out fast, so a GitHub Actions cron polls both
ticket systems every 30 minutes. No dependencies, no database, no state file — one 110-line script.

```
node check.js          # check once; prints what it saw, notifies only if something is on sale
node --test            # run the parser/predicate tests
FORCE_NOTIFY=1 node check.js   # send a message regardless, to prove the Telegram path works
```

## Setup

1. **Create a bot**: message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. **Find your chat id**: send any message to your new bot, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `result[0].message.chat.id`.
3. **Store both as repo secrets**:
   ```bash
   gh secret set TELEGRAM_BOT_TOKEN
   gh secret set TELEGRAM_CHAT_ID
   ```
4. Trigger a run by hand to confirm: `gh workflow run check.yml && gh run watch`.

## How it decides "available"

Two independent sources, queried in parallel; either one failing cannot blind the other.

### 1. bycard.by

```
GET https://abws.bycard.by/api/v3/pages/events/zapiski-yunogo-vracha-2   → 200 application/json
```

`calendar` is an array of `{count, date}` and is **empty while nothing is on sale** — that is the
signal. Verified against an event that *is* on sale (`damy-i-gusary` → `[{"count":1,"date":"2026-10-15"}]`).

- ⚠️ `performance.isSelling` is `1` even with an empty calendar. **Not a usable signal.**
- `cityId` is deliberately omitted: this is a touring Brest production, so a date in any city counts.
- The `hg-security` JavaScript anti-bot only guards the `bycard.by` **frontend**. Calling
  `abws.bycard.by` directly avoids it entirely — no cookies, no browser, no HTML parsing.
  (Endpoint found in the Nuxt 2 chunk `/_nuxt/02d0ab92aa0ab502f263.js`.)

### 2. puppet-minsk.by → tce.by

The theatre's own page is the index of what exists. Each performance is one
`<div class="date-item">` holding the date and a link carrying the tce.by show id:

```
https://tce.by/shows.html?base=<base64 seller GUID>&data=4956
```

Show ids are **scraped, never hardcoded** — a newly posted date *is* a new id appearing here.
Then, per show, the booking API (derived from `doRequest()` in `https://tce.by/js/main.js`):

```
GET https://tce.by/index.php?view=shows&action=ticket&kind=json&base=<base>&data=<showId>
```

`{data, attr, success}`. On `success: true`, `data` holds **only the sellable seats**, so
`success === true && data.length > 0` is the entire predicate and `data.length` is the seat count.
Nothing on sale returns `{"success":false,"data":"Операция не принесла результата."}`.

- ⚠️ Served as `Content-Type: text/html` **even for JSON** → parse the body, never `res.json()`.
- ⚠️ A `success: true` payload has never been observed (this seller had no inventory at all across
  ids 4925–4957 when this was written). Field names come from reading `main.js`, not from a real
  response — so the script only ever reads `data.length` and never touches `x`/`y`/`pzone_id`.
- tce.by runs [Anubis](https://github.com/TecharoHQ/anubis) proof-of-work, which challenges
  *browser-shaped* requests only. The script sends a plain non-browser `User-Agent` on purpose —
  do not "improve" it into a Chrome UA.
- **tce.by appears to refuse connections from non-Belarus IPs** (`ECONNREFUSED`/`ETIMEDOUT` from
  several independent vantage points). If the runner can't reach it, the log says
  `WARNING: every tce.by call failed` and the run still succeeds on bycard alone. See below.

## Operating notes

- **Alerts repeat** every 30 min while tickets are on sale. Intentional: there is no state file, so
  nothing to go stale, and a rare drop is worth nagging about. Add a committed `state.json` if it
  ever gets annoying.
- **Exit codes**: `1` only when *both* sources fail (total blindness → GitHub emails you about the
  red run). One source failing logs loudly and still exits 0.
- **Cron is best-effort.** GitHub delays or drops scheduled runs under load, hence the `:07/:37`
  offset instead of `:00/:30`.
- **Public repo ⇒ scheduled workflows are auto-disabled after 60 days with no repository activity.**
  If you get that email from GitHub, click re-enable.
- **If tce.by is permanently unreachable from Actions**, availability for the theatre's own dates
  can't be read. Fallback: add a committed `state.json` and alert on a *new show id* appearing on
  the puppet-minsk page, which is reachable from everywhere.
