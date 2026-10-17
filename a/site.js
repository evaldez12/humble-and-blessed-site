(() => {
/* Option A shared behaviour: header, footer, menu, cart drawer, product cards, countdown. */
const { PRODUCTS, SIZES, LOOKS, money, byId } = window.HB_DATA;

const page = document.body.dataset.page || '';
const KEY = 'hb-cart-a';
const cart = { items: JSON.parse(localStorage.getItem(KEY) || '[]') };
const save = () => localStorage.setItem(KEY, JSON.stringify(cart.items));
const count = () => cart.items.reduce((n, i) => n + i.qty, 0);

/* ---------- chrome ---------- */
document.body.insertAdjacentHTML('afterbegin', `
<header class="hdr">
  <button class="burger" aria-label="Open menu"></button>
  <a class="logo" href="index.html" aria-label="Humble & Blessed home"><img class="mono" src="../assets/monogram-hb-header.svg" alt="H&B"></a>
  <nav><a href="shop.html" ${page==='shop'?'class="on"':''}>Shop</a><a href="lookbook.html" ${page==='lookbook'?'class="on"':''}>Lookbook</a><a href="about.html" ${page==='about'?'class="on"':''}>About</a></nav>
  <div class="right"><button class="cart-btn">Cart (<span class="cart-n">${count()}</span>)</button></div>
</header>
<div class="menu" role="dialog" aria-label="Menu">
  <button class="close">Close</button>
  <a href="index.html">Home</a><a href="shop.html">Shop</a><a href="lookbook.html">Lookbook</a><a href="about.html">About</a>
</div>
<div class="scrim"></div>
<aside class="drawer" aria-label="Cart">
  <header><h2>Your cart</h2><button class="close">Close</button></header>
  <div class="items"></div>
  <footer><div class="total"><span>Total</span><b class="sum">$0</b></div><button class="btn wide checkout">Check out</button></footer>
</aside>`);

document.body.insertAdjacentHTML('beforeend', `
<footer class="ftr"><div class="wrap">
  <div class="cols">
    <div><img class="mono" src="../assets/monogram-hb-footer.svg" alt="H&B monogram"><div class="logo">Humble&amp;Blessed</div><p style="margin-top:10px;max-width:28ch">Always Be Humble To Stay Blessed. Made in small runs in New York since 2020.</p></div>
    <div><h4>Shop</h4><a href="shop.html">All</a><a href="shop.html#Shorts">Shorts</a><a href="shop.html#Tees">Tees</a><a href="shop.html#Hoodies">Hoodies</a></div>
    <div><h4>Brand</h4><a href="lookbook.html">Lookbook</a><a href="about.html">About</a><a href="https://instagram.com/humblenblessed">Instagram</a></div>
    <div><h4>Help</h4><a href="#">Shipping</a><a href="#">Returns</a><a href="#">Size guide</a><a href="mailto:hello@humblenblessed.com">Contact</a></div>
  </div>
  <div class="base"><span>Humble &amp; Blessed, New York</span><span>Founder <a href="https://instagram.com/exclusive.roger">@exclusive.roger</a></span></div>
</div></footer>`);

const $ = s => document.querySelector(s);
const menu = $('.menu'), drawer = $('.drawer'), scrim = $('.scrim');
$('.burger').onclick = () => menu.classList.add('open');
menu.querySelector('.close').onclick = () => menu.classList.remove('open');
function openCart(){ drawer.classList.add('open'); scrim.classList.add('on'); render(); }
function closeCart(){ drawer.classList.remove('open'); scrim.classList.remove('on'); }
$('.cart-btn').onclick = openCart; drawer.querySelector('.close').onclick = closeCart; scrim.onclick = closeCart;
addEventListener('keydown', e => { if (e.key === 'Escape') { closeCart(); menu.classList.remove('open'); } });
$('.checkout').onclick = () => { drawer.querySelector('.items').insertAdjacentHTML('afterbegin', '<p class="empty">Checkout connects to the store (Shopify) in the live build.</p>'); };

function render(){
  const box = drawer.querySelector('.items');
  if (!cart.items.length) { box.innerHTML = '<p class="empty">Nothing here yet.</p>'; }
  else box.innerHTML = cart.items.map((i, k) => { const p = byId(i.id); return `
    <div class="item"><img src="${p.img}" alt=""><div><div class="n">${p.name}</div><div class="s">${i.size} · ${i.qty} × ${money(p.price)}</div></div>
    <button class="rm" data-k="${k}">Remove</button></div>`; }).join('');
  box.querySelectorAll('.rm').forEach(b => b.onclick = () => { cart.items.splice(+b.dataset.k, 1); save(); sync(); render(); });
  drawer.querySelector('.sum').textContent = money(cart.items.reduce((s, i) => s + byId(i.id).price * i.qty, 0));
}
function sync(){ document.querySelectorAll('.cart-n').forEach(n => n.textContent = count()); }

function addToCart(id, size){
  const f = cart.items.find(i => i.id === id && i.size === size);
  if (f) f.qty++; else cart.items.push({ id, size, qty: 1 });
  save(); sync(); bump(); openCart();
}

/* ---------- product cards ---------- */
function cards(el, list = PRODUCTS){
  el.innerHTML = list.map(p => `
    <a class="card" href="product.html?id=${p.id}">
      <div class="ph"><img src="${p.img}" alt="${p.name}" loading="lazy"></div>
      <div class="meta"><span>${p.name}</span><span class="c">${money(p.price)}</span></div>
    </a>`).join('');
}

/* ---------- countdown to the next drop ---------- */
function countdown(el, when){
  const parts = ['days','hours','min','sec'];
  function tick(){
    let d = Math.max(0, when - Date.now()) / 1000;
    const v = [Math.floor(d/86400), Math.floor(d%86400/3600), Math.floor(d%3600/60), Math.floor(d%60)];
    el.innerHTML = v.map((n,i) => `<div><b>${String(n).padStart(2,'0')}</b><span>${parts[i]}</span></div>`).join('');
  }
  tick(); setInterval(tick, 1000);
}

/* ---------- hero wordmark fit + parallax (home only) ---------- */
function hero(){
  const h = $('.hero'); if (!h) return;
  const wm = h.querySelector('.wordmark');
  function fit(){ wm.style.fontSize='100px'; const w = wm.getBoundingClientRect().width; wm.style.fontSize=''; h.style.setProperty('--wm', Math.min(100*(innerWidth*.94)/w, innerHeight*.36)+'px'); }
  document.fonts.ready.then(fit); addEventListener('resize', fit); fit();
  setTimeout(() => h.classList.remove('loading'), 2600);
}

/* ---------- finish: reveals, image parallax, cart bump, page transitions ---------- */
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function polish(){
  if (reduceMotion) return;
  /* reveal once, staggered within a parent, as things enter the screen */
  const targets = document.querySelectorAll('.section-head, .card, .look, .story > *, .drop2 .wrap > *, .drop2 > .wrap > *, .pdp > *, .about-cols > *, .timeline li, .founder, .page-head > *, .about > *, .strip');
  targets.forEach(el => el.classList.add('rv'));
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) {
    const kids = [...e.target.parentElement.children].filter(k => k.classList.contains('rv'));
    e.target.style.transitionDelay = (kids.indexOf(e.target) % 6) * 70 + 'ms';
    e.target.classList.add('in'); io.unobserve(e.target);
  } }), { rootMargin: '0px 0px -8% 0px', threshold: .08 });
  targets.forEach(el => io.observe(el));
  /* lookbook images drift inside their frames as you scroll */
  const looks = document.querySelectorAll('.look img');
  if (looks.length) {
    const upd = () => looks.forEach(img => { const r = img.getBoundingClientRect(); const p = (r.top + r.height/2 - innerHeight/2) / innerHeight; img.style.transform = `scale(1.12) translateY(${(-p * 6).toFixed(2)}%)`; });
    addEventListener('scroll', upd, { passive: true }); upd();
  }
}
function bump(){ document.querySelectorAll('.cart-btn').forEach(b => { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }); }

polish();
window.HB = { openCart, closeCart, render, sync, addToCart, cards, countdown, hero, polish, bump, PRODUCTS, SIZES, LOOKS, money, byId };
})();
