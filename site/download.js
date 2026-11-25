// The download button: works out the visitor's computer from the browser and links the matching installer from the
// latest GitHub release. Anything else (a phone, a Chromebook, or GitHub not answering) gets the releases page.

const REPO = 'ashvtol/SlayBudget';
const RELEASES = `https://github.com/${REPO}/releases/latest`;

/** 'mac', 'windows', 'linux', or 'other' for phones, tablets and Chromebooks, which can't install it. */
export function platformOf(userAgent, hint = '') {
  const ua = userAgent.toLowerCase();
  const h = hint.toLowerCase();
  if (/iphone|ipad|ipod|android|cros|mobile/.test(ua)) return 'other';
  if (h.includes('mac') || ua.includes('macintosh') || ua.includes('mac os x')) return 'mac';
  if (h.includes('win') || ua.includes('windows')) return 'windows';
  if (h.includes('linux') || ua.includes('linux') || ua.includes('x11')) return 'linux';
  return 'other';
}

// What each platform downloads, best first.
const FILES = {
  mac: { label: 'Download for Mac', patterns: [/_universal\.dmg$/, /\.dmg$/] },
  windows: { label: 'Download for Windows', patterns: [/-setup\.exe$/, /\.msi$/] },
  linux: { label: 'Download for Linux', patterns: [/\.AppImage$/, /\.deb$/] },
};

/** The button for a platform: its label, the link and the file name (null when it links the releases page). */
export function pickDownload(platform, assets) {
  const kind = FILES[platform];
  if (!kind) return { label: 'See all downloads', url: RELEASES, file: null };
  for (const pattern of kind.patterns) {
    const hit = assets.find((a) => pattern.test(a.name));
    if (hit) return { label: kind.label, url: hit.browser_download_url, file: hit.name };
  }
  return { label: kind.label, url: RELEASES, file: null };
}

/** Wire every [data-download] button on the page. */
export async function wireDownloads(doc = document, nav = navigator) {
  const platform = platformOf(nav.userAgent, nav.userAgentData?.platform ?? '');
  let assets = [];
  let version = '';
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (res.ok) {
      const release = await res.json();
      assets = release.assets ?? [];
      version = release.tag_name ?? '';
    }
  } catch {
    // Offline or rate-limited: the buttons keep linking the releases page.
  }
  const pick = pickDownload(platform, assets);
  for (const el of doc.querySelectorAll('[data-download]')) {
    el.setAttribute('href', pick.url);
    const label = el.querySelector('[data-download-label]');
    if (label) label.textContent = pick.label;
  }
  for (const el of doc.querySelectorAll('[data-version]')) el.textContent = version ? `${version} · free` : 'Free';
  doc.documentElement.dataset.platform = platform;
}
