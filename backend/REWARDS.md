# Offerwall reward integration

The live frontend reads `GET /api/rewards?userId=...` from the Worker. Balances and completed surveys come from D1, never localStorage. The browser refreshes every 15 seconds while visible and after a profile change or a return to the tab.

## Provider settings

In the Offerwall.GG placement, set the postback URL to:

```text
https://lootlane-test-backend.brycen0407.workers.dev/api/offerwall/postback
```

Use GET with no macros (the provider appends all fields), or POST with form-encoded fields. The handler verifies HMAC-SHA256, checks the authenticated conversion record, and acknowledges only after D1 records it. The placement secret is stored as the Worker secret `OFFERWALL_SECRET`; never put it in frontend code or Git.

The scheduled job runs every minute and reconciles conversion history, so missed callbacks can be recovered even before the placement callback is configured. A shared database lease bounds polling across visitors and cron. Each pass checks the latest page and resumes older pages, including reversed records.

## Accounting behavior

- `GET /api/offers` reads live, already-converted `reward` amounts and `currency.perUsd` from the same Offerwall.GG placement. It does not multiply by the rate again or use rounded `rewardFormatted`. The secret stays in the Worker.
- Surveys are the default catalogue: `category=survey&type=singlestep` upstream, with a default maximum estimate of 100 Robux. The selector offers all up to 100, (0,15], (15,30], (30,50], (50,100], and any reward. `minReward` is exclusive and `maxReward` inclusive, preserving fractional payouts without overlaps or gaps. Older clients omitting `minReward` retain their cumulative limits. Filtering applies to the full targeted survey catalogue before local pagination (12 cards), ordered by smallest reward first; `total` counts all matches. Variable partners appear only under `any`, since their catalogue amount is not a quote. The provider category is singular `survey`, verified against the live wall. Scans are bounded to ten 200-offer pages and 12 seconds; incomplete or inconsistent responses fail visibly rather than pretending there are no smaller surveys.
- `category=all` uses provider popularity order and pagination. Both views request `type=singlestep` and locally exclude multi-step offers and the owner's blocked categories: game, mobilegame, desktopgame, app, freetrial, shopping, deposit, creditcard, multireward. This mirrors the settings supplied on 2026-09-24; update the local guard if the owner changes this policy. The live provider incorrectly returns EarnX (761) as an allowed signup despite its `multistep` type, so category filtering alone is insufficient.
- The catalog labels surveys as estimates and variable rewards as "Reward varies". Each card links to the provider's requirements page with the same user ID, where the provider tracks the actual offer start. Advertiser confirmation may differ from an estimate; changing display labels does not increase historical credits. No fixed 15/30/50/100 reward offers are fabricated.
- Country comes from Cloudflare's visitor geolocation and device from the visitor's user agent. Missing geolocation or an unexpected provider currency fails closed rather than displaying datacenter-targeted or incorrectly labeled offers.

- Transaction IDs are unique. Retries cannot credit twice.
- Amounts retain four decimal places as integer units; the provider's confirmed amount is authoritative.
- Owner-authorized corrections live separately in `reward_corrections`, keyed by the source transaction. A correction records the promised total and an audit reason; the added amount is only the positive difference from the provider credit. It cannot credit a second completion, duplicate on retry, or overwrite the provider's amount.
- The balance response separates `providerBalance` and `storeCorrection`. Corrections are funded by the store; they are not additional revenue from Offerwall.GG. They become inactive if the source conversion reverses. There is no public endpoint to create corrections.
- Reversals remove the corresponding credit and survey count. Reordered credits never undo reversals.
- Test callbacks and pending/rejected conversions do not credit.
- Authenticated provider records named `Survey ...` with no intermediate goal count as completed surveys. Games and partial goals can award balance but do not satisfy the ten-survey requirement.
- Usernames are matched case-insensitively. Old guest rewards remain attached to the exact guest ID; they are not automatically moved to an unverified username.
- The username flow is a profile lookup, not proof of Roblox account ownership. Withdrawals unlock at 10 completed surveys (counted since the last withdrawal) and at least 1 whole Robux available. `POST /api/withdraw` records the request and posts it to the Discord #payout-log webhook (`PAYOUT_WEBHOOK_URL` secret); staff pay the Robux manually and must confirm the Roblox account first, since usernames are not verified. Staff close a request with `POST /api/withdraw {"action":"resolve","id":"...","status":"paid"|"rejected"}` and `Authorization: Bearer <TEST_ACCESS_KEY>`; rejected requests return the balance and surveys.
- Provider errors preserve confirmed balances and are surfaced as delayed sync, never as zeroing or success.

## Deploy and check

```sh
npx --no-install wrangler d1 migrations apply lootlane-test --remote
npx --no-install wrangler secret put OFFERWALL_SECRET
npx --no-install wrangler deploy
```

From the repo root:

```sh
node --test tests/rewards.test.mjs tests/offers.test.mjs
python tests/ui_smoke.py
```

The tests use local secrets and mocked provider records, not real rewards or Discord messages.

References: [Postbacks](https://offerwall.gg/developers/postbacks), [API specification](https://offerwall.gg/openapi.json).
