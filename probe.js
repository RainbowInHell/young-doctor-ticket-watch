const PUPPET = 'https://puppet-minsk.by/spektakli/spektakli-dlya-vzroslykh/item/217-zapiski-yunogo-vracha';
const TCE = 'https://tce.by/index.php?view=shows&action=ticket&kind=json&base=RkZDMTE2MUQtMTNFNy00NUIyLTg0QzYtMURDMjRBNTc1ODA0&data=4956';
const BOT = 'young-doctor-ticket-watch (+https://github.com/RainbowInHell/young-doctor-ticket-watch)';
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function probe(label, url, headers) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    const b = await r.text();
    console.log(`\n=== ${label} === ${r.status} ${r.headers.get('content-type')} len=${b.length}`);
    console.log('server:', r.headers.get('server'), '| set-cookie:', String(r.headers.get('set-cookie')).slice(0, 80));
    console.log('title:', (b.match(/<title>([^<]*)</) || [])[1]);
    console.log('date-item:', (b.match(/class="date-item"/g) || []).length, '| tce links:', (b.match(/tce\.by\/shows/g) || []).length);
    console.log('head:', JSON.stringify(b.slice(0, 300)));
  } catch (e) {
    console.log(`\n=== ${label} === THREW ${e.message} (${e.cause && (e.cause.code || e.cause.message)})`);
  }
}

(async () => {
  await probe('puppet bot-UA', PUPPET, { 'user-agent': BOT });
  await probe('puppet browser-UA', PUPPET, { 'user-agent': BROWSER, 'accept-language': 'ru-RU,ru;q=0.9' });
  await probe('puppet no-UA', PUPPET, {});
  await probe('tce bot-UA', TCE, { 'user-agent': BOT });
  await probe('tce browser-UA', TCE, { 'user-agent': BROWSER });
})();
