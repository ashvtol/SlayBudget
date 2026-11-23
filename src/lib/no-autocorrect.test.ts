import { afterEach, describe, expect, it } from 'vitest';
import { installNoAutocorrect } from './no-autocorrect';

// macOS autocorrect in the app's web view puts a bubble under a field ("sh" -> "Sh"); the first click then only
// dismisses it, so picking a category took two clicks. Fields here are names, amounts and searches, not prose.
const OFF = { autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', autocomplete: 'off' };
const attrs = (el: Element) => Object.fromEntries(Object.keys(OFF).map((k) => [k, el.getAttribute(k)]));
const tick = () => new Promise((r) => setTimeout(r, 0));

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  document.body.innerHTML = '';
});

describe('installNoAutocorrect', () => {
  it('turns autocorrect off on text inputs already there and added later, before they can be focused', async () => {
    document.body.innerHTML = '<input id="a"><input id="b" type="search">';
    stop = installNoAutocorrect(document);
    expect(attrs(document.getElementById('a')!)).toEqual(OFF);
    const later = document.createElement('div');
    later.innerHTML = '<label><input id="c" type="text"></label><input id="d" type="number">';
    document.body.append(later);
    await tick();
    expect(attrs(document.getElementById('b')!)).toEqual(OFF);
    expect(attrs(document.getElementById('c')!)).toEqual(OFF);
    expect(attrs(document.getElementById('d')!)).toEqual(OFF);
  });

  it('leaves prose (textareas), checkboxes and fields that opt back in alone', async () => {
    stop = installNoAutocorrect(document);
    document.body.innerHTML = '<textarea id="notes"></textarea><input id="cb" type="checkbox"><input id="keep" data-autocorrect="on">';
    await tick();
    for (const id of ['notes', 'cb', 'keep']) expect(document.getElementById(id)!.getAttribute('autocorrect')).toBeNull();
  });
});
