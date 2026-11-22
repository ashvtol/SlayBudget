import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A Mac window never scrolls as a whole: only panes scroll. The page frame is locked in CSS.
const css = readFileSync(resolve(__dirname, 'styles.css'), 'utf8').replace(/\s+/g, ' ');

describe('page frame', () => {
  it('never lets the whole window scroll or bounce', () => {
    const rule = css.match(/html, body, #root \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/height: 100%/);
    expect(rule).toMatch(/overflow: hidden/);
    expect(rule).toMatch(/overscroll-behavior: none/);
  });
});
