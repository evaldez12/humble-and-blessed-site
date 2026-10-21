// Humble & Blessed — store runtime: product grid, drop state, members early access, stock, pre-orders,
// cart drawer, restock alerts, countdown, ad tracking, mobile menu. Shared by every page.
import { CONFIG } from './config.js';

export const SIZE_CHARTS = {
  tee: { title: 'Tees (inches, laid flat)', head: ['Size', 'Chest', 'Length', 'Shoulder'],
    rows: [['S', '22', '27.5', '22'], ['M', '23', '28.5', '23'], ['L', '24', '29.5', '24'], ['XL', '25', '30.5', '25'], ['XXL', '26', '31.5', '26']],
    note: 'Boxy fit. Size down for a regular fit. Sample measurements, replace with the factory spec sheet.' },
  shoe: { title: 'Sneakers (US men\'s)', head: ['US', 'EU', 'UK', 'CM'],
    rows: [['7', '40', '6', '25'], ['8', '41', '7', '26'], ['9', '42', '8', '27'], ['10', '43', '9', '28'], ['11', '44', '10', '29'], ['12', '45', '11', '30'], ['13', '46', '12', '31']],
    note: 'True to size. Half sizes go up.' },
  hat: { title: 'Hats', head: ['Size', 'Fits'], rows: [['One size', 'Adjustable snapback, 22 to 24 in']], note: '' },
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const money = n => '$' + Number(n).toFixed(n % 1 ? 2 : 0);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
const fmtDate = iso => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: CONFIG.TIMEZONE || 'America/New_York', timeZoneName: 'short' });

let PRODUCTS = [];
export async function loadProducts() {
  if (PRODUCTS.length) return PRODUCTS;
  // live catalog from the admin; products.json is the fallback for static hosts and offline previews
  try {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 4000);
    const r = await fetch('/api/products', { signal: ctl.signal });
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) PRODUCTS = await r.json();
  } catch {}
  if (!PRODUCTS.length) PRODUCTS = await (await fetch('products.json')).json();
  return PRODUCTS;
}
export const productById = id => PRODUCTS.find(p => p.id === id);
// with the Worker every product has its own page; on a static mirror (no backend) the template reads ?id=
export const productUrl = p => STATE.live ? `product-${p.id}` : `product.html?id=${encodeURIComponent(p.id)}`;
// uploads from the admin are /media/<key>.jpg; the original photos are files in assets/products/
export const imgUrl = f => /^(\/|https?:)/.test(f || '') ? f : `assets/products/${f}`;

/* ---------------- live state: drop window, stock, pre-orders, membership ---------------- */
let STATE = { drop: null, products: {} };
let MEMBER = { token: store.get('hb-member'), eligible: store.get('hb-member-ok') === '1' };
async function loadState() {
  try {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 4000);
    const r = await fetch('/api/state', { signal: ctl.signal });
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) { STATE = await r.json(); STATE.live = true; }
  } catch {}
  // offline / static hosts: fall back to products.json
  for (const p of PRODUCTS) STATE.products[p.id] ??= { status: p.status || (p.soldOut ? 'archive' : 'live'), preorder: false, ship_note: '', stock: null };
  if (STATE.drop) STATE.drop.phase = phaseOf(STATE.drop);
}
function phaseOf(d) { const t = Date.now(); return t < Date.parse(d.early_at) ? 'upcoming' : t < Date.parse(d.public_at) ? 'early' : 'public'; }
async function claimMemberLink() {
  const url = new URL(location.href); const t = url.searchParams.get('member');
  if (!t) return;
  url.searchParams.delete('member'); history.replaceState(null, '', url.pathname + url.search + url.hash);
  try {
    const r = await fetch('/api/member?t=' + encodeURIComponent(t));
    const d = await r.json();
    if (d.ok) { MEMBER = { token: t, eligible: !!d.eligible }; store.set('hb-member', t); store.set('hb-member-ok', d.eligible ? '1' : '0'); toast(d.eligible ? "You're in. Members early access unlocked on this device." : "You're on the list. Early access starts with the next drop."); }
    else toast('That member link is not valid anymore.');
  } catch {}
}
const isMember = () => !!(MEMBER.token && MEMBER.eligible);
// read-only view of the live state for custom designs (drop bar, badges)
export const getState = () => ({ live: !!STATE.live, drop: STATE.drop ? { ...STATE.drop, phase: phaseOf(STATE.drop) } : null, member: isMember() });
const SHOP = () => CONFIG.SHOP_URL || 'index.html#shop';
// without the backend there is no list to join: point people to the brand's Instagram instead (if set)
const offline = () => !STATE.live && !!CONFIG.OFFLINE_JOIN_URL;
export const offlineJoin = (cls = 'btn wide') => `<a class="${cls}" href="${esc(CONFIG.OFFLINE_JOIN_URL)}" target="_blank" rel="noopener">${esc(CONFIG.OFFLINE_JOIN_LABEL || 'Follow for drop dates')}</a>`;

// one product's status for display: soldout | upcoming | members | available | preorder
export function productStatus(p) {
  const ps = STATE.products[p.id] || {}; const phase = STATE.drop?.phase;
  if (ps.status === 'archive') return 'soldout';
  if (ps.status === 'drop' && (!phase || phase === 'upcoming')) return 'upcoming';
  if (ps.status === 'drop' && phase === 'early' && !isMember()) return 'members';
  if (ps.preorder) return 'preorder';
  if (ps.stock && p.sizes.every(s => (ps.stock[s] ?? 0) <= 0)) return 'soldout';
  return 'available';
}
export function sizeOpen(p, size) {
  const ps = STATE.products[p.id] || {};
  return ps.preorder || !ps.stock || (ps.stock[size] ?? 0) > 0;
}
const stockLeft = (p, size) => STATE.products[p.id]?.stock?.[size];

/* ---------------- product grid ---------------- */
const BADGE = { soldout: ['Sold out', 'out'], upcoming: [CONFIG.UPCOMING_LABEL || 'Dropping soon', ''], members: ['Members first', ''], preorder: ['Pre-order', ''], available: ['', ''] };
export function renderGrid(container, products) {
  container.innerHTML = products.map(p => {
    const st = productStatus(p); const [label, cls] = BADGE[st];
    const gone = st === 'soldout';
    const btn = st === 'available' || st === 'preorder'
      ? `<a class="mini solid" href="${productUrl(p)}">${st === 'preorder' ? 'Pre-order' : 'Shop'}</a>`
      : `<button class="mini" data-notify="${st === 'members' || st === 'upcoming' ? '' : p.id}">${st === 'soldout' ? 'Notify me' : 'Get access'}</button>`;
    return `
    <article class="product rv in" data-cat="${p.category}">
      ${label ? `<span class="tagp ${cls}">${label}</span>` : ''}
      <a class="media" data-tilt href="${productUrl(p)}" aria-label="${esc(p.name)}">
        <img src="${imgUrl(p.images[0])}" alt="${esc(p.name)}" loading="lazy">
        ${p.images[1] ? `<img class="alt" src="${imgUrl(p.images[1])}" alt="" loading="lazy">` : ''}
      </a>
      <div class="info">
        <div><b><a href="${productUrl(p)}">${esc(p.name)}</a></b><small>${esc(p.color)}</small></div>
        <div class="right"><span class="price${gone ? ' gone' : ''}">${money(p.price)}</span>${btn}</div>
      </div>
    </article>`; }).join('');
  tilt(container);
}
export function bindFilters(bar, container) {
  $$('button', bar).forEach(b => b.addEventListener('click', () => {
    $$('button', bar).forEach(x => x.classList.toggle('on', x === b));
    $$('.product', container).forEach(p => { p.style.display = (b.dataset.f === 'all' || p.dataset.cat === b.dataset.f) ? '' : 'none'; });
  }));
}
export function tilt(root = document) {
  $$('[data-tilt]', root).forEach(el => {
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `rotateY(${x * 14}deg) rotateX(${-y * 14}deg) scale(1.02)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
}

/* ---------------- product page ---------------- */
const chartHtml = c => `<div class="tablewrap"><table class="chart"><thead><tr>${c.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${c.rows.map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${c.note ? `<p class="dim" style="font-size:13px">${esc(c.note)}</p>` : ''}`;
// fills the shared product.html template: photos, text, details, size guide, then sizes and buttons
export function renderProductPage(id) {
  const p = productById(id);
  if (!p) { const w = $('main.pdp .wrap'); if (w) w.innerHTML = `<p class="crumbs pixel"><a href="${SHOP()}">Back to shop</a></p><h1>This piece isn\'t available.</h1>`; return; }
  document.title = `${p.name} — Humble & Blessed`;
  $('#pdp-crumb').textContent = p.name; $('#pdp-name').textContent = p.name;
  $('#pdp-color').textContent = p.color || ''; $('#pdp-desc').textContent = p.description || '';
  const g = $('#pdp-gallery'), key = (p.images || []).join('|');
  if (g.dataset.key !== key) { g.dataset.key = key; g.innerHTML = (p.images || []).map(f => `<img src="${imgUrl(f)}" alt="${esc(p.name)}">`).join(''); }
  const det = p.details || [];
  $('#pdp-details').innerHTML = det.map(d => `<li>${esc(d)}</li>`).join(''); $('#pdp-details-box').hidden = !det.length;
  const chart = SIZE_CHARTS[p.sizeChart];
  $('#pdp-chart-box').hidden = !chart; if (chart) $('#pdp-chart').innerHTML = chartHtml(chart);
  renderPdp(id);
}
export function renderPdp(id) {
  const p = productById(id); if (!p) return;
  const st = productStatus(p); const ps = STATE.products[p.id] || {};
  const sizes = $('#sizes'), cta = $('#cta'), priceEl = $('#pdp-price');
  let chosen = null;
  sizes.innerHTML = p.sizes.map(s => {
    const open = sizeOpen(p, s) && st !== 'soldout';
    const left = stockLeft(p, s);
    return `<button type="button" data-size="${esc(s)}" ${open ? '' : 'disabled class="out"'} title="${open ? (left != null && left > 0 && left <= 3 && !ps.preorder ? `Only ${left} left` : '') : 'Sold out'}">${esc(s)}</button>`;
  }).join('');
  const first = $('button:not([disabled])', sizes); if (first) { first.classList.add('on'); chosen = first.dataset.size; }
  const low = () => { const l = stockLeft(p, chosen); return chosen && !ps.preorder && l != null && l > 0 && l <= 3 ? `<p class="pixel low">Only ${l} left in ${esc(chosen)}</p>` : ''; };
  const draw = () => {
    if (st === 'soldout') {
      priceEl.className = 'price gone'; priceEl.innerHTML = `${money(p.price)}<span class="flag">Sold out</span>`;
      cta.innerHTML = `${offline() ? offlineJoin('btn solid wide') : `<button class="btn solid wide" data-notify="${p.id}">Notify me when it's back</button>`}<a class="btn wide" href="${SHOP()}">Back to shop</a>`;
    } else if (st === 'upcoming') {
      const soon = CONFIG.UPCOMING_LABEL || 'Dropping soon';
      priceEl.className = 'price'; priceEl.innerHTML = CONFIG.HIDE_UPCOMING_PRICE ? `<span class="flag soon">${esc(soon)}</span>` : `${money(p.price)}<span class="flag soon">${esc(soon)}</span>`;
      const when = STATE.drop ? `<p class="pixel note">Members shop ${fmtDate(STATE.drop.early_at)}. Public ${fmtDate(STATE.drop.public_at)}.</p>` : '';
      cta.innerHTML = offline() ? offlineJoin('btn solid wide') : `<button class="btn solid wide" data-notify="">Get early access</button>${when}`;
    } else if (st === 'members') {
      priceEl.className = 'price'; priceEl.innerHTML = `${money(p.price)}<span class="flag soon">Members only right now</span>`;
      cta.innerHTML = `<button class="btn solid wide" data-notify="">Join for the next drop</button><p class="pixel note">Public access opens ${fmtDate(STATE.drop.public_at)}. Members: use the link in your email or text.</p>`;
    } else {
      priceEl.className = 'price'; priceEl.innerHTML = money(p.price) + (st === 'preorder' ? '<span class="flag soon">Pre-order</span>' : '');
      cta.innerHTML = `<button class="btn solid wide" data-add="${p.id}" data-size="${esc(chosen || '')}" ${chosen ? '' : 'disabled'}>${st === 'preorder' ? 'Pre-order' : 'Add to cart'}</button>${st === 'preorder' && ps.ship_note ? `<p class="pixel note">${esc(ps.ship_note)}</p>` : ''}${low()}`;
    }
  };
  sizes.onclick = e => {
    const b = e.target.closest('button:not([disabled])'); if (!b) return;
    $$('button', sizes).forEach(x => x.classList.toggle('on', x === b)); chosen = b.dataset.size; draw();
  };
  draw();
  track('ViewContent', { content_ids: [p.id], content_name: p.name, content_type: 'product', value: p.price, currency: 'USD' });
}

/* ---------------- cart ---------------- */
const CART_KEY = 'hb-cart';
const readCart = () => { try { return JSON.parse(store.get(CART_KEY) || '[]'); } catch { return []; } };
const writeCart = c => { store.set(CART_KEY, JSON.stringify(c)); updateCartCount(); };
export const cartCount = () => readCart().reduce((n, l) => n + l.qty, 0);
function updateCartCount() { $$('[data-cart-count]').forEach(el => { el.textContent = `${el.dataset.cartLabel || 'CART'} (${cartCount()})`; }); }

export function addToCart(id, size, qty = 1) {
  const p = productById(id); if (!p) return false;
  const st = productStatus(p);
  if (!(st === 'available' || st === 'preorder') || !sizeOpen(p, size)) { toast('That size is not available right now.'); return false; }
  const cart = readCart();
  const line = cart.find(l => l.id === id && l.size === size);
  const left = stockLeft(p, size); const want = (line?.qty || 0) + qty;
  if (st !== 'preorder' && left != null && want > left) { toast(`Only ${left} left in ${size}.`); return false; }
  line ? line.qty = want : cart.push({ id, size, qty });
  writeCart(cart); openCart();
  track('AddToCart', { content_ids: [id], content_type: 'product', value: p.price * qty, currency: 'USD' });
  return true;
}
export function clearCart() { writeCart([]); }
function removeLine(i) { const c = readCart(); c.splice(i, 1); writeCart(c); renderCart(); }

function cartMarkup() {
  return `
  <div class="drawer-back" data-close-cart></div>
  <aside class="drawer" id="cart" aria-label="Cart">
    <header><span class="pixel">Your cart</span><button class="x" data-close-cart aria-label="Close">×</button></header>
    <div class="lines" id="cart-lines"></div>
    <footer>
      <div class="total"><span>Subtotal</span><b id="cart-total">$0</b></div>
      <button class="btn solid wide" id="cart-checkout">Checkout</button>
      <p class="pixel" id="cart-note"></p>
    </footer>
  </aside>
  <div class="drawer-back" data-close-notify></div>
  <aside class="drawer" id="notify" aria-label="Restock alert">
    <header><span class="pixel" id="notify-kicker">Restock alert</span><button class="x" data-close-notify aria-label="Close">×</button></header>
    <div class="lines">
      <p id="notify-title" class="big"></p>
      <p class="dim" id="notify-dek">Drop your email or number. One message when it's back, nothing else.</p>
      <form id="notify-form">
        <input id="notify-contact" type="text" inputmode="email" placeholder="Email or phone" required autocomplete="email">
        <select id="notify-size" aria-label="Size"></select>
        <button class="btn solid wide" type="submit">Notify me</button>
      </form>
      <p class="pixel" id="notify-msg"></p>
    </div>
  </aside>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>`;
}
export function openCart() { renderCart(); document.body.classList.add('cart-open'); }
export function closeCart() { document.body.classList.remove('cart-open'); }
function renderCart() {
  const cart = readCart(), box = $('#cart-lines');
  if (!box) return;
  if (!cart.length) { box.innerHTML = '<p class="dim">Nothing in here yet.</p>'; $('#cart-total').textContent = '$0'; }
  else {
    box.innerHTML = cart.map((l, i) => { const p = productById(l.id); if (!p) return ''; const ps = STATE.products[p.id] || {}; return `
      <div class="line">
        <img src="${imgUrl(p.images[0])}" alt="">
        <div><b>${esc(p.name)}</b><small>${esc(l.size)} · ×${l.qty}${ps.preorder ? ` · Pre-order${ps.ship_note ? ', ' + esc(ps.ship_note) : ''}` : ''}</small></div>
        <span>${money(p.price * l.qty)}</span>
        <button class="x" data-remove="${i}" aria-label="Remove">×</button>
      </div>`; }).join('');
    $('#cart-total').textContent = money(cart.reduce((s, l) => s + (productById(l.id)?.price || 0) * l.qty, 0));
    $$('[data-remove]', box).forEach(b => b.addEventListener('click', () => removeLine(+b.dataset.remove)));
  }
  $('#cart-note').textContent = isMember() && STATE.drop?.phase === 'early' ? 'Members early access. Secure checkout by Stripe.' : 'Secure checkout by Stripe. Shipping and tax calculated at checkout.';
}
async function checkout() {
  const cart = readCart(); if (!cart.length) return;
  const note = $('#cart-note'), btn = $('#cart-checkout');
  if (!CONFIG.CHECKOUT_ENDPOINT || !STATE.live) { note.textContent = 'Checkout is not connected yet.'; return; }
  btn.disabled = true; note.textContent = 'Opening secure checkout…';
  const value = cart.reduce((s, l) => s + (productById(l.id)?.price || 0) * l.qty, 0);
  track('InitiateCheckout', { content_ids: cart.map(l => l.id), num_items: cartCount(), value, currency: 'USD' });
  try {
    const r = await fetch(CONFIG.CHECKOUT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: cart.map(l => ({ id: l.id, size: l.size, qty: l.qty })), member: MEMBER.token || null }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.url) throw new Error(data.error || 'Checkout is unavailable right now.');
    location.href = data.url;
  } catch (err) { note.textContent = err.message; btn.disabled = false; }
}

/* ---------------- restock / early-access alerts ---------------- */
export function openNotify(id) {
  const p = id ? productById(id) : null;
  const drop = STATE.drop && STATE.drop.phase !== 'public' ? STATE.drop : null;
  $('#notify-kicker').textContent = p ? 'Restock alert' : 'Members list';
  $('#notify-title').textContent = p ? `${p.name} · ${p.color}` : (drop ? `${drop.name}: early access` : 'Next drop');
  $('#notify-dek').textContent = p ? "Drop your email or number. One message when it's back, nothing else." : 'Members get a private link to shop before the public drop. Drops and restocks only, nothing else.';
  const sel = $('#notify-size');
  sel.innerHTML = p ? `<option value="">Any size</option>` + p.sizes.map(s => `<option>${esc(s)}</option>`).join('') : '<option value="">Any</option>';
  sel.style.display = p ? '' : 'none';
  $('#notify-form').dataset.product = id || '';
  $('#notify-msg').textContent = '';
  document.body.classList.add('notify-open');
  setTimeout(() => $('#notify-contact').focus(), 50);
}
function closeNotify() { document.body.classList.remove('notify-open'); }

export async function subscribe(contact, props = {}) {
  const isEmail = /\S+@\S+\.\S+/.test(contact);
  const phone = contact.replace(/[^\d+]/g, '');
  if (!isEmail && phone.replace(/\D/g, '').length < 10) throw new Error('Enter a valid email or phone number.');
  const event_id = 'lead-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  try { const list = JSON.parse(store.get('hb-alerts') || '[]'); list.push({ contact, ...props, at: new Date().toISOString() }); store.set('hb-alerts', JSON.stringify(list)); } catch {}
  let saved = 'local';
  if (CONFIG.WAITLIST_API) {
    try {
      const r = await fetch(CONFIG.WAITLIST_API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact, product: props.restock_product || 'next-drop', size: props.restock_size || 'any', source: location.pathname, event_id }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) saved = 'waitlist';
      else if (r.status === 400 && d.error) throw new Error(d.error);
    } catch (e) { if (e.message && !/fetch|network|JSON|abort/i.test(e.message)) throw e; }
  }
  if (CONFIG.KLAVIYO_COMPANY_ID && CONFIG.KLAVIYO_LIST_ID) {
    const attrs = isEmail ? { email: contact } : { phone_number: phone.startsWith('+') ? phone : '+1' + phone.replace(/\D/g, '') };
    const body = { data: { type: 'subscription', attributes: { custom_source: 'Website restock alert', profile: { data: { type: 'profile', attributes: { ...attrs, properties: props } } } }, relationships: { list: { data: { type: 'list', id: CONFIG.KLAVIYO_LIST_ID } } } } };
    const r = await fetch(`https://a.klaviyo.com/client/subscriptions/?company_id=${CONFIG.KLAVIYO_COMPANY_ID}`, { method: 'POST', headers: { 'Content-Type': 'application/json', revision: '2024-10-15' }, body: JSON.stringify(body) }).catch(() => null);
    if (r && (r.ok || r.status === 202)) saved = saved === 'local' ? 'klaviyo' : saved;
  }
  track('Lead', { content_name: props.restock_product || 'next-drop' }, event_id);
  return { saved };
}
function bindNotifyForm() {
  $('#notify-form').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#notify-msg'), contact = $('#notify-contact').value.trim();
    const product = e.target.dataset.product, size = $('#notify-size').value;
    try {
      const res = await subscribe(contact, { restock_product: product || 'next-drop', restock_size: size || 'any' });
      msg.textContent = res.saved === 'local' ? 'Saved on this device only (waitlist backend not reachable here).' : (product ? "You're on the list." : "You're in. Watch for your private link before the drop.");
      $('#notify-contact').value = '';
    } catch (err) { msg.textContent = err.message; }
  });
}

/* ---------------- countdown + members bar ---------------- */
const pad = n => String(n).padStart(2, '0');
const until = t => { let d = Math.max(0, t - Date.now()); const days = Math.floor(d / 864e5); d -= days * 864e5; const h = Math.floor(d / 36e5); d -= h * 36e5; const m = Math.floor(d / 6e4); d -= m * 6e4; return `${days}d ${pad(h)}:${pad(m)}:${pad(Math.floor(d / 1e3))}`; };
export function countdown(el) {
  if (!el) return;
  const drop = STATE.drop || (CONFIG.NEXT_DROP ? { name: CONFIG.NEXT_DROP_NAME, early_at: CONFIG.NEXT_DROP, public_at: CONFIG.NEXT_DROP } : null);
  if (!drop) { el.innerHTML = `<span class="pixel">Next drop</span><b>Date TBA</b><button class="mini" data-notify="">Get early access</button>`; return; }
  const name = drop.name ? esc(drop.name) + ' · ' : '';
  const tick = () => {
    const ph = phaseOf(drop);
    if (ph === 'upcoming') el.innerHTML = `<span class="pixel">${name}${isMember() ? 'Your early access in' : 'Members shop in'}</span><b class="num">${until(Date.parse(drop.early_at))}</b>${isMember() ? '<span class="pixel">Member</span>' : '<button class="mini" data-notify="">Get early access</button>'}`;
    else if (ph === 'early') el.innerHTML = `<span class="pixel">${name}${isMember() ? 'Members early access is open' : 'Members are shopping. Public in'}</span><b class="num">${isMember() ? 'Shop now' : until(Date.parse(drop.public_at))}</b>${isMember() ? '<a class="mini" href="${SHOP()}">Shop</a>' : '<button class="mini" data-notify="">Join for next time</button>'}`;
    else el.innerHTML = `<span class="pixel">${name}</span><b>Live now</b><a class="mini" href="${SHOP()}">Shop</a>`;
    if (STATE.drop && STATE.drop.phase !== ph) { STATE.drop.phase = ph; document.dispatchEvent(new CustomEvent('store:state')); }
  };
  tick(); setInterval(tick, 1000);
}

/* ---------------- ad tracking (Meta, TikTok, Google) behind a consent banner ---------------- */
const hasPixels = () => !!(CONFIG.META_PIXEL_ID || CONFIG.TIKTOK_PIXEL_ID || CONFIG.GA4_ID);
let pixelsOn = false;
function loadPixels() {
  if (pixelsOn || !hasPixels()) return; pixelsOn = true;
  if (CONFIG.META_PIXEL_ID) {
    !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', CONFIG.META_PIXEL_ID); fbq('track', 'PageView');
  }
  if (CONFIG.TIKTOK_PIXEL_ID) {
    !function (w, d, t) { w.TiktokAnalyticsObject = t; const ttq = w[t] = w[t] || []; ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie']; ttq.setAndDefer = (o, m) => { o[m] = function () { o.push([m].concat([].slice.call(arguments, 0))); }; }; for (const m of ttq.methods) ttq.setAndDefer(ttq, m); ttq.load = function (e) { const s = d.createElement('script'); s.async = true; s.src = 'https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=' + e + '&lib=' + t; d.head.appendChild(s); }; ttq.load(CONFIG.TIKTOK_PIXEL_ID); ttq.page(); }(window, document, 'ttq');
  }
  if (CONFIG.GA4_ID) {
    const s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(CONFIG.GA4_ID); document.head.appendChild(s);
    window.dataLayer = window.dataLayer || []; window.gtag = function () { dataLayer.push(arguments); }; gtag('js', new Date()); gtag('config', CONFIG.GA4_ID);
  }
  for (const [n, d, id] of QUEUE.splice(0)) fire(n, d, id);
}
const QUEUE = [];
const TT = { ViewContent: 'ViewContent', AddToCart: 'AddToCart', InitiateCheckout: 'InitiateCheckout', Purchase: 'CompletePayment', Lead: 'SubmitForm' };
const GA = { ViewContent: 'view_item', AddToCart: 'add_to_cart', InitiateCheckout: 'begin_checkout', Purchase: 'purchase', Lead: 'generate_lead' };
function fire(name, data = {}, eventId) {
  if (window.fbq) fbq('track', name, data, eventId ? { eventID: eventId } : undefined);
  if (window.ttq) ttq.track(TT[name] || name, { value: data.value, currency: data.currency, contents: (data.content_ids || []).map(id => ({ content_id: id })) }, eventId ? { event_id: eventId } : undefined);
  if (window.gtag) gtag('event', GA[name] || name, { value: data.value, currency: data.currency, transaction_id: name === 'Purchase' ? eventId : undefined });
}
export function track(name, data, eventId) {
  if (!hasPixels()) return;
  pixelsOn ? fire(name, data, eventId) : QUEUE.push([name, data, eventId]);
}
function consent() {
  if (!hasPixels()) return;
  const c = store.get('hb-consent');
  if (c === 'yes') return loadPixels();
  if (c === 'no') return;
  document.body.insertAdjacentHTML('beforeend', `<div class="consent" id="consent" role="dialog" aria-label="Cookies"><p>We use cookies to measure our ads and improve the site. <a href="info.html#privacy">Privacy</a></p><div><button class="mini" data-c="no">Decline</button><button class="mini solid" data-c="yes">Accept</button></div></div>`);
  $('#consent').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; store.set('hb-consent', b.dataset.c); $('#consent').remove(); if (b.dataset.c === 'yes') loadPixels(); });
}

/* ---------------- misc ---------------- */
export function supportsWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
export function toast(text) {
  const t = $('#toast'); if (!t) return;
  t.textContent = text; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 4200);
}
function analytics() {
  if (!CONFIG.PLAUSIBLE_DOMAIN) return;
  const s = document.createElement('script'); s.defer = true; s.dataset.domain = CONFIG.PLAUSIBLE_DOMAIN;
  s.src = 'https://plausible.io/js/script.js'; document.head.appendChild(s);
}
function instagramWall() {
  const el = $('#igwall'); if (!el || !CONFIG.BEHOLD_FEED_ID) return;
  el.innerHTML = `<div data-behold-id="${esc(CONFIG.BEHOLD_FEED_ID)}"></div>`;
  const s = document.createElement('script'); s.src = 'https://w.behold.so/widget.js'; s.type = 'module'; document.head.appendChild(s);
}
function mobileMenu() {
  const nav = $('.nav'), burger = $('.burger'); if (!nav || !burger) return;
  burger.addEventListener('click', () => nav.classList.toggle('open'));
  $$('.nav ul a').forEach(a => a.addEventListener('click', () => nav.classList.remove('open')));
}

/* ---------------- boot ---------------- */
export async function initStore() {
  await loadProducts();
  document.body.insertAdjacentHTML('beforeend', cartMarkup());
  await Promise.all([loadState(), claimMemberLink()]);
  updateCartCount();
  $$('[data-cart-count]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); openCart(); }));
  $$('[data-close-cart]').forEach(el => el.addEventListener('click', closeCart));
  $$('[data-close-notify]').forEach(el => el.addEventListener('click', closeNotify));
  $('#cart-checkout').addEventListener('click', checkout);
  bindNotifyForm();
  document.addEventListener('click', e => {
    const n = e.target.closest('[data-notify]'); if (n) { e.preventDefault(); openNotify(n.dataset.notify); return; }
    const a = e.target.closest('[data-add]'); if (a && !a.disabled) { e.preventDefault(); addToCart(a.dataset.add, a.dataset.size || productById(a.dataset.add)?.sizes?.[0] || ''); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeCart(); closeNotify(); } });
  mobileMenu(); analytics(); instagramWall(); consent();
  // keep the address bar clean: section links (#story, #shop) scroll the page but never stick to the URL,
  // so a copied link always opens at the top
  const clean = () => { if (location.hash && location.hash !== '#cart') history.replaceState(null, '', location.pathname + location.search); };
  addEventListener('hashchange', () => setTimeout(clean, 900));
  if (location.hash) setTimeout(clean, 1500);
  if (!CONFIG.CUSTOM_COUNTDOWN) countdown($('#countdown'));   // a design can draw its own drop bar (getState)
  return PRODUCTS;
}
