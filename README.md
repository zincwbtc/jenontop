# Lootlane Rewards

Static rewards site on GitHub Pages with a Cloudflare Worker and D1 backend.

- `index.html`, `support.css`, `dashboard.js`: responsive site and live Offerwall.GG catalog.
- [Domain setup](DOMAIN.md): `lootlaneblox.com` DNS cutover and hosting configuration.
- [Rewards integration](backend/REWARDS.md): provider pricing, confirmed credits and withdrawals.
- [Browser checks](tests/README.md): frontend regression tests.

Run `node --test tests/rewards.test.mjs tests/offers.test.mjs` and `python tests/ui_smoke.py` from the repository root. Deploy the API from `backend` using `npx --no-install wrangler deploy`; pushing `main` publishes the frontend.
