import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A text field with no box of its own (a search row, an inline rename) shows its caret, not a focus ring: the ring
// drew a hard grey rectangle with a white inner line around a field that has no edges (very visible in Graphite).
const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const css = read('app/styles.css').replace(/\s+/g, ' ');

describe('bare text fields', () => {
  it('are left out of the text-field focus ring (by the rule itself, so a more specific rule cannot bring it back)', () => {
    const ring = css.match(/([^}]*)\{ outline: none; box-shadow: var\(--focus-ring\), inset 0 0 0 0\.5px var\(--accent\); \}/)?.[1] ?? '';
    expect(ring).toContain('input:');
    expect(ring).toContain(':not(.field-bare)');
  });

  it.each([
    ['features/transactions/filter-bar.tsx', 'Search transactions'],
    ['features/search/search-palette.tsx', 'Search query'],
    ['features/settings/tags-pane.tsx', 'Tag name'],
    ['features/categories/category-form.tsx', 'Category name'],
    ['features/categories/category-form.tsx', 'aria-label="Budget"'],
  ])('%s marks its bare field (%s)', (file, marker) => {
    const src = read(file);
    const at = src.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    // The <input …> around the marker carries field-bare.
    const start = src.lastIndexOf('<input', at);
    const end = src.indexOf('/>', at);
    expect(src.slice(start, end)).toContain('field-bare');
  });
});
