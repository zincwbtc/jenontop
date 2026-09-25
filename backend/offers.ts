import { amountUnits, validUser } from './rewards.ts';

const PUBLIC_KEY = 'c6e9d79d42b4ff5990ee1e9dbc1d7039';
export function presentOffer(offer: any, user: string) {
  if (!Number.isSafeInteger(offer.id) || offer.id <= 0) throw new Error('Invalid offer');
  const reward = amountUnits(offer.reward) / 10000;
  if (reward < 0) throw new Error('Invalid reward');
  const categories: string[] = Array.isArray(offer.categories) ? offer.categories.map(String) : [];
  const survey = categories.some(category => /^surveys?$/i.test(category)) || /^survey\b/i.test(offer.name || '');
  // Never use rounded rewardFormatted, USD revenue, or a second exchange rate.
  const rewardKind = offer.rewardIsVariable ? 'variable' : offer.type === 'multistep' ? 'total' : survey ? 'estimate' : 'fixed';
  const details = new URL(`https://offerwall.gg/wall/${PUBLIC_KEY}/offer/${offer.id}`);
  details.searchParams.set('userId', user);
  return {
    id: offer.id, name: String(offer.name || 'Offer'), description: String(offer.description || ''),
    requirements: String(offer.requirements || ''), reward, rewardKind, detailsUrl: details.href
  };
}

export async function handleOffers(request: Request, env: { OFFERWALL_SECRET?: string }) {
  const query = new URL(request.url).searchParams;
  const user = query.get('userId') || '';
  const page = Number(query.get('page') || 1);
  if (!validUser(user) || !Number.isSafeInteger(page) || page < 1 || page > 10000)
    return Response.json({ error: 'Invalid offer request.' }, { status: 400 });
  if (!env.OFFERWALL_SECRET) return Response.json({ error: 'Offers are temporarily unavailable.' }, { status: 503 });
  const url = new URL('https://offerwall.gg/api/v1/offers');
  url.search = new URLSearchParams({ appId: PUBLIC_KEY, userId: user, limit: '12', page: String(page), sort: 'payout' }).toString();
  // Target the visitor, not the datacenter making this server-side request.
  const country = (request as Request & { cf?: { country?: string } }).cf?.country;
  if (!country || !/^[A-Z]{2}$/.test(country) || ['XX', 'T1'].includes(country))
    return Response.json({ error: 'We could not determine offer availability for your location. Please use the provider link.' }, { status: 503 });
  url.searchParams.set('country', country);
  const agent = request.headers.get('User-Agent') || '';
  url.searchParams.set('device', /android/i.test(agent) ? 'android' : /iPhone|iPad|iPod/i.test(agent) ? 'ios' : /mobile/i.test(agent) ? 'mobile' : 'desktop');
  const search = (query.get('search') || '').trim().slice(0, 80);
  if (search) url.searchParams.set('search', search);
  try {
    const response = await fetch(url, {
      headers: { 'X-Api-Key': env.OFFERWALL_SECRET, Accept: 'application/json', 'User-Agent': 'LootlaneRewards/1.0' },
      redirect: 'manual', signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error('Provider unavailable');
    const body = await response.json() as any;
    const data = body.data;
    if (body.success !== true || !Array.isArray(data?.offers) || !/^robux$/i.test(data.currency?.name || '')) throw new Error('Invalid provider currency');
    const rate = Number(data.currency.perUsd);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid provider rate');
    return Response.json({
      offers: data.offers.map((offer: any) => presentOffer(offer, user)),
      currency: { name: 'Robux', perUsd: rate },
      page, hasMore: Number(data.pagination?.pages || 1) > page
    });
  } catch {
    return Response.json({ error: 'Live offer prices are unavailable. Retry or open Offerwall.GG.' }, { status: 503 });
  }
}
