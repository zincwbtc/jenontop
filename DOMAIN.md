# lootlaneblox.com on Cloudflare

The full site and API deploy together to the existing Cloudflare Worker `lootlane-test-backend` in account `44014acb04e2be1ced2a310b54003139`. Its preview address is https://lootlane-test-backend.brycen0407.workers.dev/. The original GitHub Pages site remains available as a fallback.

The frontend uses same-origin `/api/` endpoints when opened on the Worker or either custom domain. Existing Offerwall callbacks, D1 balances, provider secrets, and withdrawal records keep using the same Worker.

## Current domain blocker

GoDaddy still serves the domain's DNS with `ns71.domaincontrol.com` and `ns72.domaincontrol.com`. The provided DNS screenshot shows an apex parking record, `www` pointing to the apex, `_domainconnect`, and `_dmarc` records.

Cloudflare's saved Wrangler login can deploy Workers but cannot create the zone. The API returned HTTP 403: `Requires permission "com.cloudflare.api.account.zone.create" to create zones for the selected account`. No assigned Cloudflare nameservers are available until the zone is created.

## One-time activation

1. In the owner's Cloudflare account, add `lootlaneblox.com` on the Free plan. Review imported records and preserve `_dmarc` and any email/verification records. Do not copy GoDaddy's apex NS/SOA records as ordinary Cloudflare records.
2. At GoDaddy, change **Nameservers** to the exact two nameservers assigned by Cloudflare. Keep the domain registered with GoDaddy.
3. Once the zone is active, remove the imported apex parking record and the old `www` CNAME, then attach both custom domains to `lootlane-test-backend`. Cloudflare's Worker custom-domain setup creates DNS records and certificates. Preserve unrelated records.
4. Persist the attachment in `backend/wrangler.jsonc` with `routes: [{"pattern":"lootlaneblox.com","custom_domain":true},{"pattern":"www.lootlaneblox.com","custom_domain":true}]` and `workers_dev: true`. Do not add these routes before the zone exists and permissions allow attachment; doing so would block otherwise-working deployments.
5. Verify both HTTPS domains, static assets, live offer prices, reward reads, and support preflights. Do not submit a real withdrawal or support message during verification.

There is no GitHub Pages `CNAME` file: the .com will serve Cloudflare directly. Do not point this domain at GitHub Pages IP addresses for this setup.

## Publishing future chat updates

The owner authorized automatic publishing in `AGENTS.md`. After committing task changes, run `powershell -NoProfile -File scripts/publish.ps1` from the repository root.

This validates a clean `main` checkout, runs backend and browser checks, builds the public site, checks the Cloudflare bundle, pushes `origin/main`, and deploys the site and API together. Wrangler's build hook also regenerates static assets when deploying directly from `backend`.

This is a local publishing workflow used after chat changes, not a background GitHub Actions job. It uses saved Git Credential Manager and Wrangler logins; credentials are never committed.

References: https://developers.cloudflare.com/workers/static-assets/ and https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
