# Lootlane: GitHub Pages edition

## Upload the storefront

Upload `index.html` to the root of your GitHub repository. It contains all styles, JavaScript and product images. No build step or assets folder is needed.

In the repository, open **Settings → Pages → Deploy from a branch**, select **main** and **/(root)**, then Save. Open the link GitHub provides.

The catalog, search, filters, item details, cart and browser-wallet connection work in the HTML. Saved orders, inventory management and Discord delivery require the backend below. The page clearly reports when it is not connected. It does not pretend to send messages or save orders.

GitHub Pages is ordinarily public, including when the source repository is private. This export protects backend operations with a private key, but does not make the storefront private. Keep using the existing private hosted site if you need the entire page restricted to you.

## Connect the test backend

The `backend` directory is a Cloudflare Worker with D1 storage. It is separate from GitHub Pages. Node.js and a Cloudflare account are needed for these steps.

1. Open a terminal in the `backend` directory and run:

   ```sh
   npm install
   npx wrangler login
   npx wrangler d1 create lootlane-test
   ```

2. Copy the database ID returned by the last command into `database_id` in `wrangler.jsonc`.
3. Set `ALLOWED_ORIGIN` to your Pages origin, for example `https://yourname.github.io` (no repository path or trailing slash). For a custom domain use that domain's HTTPS origin.
4. Apply the included schema:

   ```sh
   npx wrangler d1 migrations apply lootlane-test --remote
   ```

5. Generate a private access key:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Save this value privately. Enter it when prompted by:

   ```sh
   npx wrangler secret put TEST_ACCESS_KEY
   ```

6. Add the Discord webhook you supplied earlier when prompted by:

   ```sh
   npx wrangler secret put WEBHOOK_TEST_URL
   ```

   The webhook was intentionally not embedded in the downloadable HTML or source files. Do not put it in GitHub.

7. Deploy:

   ```sh
   npx wrangler deploy
   ```

8. Open the GitHub Pages site, click **Backend settings**, enter the Worker HTTPS URL and your private access key, then Save. The access key is held in session storage and must be entered again in a new browser session.

## Run a test

Add an item, proceed to checkout, and use a test username and email.

- Approved fixture: `4242 4242 4242 4242`
- Declined fixture: `4000 0000 0000 0002`
- Both: expiry `12/34`, CVC `123`
- Demo purchase confirmation: click **Reveal demo code** and enter `246810`. No SMS is sent.

Billing address is optional and is stored with the private order record. It is not included in webhook events. Apply migration `0003_billing_address.sql` before deploying this version of the backend.

Only those exact synthetic fixtures are accepted on the server. There are no real card charges, bank verification or item deliveries. The wallet button connects an address only; it never requests a signature or transaction.

Discord receives an embed marked TEST MODE with synthetic card data, the fixed demo code, and sample order information. Username, email and billing address are not forwarded. The order screen and dashboard show the payload and delivery status. HTTP 2xx means the message was accepted, not that a bank approved a payment. Keep the private tracking key to retrieve an order later.

The original private hosted store remains separate. This package does not automatically reuse its database or its hosted secrets.

## Contents

- `index.html`: standalone storefront, ready for GitHub upload.
- `backend/`: protected synthetic-only test API, catalog and SQL migrations.
- `image-sources.json`: product image sources; images belong to their owners.

Validated: standalone frontend build, server package dry-run build and secret-free export. Your new Cloudflare deployment and GitHub Pages URL must be tested after you configure them.

References:
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://developers.cloudflare.com/d1/wrangler-commands/
