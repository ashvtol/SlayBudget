// Analytics only with consent: nothing from Google loads (no requests, no cookies) until a visitor accepts. The choice
// is remembered; the footer's "Cookie settings" asks again. Used only to improve SlayBudget, never shared or sold.

export const GA_ID = 'G-C5GWC1BX5M';
const KEY = 'sb-consent';

const stored = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const remember = (value) => {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Private browsing: the choice lasts for this page only.
  }
};

/** Google's gtag: queue a command (the library reads the queue once it loads). */
function gtag() {
  window.dataLayer = window.dataLayer || [];
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer.push(arguments);
}

/** Load Google Analytics once, after consent, with Google signals and ad personalization off. */
function loadAnalytics(doc) {
  if (doc.querySelector('script[src*="googletagmanager.com/gtag/js"]')) return;
  gtag('js', new Date());
  gtag('config', GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
  const script = doc.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  doc.head.appendChild(script);
}

function closeBanner(doc) {
  doc.querySelector('[data-consent-banner]')?.remove();
}

function showBanner(doc) {
  if (doc.querySelector('[data-consent-banner]')) return;
  const banner = doc.createElement('div');
  banner.setAttribute('data-consent-banner', '');
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Cookies');
  banner.className = 'consent';
  banner.innerHTML = `
    <p>This site uses analytics cookies to see how it's used, only to improve SlayBudget. They're never shared or sold.
    The app itself collects nothing.</p>
    <div class="consent-actions">
      <button type="button" class="button small ghost" data-consent="decline">Decline</button>
      <button type="button" class="button small" data-consent="accept">Accept</button>
    </div>`;
  banner.querySelector('[data-consent="accept"]').addEventListener('click', () => {
    remember('granted');
    closeBanner(doc);
    loadAnalytics(doc);
  });
  banner.querySelector('[data-consent="decline"]').addEventListener('click', () => {
    remember('denied');
    closeBanner(doc);
  });
  doc.body.appendChild(banner);
}

/** On each page load: load analytics if accepted before, ask if never asked, and wire "Cookie settings". */
export function initConsent(doc = document) {
  const choice = stored();
  if (choice === 'granted') loadAnalytics(doc);
  else if (choice !== 'denied') showBanner(doc);
  for (const el of doc.querySelectorAll('[data-cookie-settings]')) {
    if (el.dataset.wired) continue;
    el.dataset.wired = '1';
    el.addEventListener('click', () => showBanner(doc));
  }
}

/** Count a download click (with the platform), only with consent. */
export function trackDownload(platform) {
  if (stored() !== 'granted') return;
  gtag('event', 'download_click', { platform });
}
