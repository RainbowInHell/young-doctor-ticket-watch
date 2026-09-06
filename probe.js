const { parseShows } = require('./check.js');
const PUPPET = 'https://puppet-minsk.by/spektakli/spektakli-dlya-vzroslykh/item/217-zapiski-yunogo-vracha';
const BOT = 'young-doctor-ticket-watch (+https://github.com/RainbowInHell/young-doctor-ticket-watch)';

(async () => {
  const r = await fetch(PUPPET, { headers: { 'user-agent': BOT }, signal: AbortSignal.timeout(20000) });
  const b = await r.text();
  console.log('status', r.status, '| len', b.length);
  console.log('date-item occurrences:', (b.match(/class="date-item"/g) || []).length);
  console.log('parseShows =>', JSON.stringify(parseShows(b)));
  console.log('tce hrefs:', JSON.stringify(b.match(/href="[^"]*tce\.by[^"]*"/g) || []));
  const i = b.indexOf('date-item');
  console.log('RAW BLOCK:', JSON.stringify(b.slice(Math.max(0, i - 150), i + 900)));
})();
