import { describe, expect, it } from 'vitest';
import { pickDownload, platformOf } from './download.js';

const asset = (name: string) => ({ name, browser_download_url: `https://github.com/ashvtol/SlayBudget/releases/download/v0.10.1/${name}` });
const ASSETS = [
  'latest.json', 'SlayBudget_0.10.1_amd64.AppImage', 'SlayBudget_0.10.1_amd64.AppImage.sig', 'SlayBudget_0.10.1_amd64.deb',
  'SlayBudget_0.10.1_universal.dmg', 'SlayBudget_0.10.1_x64-setup.exe', 'SlayBudget_0.10.1_x64-setup.exe.sig',
  'SlayBudget_0.10.1_x64_en-US.msi', 'SlayBudget_universal.app.tar.gz',
].map(asset);

describe('platformOf', () => {
  it('reads the platform from the browser, preferring the modern hint', () => {
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15')).toBe('mac');
    expect(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0')).toBe('windows');
    expect(platformOf('Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0')).toBe('linux');
    expect(platformOf('anything', 'macOS')).toBe('mac');
    expect(platformOf('anything', 'Windows')).toBe('windows');
  });

  it('treats phones and tablets as not able to install it', () => {
    expect(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148')).toBe('other');
    expect(platformOf('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBe('other');
    expect(platformOf('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile')).toBe('other');
    expect(platformOf('Mozilla/5.0 (X11; CrOS x86_64 16002.0.0) Chrome/130.0')).toBe('other');
  });
});

describe('pickDownload', () => {
  it('picks the Mac disk image, the Windows installer and the Linux AppImage', () => {
    expect(pickDownload('mac', ASSETS)).toMatchObject({ label: 'Download for Mac', file: 'SlayBudget_0.10.1_universal.dmg' });
    expect(pickDownload('windows', ASSETS)).toMatchObject({ label: 'Download for Windows', file: 'SlayBudget_0.10.1_x64-setup.exe' });
    expect(pickDownload('linux', ASSETS)).toMatchObject({ label: 'Download for Linux', file: 'SlayBudget_0.10.1_amd64.AppImage' });
    expect(pickDownload('mac', ASSETS).url).toBe(ASSETS[4].browser_download_url);
  });

  it('falls back to the releases page when there is no file for the platform or the list could not load', () => {
    const releases = 'https://github.com/ashvtol/SlayBudget/releases/latest';
    expect(pickDownload('other', ASSETS)).toMatchObject({ label: 'See all downloads', url: releases, file: null });
    expect(pickDownload('windows', [])).toMatchObject({ label: 'Download for Windows', url: releases, file: null });
    expect(pickDownload('linux', [asset('SlayBudget_0.10.1_amd64.deb')])).toMatchObject({ file: 'SlayBudget_0.10.1_amd64.deb' });
  });
});
