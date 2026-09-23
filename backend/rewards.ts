import { createHmac, timingSafeEqual } from 'node:crypto';

const PUBLIC_KEY = 'c6e9d79d42b4ff5990ee1e9dbc1d7039';
const SCALE = 10000;
type Env = { DB: any; OFFERWALL_SECRET?: string };
type Conversion = {
  transactionId: string; userId: string; currencyAmount: number | string;
  status: string; offerName?: string; goalId?: string; createdAt?: string; test?: string | number | boolean;
};
export function validUser(value: string) {
  return /^[A-Za-z0-9_]{3,20}$/.test(value) || /^guest-[a-zA-Z0-9-]{8,60}$/.test(value);
}
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
    SELECT COALESCE(SUM(CASE WHEN status='credited' THEN amount_units ELSE 0 END),0) AS units,
      COALESCE(SUM(CASE WHEN status='credited' THEN completed_survey ELSE 0 END),0) AS completed,
      MAX(updated_at) AS updated
    FROM reward_conversions WHERE user_key=?
  `).bind(user.toLowerCase()).first();
  const sync = await env.DB.prepare('SELECT last_success,last_error FROM reward_sync WHERE id=1').first();
  return {
    userId: user, balance: Number(row?.units || 0) / SCALE, completedSurveys: Number(row?.completed || 0),
    requiredSurveys: 10, eligible: Number(row?.completed || 0) >= 10 && Number(row?.units || 0) > 0,
    payoutsEnabled: false, updatedAt: row?.updated || null, lastSyncedAt: sync?.last_success || null,
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
