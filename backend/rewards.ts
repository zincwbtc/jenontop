import { createHmac, timingSafeEqual } from 'node:crypto';

const PUBLIC_KEY = 'c6e9d79d42b4ff5990ee1e9dbc1d7039';
const SCALE = 10000;
type Env = { DB: any; OFFERWALL_SECRET?: string; PAYOUT_WEBHOOK_URL?: string; TEST_ACCESS_KEY?: string;
  FEED_EARNINGS_WEBHOOK_URL?: string; FEED_WITHDRAW_WEBHOOK_URL?: string };
const REQUIRED_SURVEYS = 10;
type Conversion = {
  transactionId: string; userId: string; currencyAmount: number | string;
  status: string; offerName?: string; goalId?: string; createdAt?: string; test?: string | number | boolean;
};
export function validUser(value: string) {
  return validUsername(value) || /^guest-[a-zA-Z0-9-]{8,60}$/.test(value);
}
// Only Roblox usernames can withdraw; guest IDs have no account to pay.
export function validUsername(value: string) { return /^[A-Za-z0-9_]{3,20}$/.test(value); }
// Integer units preserve all four provider decimal places.
export function amountUnits(value: unknown): number {
  const text = String(value);
  if (!/^-?[0-9]{1,10}(\.[0-9]{1,4})?$/.test(text)) throw new Error('Invalid reward amount');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const units = Number(whole) * SCALE + Number(fraction.padEnd(4, '0'));
  if (!Number.isSafeInteger(units)) throw new Error('Invalid reward amount');
  return text.startsWith('-') ? -units : units;
}
export function verifySignature(secret: string, user: string, tx: string, amount: string, signature: string) {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(user + ':' + tx + ':' + amount).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
function isTest(value: unknown) { return value === true || value === 1 || value === '1'; }

// Accept only records from the authenticated provider API.
export async function storeConversion(env: Env, item: Conversion) {
  if (isTest(item.test) || !['credited', 'reversed'].includes(item.status)) return;
  if (!validUser(item.userId) || !/^[A-Za-z0-9_.:-]{1,191}$/.test(item.transactionId)) throw new Error('Invalid conversion identity');
  const rawUnits = amountUnits(item.currencyAmount);
  if (rawUnits === 0 || (item.status === 'credited' && rawUnits < 0)) throw new Error('Invalid conversion amount');
  const units = Math.abs(rawUnits);
  const now = new Date().toISOString();
  const seenBefore = await env.DB.prepare('SELECT 1 FROM reward_conversions WHERE transaction_id=?').bind(item.transactionId).first();
  // Multi-step goals are not completed surveys; metadata is authenticated by the API.
  const survey = /^survey\b/i.test(item.offerName || '') && !item.goalId ? 1 : 0;
  const result = await env.DB.prepare(`
    INSERT INTO reward_conversions
      (transaction_id,user_id,user_key,amount_units,status,completed_survey,offer_name,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(transaction_id) DO UPDATE SET
      status=CASE WHEN reward_conversions.status='reversed' THEN 'reversed' ELSE excluded.status END,
      completed_survey=excluded.completed_survey,
      offer_name=excluded.offer_name, updated_at=excluded.updated_at
    WHERE reward_conversions.user_key=excluded.user_key
      AND reward_conversions.amount_units=excluded.amount_units
    RETURNING transaction_id
  `).bind(item.transactionId, item.userId, item.userId.toLowerCase(), units, item.status,
      survey, String(item.offerName || '').slice(0, 200), item.createdAt || now, now).first();
  if (!result) throw new Error('Conversion conflicts with stored reward');
  // New real completion by a Roblox user (not a guest): show it in the public feed. Never blocks the reward.
  if (!seenBefore && item.status === 'credited' && validUsername(item.userId)) {
    try { await postFeed(env, 'earning', item.userId, units, String(item.offerName || 'Survey')); } catch {}
  }
}
export async function providerConversions(env: Env, params: Record<string, string> = {}) {
  if (!env.OFFERWALL_SECRET) throw new Error('Rewards integration is not configured');
  const url = new URL('https://offerwall.gg/api/v1/conversions');
  url.search = new URLSearchParams({ appId: PUBLIC_KEY, limit: '200', ...params }).toString();
  const response = await fetch(url, {
    headers: { 'X-Api-Key': env.OFFERWALL_SECRET, Accept: 'application/json', 'User-Agent': 'LootlaneRewards/1.0' },
    redirect: 'manual', signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error('Provider unavailable (' + response.status + ')');
  const body = await response.json() as any;
  if (body.success !== true || !Array.isArray(body.data?.conversions)) throw new Error('Invalid provider response');
  return { conversions: body.data.conversions as Conversion[], total: Number(body.data.pagination?.total || 0) };
}
// The database lease limits upstream calls across browsers and the scheduled job.
// Each run checks new records and resumes scanning older records for missed reversals.
export async function reconcileRewards(env: Env) {
  const now = Date.now();
  const lease = await env.DB.prepare(
    'UPDATE reward_sync SET lease_until=? WHERE id=1 AND lease_until<? RETURNING scan_page'
  ).bind(now + 60000, now).first();
  if (!lease) return;
  try {
    const newest = await providerConversions(env, { page: '1' });
    for (const item of newest.conversions) await storeConversion(env, item);
    const pages = Math.max(1, Math.ceil(newest.total / 200));
    let page = Math.max(2, lease.scan_page);
    if (page > pages) page = 2;
    for (let batch = 0; page <= pages && batch < 2; batch++, page++) {
      const older = await providerConversions(env, { page: String(page) });
      for (const item of older.conversions) await storeConversion(env, item);
    }
    await env.DB.prepare('UPDATE reward_sync SET last_success=?,scan_page=?,last_error=NULL WHERE id=1')
      .bind(new Date().toISOString(), page > pages ? 2 : page).run();
  } catch (error) {
    await env.DB.prepare('UPDATE reward_sync SET last_error=? WHERE id=1')
      .bind(error instanceof Error ? error.message : 'Reward sync failed').run();
    throw error;
  }
}
export async function rewardSummary(env: Env, user: string) {
  const row = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN c.status='credited' THEN c.amount_units ELSE 0 END),0) AS provider_units,
      COALESCE(SUM(CASE WHEN c.status='credited'
        THEN MAX(0,COALESCE(a.promised_units,0)-c.amount_units) ELSE 0 END),0) AS correction_units,
      COALESCE(SUM(CASE WHEN c.status='credited' THEN c.completed_survey ELSE 0 END),0) AS completed,
      MAX(MAX(c.updated_at,COALESCE(a.created_at,c.updated_at))) AS updated
    FROM reward_conversions c LEFT JOIN reward_corrections a ON a.transaction_id=c.transaction_id
    WHERE c.user_key=?
  `).bind(user.toLowerCase()).first();
  const spent = await env.DB.prepare(`
    SELECT COALESCE(SUM(amount_units),0) AS units, COALESCE(SUM(surveys_used),0) AS surveys,
      COALESCE(SUM(CASE WHEN status='pending' THEN amount_units ELSE 0 END),0) AS pending_units
    FROM reward_withdrawals WHERE user_key=? AND status IN ('pending','paid')
  `).bind(user.toLowerCase()).first();
  const sync = await env.DB.prepare('SELECT last_success,last_error FROM reward_sync WHERE id=1').first();
  const providerUnits = Number(row?.provider_units || 0);
  const correctionUnits = Number(row?.correction_units || 0);
  const totalUnits = providerUnits + correctionUnits;
  const spentUnits = Number(spent?.units || 0), pendingUnits = Number(spent?.pending_units || 0);
  // A reversal after a payout can push the remainder below zero; never show a negative balance.
  const availableUnits = Math.max(0, totalUnits - spentUnits);
  const totalSurveys = Number(row?.completed || 0);
  const progress = Math.max(0, totalSurveys - Number(spent?.surveys || 0));
  const payoutsEnabled = !!env.PAYOUT_WEBHOOK_URL;
  return {
    userId: user, balance: availableUnits / SCALE, earnedBalance: totalUnits / SCALE,
    providerBalance: providerUnits / SCALE, storeCorrection: correctionUnits / SCALE,
    withdrawnBalance: (spentUnits - pendingUnits) / SCALE, pendingWithdrawal: pendingUnits / SCALE,
    completedSurveys: progress, totalCompletedSurveys: totalSurveys, requiredSurveys: REQUIRED_SURVEYS,
    withdrawableBalance: Math.floor(availableUnits / SCALE),
    eligible: payoutsEnabled && validUsername(user) && progress >= REQUIRED_SURVEYS && availableUnits >= SCALE,
    payoutsEnabled, updatedAt: row?.updated || null, lastSyncedAt: sync?.last_success || null,
    syncDelayed: !!sync?.last_error
  };
}
export async function handleRewards(request: Request, env: Env) {
  const user = new URL(request.url).searchParams.get('userId') || '';
  if (!validUser(user)) return Response.json({ error: 'Invalid player ID' }, { status: 400 });
  try { await reconcileRewards(env); } catch { /* Keep confirmed credits visible during a provider outage. */ }
  const summary = await rewardSummary(env, user);
  if (!summary.lastSyncedAt && summary.syncDelayed) return Response.json({ error: 'Rewards are temporarily unavailable. Please try again.' }, { status: 503 });
  return Response.json(summary);
}
export async function handlePostback(request: Request, env: Env) {
  if (!env.OFFERWALL_SECRET) return new Response('NOT CONFIGURED', { status: 503 });
  let fields: URLSearchParams;
  if (request.method === 'GET') fields = new URL(request.url).searchParams;
  else if (request.method === 'POST') {
    if (!(request.headers.get('Content-Type') || '').startsWith('application/x-www-form-urlencoded')) return new Response('UNSUPPORTED FORMAT', { status: 415 });
    const body = await request.text();
    if (body.length > 8192) return new Response('TOO LARGE', { status: 413 });
    fields = new URLSearchParams(body);
  } else return new Response('METHOD NOT ALLOWED', { status: 405 });
  const user = fields.get('userId') || fields.get('user') || '';
  const tx = fields.get('transactionId') || fields.get('tx') || '';
  const amount = fields.get('currencyAmount') || fields.get('amount') || '';
  const signature = fields.get('signature') || fields.get('sig') || '';
  if (!verifySignature(env.OFFERWALL_SECRET, user, tx, amount, signature)) return new Response('FORBIDDEN', { status: 403 });
  if (fields.get('test') === '1') return new Response('OK');
  if (!validUser(user) || !/^[A-Za-z0-9_.:-]{1,191}$/.test(tx)) return new Response('INVALID CONVERSION', { status: 400 });
  let units: number;
  try { units = amountUnits(amount); } catch { return new Response('INVALID AMOUNT', { status: 400 }); }
  if (!units) return new Response('INVALID AMOUNT', { status: 400 });
  try {
    // HMAC covers only three fields. Check unsigned metadata and test status against the API.
    const data = await providerConversions(env, { transactionId: tx });
    const conversion = data.conversions.find(item => item.transactionId === tx);
    if (!conversion || conversion.userId !== user || !['credited','reversed'].includes(conversion.status)) return new Response('RETRY', { status: 503 });
    if (Math.abs(amountUnits(conversion.currencyAmount)) !== Math.abs(units)) return new Response('AMOUNT MISMATCH', { status: 409 });
    if (units < 0 && conversion.status !== 'reversed') return new Response('RETRY', { status: 503 });
    await storeConversion(env, conversion);
    return new Response('OK');
  } catch { return new Response('RETRY', { status: 503 }); }
}

// ---------- Public activity feed (Discord #demo-earnings / #demo-withdrawals webhooks) ----------
// Real users only show as a masked name ("Yessi********er") plus their own Roblox headshot.
export function maskName(name: string) {
  const shown = Math.max(1, Math.min(5, name.length - 4));
  return name.slice(0, shown) + '*'.repeat(Math.max(4, name.length - shown - 2)) + name.slice(-2);
}
async function robloxHeadshot(username: string): Promise<string | undefined> {
  try {
    const lookup = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000),
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
    });
    const id = ((await lookup.json()) as any)?.data?.[0]?.id;
    if (!id) return undefined;
    const thumb = await fetch('https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=' + id + '&size=150x150&format=Png&isCircular=false', { signal: AbortSignal.timeout(4000) });
    return ((await thumb.json()) as any)?.data?.[0]?.imageUrl || undefined;
  } catch { return undefined; }
}
function feedWebhook(value?: string) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['discord.com', 'discordapp.com'].includes(url.hostname) || !url.pathname.startsWith('/api/webhooks/')) return null;
  return url;
}
export async function postFeed(env: Env, kind: 'earning' | 'withdrawal', username: string, units: number, offerName = '') {
  const hook = feedWebhook(kind === 'earning' ? env.FEED_EARNINGS_WEBHOOK_URL : env.FEED_WITHDRAW_WEBHOOK_URL);
  if (!hook) return;
  const amount = Number((units / SCALE).toFixed(2)).toLocaleString('en-US');
  const name = maskName(username).replace(/\*/g, '\\*').replace(/_/g, '\\_'); // keep Discord from reading * and _ as formatting
  const embed: any = kind === 'earning'
    ? { description: '**' + name + '** completed an offer for **' + amount + '** <:robux:1553178247007707146>',
        fields: [{ name: 'Offerwall', value: 'Lootlane Surveys', inline: true }, { name: 'Offer name', value: offerName.slice(0, 80) || 'Survey', inline: true }] }
    : { description: '**' + name + '** withdrew **' + amount + '** <:robux:1553178247007707146>', fields: [{ name: 'Method', value: 'Gamepass' }] };
  embed.color = 0x91edc8;
  embed.footer = { text: 'Lootlane' };
  embed.timestamp = new Date().toISOString();
  const avatar = await robloxHeadshot(username);
  if (avatar) embed.thumbnail = { url: avatar };
  const response = await fetch(hook, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ allowed_mentions: { parse: [] }, embeds: [embed] }),
  });
  await response.body?.cancel();
}

function payoutWebhook(env: Env) {
  const url = new URL(env.PAYOUT_WEBHOOK_URL || '');
  if (url.protocol !== 'https:' || !['discord.com', 'discordapp.com'].includes(url.hostname) || !url.pathname.startsWith('/api/webhooks/')) throw new Error('Invalid payout webhook');
  return url;
}
type Withdrawal = { id: string; user_id: string; amount_units: number; surveys_used: number; created_at: string };
// Posts to #payout-log. A failed post leaves notified=0 so the cron job retries it.
export async function notifyWithdrawal(env: Env, w: Withdrawal) {
  const amount = (w.amount_units / SCALE).toLocaleString('en-US');
  const response = await fetch(payoutWebhook(env), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      username: 'Lootlane Payouts', allowed_mentions: { parse: [] },
      embeds: [{
        title: 'New withdrawal request', color: 0x91edc8,
        description: 'Pay **' + amount + ' Robux** to Roblox user **' + w.user_id + '**.\nUsernames are not verified, so confirm the account before paying.',
        fields: [
          { name: 'Roblox username', value: '[' + w.user_id + '](https://www.roblox.com/search/users?keyword=' + encodeURIComponent(w.user_id) + ')', inline: true },
          { name: 'Amount', value: amount + ' Robux', inline: true },
          { name: 'Surveys used', value: String(w.surveys_used), inline: true },
          { name: 'Request ID', value: '`' + w.id + '`' }
        ],
        footer: { text: 'Lootlane withdrawals' }, timestamp: w.created_at
      }]
    })
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error('Payout log unavailable (' + response.status + ')');
  await env.DB.prepare('UPDATE reward_withdrawals SET notified=1 WHERE id=?').bind(w.id).run();
}
export async function notifyPendingWithdrawals(env: Env) {
  if (!env.PAYOUT_WEBHOOK_URL) return;
  for (let i = 0; i < 10; i++) {
    const w = await env.DB.prepare('SELECT id,user_id,amount_units,surveys_used,created_at FROM reward_withdrawals WHERE notified=0 ORDER BY created_at LIMIT 1').first();
    if (!w) return;
    await notifyWithdrawal(env, w);
  }
}
function isAdmin(request: Request, env: Env) {
  const key = env.TEST_ACCESS_KEY || '';
  const given = Buffer.from(request.headers.get('Authorization') || '');
  const expected = Buffer.from('Bearer ' + key);
  return key.length >= 32 && given.length === expected.length && timingSafeEqual(given, expected);
}
export async function handleWithdraw(request: Request, env: Env) {
  let body: any;
  try { body = JSON.parse(await request.text()); } catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }); }
  // Staff close a request once the Robux is sent (paid) or refused (rejected gives the balance back).
  if (body?.action === 'resolve') {
    if (!isAdmin(request, env)) return Response.json({ error: 'Not authorized.' }, { status: 403 });
    if (!['paid', 'rejected'].includes(body.status) || typeof body.id !== 'string') return Response.json({ error: 'Give an id and a status of paid or rejected.' }, { status: 400 });
    const done = await env.DB.prepare("UPDATE reward_withdrawals SET status=?,updated_at=? WHERE id=? AND status='pending' RETURNING id,user_id,status")
      .bind(body.status, new Date().toISOString(), body.id).first();
    return done ? Response.json({ ok: true, withdrawal: done }) : Response.json({ error: 'No pending withdrawal with that id.' }, { status: 404 });
  }
  const user = String(body?.userId || '');
  if (!validUsername(user)) return Response.json({ error: 'Log in with your Roblox username to withdraw.' }, { status: 400 });
  if (!env.PAYOUT_WEBHOOK_URL) return Response.json({ error: 'Withdrawals are temporarily unavailable.' }, { status: 503 });
  try { await reconcileRewards(env); } catch { /* Withdraw against confirmed credits only. */ }
  const now = new Date().toISOString(), key = user.toLowerCase();
  // One statement checks eligibility and records the request, so concurrent clicks cannot withdraw twice.
  const created = await env.DB.prepare(`
    WITH earned AS (
      SELECT COALESCE(SUM(c.amount_units + MAX(0,COALESCE(a.promised_units,0)-c.amount_units)),0) AS units,
        COALESCE(SUM(c.completed_survey),0) AS surveys
      FROM reward_conversions c LEFT JOIN reward_corrections a ON a.transaction_id=c.transaction_id
      WHERE c.user_key=? AND c.status='credited'
    ), spent AS (
      SELECT COALESCE(SUM(amount_units),0) AS units, COALESCE(SUM(surveys_used),0) AS surveys
      FROM reward_withdrawals WHERE user_key=? AND status IN ('pending','paid')
    )
    INSERT INTO reward_withdrawals(id,user_id,user_key,amount_units,surveys_used,status,notified,created_at,updated_at)
    SELECT ?,?,?,((earned.units-spent.units)/${SCALE})*${SCALE},earned.surveys-spent.surveys,'pending',0,?,?
    FROM earned, spent
    WHERE earned.surveys-spent.surveys>=${REQUIRED_SURVEYS} AND earned.units-spent.units>=${SCALE}
    RETURNING id,user_id,amount_units,surveys_used,created_at
  `).bind(key, key, crypto.randomUUID(), user, key, now, now).first();
  if (!created) {
    const summary = await rewardSummary(env, user);
    const error = summary.completedSurveys < REQUIRED_SURVEYS
      ? 'Complete ' + (REQUIRED_SURVEYS - summary.completedSurveys) + ' more surveys to withdraw.'
      : 'You need at least 1 Robux available to withdraw.';
    return Response.json({ error, summary }, { status: 409 });
  }
  let notified = true;
  try { await notifyWithdrawal(env, created); } catch { notified = false; }
  try { await postFeed(env, 'withdrawal', created.user_id, created.amount_units); } catch {}
  return Response.json({
    ok: true, notified,
    withdrawal: { id: created.id, amount: created.amount_units / SCALE, surveysUsed: created.surveys_used, status: 'pending', createdAt: created.created_at },
    summary: await rewardSummary(env, user)
  });
}
