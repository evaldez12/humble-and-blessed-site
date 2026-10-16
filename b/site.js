(() => {
/* Option B shared behaviour: header, footer, menu, cart drawer, product cards, countdown, fog, motto. */
const { PRODUCTS, SIZES, LOOKS, money, byId } = window.HB_DATA;

const page = document.body.dataset.page || '';
const KEY = 'hb-cart-b';
const cart = { items: JSON.parse(localStorage.getItem(KEY) || '[]') };
const save = () => localStorage.setItem(KEY, JSON.stringify(cart.items));
const count = () => cart.items.reduce((n, i) => n + i.qty, 0);

document.body.insertAdjacentHTML('afterbegin', `
<header class="hdr">
  <button class="burger" aria-label="Open menu"></button>
  <a class="logo" href="index.html" aria-label="Humble & Blessed home"><img class="mono" src="../assets/monogram-hb-traced-white.svg" alt="H&B"></a>
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
  <footer><div class="total"><span>Total</span><b class="sum">$0</b></div><button class="btn wide solid checkout">Check out</button></footer>
</aside>`);

document.body.insertAdjacentHTML('beforeend', `
<footer class="ftr"><div class="wrap">
  <div class="cols">
    <div><img class="mono" src="../assets/monogram-hb-traced-white.svg" alt="H&B monogram"><div class="logo">Humble&amp;Blessed</div><p style="margin-top:10px;max-width:28ch">Always be humble to stay blessed. Made in small runs in New York since 2020.</p></div>
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

function cards(el, list = PRODUCTS){
  el.innerHTML = list.map(p => `
    <a class="card" href="product.html?id=${p.id}">
      <div class="ph"><img src="${p.img}" alt="${p.name}" loading="lazy"></div>
      <div class="meta"><span>${p.name}</span><span class="c">${money(p.price)}</span></div>
    </a>`).join('');
}

function countdown(el, when){
  const parts = ['days','hours','min','sec'];
  function tick(){
    let d = Math.max(0, when - Date.now()) / 1000;
    const v = [Math.floor(d/86400), Math.floor(d%86400/3600), Math.floor(d%3600/60), Math.floor(d%60)];
    el.innerHTML = v.map((n,i) => `<div><b>${String(n).padStart(2,'0')}</b><span>${parts[i]}</span></div>`).join('');
  }
  tick(); setInterval(tick, 1000);
}

/* home: motto lines light up as they pass the middle of the screen; stage follows scroll */
function motto(stage){
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function onScroll(){
    const p = Math.min(1, Math.max(0, scrollY / innerHeight));
    if (!reduce) stage.style.setProperty('--p', p.toFixed(3));
    const mid = innerHeight * .55;
    document.querySelectorAll('.motto .line').forEach(l => l.classList.toggle('lit', l.getBoundingClientRect().top < mid));
    return p;
  }
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  setTimeout(() => document.body.classList.remove('loading'), 2600);
}

/* home: dust motes drifting up through the light shaft */
function dust(c){
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; if (reduce) return;
  const ctx = c.getContext('2d'); let W, H, P = [];
  function size(){ W = c.width = innerWidth; H = c.height = innerHeight; P = Array.from({length: Math.round(W / 9)}, mk); }
  function mk(){ return { x: Math.random()*W, y: Math.random()*H, r: .6 + Math.random()*1.6, v: .08 + Math.random()*.25, s: Math.random()*6.28, w: .2 + Math.random()*.5, a: Math.random() }; }
  addEventListener('resize', size); size();
  (function frame(t){
    ctx.clearRect(0, 0, W, H);
    for (const p of P){
      p.y -= p.v; p.x += Math.sin(t/1400 + p.s) * .15; if (p.y < -4) { p.y = H + 4; p.x = Math.random()*W; }
      const cx = W*.5 + (p.y - H*.5) * .14;                 // the shaft leans like the CSS one
      const near = Math.max(0, 1 - Math.abs(p.x - cx) / (W*.22));
      const tw = .55 + .45*Math.sin(t/900 + p.a*9);
      ctx.globalAlpha = (0.08 + near*.55) * tw;
      ctx.fillStyle = '#ffe6b4'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill();
    }
    requestAnimationFrame(frame);
  })(0);
}

/* home: pointer parallax, eased, written to --mx/--my on the stage */
function parallax(stage){
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let tx = 0, ty = 0, cx = 0, cy = 0;
  addEventListener('pointermove', e => { tx = (e.clientX/innerWidth - .5)*2; ty = (e.clientY/innerHeight - .5)*2; }, { passive: true });
  (function tick(){ cx += (tx-cx)*.05; cy += (ty-cy)*.05; stage.style.setProperty('--mx', cx.toFixed(3)); stage.style.setProperty('--my', cy.toFixed(3)); document.documentElement.style.setProperty('--mx', cx.toFixed(3)); document.documentElement.style.setProperty('--my', cy.toFixed(3)); requestAnimationFrame(tick); })();
}

/* home: WebGL fog, value-noise fbm drifting slowly with a warm shaft near the centre */
function fog(c){
  const gl = c.getContext('webgl', { antialias: false });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!gl || reduce) { c.style.background = 'radial-gradient(50% 40% at 50% 30%,#2A2622,#000)'; return; }
  const vs = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
  const fs = `precision mediump float;uniform vec2 r;uniform float t;
  float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
  float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
  void main(){vec2 uv=gl_FragCoord.xy/r;vec2 p=uv*vec2(r.x/r.y,1.)*2.2;
    float f=fbm(p+vec2(t*.05,t*.02));f=fbm(p+f*1.4+vec2(-t*.03,t*.015));
    float ground=smoothstep(.95,.1,uv.y);float d=f*ground*.75;
    vec3 col=mix(vec3(0.),vec3(.16,.14,.12),d);
    float shaft=exp(-pow((uv.x-.5+(uv.y-.5)*.12)*6.,2.))*(1.-uv.y)*.12;
    col+=vec3(.8,.66,.38)*shaft*(.6+f*.8);gl_FragColor=vec4(col,1.);}`;
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr); gl.useProgram(pr);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const ur = gl.getUniformLocation(pr, 'r'), ut = gl.getUniformLocation(pr, 't');
  function size(){ const s = Math.min(devicePixelRatio, 1.5) * .6; c.width = innerWidth * s; c.height = innerHeight * s; gl.viewport(0, 0, c.width, c.height); }
  addEventListener('resize', size); size();
  const t0 = performance.now();
  (function frame(){ gl.uniform2f(ur, c.width, c.height); gl.uniform1f(ut, (performance.now() - t0) / 1000); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); requestAnimationFrame(frame); })();
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
window.HB = { openCart, closeCart, render, sync, addToCart, cards, countdown, motto, dust, parallax, fog, polish, bump, PRODUCTS, SIZES, LOOKS, money, byId };
})();
