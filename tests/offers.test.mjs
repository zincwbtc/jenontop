import test from 'node:test';
import assert from 'node:assert/strict';
import { handleOffers, presentOffer } from '../backend/offers.ts';
import { allowedOrigin, requestOrigin } from '../backend/origins.ts';

const offer = { id: 123, name: 'Sign-up', reward: 143.125, rewardFormatted: '143 Robux', type: 'singlestep', categories: ['signup'] };
test('same-origin browser reads work on Cloudflare while cross-site requests still require an allowed Origin', () => {
  const url = 'https://lootlaneblox.com/api/rewards';
  assert.equal(requestOrigin(new Request(url, {headers:{'Sec-Fetch-Site':'same-origin'}})), 'https://lootlaneblox.com');
  assert.equal(requestOrigin(new Request(url, {headers:{'Sec-Fetch-Site':'cross-site'}})), '');
  assert.equal(requestOrigin(new Request(url)), '');
  assert.equal(requestOrigin(new Request(url, {headers:{Origin:'https://other.test','Sec-Fetch-Site':'same-origin'}})), 'https://other.test');
});
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
  const request = new Request('https://worker.test/api/offers?userId=Player_One&page=2&category=all', {headers: {'User-Agent': 'iPhone'}});
  request.cf = {country: 'CA'};
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input);
    assert.equal(url.searchParams.get('country'), 'CA');
    assert.equal(url.searchParams.get('device'), 'ios');
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(url.searchParams.get('sort'), 'popular');
    assert.equal(url.searchParams.get('type'), 'singlestep');
    assert.equal(url.searchParams.has('category'), false);
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

const survey = { ...offer, name: 'Survey · 5 min', categories: ['survey'], reward: 15 };
function surveyRequest(query = '') {
  const request = new Request('https://worker.test/api/offers?userId=Player_One' + query);
  request.cf = { country: 'CA' };
  return request;
}
function catalogue(offers, pages = 1, rate = 100) {
  return Response.json({ success: true, data: { offers, currency: { name: 'Robux', perUsd: rate }, pagination: { pages } } });
}
test('default surveys exclude large game totals and variable quotes, finding small rewards on later provider pages', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    calls.push(Number(url.searchParams.get('page')));
    assert.equal(url.searchParams.get('category'), 'survey');
    assert.equal(url.searchParams.get('type'), 'singlestep');
    assert.equal(url.searchParams.get('limit'), '200');
    assert.equal(url.searchParams.get('sort'), 'popular');
    return catalogue(calls.length === 1 ? [
      {...survey, id: 1, reward: 210}, {...offer, id: 2, reward: 51000, type: 'multistep'},
      {...survey, id: 3, reward: 10, rewardIsVariable: true},
      {...survey, id: 4, reward: 50, type: 'multistep'},
      {...offer, id: 5, name: 'Survey Game', reward: 15}
    ] : [15, 30, 50, 100].reverse().map((reward, i) => ({...survey, id: i + 10, reward})), 2);
  });
  const data = await (await handleOffers(surveyRequest(), { OFFERWALL_SECRET: 'test' })).json();
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(data.offers.map(item => item.reward), [15, 30, 50, 100]);
  assert.ok(data.offers.every(item => item.rewardKind === 'estimate'));
  assert.equal(data.hasMore, false);
  assert.equal(data.category, 'survey');
});
test('reward filters preserve exact amounts, apply before pagination, and include variable partners only under Any reward', async t => {
  t.mock.method(globalThis, 'fetch', async () => catalogue([
    ...[0, 15, 15.0001, 30, 30.0001, 50, 50.0001, 100, 100.0001].map((reward, id) => ({...survey, id: id + 1, reward})),
    {...survey, id: 50, reward: 1, rewardIsVariable: true}
  ]));
  for (const limit of [15, 30, 50, 100]) {
    const data = await (await handleOffers(surveyRequest('&maxReward=' + limit), {OFFERWALL_SECRET: 'test'})).json();
    assert.ok(data.offers.every(item => item.reward > 0 && item.reward <= limit && item.rewardKind === 'estimate'));
    assert.equal(data.offers.at(-1).reward, limit);
  }
  const any = await (await handleOffers(surveyRequest('&maxReward=any'), {OFFERWALL_SECRET: 'test'})).json();
  assert.equal(any.offers.at(-1).rewardKind, 'variable');
  assert.ok(any.offers.some(item => item.reward === 100.0001));
  t.mock.method(globalThis, 'fetch', async () => catalogue(Array.from({length: 25}, (_, i) => ({...survey, id: i + 1, reward: 25 - i}))));
  const page2 = await (await handleOffers(surveyRequest('&page=2&maxReward=30'), {OFFERWALL_SECRET: 'test'})).json();
  assert.deepEqual(page2.offers.map(item => item.reward), Array.from({length: 12}, (_, i) => 13 + i));
  assert.equal(page2.hasMore, true);
});
test('distinct reward ranges change the first page even with more than twelve low-paying surveys', async t => {
  const values = [...Array.from({length: 14}, (_, i) => i + 1), 15, 15.0001, 30, 30.0001, 50, 50.0001, 100, 100.0001];
  t.mock.method(globalThis, 'fetch', async () => catalogue([
    ...values.map((reward, i) => ({...survey, id: i + 1, reward})),
    {...survey, id: 100, reward: 25, rewardIsVariable: true}
  ]));
  const firstPageIds = new Set();
  for (const [min, max, expected, total] of [
    [0, 15, Array.from({length: 12}, (_, i) => i + 1), 15],
    [15, 30, [15.0001, 30], 2], [30, 50, [30.0001, 50], 2], [50, 100, [50.0001, 100], 2]
  ]) {
    const data = await (await handleOffers(surveyRequest('&minReward=' + min + '&maxReward=' + max), {OFFERWALL_SECRET: 'test'})).json();
    assert.deepEqual(data.offers.map(item => item.reward), expected);
    assert.equal(data.total, total);
    assert.equal(data.hasMore, total > 12);
    for (const item of data.offers) { assert.equal(firstPageIds.has(item.id), false); firstPageIds.add(item.id); }
  }
  const second = await (await handleOffers(surveyRequest('&minReward=0&maxReward=15&page=2'), {OFFERWALL_SECRET: 'test'})).json();
  assert.deepEqual(second.offers.map(item => item.reward), [13, 14, 15]);
  assert.equal(second.total, 15);
  assert.equal(second.hasMore, false);
});
test('invalid filters never contact the provider; empty inventory does not fall back to games', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return catalogue([], 0); });
  for (const query of ['&category=casino', '&maxReward=51000', '&page=0', '&minReward=-1', '&minReward=30&maxReward=15', '&minReward=15&maxReward=any']) {
    assert.equal((await handleOffers(surveyRequest(query), {OFFERWALL_SECRET: 'test'})).status, 400);
  }
  assert.equal(calls, 0);
  const data = await (await handleOffers(surveyRequest(), {OFFERWALL_SECRET: 'test'})).json();
  assert.deepEqual(data.offers, []);
  assert.equal(data.hasMore, false);
});
test('incomplete catalogues and mid-scan currency changes fail instead of hiding small surveys', async t => {
  t.mock.method(globalThis, 'fetch', async () => catalogue([survey], 11));
  assert.equal((await handleOffers(surveyRequest(), {OFFERWALL_SECRET: 'test'})).status, 503);
  t.mock.method(globalThis, 'fetch', async input => catalogue([survey], 2, new URL(input).searchParams.get('page') === '1' ? 100 : 70));
  assert.equal((await handleOffers(surveyRequest(), {OFFERWALL_SECRET: 'test'})).status, 503);
});
test('all views enforce the owner blocklist even when upstream misclassifies multi-step offers as sign-ups', async t => {
  const blocked = ['game', 'mobilegame', 'desktopgame', 'app', 'freetrial', 'shopping', 'deposit', 'creditcard', 'multireward'];
  t.mock.method(globalThis, 'fetch', async input => {
    assert.equal(new URL(input).searchParams.get('type'), 'singlestep');
    return catalogue([
      {...offer, id: 761, name: 'EarnX', type: 'multistep'},
      ...blocked.map((category, i) => ({...survey, id: i + 1, categories: ['survey', category.toUpperCase()]})),
      survey, {...offer, id: 777}
    ]);
  });
  const all = await (await handleOffers(surveyRequest('&category=all'), {OFFERWALL_SECRET: 'test'})).json();
  assert.deepEqual(all.offers.map(item => item.id), [123, 777]);
  const surveys = await (await handleOffers(surveyRequest(), {OFFERWALL_SECRET: 'test'})).json();
  assert.deepEqual(surveys.offers.map(item => item.id), [123]);
});
test('missing geolocation and incorrect currency fail closed instead of displaying wrong prices', async t => {
  const request = new Request('https://worker.test/api/offers?userId=Player_One');
  assert.equal((await handleOffers(request, {OFFERWALL_SECRET: 'test'})).status, 503);
  request.cf = {country: 'CA'};
  t.mock.method(globalThis, 'fetch', async () => Response.json({success: true, data: {offers: [offer], currency: {name: 'Coins', perUsd: 1000}}}));
  assert.equal((await handleOffers(request, {OFFERWALL_SECRET: 'test'})).status, 503);
});
