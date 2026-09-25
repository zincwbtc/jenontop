import { amountUnits, validUser } from './rewards.ts';

const PUBLIC_KEY = 'c6e9d79d42b4ff5990ee1e9dbc1d7039';
const PAGE_SIZE = 12;
// Owner's blocked categories (2026-09-24). Keep a local guard as well as the
// placement filters: the provider can tag a multi-step offer only as "signup".
const BLOCKED_CATEGORIES = new Set(['game', 'mobilegame', 'desktopgame', 'app', 'freetrial', 'shopping', 'deposit', 'creditcard', 'multireward']);
function allowedOffer(offer: any) {
  return offer.type === 'singlestep' && Array.isArray(offer.categories) &&
    !offer.categories.some((category: unknown) => BLOCKED_CATEGORIES.has(String(category).toLowerCase()));
}
function isSurvey(offer: any) {
  const categories = Array.isArray(offer.categories) ? offer.categories.map(String) : [];
  return categories.length ? categories.some((category: string) => /^surveys?$/i.test(category)) : /^survey\b/i.test(offer.name || '');
}
export function presentOffer(offer: any, user: string) {
  if (!Number.isSafeInteger(offer.id) || offer.id <= 0) throw new Error('Invalid offer');
  const reward = amountUnits(offer.reward) / 10000;
  if (reward < 0) throw new Error('Invalid reward');
  const survey = isSurvey(offer);
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
  const category = query.get('category') || 'survey';
  const maxReward = query.get('maxReward') || '100';
  if (!validUser(user) || !Number.isSafeInteger(page) || page < 1 || page > 10000 ||
      !['survey', 'all'].includes(category) || !['15', '30', '50', '100', 'any'].includes(maxReward))
    return Response.json({ error: 'Invalid offer request.' }, { status: 400 });
  if (!env.OFFERWALL_SECRET) return Response.json({ error: 'Offers are temporarily unavailable.' }, { status: 503 });
  const url = new URL('https://offerwall.gg/api/v1/offers');
  const surveys = category === 'survey';
  url.search = new URLSearchParams({ appId: PUBLIC_KEY, userId: user,
    limit: surveys ? '200' : String(PAGE_SIZE), page: surveys ? '1' : String(page), sort: 'popular' }).toString();
  url.searchParams.set('type', 'singlestep');
  if (surveys) url.searchParams.set('category', 'survey');
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
    const signal = AbortSignal.timeout(12000);
    async function readPage(providerPage: number) {
      url.searchParams.set('page', String(providerPage));
      const response = await fetch(url, {
        headers: { 'X-Api-Key': env.OFFERWALL_SECRET!, Accept: 'application/json', 'User-Agent': 'LootlaneRewards/1.0' },
        redirect: 'manual', signal
      });
      if (!response.ok) throw new Error('Provider unavailable');
      const body = await response.json() as any;
      const data = body.data;
      if (body.success !== true || !Array.isArray(data?.offers) || !/^robux$/i.test(data.currency?.name || '')) throw new Error('Invalid provider currency');
      const rate = Number(data.currency.perUsd);
      const pages = Number(data.pagination?.pages ?? 1);
      if (!Number.isFinite(rate) || rate <= 0 || !Number.isSafeInteger(pages) || pages < 0) throw new Error('Invalid provider response');
      return { offers: data.offers as any[], rate, pages };
    }
    const data = await readPage(surveys ? 1 : page);
    let offers = data.offers;
    if (surveys) {
      // Filter the full targeted survey catalogue BEFORE local pagination. Otherwise
      // low rewards on later provider pages disappear behind high-paying offers.
      if (data.pages > 10) throw new Error('Survey catalogue too large');
      for (let next = 2; next <= data.pages; next++) {
        const extra = await readPage(next);
        if (extra.rate !== data.rate || extra.pages !== data.pages) throw new Error('Catalogue changed; retry');
        offers.push(...extra.offers);
      }
      offers = offers.filter(offer => isSurvey(offer) && offer.type === 'singlestep');
    }
    let presented = [...new Map(offers.filter(allowedOffer).map(offer => [offer.id, presentOffer(offer, user)])).values()];
    let hasMore = data.pages > page;
    if (surveys) {
      presented = presented.filter(offer => maxReward === 'any' ||
        (offer.rewardKind !== 'variable' && offer.reward > 0 && offer.reward <= Number(maxReward)));
      presented.sort((a, b) => Number(a.rewardKind === 'variable') - Number(b.rewardKind === 'variable') || a.reward - b.reward || a.id - b.id);
      hasMore = presented.length > page * PAGE_SIZE;
      presented = presented.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    }
    return Response.json({
      offers: presented, currency: { name: 'Robux', perUsd: data.rate },
      category, maxReward: surveys ? maxReward : 'any', page, hasMore
    });
  } catch {
    return Response.json({ error: 'Live offer prices are unavailable. Retry or open Offerwall.GG.' }, { status: 503 });
  }
}
