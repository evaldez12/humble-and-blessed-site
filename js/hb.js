// Humble & Blessed design layer on top of the store (js/store.js): product cards, shop filters,
// lookbook and the drop-two countdown, drawn in the H&B look from live store data.
import { initStore, productStatus, productUrl, imgUrl, money, getState, offlineJoin } from './store.js';

export const LOOKS = [
  { img: 'assets/look-1.webp', cap: 'Drop one. Bushwick, September.' },
  { img: 'assets/look-2.webp', cap: 'Rooftop, Mott Haven.' },
  { img: 'assets/look-3.webp', cap: 'Last train, Jay Street.' },
  { img: 'assets/cupid-engraving-ink.webp', cap: 'From the first lookbook, 2020.', eng: true },
];
export const CATS = { shorts: 'Shorts', tees: 'Tees', hoodies: 'Hoodies', hats: 'Caps', other: 'Other' };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// what the small line under each card says
function tag(p) {
  const st = productStatus(p);
  if (st === 'upcoming') return ['Coming soon', 'soon'];
  if (st === 'members') return ['Members first', 'soon'];
  if (st === 'soldout') return ['Sold out', 'soon'];
  if (st === 'preorder') return [`${money(p.price)} · Pre-order`, ''];
  return [money(p.price), ''];
}
export function renderCards(el, products) {
  if (!el) return;
  el.innerHTML = products.map(p => {
    const [label, cls] = tag(p);
    return `
    <a class="card product" data-cat="${esc(p.category)}" href="${productUrl(p)}">
      <div class="ph"><img src="${imgUrl(p.images?.[0])}" alt="${esc(p.name)}" loading="lazy"></div>
      <div class="meta"><span>${esc(p.name)}</span><span class="c${cls ? ' ' + cls : ''}">${esc(label)}</span></div>
    </a>`; }).join('');
}

// shop page: filter buttons for the categories that have products; #shorts etc. in the address picks one
export function shopFilters(bar, grid, products) {
  const cats = ['all', ...Object.keys(CATS).filter(c => products.some(p => p.category === c))];
  let cur = decodeURIComponent(location.hash.slice(1)).toLowerCase();
  if (!cats.includes(cur)) cur = 'all';
  const draw = () => {
    bar.innerHTML = cats.map(c => `<button class="${c === cur ? 'on' : ''}" data-f="${c}">${c === 'all' ? 'All' : CATS[c]}</button>`).join('');
    bar.querySelectorAll('button').forEach(b => b.onclick = () => { cur = b.dataset.f; history.replaceState(null, '', cur === 'all' ? location.pathname : '#' + cur); draw(); });
    renderCards(grid, cur === 'all' ? products : products.filter(p => p.category === cur));
  };
  draw();
  document.addEventListener('store:state', draw);
}

// drop two: big countdown to the next members/public time set in the admin, and the right way to join
export function dropBar(countEl, joinEl, dekEl) {
  const pad = n => String(n).padStart(2, '0');
  let timer;
  const draw = () => {
    const { live, drop, member } = getState();
    clearInterval(timer);
    if (joinEl) joinEl.innerHTML = live
      ? (member ? '<span class="ig">You are on the list</span>' : '<button class="ig" data-notify="">Join the list</button>')
      : offlineJoin('ig');
    if (dekEl) dekEl.textContent = live
      ? 'Join the list and you get a private link to shop it before everyone else.'
      : 'Drop dates go up on Instagram first.';
    if (!countEl) return;
    const target = drop && (drop.phase === 'upcoming' ? drop.early_at : drop.phase === 'early' ? drop.public_at : null);
    if (!drop || drop.phase === 'public') { countEl.innerHTML = `<div class="tba"><b>${drop ? 'Live now' : 'Date to be announced'}</b>${drop ? '<a href="shop.html">Shop the drop</a>' : ''}</div>`; return; }
    const label = drop.phase === 'upcoming' ? (member ? 'Your early access opens in' : 'Members shop first, in') : (member ? 'Members early access is open' : 'Members are shopping. Everyone else in');
    const tick = () => {
      let d = Math.max(0, Date.parse(target) - Date.now()) / 1000;
      const v = [Math.floor(d / 86400), Math.floor(d % 86400 / 3600), Math.floor(d % 3600 / 60), Math.floor(d % 60)];
      countEl.innerHTML = `<p class="when">${esc(drop.name)}. ${label}</p><div class="nums">${v.map((n, i) => `<div><b>${pad(n)}</b><span>${['days', 'hours', 'min', 'sec'][i]}</span></div>`).join('')}</div>`;
      if (d <= 0) { clearInterval(timer); setTimeout(() => document.dispatchEvent(new CustomEvent('store:state')), 1200); }
    };
    tick(); timer = setInterval(tick, 1000);
  };
  draw();
  document.addEventListener('store:state', draw);
}

export { initStore };
