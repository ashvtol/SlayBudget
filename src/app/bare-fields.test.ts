import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A text field with no box of its own (a search row, an inline rename) shows its caret, not a focus ring: the ring
// drew a hard grey rectangle with a white inner line around a field that has no edges (very visible in Graphite).
const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const css = read('app/styles.css').replace(/\s+/g, ' ');

describe('bare text fields', () => {
  it('no text field draws a focus ring: the caret shows where you are typing', () => {
    const rule = css.match(/input:not\(\[type="checkbox"\]\)[^{]*textarea:focus-visible \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('outline: none');
    expect(rule).not.toContain('--focus-ring');
    expect(rule).not.toContain('box-shadow: var');
  });

  it('dropdowns draw no focus ring either (clicking one counts as keyboard focus in the app window)', () => {
    const rule = css.match(/\.popup:focus-visible \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('outline: none');
    expect(rule).not.toContain('--focus-ring');
  });

  it('draw no outline of their own either (the browser default would replace the ring)', () => {
    expect(css).toMatch(/\.field-bare:focus(-visible)? \{ outline: none; \}/);
  });

  it.each([
    ['features/transactions/filter-bar.tsx', 'Search transactions'],
    ['features/search/search-palette.tsx', 'Search query'],
    ['features/settings/tags-pane.tsx', 'Tag name'],
    ['features/categories/category-form.tsx', 'Category name'],
    ['features/categories/category-form.tsx', 'aria-label="Budget"'],
    // Search and pick fields that open focused inside a menu: the caret is enough.
    ['components/category-menu.tsx', 'Search categories'],
    ['features/transactions/filter-menu.tsx', 'placeholder="Search..."'],
    ['features/transactions/filter-menu.tsx', 'aria-label="Keyword"'],
    ['features/transactions/tag-picker.tsx', 'aria-label="Add tags"'],
    ['features/categories/emoji-picker.tsx', 'Or paste any emoji'],
    ['features/recurrings/recurring-form.tsx', 'Search a name, e.g. Netflix'],
    ['features/search/search-page.tsx', 'aria-label="Search query"'],
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
