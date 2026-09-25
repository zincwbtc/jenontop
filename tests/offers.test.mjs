import test from 'node:test';
import assert from 'node:assert/strict';
import { handleOffers, presentOffer } from '../backend/offers.ts';
import { allowedOrigin } from '../backend/origins.ts';

const offer = { id: 123, name: 'Game', reward: 143.125, rewardFormatted: '143 Robux', type: 'singlestep', categories: ['game'] };
test('display uses the full provider amount without rounding or applying the exchange rate again', () => {
  const shown = presentOffer(offer, 'Player_One');
  assert.equal(shown.reward, 143.125);
  assert.equal(shown.rewardKind, 'fixed');
  assert.equal(new URL(shown.detailsUrl).searchParams.get('userId'), 'Player_One');
});
test('variable payouts, survey estimates and multi-step totals cannot look like guaranteed single rewards', () => {
  assert.equal(presentOffer({...offer, rewardIsVariable: true}, 'Player_One').rewardKind, 'variable');
  assert.equal(presentOffer({...offer, categories: ['survey']}, 'Player_One').rewardKind, 'estimate');
  assert.equal(presentOffer({...offer, type: 'multistep'}, 'Player_One').rewardKind, 'total');
  assert.throws(() => presentOffer({...offer, reward: -1}, 'Player_One'));
});
test('custom domain origins are exact matches and old site remains supported during migration', () => {
  const origins = 'https://lootlaneblox.com,https://www.lootlaneblox.com,https://zincwbtc.github.io';
  for (const origin of origins.split(',')) assert.equal(allowedOrigin(origin, origins), true);
  for (const origin of [null, 'null', 'http://lootlaneblox.com', 'https://lootlaneblox.com.evil.test']) assert.equal(allowedOrigin(origin, origins), false);
});
test('offers target the visitor, preserve the provider rate, and expose no secret or revenue fields', async t => {
  const request = new Request('https://worker.test/api/offers?userId=Player_One&page=2', {headers: {'User-Agent': 'iPhone'}});
  request.cf = {country: 'CA'};
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input);
    assert.equal(url.searchParams.get('country'), 'CA');
    assert.equal(url.searchParams.get('device'), 'ios');
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(options.headers['X-Api-Key'], 'test-secret');
    assert.equal(url.href.includes('test-secret'), false);
    return Response.json({success: true, data: {offers: [{...offer, payoutUsd: 2}], currency: {name: 'Robux', perUsd: 70}, pagination: {pages: 3}}});
  });
  const response = await handleOffers(request, {OFFERWALL_SECRET: 'test-secret'});
  const data = await response.json();
  assert.equal(data.currency.perUsd, 70);
  assert.equal(data.offers[0].reward, 143.125);
  assert.equal(data.offers[0].payoutUsd, undefined);
  assert.equal(data.hasMore, true);
  assert.equal(JSON.stringify(data).includes('test-secret'), false);
});
test('missing geolocation and incorrect currency fail closed instead of displaying wrong prices', async t => {
  const request = new Request('https://worker.test/api/offers?userId=Player_One');
  assert.equal((await handleOffers(request, {OFFERWALL_SECRET: 'test'})).status, 503);
  request.cf = {country: 'CA'};
  t.mock.method(globalThis, 'fetch', async () => Response.json({success: true, data: {offers: [offer], currency: {name: 'Coins', perUsd: 1000}}}));
  assert.equal((await handleOffers(request, {OFFERWALL_SECRET: 'test'})).status, 503);
});
