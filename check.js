'use strict';

// Watches ticket availability for the play "Записки юного врача" (A Young Doctor's Notebook)
// and sends one Telegram message when anything is actually purchasable. See README.md.

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
      const link = block.match(/tce\.by\/shows\.html\?base=([^&"']+)&(?:amp;)?data=(\d+)/);
      if (!link) return null; // a listed date with no "buy from us" link
      const when = block.match(/<p>\s*([^<]*?)\s*<\/p>/);
      return { when: when ? when[1] : '?', base: link[1], id: link[2] };
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

async function checkTce() {
  const shows = parseShows(await get(PUPPET_URL)); // the date list is the index; fatal if it fails
  const available = [];
  const failed = [];
  for (const s of shows) {
    // One unreachable show must not discard the dates we already scraped.
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
      `puppet-minsk.by/tce.by: ${shows.length} date(s) listed, ${available.length} on sale, ${failed.length} unchecked`
    );
    for (const s of shows) console.log(`  - ${s.when} (show ${s.id})`);
    for (const f of failed) console.error(`  ! tce.by unreachable for show ${f}`);
    if (shows.length && failed.length === shows.length) {
      console.error('WARNING: every tce.by call failed — puppet-minsk availability is UNKNOWN this run');
    }
    for (const a of available) found.push(`• ${a.when} — ${a.seats} мест(а)\n  ${tcePage(a.base, a.id)}`);
  } else {
    console.error(`SOURCE FAILED puppet-minsk.by: ${why(tce.reason)}`);
  }

  if (bycard.status === 'fulfilled') {
    const { dates, price } = bycard.value;
    console.log(`bycard.by: ${dates.length} date(s) on sale`);
    if (dates.length) found.push(`• bycard.by: ${dates.join(', ')} (${price} BYN)\n  ${BYCARD_PAGE}`);
  } else {
    console.error(`SOURCE FAILED bycard.by: ${why(bycard.reason)}`);
  }

  if (tce.status === 'rejected' && bycard.status === 'rejected') {
    console.error('both sources failed — flying blind, failing the run so it gets noticed');
    process.exitCode = 1;
    return;
  }

  if (!found.length) {
    if (!process.env.FORCE_NOTIFY) return console.log('no tickets on sale — staying quiet');
    found.push('(FORCE_NOTIFY set: nothing on sale, this is a pipe test)');
  }

  await notify(['🎟 Записки юного врача — билеты в продаже!', '', ...found].join('\n'));
  console.log('telegram notification sent');
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

module.exports = { parseShows, tceAvailable, bycardDates };
