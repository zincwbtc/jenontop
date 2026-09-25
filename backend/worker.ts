import { GET, POST } from './shop';
import { handlePostback, handleRewards, handleWithdraw, notifyPendingWithdrawals, reconcileRewards } from './rewards';
import { allowedOrigin, requestOrigin } from './origins';
import { handleOffers } from './offers';

export default {
  async fetch(request: Request, env: any) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    // Provider callbacks have no browser Origin. Authenticate with HMAC instead.
    if (url.pathname === '/api/offerwall/postback') {
      const response = await handlePostback(request, env);
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    const origin = requestOrigin(request);
    const allowed = allowedOrigin(origin, env.ALLOWED_ORIGIN);
    const headers = {
      'Access-Control-Allow-Origin': allowed ? origin : 'https://invalid.invalid',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Vary': 'Origin', 'Cache-Control': 'no-store'
    };
    if (!allowed) return Response.json({ error: 'Origin not allowed' }, { status: 403, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    try {
      let response: Response;
      if (url.pathname === '/api/offers' && request.method === 'GET') response = await handleOffers(request, env);
      else if (url.pathname === '/api/rewards' && request.method === 'GET') response = await handleRewards(request, env);
      else if (url.pathname === '/api/withdraw' && request.method === 'POST') response = await handleWithdraw(request, env);
      else if (url.pathname === '/api/shop') {
        response = request.method === 'GET' ? await GET(request) : request.method === 'POST' ? await POST(request) : new Response('Method not allowed', { status: 405 });
      } else response = new Response('Not found', { status: 404 });
      const result = new Response(response.body, response);
      Object.entries(headers).forEach(([key, value]) => result.headers.set(key, value));
      return result;
    } catch { return Response.json({ error: 'Rewards temporarily unavailable. Please retry.' }, { status: 503, headers }); }
  },
  async scheduled(_controller: any, env: any, ctx: any) {
    ctx.waitUntil(Promise.allSettled([reconcileRewards(env), notifyPendingWithdrawals(env)]));
  }
};
