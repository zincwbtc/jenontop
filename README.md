# Lootlane Rewards

Rewards site hosted on GitHub Pages at `lootlaneblox.com`, with Cloudflare DNS and a Cloudflare Worker/D1 backend.

- `index.html`, `support.css`, `dashboard.js`: responsive site and live Offerwall.GG catalog.
- [Domain setup](DOMAIN.md): `lootlaneblox.com` DNS cutover and hosting configuration.
- [Rewards integration](backend/REWARDS.md): provider pricing, confirmed credits and withdrawals.
- [Browser checks](tests/README.md): frontend regression tests.

After committing changes on `main`, run `powershell -NoProfile -File scripts/publish.ps1` to check the site, push origin, and deploy the complete site and API to Cloudflare. Future chat changes are authorized for automatic publishing; see `AGENTS.md`.

For checks alone, run `node --test tests/rewards.test.mjs tests/offers.test.mjs` and `python tests/ui_smoke.py` from the repository root. Wrangler's build hook stages only public frontend files into the ignored `dist/` directory.

Social link previews use static Open Graph and large-image card metadata in `index.html`, with the public 1200 × 630 PNG at `assets/lootlane-social-v1.png`. No JavaScript or login is needed to read the preview. To update the artwork, edit `scripts/social-preview.html` and run `python scripts/build-social-preview.py` (Playwright and Chrome required). When replacing a published image, use a new filename and update both image URLs in the metadata to avoid stale social caches. Social apps control whether a preview is displayed in a particular chat, post, or story; this does not embed an interactive website inside a message.
