# lootlaneblox.com — GitHub Pages

GitHub Pages serves the frontend from `zincwbtc/jenontop`, branch `main`, repository root. The custom domain is `lootlaneblox.com`, recorded both in GitHub Pages settings and the root `CNAME` file. Visitors keep the .com address; this is not a forwarding redirect to github.io.

Cloudflare manages DNS. GoDaddy remains the registrar, with nameservers `brenna.ns.cloudflare.com` and `uriah.ns.cloudflare.com`. The Cloudflare zone is active. The owner configured its DNS separately.

The rewards, offers, support and withdrawal API remains at `https://lootlane-test-backend.brycen0407.workers.dev`. The frontend must call that origin, not relative `/api/` URLs: GitHub Pages serves static files only. Both .com origins are already allowed by the API.

## Publishing

The owner authorized automatic publishing after chat changes. Commit task files, then run `powershell -NoProfile -File scripts/publish.ps1`. It checks the site, pushes origin/main, and deploys the Cloudflare backend and its optional static backup. GitHub Pages publishes the .com frontend from the push. DNS needs no change for later content updates.

Do not attach the .com to the Worker or migrate the frontend to Cloudflare Pages. Keep the existing CNAME file. When changing the domain, check GitHub Pages DNS health, certificate status, HTTPS, and live API requests.

GitHub custom-domain documentation: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
