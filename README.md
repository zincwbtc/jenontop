# Lootlane Rewards

Rewards site and API hosted together on Cloudflare Workers with D1 storage. GitHub Pages remains available as a fallback.

- `index.html`, `support.css`, `dashboard.js`: responsive site and live Offerwall.GG catalog.
- [Domain setup](DOMAIN.md): `lootlaneblox.com` DNS cutover and hosting configuration.
- [Rewards integration](backend/REWARDS.md): provider pricing, confirmed credits and withdrawals.
- [Browser checks](tests/README.md): frontend regression tests.

After committing changes on `main`, run `powershell -NoProfile -File scripts/publish.ps1` to check the site, push origin, and deploy the complete site and API to Cloudflare. Future chat changes are authorized for automatic publishing; see `AGENTS.md`.

For checks alone, run `node --test tests/rewards.test.mjs tests/offers.test.mjs` and `python tests/ui_smoke.py` from the repository root. Wrangler's build hook stages only public frontend files into the ignored `dist/` directory.
