# lootlaneblox.com

The frontend is published from `main` at the root of `zincwbtc/jenontop` using GitHub Pages. Cloudflare hosts the rewards, offers, support, and withdrawal API at `https://lootlane-test-backend.brycen0407.workers.dev`.

The backend accepts these exact origins: `https://lootlaneblox.com`, `https://www.lootlaneblox.com`, and `https://zincwbtc.github.io`. Asset paths work at the domain root and at the existing repository URL.

## DNS cutover

The domain was registered at GoDaddy. At the last check, its nameservers were `ns71.domaincontrol.com` and `ns72.domaincontrol.com`, and the apex pointed to GoDaddy's parking service. No Cloudflare zone for this domain was present in the connected account.

1. When DNS access is available, set the GitHub Pages custom domain to `lootlaneblox.com` in https://github.com/zincwbtc/jenontop/settings/pages. This creates the root `CNAME` file; pull that commit before making further changes.
2. In the authoritative DNS provider, replace the apex parking A records with these records. Preserve unrelated email and verification records.

| Type | Name | Value |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | zincwbtc.github.io |

3. Wait for GitHub's DNS check and certificate provisioning, then enable Enforce HTTPS. Verify assets, offers, rewards and support preflight requests on the new origin. The previous GitHub Pages URL will redirect to the custom domain.

If Cloudflare should also manage DNS, first add the domain to the specified Cloudflare account, copy existing DNS records, add the records above as **DNS only**, and change the nameservers at GoDaddy to the exact pair Cloudflare assigns. Do not invent the nameservers or change the registrar itself. A Worker login alone does not grant DNS edit permission.

The custom-domain redirect is deliberately not activated while DNS still points to parking; otherwise the existing working site would redirect visitors to GoDaddy.

Source: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
