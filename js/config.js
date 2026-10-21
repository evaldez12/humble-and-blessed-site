// Humble & Blessed — site configuration. Fill these in when the accounts exist.
// Everything works without them (cart stays local, alerts are saved in the browser).
export const CONFIG = {
  // Backend: the Cloudflare Worker in worker/index.js, same origin as the site. On hosts without the
  // Worker (GitHub Pages mirror, previews) these calls fail quietly and the fallbacks apply.
  WAITLIST_API: '/api/subscribe',
  CHECKOUT_ENDPOINT: '/api/checkout',
  SITE_URL: 'https://humble-and-blessed.bizallies.workers.dev',
  TIMEZONE: 'America/New_York',          // drop times are shown in this zone

  // Optional: Klaviyo alongside the built-in waitlist (leave empty to skip).
  KLAVIYO_COMPANY_ID: '',
  KLAVIYO_LIST_ID: '',

  // Fallback only: drops are scheduled in the admin (/admin → Drop). Used on hosts without the backend.
  NEXT_DROP: '',
  NEXT_DROP_NAME: '',

  // Instagram wall: create a feed at behold.so and paste its feed ID.
  BEHOLD_FEED_ID: '',

  // Ad tracking. Empty = off. When any is set, visitors get a cookie banner and pixels load only after they accept.
  META_PIXEL_ID: '',
  TIKTOK_PIXEL_ID: '',
  GA4_ID: '',

  // Plausible analytics domain, e.g. 'brand.com'. Empty = none.
  PLAUSIBLE_DOMAIN: '',

  STORY_VIDEO: '',
  INSTAGRAM_URL: 'https://instagram.com/humblenblessed',
  CONTACT_EMAIL: 'hello@humblenblessed.com',

  // Humble & Blessed design hooks
  SHOP_URL: 'shop.html',                      // where "Back to shop" links go
  UPCOMING_LABEL: 'Coming soon',              // badge for pieces set to "In this drop" before the drop opens
  HIDE_UPCOMING_PRICE: true,                  // no price on coming-soon pieces
  CUSTOM_COUNTDOWN: true,                     // js/hb.js draws the drop-two countdown in #countdown
  // shown instead of signup buttons where the store backend isn't running (the GitHub Pages copy)
  OFFLINE_JOIN_URL: 'https://instagram.com/humblenblessed',
  OFFLINE_JOIN_LABEL: 'Follow @humblenblessed for drop dates',
};
