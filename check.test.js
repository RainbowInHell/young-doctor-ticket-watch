'use strict';

// Run with: node --test
// Fixtures below are real responses captured from the live sources on 2026-09-06.

const test = require('node:test');
const assert = require('node:assert');
const { parseShows, tceAvailable, bycardDates } = require('./check.js');

// Verbatim excerpt of https://puppet-minsk.by/spektakli/spektakli-dlya-vzroslykh/item/217-zapiski-yunogo-vracha
const PUPPET_HTML = `
      <div class="performance-dates">
      <div class="container">
        <p class="block-title" id="tickets">Даты показа</p>
        <div class="dates-wrapper">
            <div class="date-item">
              <div class="date-time">
                    <p>29 Сентября, Вторник, 19:00</p>
              </div>
              <div class="performance-buy-ticket">
                <a href="https://tce.by/shows.html?base=RkZDMTE2MUQtMTNFNy00NUIyLTg0QzYtMURDMjRBNTc1ODA0&data=4956" class="btn btn-border ticket-partner" target="_blank">Купить у нас</a>
              </div>
              <div class="buy-partner"><p>купить у партнеров</p></div>
              <a href="https://www.ticketpro.by/bilety-v-teatr/kukolnyj/" class="btn"><img alt="ticketpro.by" src="/images/Ticketpro_Logo-white.png" /></a>
            </div>
            <div class="date-item">
              <div class="date-time">
                    <p>30 Сентября, Среда, 19:00</p>
              </div>
              <div class="performance-buy-ticket">
                <a href="https://tce.by/shows.html?base=RkZDMTE2MUQtMTNFNy00NUIyLTg0QzYtMURDMjRBNTc1ODA0&data=4957" class="btn btn-border ticket-partner" target="_blank">Купить у нас</a>
              </div>
            </div>
        </div>
      </div>
    </div>`;

test('parseShows pulls every performance date and its tce.by show id', () => {
  const shows = parseShows(PUPPET_HTML);
  assert.strictEqual(shows.length, 2);
  assert.deepStrictEqual(
    shows.map((s) => [s.when, s.id]),
    [
      ['29 Сентября, Вторник, 19:00', '4956'],
      ['30 Сентября, Среда, 19:00', '4957'],
    ]
  );
  // base must be scraped, not hardcoded — base64 of FFC1161D-13E7-45B2-84C6-1DC24A575804
  assert.strictEqual(shows[0].base, 'RkZDMTE2MUQtMTNFNy00NUIyLTg0QzYtMURDMjRBNTc1ODA0');
});

test('parseShows tolerates HTML-escaped ampersands', () => {
  const shows = parseShows(PUPPET_HTML.replace(/&data=/g, '&amp;data='));
  assert.deepStrictEqual(shows.map((s) => s.id), ['4956', '4957']);
});

test('parseShows finds a newly posted date (the whole point of scraping)', () => {
  const extra = PUPPET_HTML.replace(
    '</div>\n        </div>',
    `</div>
            <div class="date-item">
              <div class="date-time"><p>12 Октября, Воскресенье, 19:00</p></div>
              <a href="https://tce.by/shows.html?base=RkZDMTE2MUQtMTNFNy00NUIyLTg0QzYtMURDMjRBNTc1ODA0&data=5011">Купить у нас</a>
            </div>
        </div>`
  );
  assert.deepStrictEqual(parseShows(extra).map((s) => s.id), ['4956', '4957', '5011']);
});

test('parseShows ignores a date block with no buy link, and empty pages', () => {
  assert.deepStrictEqual(parseShows('<div class="date-item"><p>1 Мая, 19:00</p></div>'), []);
  assert.deepStrictEqual(parseShows(''), []);
});

test('tceAvailable is false for the real "nothing on sale" response', () => {
  // exact live body for data=4956 and data=4957
  const real = JSON.parse('{"data":"Операция не принесла результата.","attr":false,"success":false}');
  assert.strictEqual(tceAvailable(real), false);
});

test('tceAvailable is true only for a non-empty seat array', () => {
  assert.strictEqual(tceAvailable({ success: true, attr: false, data: [] }), false);
  assert.strictEqual(tceAvailable({ success: true, attr: false, data: [{ x: 6, y: 2, id: 1, pzone_id: 1 }] }), true);
  // success:true with the string payload shape must not be mistaken for availability
  assert.strictEqual(tceAvailable({ success: true, data: 'что-то' }), false);
});

test('bycardDates reflects the live empty calendar, and a populated one', () => {
  assert.deepStrictEqual(bycardDates({ calendar: [], objects: [] }), []);
  // real shape from an event that IS on sale (slug damy-i-gusary)
  assert.deepStrictEqual(bycardDates({ calendar: [{ count: 1, date: '2026-10-15' }] }), ['2026-10-15']);
  assert.deepStrictEqual(bycardDates({}), []);
});

test('bycard isSelling must not be used as the signal', () => {
  // live payload: isSelling === 1 while the calendar is empty
  assert.deepStrictEqual(bycardDates({ calendar: [], performance: { isSelling: 1 } }), []);
});
