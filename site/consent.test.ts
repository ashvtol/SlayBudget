import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GTM_ID, initConsent, trackDownload } from './consent.js';

const gtmScripts = () => [...document.querySelectorAll('script[src*="googletagmanager.com/gtm.js"]')];
const banner = () => document.querySelector('[data-consent-banner]') as HTMLElement | null;

beforeEach(() => {
  document.body.innerHTML = '<footer><button type="button" data-cookie-settings>Cookie settings</button></footer>';
  for (const s of gtmScripts()) s.remove();
  localStorage.clear();
  delete (window as unknown as { dataLayer?: unknown[] }).dataLayer;
});
afterEach(() => localStorage.clear());

describe('cookie consent', () => {
  it('asks first and loads nothing from Google until you accept', () => {
    initConsent();
    expect(banner()).not.toBeNull();
    expect(banner()!.textContent).toMatch(/only to improve SlayBudget/);
    expect(banner()!.textContent).toMatch(/never shared or sold/);
    expect(gtmScripts()).toHaveLength(0);
  });

  it('accepting loads Tag Manager once, remembers it, and closes the banner', () => {
    initConsent();
    (banner()!.querySelector('[data-consent="accept"]') as HTMLButtonElement).click();
    expect(gtmScripts()).toHaveLength(1);
    expect(gtmScripts()[0].getAttribute('src')).toContain(`id=${GTM_ID}`);
    expect(localStorage.getItem('sb-consent')).toBe('granted');
    expect(banner()).toBeNull();
    initConsent(); // the next visit
    expect(gtmScripts()).toHaveLength(1);
    expect(banner()).toBeNull();
  });

  it('declining loads nothing, remembers it, and Cookie settings asks again', () => {
    initConsent();
    (banner()!.querySelector('[data-consent="decline"]') as HTMLButtonElement).click();
    expect(gtmScripts()).toHaveLength(0);
    expect(localStorage.getItem('sb-consent')).toBe('denied');
    initConsent();
    expect(banner()).toBeNull();
    (document.querySelector('[data-cookie-settings]') as HTMLButtonElement).click();
    expect(banner()).not.toBeNull();
  });

  it('a download click is counted only with consent', () => {
    trackDownload('mac');
    expect((window as unknown as { dataLayer?: unknown[] }).dataLayer ?? []).toHaveLength(0);
    localStorage.setItem('sb-consent', 'granted');
    trackDownload('mac');
    expect((window as unknown as { dataLayer: Record<string, unknown>[] }).dataLayer.at(-1)).toMatchObject({ event: 'download_click', platform: 'mac' });
  });
});
