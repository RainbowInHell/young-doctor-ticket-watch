'use strict';

// Watches ticket availability for the play "Записки юного врача" (A Young Doctor's Notebook)
// and sends one Telegram message when there is something new to act on. See README.md.

const fs = require('node:fs');

const STATE_FILE = 'state.json';
const PUPPET_URL = 'https://puppet-minsk.by/spektakli/spektakli-dlya-vzroslykh/item/217-zapiski-yunogo-vracha';
const BYCARD_API = 'https://abws.bycard.by/api/v3/pages/events/zapiski-yunogo-vracha-2';
const BYCARD_PAGE = 'https://bycard.by/afisha/minsk/theatre/zapiski-yunogo-vracha-2';
const tceApi = (base, id) =>
  `https://tce.by/index.php?view=shows&action=ticket&kind=json&base=${base}&data=${id}`;
const tcePage = (base, id) => `https://tce.by/shows.html?base=${base}&data=${id}`;

// ponytail: plain non-browser UA on purpose. tce.by runs Anubis proof-of-work, which challenges
// browser-shaped requests only and waves through obvious bots. Do not "fix" this to a Chrome UA.
const UA = 'young-doctor-ticket-watch (+https://github.com/RainbowInHell/young-doctor-ticket-watch)';

// Node wraps every network failure as a bare "fetch failed"; the useful code hides in .cause.
const why = (e) => (e.cause ? `${e.message} (${e.cause.code || e.cause.message})` : e.message);

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

// tce.by serves JSON as Content-Type: text/html, so parse the body instead of trusting res.json().
const getJson = async (url) => JSON.parse(await get(url));

/** Performances listed on the theatre's own page -> [{ when, base, id }]. */
function parseShows(html) {
  return html
    .split('class="date-item"')
    .slice(1)
    .map((block) => {
      const link = block.match(/tce\.by\/shows\.html\?base=([A-Za-z0-9+/=_-]+)&(?:amp;)?data=(\d+)/);
      if (!link) return null; // a listed date with no "buy from us" link
      const when = block.match(/<p>([^<]*)<\/p>/);
      return { when: when ? when[1].trim() : '?', base: link[1], id: link[2] };
    })
    .filter(Boolean);
}

/** tce.by returns ONLY sellable seats, so absence from the array *is* unavailability.
 *  Never index into the seat objects: a success:true payload has never been observed. */
function tceAvailable(json) {
  return json.success === true && Array.isArray(json.data) && json.data.length > 0;
}

/** bycard's `calendar` is [{count, date}] and stays empty while nothing is on sale.
 *  performance.isSelling is 1 even then, so it is NOT a usable signal. */
function bycardDates(json) {
  return (json.calendar || []).map((c) => c.date);
}

/** Shows absent from the previous run. `prev === null` (first run, or unreadable state) yields
 *  nothing on purpose: an empty state must never be reported as "every date is new". */
function newShows(shows, prev) {
  return prev ? shows.filter((s) => !prev.showIds.includes(s.id)) : [];
}

function readState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return Array.isArray(state.showIds) ? state : null;
  } catch {
    return null; // missing or corrupt — treated as a first run, never as "all new"
  }
}

/** Rewrites state.json only when the set actually changed, so the workflow commits rarely
 *  instead of once every 30 minutes. Returns whether it wrote. */
function writeState(showIds) {
  const next = `${JSON.stringify({ showIds }, null, 2)}\n`;
  try {
    if (fs.readFileSync(STATE_FILE, 'utf8') === next) return false;
  } catch {
    // no state file yet
  }
  fs.writeFileSync(STATE_FILE, next);
  console.log(`${STATE_FILE} updated: [${showIds.join(', ')}]`);
  return true;
}

async function checkTce() {
  const html = await get(PUPPET_URL); // the date list is the index; fatal if it fails
  // Observed once from an Actions runner: a fast HTTP 200 with the dates block missing entirely.
  // Treat that as a failed fetch, never as "zero dates" — otherwise the watcher reads
  // 2 -> 0 -> 2 as two brand-new dates and fires a false alert.
  if (!html.includes('dates-wrapper')) {
    throw new Error(`page is missing its dates-wrapper block (len=${html.length})`);
  }
  const shows = parseShows(html);
  const available = [];
  const failed = [];
  for (const s of shows) {
    // tce.by is unreachable from GitHub Actions (verified: UND_ERR_SOCKET). Kept because it is the
    // only source of real seat counts, and one dead show must not discard the scraped dates.
    try {
      const json = await getJson(tceApi(s.base, s.id));
      if (tceAvailable(json)) available.push({ ...s, seats: json.data.length });
    } catch (e) {
      failed.push(`${s.id}: ${why(e)}`);
    }
  }
  return { shows, available, failed };
}

async function checkBycard() {
  const json = await getJson(BYCARD_API);
  const p = json.performance || {};
  return { dates: bycardDates(json), price: `${p.minPrice}-${p.maxPrice}` };
}

async function notify(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat_id = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat_id) throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id, text, disable_web_page_preview: true }),
  });
  const body = await res.json().catch(() => ({}));
  // A silently dropped alert is the worst possible failure here, so make it loud.
  if (!body.ok) throw new Error(`telegram sendMessage failed: ${res.status} ${JSON.stringify(body)}`);
}

async function main() {
  const [tce, bycard] = await Promise.allSettled([checkTce(), checkBycard()]);
  const found = [];

  if (tce.status === 'fulfilled') {
    const { shows, available, failed } = tce.value;
    console.log(
      `puppet-minsk.by: ${shows.length} date(s) listed, ${available.length} on sale, ${failed.length} unchecked`
    );
    for (const s of shows) console.log(`  - ${s.when} (show ${s.id})`);
    for (const f of failed) console.error(`  ! tce.by unreachable for show ${f}`);
    if (shows.length && failed.length === shows.length) {
      console.error('NOTE: every tce.by call failed — seat counts unavailable (expected on Actions)');
    }

    // Change detection: a newly posted performance is the whole point of watching this page.
    const prev = readState();
    if (prev === null) {
      console.log(`no usable ${STATE_FILE} — recording current dates without notifying`);
    } else {
      const fresh = newShows(shows, prev);
      for (const s of fresh) found.push(`• Новая дата: ${s.when}\n  ${tcePage(s.base, s.id)}`);
      if (!fresh.length) console.log('no new dates since the last run');
    }
    writeState(shows.map((s) => s.id));

    // Only reachable if tce.by ever starts answering from the runner.
    for (const a of available) found.push(`• ${a.when} — ${a.seats} мест(а)\n  ${tcePage(a.base, a.id)}`);
  } else {
    console.error(`SOURCE FAILED puppet-minsk.by: ${why(tce.reason)}`);
  }

  // Stateless by choice: bycard is empty today, and while it is not, a repeat ping is wanted.
  if (bycard.status === 'fulfilled') {
    const { dates, price } = bycard.value;
    console.log(`bycard.by: ${dates.length} date(s) on sale`);
    if (dates.length) {
      found.push(`• В продаже на bycard.by: ${dates.join(', ')} (${price} BYN)\n  ${BYCARD_PAGE}`);
    }
  } else {
    console.error(`SOURCE FAILED bycard.by: ${why(bycard.reason)}`);
  }

  if (tce.status === 'rejected' && bycard.status === 'rejected') {
    console.error('both sources failed — flying blind, failing the run so it gets noticed');
    process.exitCode = 1;
    return;
  }

  if (!found.length) {
    if (!process.env.FORCE_NOTIFY) return console.log('nothing new — staying quiet');
    found.push('(FORCE_NOTIFY set: nothing to report, this is a pipe test)');
  }

  await notify(['🎟 Записки юного врача', '', ...found].join('\n'));
  console.log('telegram notification sent');
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

module.exports = { parseShows, tceAvailable, bycardDates, newShows };
