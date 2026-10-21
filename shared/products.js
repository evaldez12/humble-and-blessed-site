/* Placeholder catalogue for the Humble & Blessed prototypes. Prices and copy are stand-ins until Rob confirms. */
const PRODUCTS = [
  { id: 'shorts', name: 'Cherub mesh shorts', price: 65, cat: 'Shorts', img: '../assets/shorts.webp', color: 'Black',
    blurb: 'Heavyweight polyester mesh, soft liner, 5" inseam. Cherub on the right leg, lettering on the left.',
    details: ['100% polyester mesh, 240 gsm, with a soft jersey liner', 'Elastic waist with a flat drawcord', 'Two side pockets', 'Screen-printed in New York'] },
  { id: 'tee', name: 'Praying cherub tee', price: 45, cat: 'Tees', img: '../assets/product-tee.webp', color: 'Black',
    blurb: 'Boxy heavyweight tee with the praying cherub and lettering across the chest.',
    details: ['100% ring-spun cotton, 280 gsm', 'Boxy fit, drop shoulder, ribbed collar', 'Pre-shrunk, garment-washed', 'Screen-printed in New York'] },
  { id: 'hoodie', name: 'Wordmark hoodie', price: 120, cat: 'Hoodies', img: '../assets/product-hoodie.webp', color: 'Black',
    blurb: 'Pullover with the blackletter wordmark across the chest and a small cherub on the sleeve.',
    details: ['80% cotton, 20% polyester fleece, 450 gsm', 'Relaxed fit, double-lined hood, kangaroo pocket', 'Ribbed cuffs and hem', 'Printed in New York'] },
  { id: 'cap', name: 'Cherub cap', price: 40, cat: 'Caps', img: '../assets/product-cap.webp', color: 'Black',
    blurb: 'Unstructured six-panel cap with the cherub embroidered on the front.',
    details: ['100% cotton twill', 'Unstructured crown, curved brim', 'Metal slide buckle', 'Embroidered in New York'] },
];
const SIZES = { shorts: ['S','M','L','XL','XXL'], tee: ['S','M','L','XL','XXL'], hoodie: ['S','M','L','XL','XXL'], cap: ['One size'] };
const LOOKS = [
  { img: '../assets/look-1.webp', cap: 'Drop one. Bushwick, September.' },
  { img: '../assets/look-2.webp', cap: 'Rooftop, Mott Haven.' },
  { img: '../assets/look-3.webp', cap: 'Last train, Jay Street.' },
  { img: '../assets/cupid-engraving-ink.webp', cap: 'From the first lookbook, 2020.', eng: true },
];
const money = n => '$' + n;
const byId = id => PRODUCTS.find(p => p.id === id);
window.HB_DATA = { PRODUCTS, SIZES, LOOKS, money, byId };
