import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { amountUnits, handlePostback, handleRewards, handleWithdraw, notifyPendingWithdrawals, reconcileRewards, rewardSummary, storeConversion } from '../backend/rewards.ts';

const secret = 'local-unit-test-secret-not-a-provider-key';
const webhook = 'https://discord.com/api/webhooks/1/test-token';
const adminKey = 'a'.repeat(40);
function environment() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../backend/migrations/0005_offerwall_rewards.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../backend/migrations/0006_reward_corrections.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../backend/migrations/0007_reward_withdrawals.sql', import.meta.url), 'utf8'));
  const DB = {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return db.prepare(sql).get(...values) || null; },
        async run() { return {meta: db.prepare(sql).run(...values)}; }
      };
    }
  };
  return { DB, OFFERWALL_SECRET: secret, sqlite: db };
}
const row = (extra = {}) => ({
  transactionId:'tx-53',userId:'Player_One',currencyAmount:53,status:'credited',
  offerName:'Survey #53',goalId:'',createdAt:'2026-09-23 07:00:00', ...extra
});
function callback(item, extra = {}, method = 'GET') {
  const amount = String(item.currencyAmount);
  const signature = createHmac('sha256',secret).update(item.userId+':'+item.transactionId+':'+amount).digest('hex');
  const fields = new URLSearchParams({
    userId:item.userId,transactionId:item.transactionId,currencyAmount:amount,signature,...extra
  });
  return method === 'POST'
    ? new Request('https://worker.test/api/offerwall/postback',{method,headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fields})
    : new Request('https://worker.test/api/offerwall/postback?'+fields);
}
function provider(t, rows) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.headers['X-Api-Key'],secret);
    assert.equal(options.redirect,'manual');
    assert.equal(new URL(url).origin,'https://offerwall.gg');
    requests.push(new URL(url));
    return Response.json({success:true,data:{conversions:rows,pagination:{total:rows.length}}});
  });
  return requests;
}
test('53 Robux completion survives duplicate GET/POST callbacks, concurrent retries, reload and case changes', async t => {
  const env=environment(); provider(t,[row()]);
  const responses=await Promise.all(Array.from({length:12},(_,i)=>handlePostback(callback(row(),{},i%2?'POST':'GET'),env)));
  assert.ok(responses.every(r=>r.status===200));
  const summary=await rewardSummary(env,'player_one');
  assert.equal(summary.balance,53); assert.equal(summary.completedSurveys,1);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM reward_conversions').get().n,1);
});
test('invalid or changed signature cannot credit and tests never affect balance',async t=>{
  const env=environment(); const calls=provider(t,[row()]);
  assert.equal((await handlePostback(callback(row(),{signature:'0'.repeat(64)}),env)).status,403);
  assert.equal((await handlePostback(callback(row(),{currencyAmount:'5300'}),env)).status,403);
  assert.equal((await handlePostback(callback(row(),{test:'1'}),env)).status,200);
  assert.equal(calls.length,0); assert.equal((await rewardSummary(env,'Player_One')).balance,0);
});
test('reversal removes the reward and completion once, and stale credits cannot restore it',async t=>{
  const env=environment(); provider(t,[row({status:'reversed',currencyAmount:-53})]);
  await storeConversion(env,row());
  await handlePostback(callback(row({currencyAmount:-53})),env);
  await handlePostback(callback(row({currencyAmount:-53})),env);
  await storeConversion(env,row());
  assert.equal((await rewardSummary(env,'Player_One')).balance,0);
  assert.equal((await rewardSummary(env,'Player_One')).completedSurveys,0);
  const other=environment();
  await storeConversion(other,row({status:'reversed',currencyAmount:-53}));
  await storeConversion(other,row());
  assert.equal((await rewardSummary(other,'Player_One')).balance,0);
});
test('unsigned status and goal fields do not change authenticated reward metadata',async t=>{
  const env=environment(); provider(t,[row()]);
  const result=await handlePostback(callback(row(),{status:'reversed',goalId:'fake',offerName:'Game'}),env);
  assert.equal(result.status,200);
  assert.equal((await rewardSummary(env,'Player_One')).completedSurveys,1);
});
test('fractional credits retain four decimals; pending, tests, and incomplete goals do not count as surveys',async()=>{
  const env=environment();
  await storeConversion(env,row({currencyAmount:3.5}));
  await storeConversion(env,row({transactionId:'fraction',currencyAmount:0.0001,goalId:'level1'}));
  await storeConversion(env,row({transactionId:'pending',status:'pending'}));
  await storeConversion(env,row({transactionId:'test',test:1}));
  await storeConversion(env,row({transactionId:'game',currencyAmount:2,offerName:'Game quest'}));
  assert.equal((await rewardSummary(env,'Player_One')).balance,5.5001);
  assert.equal((await rewardSummary(env,'Player_One')).completedSurveys,1);
  assert.equal(amountUnits('23.1000'),231000);
  for(const invalid of ['NaN','Infinity','1e3','1.00001']) assert.throws(()=>amountUnits(invalid));
});
test('confirmed transactions cannot be reassigned or have their amounts changed',async()=>{
  const env=environment(); await storeConversion(env,row());
  await assert.rejects(()=>storeConversion(env,row({userId:'Other_Player'})));
  await assert.rejects(()=>storeConversion(env,row({currencyAmount:999})));
  assert.equal((await rewardSummary(env,'Other_Player')).balance,0);
});
test('API reconciliation recovers historical rewards and shared lease bounds polling',async t=>{
  const env=environment(); const requests=provider(t,[row({userId:'Aravolust',currencyAmount:3.5})]);
  await Promise.all([reconcileRewards(env),reconcileRewards(env),reconcileRewards(env)]);
  assert.equal(requests.length,1);
  const response=await handleRewards(new Request('https://worker.test/api/rewards?userId=aravolust'),env);
  const result=await response.json();
  assert.equal(result.balance,3.5); assert.equal(result.completedSurveys,1);
  assert.ok(result.lastSyncedAt); assert.equal(requests.length,1);
});
test('provider outages retry callbacks and keep confirmed balances',async t=>{
  const env=environment(); await storeConversion(env,row());
  t.mock.method(globalThis,'fetch',async()=>new Response('Unavailable',{status:503}));
  assert.equal((await handlePostback(callback(row()),env)).status,503);
  await assert.rejects(()=>reconcileRewards(env));
  assert.equal((await rewardSummary(env,'Player_One')).balance,53);
});
test('the ten survey threshold uses confirmed survey completions',async()=>{
  const env={...environment(),PAYOUT_WEBHOOK_URL:webhook};
  for(let i=0;i<9;i++) await storeConversion(env,row({transactionId:'survey-'+i}));
  assert.equal((await rewardSummary(env,'Player_One')).eligible,false);
  await storeConversion(env,row({transactionId:'survey-9'}));
  const result=await rewardSummary(env,'Player_One');
  assert.equal(result.completedSurveys,10); assert.equal(result.balance,530);
  assert.equal(result.eligible,true); assert.equal(result.payoutsEnabled,true);
});
test('an authorized 53 Robux correction adds only the 49.5 shortfall and survives provider resync',async()=>{
  const env=environment();
  const conversion=row({currencyAmount:3.5});
  await storeConversion(env,conversion);
  const insert=env.sqlite.prepare("INSERT INTO reward_corrections(transaction_id,promised_units,reason) VALUES(?,?,?) ON CONFLICT(transaction_id) DO NOTHING");
  insert.run(conversion.transactionId,530000,'Owner-authorized reward correction');
  insert.run(conversion.transactionId,530000,'Duplicate correction attempt');
  for(let i=0;i<3;i++) await storeConversion(env,conversion);
  const result=await rewardSummary(env,'Player_One');
  assert.equal(result.balance,53);
  assert.equal(result.providerBalance,3.5);
  assert.equal(result.storeCorrection,49.5);
  assert.equal(result.completedSurveys,1);
  assert.equal((await rewardSummary(env,'Other_Player')).balance,0);
  assert.equal(env.sqlite.prepare('SELECT amount_units FROM reward_conversions').get().amount_units,35000);
});
test('a correction never reduces a higher provider reward and reverses with its source survey',async()=>{
  const env=environment();
  await storeConversion(env,row({currencyAmount:60}));
  env.sqlite.prepare("INSERT INTO reward_corrections(transaction_id,promised_units,reason) VALUES(?,?,?)")
    .run('tx-53',530000,'Honor quoted reward');
  assert.equal((await rewardSummary(env,'Player_One')).balance,60);
  assert.equal((await rewardSummary(env,'Player_One')).storeCorrection,0);
  await storeConversion(env,row({currencyAmount:-60,status:'reversed'}));
  const result=await rewardSummary(env,'Player_One');
  assert.equal(result.balance,0); assert.equal(result.storeCorrection,0); assert.equal(result.completedSurveys,0);
});

// Withdrawals: the provider has no new rows; the Discord webhook is captured instead of sent.
function payoutEnv(t, {failPosts = 0} = {}) {
  const env = {...environment(), PAYOUT_WEBHOOK_URL: webhook, TEST_ACCESS_KEY: adminKey};
  const posts = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (new URL(url).origin === 'https://offerwall.gg') return Response.json({success:true,data:{conversions:[],pagination:{total:0}}});
    assert.equal(String(url), webhook);
    if (failPosts-- > 0) return new Response('down', {status: 500});
    posts.push(JSON.parse(options.body));
    return new Response(null, {status: 204});
  });
  return {env, posts};
}
const withdraw = (env, body, headers = {}) => handleWithdraw(new Request('https://worker.test/api/withdraw', {
  method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)
}), env);
async function surveys(env, count, amount = 53, prefix = 's') {
  for (let i = 0; i < count; i++) await storeConversion(env, row({transactionId: prefix + '-' + i, currencyAmount: amount}));
}
test('ten completed surveys unlock a withdrawal that posts once to the payout log and resets progress', async t => {
  const {env, posts} = payoutEnv(t);
  await surveys(env, 9);
  let response = await withdraw(env, {userId: 'Player_One'});
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /1 more survey/);
  assert.equal(posts.length, 0);
  await surveys(env, 1, 53, 'last');
  assert.equal((await rewardSummary(env, 'Player_One')).eligible, true);
  response = await withdraw(env, {userId: 'player_one'});
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.withdrawal.amount, 530); assert.equal(result.withdrawal.surveysUsed, 10); assert.equal(result.notified, true);
  assert.equal(result.summary.balance, 0); assert.equal(result.summary.completedSurveys, 0);
  assert.equal(result.summary.pendingWithdrawal, 530); assert.equal(result.summary.eligible, false);
  assert.equal(posts.length, 1);
  assert.match(posts[0].embeds[0].description, /530 Robux\*\* to Roblox user \*\*player_one/);
  assert.deepEqual(posts[0].allowed_mentions, {parse: []});
  // Nothing left to withdraw until ten more surveys.
  assert.equal((await withdraw(env, {userId: 'Player_One'})).status, 409);
  await surveys(env, 10, 53, 'next');
  assert.equal((await withdraw(env, {userId: 'Player_One'})).status, 200);
  assert.equal(posts.length, 2);
});
test('concurrent withdraw clicks create exactly one request', async t => {
  const {env, posts} = payoutEnv(t);
  await surveys(env, 10);
  const responses = await Promise.all(Array.from({length: 8}, () => withdraw(env, {userId: 'Player_One'})));
  assert.equal(responses.filter(r => r.status === 200).length, 1);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM reward_withdrawals').get().n, 1);
  assert.equal(posts.length, 1);
});
test('guests and disabled payouts cannot withdraw', async t => {
  const {env} = payoutEnv(t);
  await storeConversion(env, row({userId: 'guest-abcdef123456'}));
  assert.equal((await withdraw(env, {userId: 'guest-abcdef123456'})).status, 400);
  assert.equal((await withdraw({...env, PAYOUT_WEBHOOK_URL: ''}, {userId: 'Player_One'})).status, 503);
  assert.equal((await rewardSummary({...env, PAYOUT_WEBHOOK_URL: ''}, 'Player_One')).payoutsEnabled, false);
});
test('only whole Robux are withdrawn; the fraction stays in the balance', async t => {
  const {env} = payoutEnv(t);
  await surveys(env, 10, 5.25);
  const result = await (await withdraw(env, {userId: 'Player_One'})).json();
  assert.equal(result.withdrawal.amount, 52); assert.equal(result.summary.balance, 0.5);
});
test('a failed payout-log post keeps the request and the scheduled job retries it', async t => {
  const {env, posts} = payoutEnv(t, {failPosts: 1});
  await surveys(env, 10);
  const result = await (await withdraw(env, {userId: 'Player_One'})).json();
  assert.equal(result.notified, false); assert.equal(result.summary.balance, 0);
  await notifyPendingWithdrawals(env);
  await notifyPendingWithdrawals(env);
  assert.equal(posts.length, 1);
  assert.equal(env.sqlite.prepare('SELECT notified FROM reward_withdrawals').get().notified, 1);
});
test('staff can mark paid or rejected; rejection returns balance and surveys', async t => {
  const {env} = payoutEnv(t);
  await surveys(env, 10);
  const first = (await (await withdraw(env, {userId: 'Player_One'})).json()).withdrawal;
  assert.equal((await withdraw(env, {action: 'resolve', id: first.id, status: 'rejected'})).status, 403);
  assert.equal((await withdraw(env, {action: 'resolve', id: first.id, status: 'rejected'}, {Authorization: 'Bearer wrong'})).status, 403);
  const auth = {Authorization: 'Bearer ' + adminKey};
  assert.equal((await withdraw(env, {action: 'resolve', id: first.id, status: 'rejected'}, auth)).status, 200);
  let summary = await rewardSummary(env, 'Player_One');
  assert.equal(summary.balance, 530); assert.equal(summary.completedSurveys, 10);
  assert.equal((await withdraw(env, {action: 'resolve', id: first.id, status: 'paid'}, auth)).status, 404);
  const second = (await (await withdraw(env, {userId: 'Player_One'})).json()).withdrawal;
  assert.equal((await withdraw(env, {action: 'resolve', id: second.id, status: 'paid'}, auth)).status, 200);
  summary = await rewardSummary(env, 'Player_One');
  assert.equal(summary.balance, 0); assert.equal(summary.withdrawnBalance, 530); assert.equal(summary.pendingWithdrawal, 0);
});
