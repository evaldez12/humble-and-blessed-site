# Humble & Blessed — launch checklist

The store (cart, checkout, drops with members early access, stock per size, pre-orders, restock alerts,
discount codes, sales dashboard, email) is built and tested locally (2026-10-22). It needs the
Cloudflare Worker to run. The GitHub Pages copy keeps working without it: products from
`products.json`, cart on the device, "Checkout is not connected yet", and Instagram links in place of
signups. These steps connect it to the real world, roughly in this order.

**Still placeholders, confirm with Rob before launch:** all four prices, fabric and fit copy, the
$8 flat / free-over-$100 shipping, 14-day returns, the Help page wording, hello@humblenblessed.com,
the legal name (is there an LLC?), and the product photos (AI renders; shoot the real shorts).

## 1. Hosting — Cloudflare Worker (Ed's account, billed to the client as hosting)
1. `wrangler d1 create hb-store` → paste the `database_id` it prints into `wrangler.jsonc`.
   (Tables are created by the Worker on first request; `worker/schema.sql` is only for reference.)
2. `wrangler secret put ADMIN_KEY` → a long random value. Save it in a file outside the repo
   (e.g. `~/Documents/<project>/ADMIN-KEY.txt`). Never commit it, never paste it in chat.
3. `wrangler deploy` (or connect the GitHub repo in Cloudflare → Workers & Pages so every push to
   `main` deploys). Preview address: https://humble-and-blessed.bizallies.workers.dev
4. Open `/admin`, enter the key, check every tab loads.

## 2. Domain (bought at cost, ~$10/yr for .com)
1. Cloudflare dashboard → Domains → Register (or transfer DNS to Cloudflare).
2. Workers & Pages → humble-and-blessed → Settings → Domains & Routes → Add → Custom domain (and `www`).
3. Update `SITE_URL` in `wrangler.jsonc` **and** `js/config.js`, then set `BASE` in `tools-seo.py` to the new
   address (and product URLs to `product-<id>`) and run `python3 tools-seo.py` for previews, canonicals and the sitemap.
   The 404 page and old `/b/...` links already work on both hosts.

## 3. Payments — the client's own Stripe account
1. Client opens Stripe (needs LLC or sole-owner details + bank) and adds Ed as Developer, or shares keys.
2. Nothing per product: checkout sends each item's name, photo and admin price to Stripe.
3. `wrangler secret put STRIPE_SECRET_KEY` — test key first (card 4242 4242 4242 4242), then live.
4. Webhook (needed for stock and the dashboard): Stripe → Developers → Webhooks → endpoint
   `https://<site>/api/stripe/webhook`, events `checkout.session.completed` and
   `checkout.session.async_payment_succeeded` → `wrangler secret put STRIPE_WEBHOOK_SECRET`.
5. Shipping: `SHIP_FLAT_CENTS`, `FREE_SHIP_OVER_CENTS` (0 = never free), `SHIP_COUNTRIES` in
   `wrangler.jsonc`. Keep the wording on `info.html` and `product.html` in step with them.
6. Turn on Stripe receipts (Settings → Emails). Stripe Tax if they want tax automated.

## 4. Products (owner, from the admin)
Admin → Products & stock → Add product / Edit details. New products start hidden and sold out so
photos can be cleaned first: open each photo full size, save to `assets/products/<name>.jpg`, run
`docpython tools/photo_bg.py <name>`, upload `assets/products/clean/<name>.jpg` in its place, uncheck
"Hide from the site", then set status (On sale / In this drop) and stock per size.
The four H&B products are seeded from `products.json` on the first visit: the shorts On sale, the
tee, hoodie and cap "In this drop" (shown as Coming soon, no price, until a drop is scheduled).
Set real prices and stock per size there before turning on Stripe.

## 5. Email — Resend (free to 3,000/month)
Add the domain in Resend, put its DNS records in Cloudflare, `wrangler secret put RESEND_API_KEY`,
set `MAIL_FROM` in `wrangler.jsonc` (e.g. `Humble & Blessed <drops@domain.com>`). Until the domain is
verified Resend only delivers to the account owner, which is enough for "Send test".
Texts: phone numbers are collected and exported; sending needs 10DLC registration (Klaviyo/Postscript).

## 6. Ads, analytics, Instagram (all optional, in `js/config.js`)
`META_PIXEL_ID`, `TIKTOK_PIXEL_ID`, `GA4_ID` → cookie banner appears, pixels load only after Accept.
Meta server-side purchases: var `META_PIXEL_ID` + `wrangler secret put META_CAPI_TOKEN`.
`PLAUSIBLE_DOMAIN` for analytics, `BEHOLD_FEED_ID` for the Instagram wall.

## 7. Before calling it launched
- Share image is `assets/share-card.jpg`; logo and monogram are already in place.
- Story copy, shipping/returns terms, size charts (none shown yet; add real measurements to `SIZE_CHARTS` in `js/store.js`), contact email.
- One full test order on the test key: add to cart → Stripe → thank-you page → order in the
  dashboard → stock went down. Then a member link and a restock signup.
- Check on a real phone: menu, cart drawer, product page, checkout.
