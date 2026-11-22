import { describe, expect, it } from 'vitest';
import { applyPlatform } from './platform';

describe('applyPlatform', () => {
  it('turns on vibrancy styling only in the Mac app', () => {
    const el = document.createElement('html');
    applyPlatform(el, { tauri: true, mac: true });
    expect(el.dataset.vibrancy).toBe('on');
  });

  it('leaves the browser build and other platforms opaque', () => {
    for (const env of [{ tauri: false, mac: true }, { tauri: true, mac: false }]) {
      const el = document.createElement('html');
      applyPlatform(el, env);
      expect(el.dataset.vibrancy).toBeUndefined();
    }
  });
});
