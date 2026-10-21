# Humble & Blessed — website and store

The website for Humble & Blessed, a New York clothing label, with its own store built in.

- Pages: `index.html` (home, 3D cherub), `shop.html`, `product.html` (one template for every product),
  `lookbook.html`, `about.html`, `info.html` (help), `thanks.html` (after checkout), `admin.html` (owner).
- Design: `style.css`, `site.js` (header, footer, effects), `js/hb.js` (H&B cards, shop filters, drop countdown).
- Store: `js/store.js` + `js/config.js` (cart, drops, members, stock, tracking), `css/store.css`,
  `worker/index.js` (Cloudflare Worker: API, admin, Stripe, email), `products.json` (seed catalog).
  Built from the clothing-brand-store skill. Launch steps: `LAUNCH.md`.
- Old `b/...` addresses redirect to the new ones.

Local test: `cp .dev.vars.example .dev.vars`, then
`wrangler dev --local --persist-to <scratch folder> --port 8790`.
Without the Worker (GitHub Pages) the site falls back to `products.json` and a device-only cart.
Prices, product copy, policies and lookbook images are placeholders until the owner confirms them.
