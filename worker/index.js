/**
 * Humble & Blessed — store Worker (built from the clothing-brand-store skill).
 * Static files are served by Cloudflare's asset handling (see wrangler.jsonc). This script answers /api/*.
 *
 * Pages (served by this script so new products work without a redeploy)
 *   GET  /product-<id>[.html]          product page: the product.html template filled from the database
 *   GET  /media/<key>.<ext>            a photo uploaded from the admin
 *
 * Public
 *   GET  /api/products                 visible products (name, price, photos, sizes, description...)
 *   GET  /api/state                    drop window, per-product status, stock, pre-order notes
 *   GET  /api/member?t=<token>         check a member's early-access link
 *   POST /api/subscribe                waitlist / restock signup
 *   GET  /api/unsubscribe?t=<token>    one-click unsubscribe (link in every email)
 *   POST /api/checkout                 Stripe Checkout for the cart (checks drop window, members, stock)
 *   POST /api/stripe/webhook           Stripe → records orders, takes sold items off stock
 *   GET  /api/order?session_id=        order value for the thank-you page (purchase tracking)
 *
 * Admin (Authorization: Bearer <ADMIN_KEY>)
 *   GET  /api/admin/summary            waitlist counts + email sends
 *   GET  /api/admin/subscribers        list (?product=)          DELETE /api/admin/subscribers/:id
 *   GET  /api/admin/export.csv         waitlist with each member's early-access link
 *   POST /api/admin/send               email everyone waiting for a product (Resend)
 *   GET  /api/admin/catalog            products + status, stock, pre-order settings + current drop
 *   POST /api/admin/product            save one product's status, stock per size, pre-order
 *   POST /api/admin/product-details    add a product, or edit its name, price, photos, sizes, description
 *   DELETE /api/admin/product?id=      delete a product (its past orders stay in the dashboard)
 *   POST /api/admin/product-order      set the order products show in the shop
 *   POST /api/admin/media              upload a photo (raw JPG/PNG/WebP body), returns its /media URL
 *   POST /api/admin/drop               schedule a drop (name, members-early time, public time)
 *   DELETE /api/admin/drop             cancel the current drop
 *   POST /api/admin/early-access       email every member their personal early-access link
 *   GET  /api/admin/dashboard          sales + signups (?demo=1 for example data)
 *   GET/POST/DELETE /api/admin/discounts   Stripe promotion codes
 *
 * Bindings / secrets: DB (D1), ADMIN_KEY, RESEND_API_KEY, MAIL_FROM, SITE_URL, STRIPE_SECRET_KEY,
 * STRIPE_WEBHOOK_SECRET, META_PIXEL_ID + META_CAPI_TOKEN (server-side ad tracking, optional).
 */

const STRIPE_VERSION = '2024-06-20';
const META_GRAPH = 'v25.0';

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nowIso = () => new Date().toISOString();
const bad = msg => Object.assign(new Error(msg), { status: 400 });

function normalizeContact(raw) {
  const c = String(raw || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c)) return { contact: c.toLowerCase(), kind: 'email' };
  const digits = c.replace(/[^\d+]/g, '');
  const n = digits.startsWith('+') ? digits : (digits.length === 10 ? '+1' + digits : (digits.length === 11 && digits.startsWith('1') ? '+' + digits : ''));
  if (/^\+\d{10,15}$/.test(n)) return { contact: n, kind: 'phone' };
  return null;
}

// ---------- signing (unsubscribe + member links) ----------
async function hmac(env, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ADMIN_KEY || 'dev'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(msg)));
  return [...new Uint8Array(sig)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}
const unsubToken = async (env, id) => `${id}.${await hmac(env, 'unsub:' + id)}`;
const memberToken = async (env, id) => `${id}.${await hmac(env, 'member:' + id)}`;
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let out = 0; for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i); return out === 0;
}
const isAdmin = (request, env) => !!env.ADMIN_KEY && timingSafeEqual((request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), env.ADMIN_KEY);
async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s).trim().toLowerCase()));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- catalog + state ----------
// Products live in D1 so the owner can add and edit them from the admin. The tables are created here on
// first use, and the first run copies products.json in once (products.json stays as the seed and the
// fallback for static hosting).
let SCHEMA_OK = false;
// waitlist, sends, drops, stock, orders: same as worker/schema.sql, kept here so a fresh database just works
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS subscribers (id INTEGER PRIMARY KEY AUTOINCREMENT, contact TEXT NOT NULL, kind TEXT NOT NULL,
    product TEXT NOT NULL DEFAULT 'next-drop', size TEXT NOT NULL DEFAULT 'any', source TEXT NOT NULL DEFAULT 'site',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), unsubscribed_at TEXT, UNIQUE (contact, product, size))`,
  'CREATE INDEX IF NOT EXISTS idx_sub_product ON subscribers (product, unsubscribed_at)',
  `CREATE TABLE IF NOT EXISTS sends (id INTEGER PRIMARY KEY AUTOINCREMENT, product TEXT NOT NULL, subject TEXT NOT NULL,
    body TEXT NOT NULL, recipients INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS product_settings (product TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'archive',
    preorder INTEGER NOT NULL DEFAULT 0, ship_note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  'CREATE TABLE IF NOT EXISTS inventory (product TEXT NOT NULL, size TEXT NOT NULL, stock INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (product, size))',
  `CREATE TABLE IF NOT EXISTS drops (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, early_at TEXT NOT NULL,
    public_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, email TEXT, name TEXT, total_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'usd', member INTEGER NOT NULL DEFAULT 0, preorder INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS order_items (order_id TEXT NOT NULL, product TEXT NOT NULL, size TEXT NOT NULL, qty INTEGER NOT NULL,
    unit_cents INTEGER NOT NULL DEFAULT 0)`,
  'CREATE INDEX IF NOT EXISTS idx_items_product ON order_items (product, size)',
  'CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at)',
];
async function ensureSchema(env) {
  if (SCHEMA_OK) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, data TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS media (key TEXT PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)'),
    ...SCHEMA.map(s => env.DB.prepare(s)),
  ]);
  SCHEMA_OK = true;
}
const PRODUCT_FIELDS = ['name', 'price', 'category', 'color', 'images', 'description', 'details', 'sizeChart', 'sizes', 'soldOut'];
const pick = p => Object.fromEntries(PRODUCT_FIELDS.filter(k => p[k] !== undefined).map(k => [k, p[k]]));
async function catalog(env, origin, { all = false } = {}) {
  await ensureSchema(env);
  const read = () => env.DB.prepare('SELECT id, data, position, hidden FROM products ORDER BY position, id').all();
  let rows = (await read()).results;
  if (!rows.length && !(await env.DB.prepare("SELECT v FROM meta WHERE k = 'seeded'").first())) {
    const seed = await (await env.ASSETS.fetch(new Request(origin + '/products.json'))).json();
    await env.DB.batch([
      ...seed.map((p, i) => env.DB.prepare('INSERT OR IGNORE INTO products (id, data, position) VALUES (?1, ?2, ?3)').bind(p.id, JSON.stringify(pick(p)), i)),
      // optional "status" in products.json (live | drop | archive) becomes the product's starting status;
      // "drop" with no drop scheduled shows as coming soon
      ...seed.filter(p => ['live', 'drop', 'archive'].includes(p.status)).map(p => env.DB.prepare("INSERT OR IGNORE INTO product_settings (product, status, preorder, ship_note) VALUES (?1, ?2, 0, '')").bind(p.id, p.status)),
      env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('seeded', datetime('now'))"),
    ]);
    rows = (await read()).results;
  }
  return rows.filter(r => all || !r.hidden).map(r => ({ ...JSON.parse(r.data), id: r.id, position: r.position, hidden: !!r.hidden }));
}
// photo paths: uploads are /media/<key>.<ext>; the original photos are files under assets/products/
const imagePath = f => f.startsWith('/') ? f : '/assets/products/' + f;
async function currentDrop(env) {
  const d = await env.DB.prepare('SELECT * FROM drops ORDER BY id DESC LIMIT 1').first();
  if (!d) return null;
  const t = Date.now(), early = Date.parse(d.early_at), pub = Date.parse(d.public_at);
  return { ...d, phase: t < early ? 'upcoming' : t < pub ? 'early' : 'public' };
}
async function state(env, origin, opts = {}) {
  // catalog first: on a fresh database it seeds products and their starting status, which the reads below need
  const cat = await catalog(env, origin, opts);
  const [drop, settings, inv] = await Promise.all([
    currentDrop(env),
    env.DB.prepare('SELECT * FROM product_settings').all(),
    env.DB.prepare('SELECT * FROM inventory').all(),
  ]);
  const products = {};
  for (const p of cat) products[p.id] = { status: p.soldOut ? 'archive' : 'live', preorder: false, ship_note: '', stock: null };
  for (const s of settings.results) if (products[s.product]) Object.assign(products[s.product], { status: s.status, preorder: !!s.preorder, ship_note: s.ship_note });
  for (const i of inv.results) if (products[i.product]) { products[i.product].stock ??= {}; products[i.product].stock[i.size] = i.stock; }
  return { drop: drop ? { name: drop.name, early_at: drop.early_at, public_at: drop.public_at, phase: drop.phase } : null, products };
}
async function memberFromToken(env, token, drop) {
  const [id, sig] = String(token || '').split('.');
  if (!id || !/^\d+$/.test(id) || !timingSafeEqual(sig || '', await hmac(env, 'member:' + id))) return null;
  const row = await env.DB.prepare('SELECT contact FROM subscribers WHERE id = ?1 AND unsubscribed_at IS NULL').bind(id).first();
  if (!row) return null;
  // early access is for people who joined before members' shopping opened
  const first = await env.DB.prepare('SELECT MIN(created_at) AS joined FROM subscribers WHERE contact = ?1').bind(row.contact).first();
  const joined = Date.parse((first.joined || '').replace(' ', 'T') + 'Z');
  if (drop && joined > Date.parse(drop.early_at)) return { id: +id, contact: row.contact, eligible: false };
  return { id: +id, contact: row.contact, eligible: true };
}
// can this product + size be bought right now?
function canBuy(ps, size, phase, isMember) {
  if (!ps || ps.status === 'archive') return 'This piece is sold out.';
  if (ps.status === 'drop') {
    if (!phase || phase === 'upcoming') return 'This piece has not dropped yet.';
    if (phase === 'early' && !isMember) return 'Members are shopping first. Public access opens soon.';
  }
  if (!ps.preorder && ps.stock && (ps.stock[size] ?? 0) <= 0) return `Size ${size} is sold out.`;
  return null;
}

// ---------- integrations ----------
async function stripe(env, path, { method = 'GET', form = null } = {}) {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method, headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': STRIPE_VERSION, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form || undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || 'Stripe error');
  return data;
}
async function verifyStripe(env, payload, header) {
  const parts = Object.fromEntries(String(header || '').split(',').map(kv => kv.split('=')));
  if (!parts.t || !parts.v1 || Math.abs(Date.now() / 1000 - +parts.t) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parts.t}.${payload}`));
  return timingSafeEqual([...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join(''), parts.v1);
}
// Meta Conversions API (server-side twin of the browser pixel; same event_id so Meta counts it once)
async function metaEvent(env, request, { name, id, value, email, phone, url }) {
  if (!env.META_PIXEL_ID || !env.META_CAPI_TOKEN) return;
  const user_data = { client_ip_address: request.headers.get('CF-Connecting-IP') || undefined, client_user_agent: request.headers.get('User-Agent') || undefined };
  if (email) user_data.em = [await sha256hex(email)];
  if (phone) user_data.ph = [await sha256hex(phone.replace(/\D/g, ''))];
  const ev = { event_name: name, event_time: Math.floor(Date.now() / 1000), event_id: id, action_source: 'website', event_source_url: url, user_data };
  if (value != null) ev.custom_data = { currency: 'USD', value };
  await fetch(`https://graph.facebook.com/${META_GRAPH}/${env.META_PIXEL_ID}/events?access_token=${encodeURIComponent(env.META_CAPI_TOKEN)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [ev] }),
  }).catch(() => {});
}
async function sendEmails(env, messages) {
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(messages.slice(i, i + 100)) });
    if (!r.ok) throw Object.assign(new Error('Resend error: ' + (await r.text()).slice(0, 300)), { sent });
    sent += Math.min(100, messages.length - i);
  }
  return sent;
}
function emailFor(env, to, subject, text, unsub) {
  return {
    from: env.MAIL_FROM || 'Humble & Blessed <onboarding@resend.dev>', to: [to], subject,
    text: `${text}\n\nAlways Be Humble To Stay Blessed.\n—\nHumble & Blessed, New York\nUnsubscribe: ${unsub}`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 20px;color:#111"><p style="white-space:pre-wrap;font-size:16px;line-height:1.6">${esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#111;font-weight:600">$1</a>')}</p><p style="margin-top:28px;font-size:18px;font-weight:700;letter-spacing:.04em;text-transform:uppercase">Always Be Humble To Stay Blessed.</p><p style="margin-top:20px;font-size:12px;color:#777">Humble & Blessed, New York · <a href="${unsub}" style="color:#777">Unsubscribe</a></p></div>`,
    headers: { 'List-Unsubscribe': `<${unsub}>` },
  };
}

// ---------- router ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const site = env.SITE_URL || url.origin;
    const mm = path.match(/^\/media\/([a-z0-9-]{8,64})\.(jpg|png|webp)$/);
    if (mm && request.method === 'GET') return media(env, mm[1]);
    const pm = path.match(/^\/product-([a-z0-9][a-z0-9-]{0,60}?)(?:\.html)?\/?$/);
    if (pm && request.method === 'GET') return productPage(env, url, site, pm[1]);
    if (/^\/product(\.html)?\/?$/.test(path)) return env.ASSETS.fetch(new Request(url.origin + '/__no-such-product__'));   // the bare template
    // the site used to live in /b/ (GitHub Pages); send old links to the new addresses
    const old = path.match(/^\/b(?:\/(index|shop|lookbook|about|product)(?:\.html)?)?\/?$/);
    if (old) {
      const pid = old[1] === 'product' && url.searchParams.get('id');
      const to = pid ? `/product-${encodeURIComponent(pid)}` : old[1] && old[1] !== 'index' ? `/${old[1]}` : '/';
      return Response.redirect(url.origin + to, 301);
    }
    // search engines: robots.txt and a sitemap built from the live catalog, so new products are listed automatically
    if (path === '/robots.txt' && request.method === 'GET') return new Response(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${site}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    if (path === '/sitemap.xml' && request.method === 'GET') return sitemap(env, url, site);
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      await ensureSchema(env);
      // ===== public =====
      if (path === '/api/products' && request.method === 'GET') {
        return json(await catalog(env, url.origin), 200, { 'Cache-Control': 'public, max-age=5' });
      }
      if (path === '/api/state' && request.method === 'GET') {
        return json(await state(env, url.origin), 200, { 'Cache-Control': 'public, max-age=15' });
      }
      if (path === '/api/member' && request.method === 'GET') {
        const drop = await currentDrop(env);
        const m = await memberFromToken(env, url.searchParams.get('t'), drop);
        if (!m) return json({ ok: false }, 404);
        return json({ ok: true, eligible: m.eligible });
      }
      if (path === '/api/subscribe' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const n = normalizeContact(body.contact);
        if (!n) return json({ error: 'Enter a valid email or phone number.' }, 400);
        await env.DB.prepare(
          `INSERT INTO subscribers (contact, kind, product, size, source) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (contact, product, size) DO UPDATE SET unsubscribed_at = NULL`
        ).bind(n.contact, n.kind, String(body.product || 'next-drop').slice(0, 80), String(body.size || 'any').slice(0, 20), String(body.source || 'site').slice(0, 40)).run();
        if (body.event_id) ctx.waitUntil(metaEvent(env, request, { name: 'Lead', id: String(body.event_id).slice(0, 64), email: n.kind === 'email' ? n.contact : null, phone: n.kind === 'phone' ? n.contact : null, url: request.headers.get('Referer') || site }));
        return json({ ok: true, kind: n.kind });
      }
      if (path === '/api/unsubscribe' && request.method === 'GET') {
        const [id, sig] = (url.searchParams.get('t') || '').split('.');
        if (!id || !timingSafeEqual(sig || '', await hmac(env, 'unsub:' + id))) return new Response('Invalid link.', { status: 400 });
        const row = await env.DB.prepare('SELECT contact FROM subscribers WHERE id = ?1').bind(id).first();
        if (row) await env.DB.prepare("UPDATE subscribers SET unsubscribed_at = datetime('now') WHERE contact = ?1").bind(row.contact).run();
        return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#070707;color:#ece6d8;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-weight:600">You're off the list.</h1><p>No more drop messages. <a href="${esc(site)}" style="color:#ece6d8">Back to Just Living</a></p></div>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      if (path === '/api/checkout' && request.method === 'POST') return await checkout(request, env, url, site);
      if (path === '/api/stripe/webhook' && request.method === 'POST') return await webhook(request, env, url, ctx, site);
      if (path === '/api/order' && request.method === 'GET') {
        const sid = url.searchParams.get('session_id') || '';
        if (!/^cs_[A-Za-z0-9_]+$/.test(sid)) return json({ error: 'Bad session' }, 400);
        const o = await env.DB.prepare('SELECT total_cents, currency FROM orders WHERE id = ?1').bind(sid).first();
        if (o) return json({ id: sid, value: o.total_cents / 100, currency: o.currency.toUpperCase() });
        if (!env.STRIPE_SECRET_KEY) return json({ error: 'Not found' }, 404);
        const s = await stripe(env, 'checkout/sessions/' + sid);
        return json({ id: sid, value: (s.amount_total || 0) / 100, currency: (s.currency || 'usd').toUpperCase() });
      }

      // ===== admin =====
      if (path.startsWith('/api/admin/')) {
        if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);
        return await admin(request, env, url, path, site);
      }
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err.message || String(err) }, err.status || 500);
    }
  },
};

// ---------- checkout ----------
async function checkout(request, env, url, site) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'Checkout is not connected yet.' }, 400);
  const body = await request.json().catch(() => ({}));
  const items = (body.items || []).filter(i => i && typeof i.id === 'string' && typeof i.size === 'string' && Number.isInteger(i.qty) && i.qty > 0 && i.qty <= 10).slice(0, 20);
  if (!items.length) return json({ error: 'Your cart is empty.' }, 400);
  const [cat, st] = [await catalog(env, url.origin), await state(env, url.origin)];
  const drop = await currentDrop(env);
  const member = body.member ? await memberFromToken(env, body.member, drop) : null;
  const isMember = !!(member && member.eligible);
  const form = new URLSearchParams();
  let preorder = false, subtotal = 0; const notes = new Set();
  items.forEach((it, i) => {
    const p = cat.find(x => x.id === it.id); const ps = st.products[it.id];
    if (!p) throw bad('An item in your cart is no longer available.');
    const why = canBuy(ps, it.size, drop?.phase, isMember);
    if (why) throw bad(`${p.name}: ${why}`);
    if (!ps.preorder && ps.stock && it.qty > (ps.stock[it.size] ?? 0)) throw bad(`${p.name}: only ${ps.stock[it.size]} left in ${it.size}.`);
    if (ps.preorder) { preorder = true; if (ps.ship_note) notes.add(`${p.name}: ${ps.ship_note}`); }
    // the price comes from the admin, so a price change applies at the next checkout
    const cents = Math.round(p.price * 100); subtotal += cents * it.qty;
    form.set(`line_items[${i}][price_data][currency]`, 'usd');
    form.set(`line_items[${i}][price_data][unit_amount]`, String(cents));
    form.set(`line_items[${i}][price_data][product_data][name]`, `${p.name}${p.sizes.length > 1 ? ` (${it.size})` : ''}`.slice(0, 250));
    if (p.images?.[0]) form.set(`line_items[${i}][price_data][product_data][images][0]`, site + imagePath(p.images[0]));
    form.set(`line_items[${i}][quantity]`, String(it.qty));
  });
  form.set('mode', 'payment');
  form.set('success_url', `${site}/thanks?session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${site}/#shop`);
  form.set('allow_promotion_codes', 'true');
  form.set('billing_address_collection', 'auto');
  form.set('phone_number_collection[enabled]', 'true');
  String(env.SHIP_COUNTRIES || 'US').split(',').map(c => c.trim().toUpperCase()).filter(Boolean)
    .forEach((c, i) => form.set(`shipping_address_collection[allowed_countries][${i}]`, c));
  form.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
  // shipping comes from wrangler.jsonc vars: flat rate, free-over threshold (0 = never free), countries
  const flat = Number(env.SHIP_FLAT_CENTS ?? 800), freeOver = Number(env.FREE_SHIP_OVER_CENTS ?? 15000);
  const free = freeOver > 0 && subtotal >= freeOver;
  form.set('shipping_options[0][shipping_rate_data][fixed_amount][amount]', free ? '0' : String(flat));
  form.set('shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'usd');
  form.set('shipping_options[0][shipping_rate_data][display_name]', (free ? 'Free shipping' : 'Shipping') + (preorder ? ' (pre-order, ships when ready)' : ' (2–5 days)'));
  form.set('metadata[items]', items.map(i => `${i.id}|${i.size}|${i.qty}`).join(';').slice(0, 500));
  form.set('metadata[member]', isMember ? '1' : '0');
  form.set('metadata[preorder]', preorder ? '1' : '0');
  if (preorder) form.set('custom_text[submit][message]', ('Pre-order. ' + [...notes].join(' · ')).slice(0, 1000));
  const s = await stripe(env, 'checkout/sessions', { method: 'POST', form });
  return json({ url: s.url, id: s.id });
}

// ---------- Stripe webhook: record the order, take it off stock ----------
async function webhook(request, env, url, ctx, site) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'Webhook secret not set' }, 400);
  const payload = await request.text();
  if (!(await verifyStripe(env, payload, request.headers.get('Stripe-Signature')))) return json({ error: 'Bad signature' }, 400);
  const event = JSON.parse(payload);
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return json({ ok: true, ignored: event.type });
  const s = event.data.object;
  if (s.payment_status !== 'paid') return json({ ok: true, pending: true });
  const exists = await env.DB.prepare('SELECT id FROM orders WHERE id = ?1').bind(s.id).first();
  if (exists) return json({ ok: true, duplicate: true });
  const cat = await catalog(env, url.origin, { all: true });
  const items = String(s.metadata?.items || '').split(';').filter(Boolean).map(x => { const [id, size, qty] = x.split('|'); return { id, size, qty: +qty || 1 }; });
  const stmts = [env.DB.prepare('INSERT INTO orders (id, email, name, total_cents, currency, member, preorder) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(s.id, s.customer_details?.email || null, s.customer_details?.name || null, s.amount_total || 0, s.currency || 'usd', s.metadata?.member === '1' ? 1 : 0, s.metadata?.preorder === '1' ? 1 : 0)];
  for (const it of items) {
    const unit = Math.round((cat.find(p => p.id === it.id)?.price || 0) * 100);
    stmts.push(env.DB.prepare('INSERT INTO order_items (order_id, product, size, qty, unit_cents) VALUES (?1, ?2, ?3, ?4, ?5)').bind(s.id, it.id, it.size, it.qty, unit));
    stmts.push(env.DB.prepare('UPDATE inventory SET stock = MAX(stock - ?3, 0) WHERE product = ?1 AND size = ?2').bind(it.id, it.size, it.qty));
  }
  await env.DB.batch(stmts);
  ctx.waitUntil(metaEvent(env, request, { name: 'Purchase', id: s.id, value: (s.amount_total || 0) / 100, email: s.customer_details?.email, phone: s.customer_details?.phone, url: site + '/thanks' }));
  return json({ ok: true });
}

// ---------- admin ----------
async function admin(request, env, url, path, site) {
  const m = request.method;

  if (path === '/api/admin/summary') {
    const { results } = await env.DB.prepare(`SELECT product, size, kind, COUNT(*) AS n FROM subscribers WHERE unsubscribed_at IS NULL GROUP BY product, size, kind ORDER BY product, size`).all();
    const totals = await env.DB.prepare(`SELECT COUNT(*) AS total, SUM(kind='email') AS emails, SUM(kind='phone') AS phones, COUNT(DISTINCT contact) AS people FROM subscribers WHERE unsubscribed_at IS NULL`).first();
    const sends = (await env.DB.prepare('SELECT * FROM sends ORDER BY id DESC LIMIT 20').all()).results;
    return json({ rows: results, totals, sends, mail: !!env.RESEND_API_KEY, stripe: !!env.STRIPE_SECRET_KEY, webhook: !!env.STRIPE_WEBHOOK_SECRET, capi: !!(env.META_PIXEL_ID && env.META_CAPI_TOKEN) });
  }
  if (path === '/api/admin/subscribers' && m === 'GET') {
    const product = url.searchParams.get('product');
    const q = product ? env.DB.prepare('SELECT * FROM subscribers WHERE product = ?1 ORDER BY id DESC LIMIT 2000').bind(product) : env.DB.prepare('SELECT * FROM subscribers ORDER BY id DESC LIMIT 2000');
    return json({ rows: (await q.all()).results });
  }
  const del = path.match(/^\/api\/admin\/subscribers\/(\d+)$/);
  if (del && m === 'DELETE') { await env.DB.prepare('DELETE FROM subscribers WHERE id = ?1').bind(del[1]).run(); return json({ ok: true }); }
  if (path === '/api/admin/export.csv') {
    const { results } = await env.DB.prepare('SELECT id, contact, kind, product, size, source, created_at, unsubscribed_at FROM subscribers ORDER BY id').all();
    const lines = ['id,contact,kind,product,size,source,created_at,unsubscribed_at,member_link'];
    for (const r of results) lines.push([r.id, r.contact, r.kind, r.product, r.size, r.source, r.created_at, r.unsubscribed_at || '', `${site}/?member=${await memberToken(env, r.id)}`].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="just-living-members.csv"' } });
  }
  if (path === '/api/admin/send' && m === 'POST') {
    if (!env.RESEND_API_KEY) return json({ error: 'Email is not connected yet: add the RESEND_API_KEY secret and MAIL_FROM (see LAUNCH.md).' }, 400);
    const b = await request.json().catch(() => ({}));
    const product = String(b.product || 'next-drop'), subject = String(b.subject || '').trim(), text = String(b.message || '').trim();
    if (!subject || !text) return json({ error: 'Subject and message are required.' }, 400);
    const test = b.test ? normalizeContact(b.test) : null;
    const rows = test ? [{ id: 0, contact: test.contact }] : (await (product === 'all'
      ? env.DB.prepare("SELECT MIN(id) AS id, contact FROM subscribers WHERE kind='email' AND unsubscribed_at IS NULL GROUP BY contact")
      : env.DB.prepare("SELECT MIN(id) AS id, contact FROM subscribers WHERE kind='email' AND unsubscribed_at IS NULL AND (product = ?1 OR product = 'next-drop') GROUP BY contact").bind(product)).all()).results;
    if (!rows.length) return json({ error: 'Nobody with an email address is waiting for that.' }, 400);
    const msgs = []; for (const r of rows) msgs.push(emailFor(env, r.contact, subject, text, `${site}/api/unsubscribe?t=${await unsubToken(env, r.id)}`));
    const sent = await sendEmails(env, msgs);
    if (!test) await env.DB.prepare('INSERT INTO sends (product, subject, body, recipients) VALUES (?1, ?2, ?3, ?4)').bind(product, subject, text, sent).run();
    return json({ ok: true, sent });
  }

  if (path === '/api/admin/catalog' && m === 'GET') {
    const [cat, st, drop] = [await catalog(env, url.origin, { all: true }), await state(env, url.origin, { all: true }), await currentDrop(env)];
    return json({ products: cat.map(p => ({ ...p, image: p.images?.[0] || '', ...st.products[p.id] })), drop });
  }
  if (path === '/api/admin/product-details' && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    const { data, hidden } = cleanProduct(b);
    const cat = await catalog(env, url.origin, { all: true });
    const old = b.id ? cat.find(x => x.id === b.id) : null;
    if (old) {
      await env.DB.prepare("UPDATE products SET data = ?2, hidden = ?3, updated_at = datetime('now') WHERE id = ?1")
        .bind(old.id, JSON.stringify({ ...data, soldOut: !!old.soldOut }), hidden ? 1 : 0).run();
      return json({ ok: true, id: old.id });
    }
    const base = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'product';
    let id = base, n = 2; while (cat.some(x => x.id === id)) id = `${base}-${n++}`;
    const position = cat.reduce((mx, x) => Math.max(mx, x.position), -1) + 1;
    await env.DB.batch([
      env.DB.prepare('INSERT INTO products (id, data, position, hidden) VALUES (?1, ?2, ?3, ?4)').bind(id, JSON.stringify({ ...data, soldOut: true }), position, hidden ? 1 : 0),
      // new products start as sold out ("Notify me") until the owner sets a status and stock
      env.DB.prepare("INSERT OR IGNORE INTO product_settings (product, status, preorder, ship_note) VALUES (?1, 'archive', 0, '')").bind(id),
    ]);
    return json({ ok: true, id, created: true });
  }
  if (path === '/api/admin/product' && m === 'DELETE') {
    const id = url.searchParams.get('id') || '';
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(id)) return json({ error: 'Bad id' }, 400);
    await ensureSchema(env);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM products WHERE id = ?1').bind(id),
      env.DB.prepare('DELETE FROM product_settings WHERE product = ?1').bind(id),
      env.DB.prepare('DELETE FROM inventory WHERE product = ?1').bind(id),
    ]);
    return json({ ok: true });
  }
  if (path === '/api/admin/product-order' && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    const ids = (Array.isArray(b.ids) ? b.ids : []).filter(x => typeof x === 'string').slice(0, 500);
    if (ids.length) { await ensureSchema(env); await env.DB.batch(ids.map((id, i) => env.DB.prepare('UPDATE products SET position = ?2 WHERE id = ?1').bind(id, i))); }
    return json({ ok: true });
  }
  if (path === '/api/admin/media' && m === 'POST') {
    const type = (request.headers.get('Content-Type') || '').split(';')[0].trim();
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type];
    if (!ext) return json({ error: 'Upload a JPG, PNG or WebP photo.' }, 400);
    const buf = new Uint8Array(await request.arrayBuffer());
    if (!buf.length) return json({ error: 'That photo was empty.' }, 400);
    if (buf.length > 1400000) return json({ error: 'That photo is too large. Try a smaller one.' }, 400);
    let b64;
    if (typeof buf.toBase64 === 'function') b64 = buf.toBase64();
    else { let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000)); b64 = btoa(bin); }
    const key = crypto.randomUUID();
    await ensureSchema(env);
    await env.DB.prepare('INSERT INTO media (key, type, data) VALUES (?1, ?2, ?3)').bind(key, type, b64).run();
    return json({ ok: true, url: `/media/${key}.${ext}` });
  }
  if (path === '/api/admin/product' && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    const cat = await catalog(env, url.origin, { all: true }); const p = cat.find(x => x.id === b.id);
    if (!p) return json({ error: 'Unknown product' }, 400);
    if (!['archive', 'drop', 'live'].includes(b.status)) return json({ error: 'Bad status' }, 400);
    const stmts = [env.DB.prepare(`INSERT INTO product_settings (product, status, preorder, ship_note, updated_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))
      ON CONFLICT (product) DO UPDATE SET status = ?2, preorder = ?3, ship_note = ?4, updated_at = datetime('now')`).bind(p.id, b.status, b.preorder ? 1 : 0, String(b.ship_note || '').slice(0, 120))];
    for (const size of p.sizes) {
      const n = Math.max(0, Math.min(100000, parseInt(b.stock?.[size] ?? 0, 10) || 0));
      stmts.push(env.DB.prepare('INSERT INTO inventory (product, size, stock) VALUES (?1, ?2, ?3) ON CONFLICT (product, size) DO UPDATE SET stock = ?3').bind(p.id, size, n));
    }
    await env.DB.batch(stmts);
    return json({ ok: true });
  }
  if (path === '/api/admin/drop' && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    const name = String(b.name || '').trim().slice(0, 80); const early = Date.parse(b.early_at), pub = Date.parse(b.public_at);
    if (!name || isNaN(early) || isNaN(pub)) return json({ error: 'Name, members time and public time are required.' }, 400);
    if (pub < early) return json({ error: 'The public drop has to come after members early access.' }, 400);
    await env.DB.prepare('INSERT INTO drops (name, early_at, public_at) VALUES (?1, ?2, ?3)').bind(name, new Date(early).toISOString(), new Date(pub).toISOString()).run();
    return json({ ok: true, drop: await currentDrop(env) });
  }
  if (path === '/api/admin/drop' && m === 'DELETE') {
    await env.DB.prepare('DELETE FROM drops WHERE id = (SELECT MAX(id) FROM drops)').run();
    return json({ ok: true });
  }
  if (path === '/api/admin/early-access' && m === 'POST') {
    if (!env.RESEND_API_KEY) return json({ error: 'Email is not connected yet. Export the CSV instead: it has every member\'s personal link.' }, 400);
    const drop = await currentDrop(env); if (!drop) return json({ error: 'Schedule a drop first.' }, 400);
    const b = await request.json().catch(() => ({}));
    const subject = String(b.subject || '').trim(), text = String(b.message || '').trim();
    if (!subject || !text.includes('{link}')) return json({ error: 'Add a subject, and put {link} in the message where each member\'s personal link goes.' }, 400);
    const test = b.test ? normalizeContact(b.test) : null;
    const rows = (await env.DB.prepare(`SELECT MIN(id) AS id, contact FROM subscribers WHERE kind='email' AND unsubscribed_at IS NULL ${test ? 'AND contact = ?1' : ''} GROUP BY contact`).bind(...(test ? [test.contact] : [])).all()).results;
    if (!rows.length) return json({ error: test ? 'Add that address to the list on the site first, then send the test.' : 'No members with an email address yet.' }, 400);
    const msgs = [];
    for (const r of rows) msgs.push(emailFor(env, r.contact, subject, text.replaceAll('{link}', `${site}/?member=${await memberToken(env, r.id)}`), `${site}/api/unsubscribe?t=${await unsubToken(env, r.id)}`));
    const sent = await sendEmails(env, msgs);
    if (!test) await env.DB.prepare('INSERT INTO sends (product, subject, body, recipients) VALUES (?1, ?2, ?3, ?4)').bind('early-access', subject, text, sent).run();
    return json({ ok: true, sent });
  }
  if (path === '/api/admin/dashboard' && m === 'GET') return json(url.searchParams.get('demo') ? await demoDashboard(env, url) : await dashboard(env, url));

  if (path === '/api/admin/discounts') {
    if (!env.STRIPE_SECRET_KEY) return json({ error: 'Discount codes turn on once your Stripe account is connected.' }, 400);
    if (m === 'GET') {
      const d = await stripe(env, 'promotion_codes?limit=50&active=true');
      return json({ codes: d.data.map(c => ({ id: c.id, code: c.code, percent_off: c.coupon?.percent_off, amount_off: c.coupon?.amount_off, times_redeemed: c.times_redeemed, max_redemptions: c.max_redemptions, expires_at: c.expires_at })) });
    }
    if (m === 'POST') {
      const b = await request.json().catch(() => ({}));
      const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 30);
      if (!code) return json({ error: 'Enter a code, letters and numbers only.' }, 400);
      const cf = new URLSearchParams({ duration: 'once', name: code });
      if (b.percent_off) cf.set('percent_off', String(Math.min(100, Math.max(1, +b.percent_off))));
      else if (b.amount_off) { cf.set('amount_off', String(Math.round(+b.amount_off * 100))); cf.set('currency', 'usd'); }
      else return json({ error: 'Enter a percent or a dollar amount off.' }, 400);
      const coupon = await stripe(env, 'coupons', { method: 'POST', form: cf });
      const pf = new URLSearchParams({ coupon: coupon.id, code });
      if (b.max_redemptions) pf.set('max_redemptions', String(parseInt(b.max_redemptions, 10)));
      if (b.expires_at) pf.set('expires_at', String(Math.floor(Date.parse(b.expires_at) / 1000)));
      if (b.first_order) pf.set('restrictions[first_time_transaction]', 'true');
      const pc = await stripe(env, 'promotion_codes', { method: 'POST', form: pf });
      return json({ ok: true, id: pc.id });
    }
    if (m === 'DELETE') {
      const id = url.searchParams.get('id') || '';
      if (!/^promo_[A-Za-z0-9]+$/.test(id)) return json({ error: 'Bad id' }, 400);
      await stripe(env, 'promotion_codes/' + id, { method: 'POST', form: new URLSearchParams({ active: 'false' }) });
      return json({ ok: true });
    }
  }
  return json({ error: 'Not found' }, 404);
}

// ---------- dashboard ----------
function days(n) { const out = []; const d = new Date(); d.setUTCHours(0, 0, 0, 0); for (let i = n - 1; i >= 0; i--) out.push(new Date(d - i * 864e5).toISOString().slice(0, 10)); return out; }
async function dashboard(env, url) {
  const D = days(30);
  await ensureSchema(env);
  const [tot, last30, rev, sign, units, inv, members] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents),0) AS cents, COALESCE(SUM(member),0) AS member_orders FROM orders').first(),
    env.DB.prepare("SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents),0) AS cents FROM orders WHERE created_at >= datetime('now','-30 day')").first(),
    env.DB.prepare("SELECT date(created_at) AS d, SUM(total_cents) AS cents, COUNT(*) AS n FROM orders WHERE created_at >= date('now','-29 day') GROUP BY d").all(),
    env.DB.prepare("SELECT date(first) AS d, COUNT(*) AS n FROM (SELECT contact, MIN(created_at) AS first FROM subscribers GROUP BY contact) WHERE first >= date('now','-29 day') GROUP BY d").all(),
    env.DB.prepare('SELECT product, size, SUM(qty) AS sold, SUM(qty*unit_cents) AS cents FROM order_items GROUP BY product, size').all(),
    env.DB.prepare('SELECT * FROM inventory').all(),
    env.DB.prepare('SELECT COUNT(DISTINCT contact) AS n FROM subscribers WHERE unsubscribed_at IS NULL').first(),
  ]);
  const cat = await catalog(env, url.origin, { all: true });
  const revMap = Object.fromEntries(rev.results.map(r => [r.d, r])), signMap = Object.fromEntries(sign.results.map(r => [r.d, r.n]));
  const stock = {}; for (const i of inv.results) stock[`${i.product}|${i.size}`] = i.stock;
  const byProduct = {};
  for (const u of units.results) {
    const p = (byProduct[u.product] ??= { id: u.product, name: cat.find(c => c.id === u.product)?.name || u.product, sold: 0, cents: 0, left: 0, sizes: {} });
    p.sold += u.sold; p.cents += u.cents; p.sizes[u.size] = { sold: u.sold, left: stock[`${u.product}|${u.size}`] ?? 0 };
  }
  for (const p of Object.values(byProduct)) p.left = Object.values(p.sizes).reduce((s, x) => s + x.left, 0);
  return {
    demo: false,
    totals: { revenue: tot.cents / 100, orders: tot.orders, aov: tot.orders ? tot.cents / 100 / tot.orders : 0, revenue30: last30.cents / 100, orders30: last30.orders, member_share: tot.orders ? tot.member_orders / tot.orders : 0, members: members.n },
    daily: D.map(d => ({ d, revenue: (revMap[d]?.cents || 0) / 100, orders: revMap[d]?.n || 0, signups: signMap[d] || 0 })),
    products: Object.values(byProduct).sort((a, b) => b.cents - a.cents),
  };
}
// clearly-labelled example numbers so the owner can see what the dashboard looks like before the first sale.
// Built from the product table first, so revenue, orders and the chart all add up to the same sales.
async function demoDashboard(env, url) {
  const cat = await catalog(env, url.origin);
  let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const products = cat.slice(0, 5).map((p, i) => {
    const sizes = {}; let sold = 0, left = 0;
    for (const s of p.sizes) { const a = Math.round(rnd() * 5) + (i === 0 ? 4 : 1), b = Math.round(rnd() * 6); sizes[s] = { sold: a, left: b }; sold += a; left += b; }
    return { id: p.id, name: p.name, sold, left, cents: sold * p.price * 100, sizes };
  }).sort((a, b) => b.cents - a.cents);
  const revenue = products.reduce((s, p) => s + p.cents, 0) / 100;
  const orders = Math.round(products.reduce((s, p) => s + p.sold, 0) / 1.4);   // about 1.4 pieces per order
  // split a whole number across days by weight, so the days add up exactly
  const split = (total, wt) => {
    const W = wt.reduce((s, x) => s + x, 0), raw = wt.map(x => total * x / W), out = raw.map(Math.floor);
    let rem = Math.round(total - out.reduce((s, x) => s + x, 0));
    raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).slice(0, rem).forEach(([, i]) => { out[i]++; });
    return out;
  };
  const D = days(30);
  // a quiet month, members' early access on day 21, the public drop on day 22, then a tail
  const wt = D.map((_, i) => i === 22 ? 38 : i === 21 ? 21 : i > 22 ? 1 + rnd() * 6 : rnd() * 2);
  const o = split(orders, wt), r = split(revenue, wt);
  const daily = D.map((d, i) => ({ d, orders: o[i], revenue: r[i], signups: i < 21 ? Math.round(8 + rnd() * 14 + i * 1.2) : Math.round(rnd() * 10) + 4 }));
  return { demo: true, totals: { revenue, orders, aov: revenue / orders, revenue30: revenue, orders30: orders, member_share: 0.38, members: daily.reduce((s, x) => s + x.signups, 0) }, daily, products };
}

// ---------- product editing ----------
const CATEGORIES = ['shorts', 'tees', 'hoodies', 'hats', 'other'];
const CHART_KEYS = ['tee', 'shoe', 'hat', 'none'];
function cleanProduct(b) {
  const str = (v, n) => String(v ?? '').trim().slice(0, n);
  const list = (v, n, each) => (Array.isArray(v) ? v : String(v ?? '').split(/\n|,/)).map(x => str(x, each)).filter(Boolean).slice(0, n);
  const name = str(b.name, 80);
  if (!name) throw bad('Give the product a name.');
  const price = Math.round(Number(b.price) * 100) / 100;
  if (!(price >= 1 && price <= 10000)) throw bad('Enter a price between $1 and $10,000.');
  const sizes = [...new Set(Array.isArray(b.sizes) ? b.sizes.map(x => str(x, 12)).filter(Boolean) : list(b.sizes, 20, 12))].slice(0, 20);
  if (!sizes.length) throw bad('Add at least one size, or "One size".');
  const images = (Array.isArray(b.images) ? b.images : []).map(String).filter(f => !f.includes('..') &&
    (/^\/media\/[a-z0-9-]{8,64}\.(jpg|png|webp)$/.test(f) || /^[a-z0-9][\w-]*(\/[\w.-]+)*\.(jpe?g|png|webp)$/i.test(f))).slice(0, 8);
  if (!images.length) throw bad('Add at least one photo.');
  return {
    hidden: !!b.hidden,
    data: {
      name, price, sizes, images,
      category: CATEGORIES.includes(b.category) ? b.category : 'other',
      color: str(b.color, 40),
      description: str(b.description, 2000),
      details: Array.isArray(b.details) ? b.details.map(x => str(x, 160)).filter(Boolean).slice(0, 12) : String(b.details ?? '').split('\n').map(x => str(x, 160)).filter(Boolean).slice(0, 12),
      sizeChart: CHART_KEYS.includes(b.sizeChart) ? b.sizeChart : 'none',
    },
  };
}
async function media(env, key) {
  await ensureSchema(env);
  const r = await env.DB.prepare('SELECT type, data FROM media WHERE key = ?1').bind(key).first();
  if (!r) return new Response('Not found', { status: 404 });
  let out;   // photos are stored as base64 text in D1; the built-in decoder is much faster than a loop
  if (typeof Uint8Array.fromBase64 === 'function') out = Uint8Array.fromBase64(r.data);
  else { const bin = atob(r.data); out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); }
  return new Response(out, { headers: { 'Content-Type': r.type, 'Cache-Control': 'public, max-age=31536000, immutable' } });
}
// one template (product.html) for every product, filled from the database
async function productPage(env, url, site, id) {
  const p = (await catalog(env, url.origin)).find(x => x.id === id);
  if (!p) return env.ASSETS.fetch(new Request(url.origin + '/__no-such-product__'));
  let tpl = await env.ASSETS.fetch(new Request(url.origin + '/product'));
  if (tpl.status >= 300 && tpl.status < 400 && tpl.headers.get('Location')) tpl = await env.ASSETS.fetch(new Request(new URL(tpl.headers.get('Location'), url.origin)));
  const fill = { __P_ID__: p.id, __P_NAME__: p.name, __P_COLOR__: p.color || '', __P_DESC__: p.description || '', __P_IMAGE__: site + imagePath(p.images?.[0] || '') };
  const html = (await tpl.text()).replace(/__P_[A-Z]+__/g, k => esc(fill[k] ?? ''));
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=30' } });
}

// ---------- sitemap ----------
// the public pages plus one entry per visible (not hidden) product
const SITEMAP_PAGES = ['/', '/shop', '/lookbook', '/about', '/info'];
async function sitemap(env, url, site) {
  const cat = await catalog(env, url.origin);
  const locs = [...SITEMAP_PAGES.map(p => site + p), ...cat.map(p => `${site}/product-${p.id}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locs.map(l => `  <url><loc>${esc(l)}</loc></url>`).join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
