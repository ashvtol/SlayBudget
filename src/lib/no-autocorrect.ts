// macOS autocorrect runs in the app's web view: typing "sh" in the category search showed an "Sh ×" bubble, and the
// first click only dismissed it, so choosing a category took two clicks. SlayBudget's inputs are names, amounts and
// searches, never prose, so autocorrect, auto-capitalization, spellcheck and autofill are off on every text input as
// soon as it's added to the page (before it can be focused). Textareas (notes) keep them; an input can opt back in
// with data-autocorrect="on".

const TEXT_TYPES = new Set(['', 'text', 'search', 'number', 'email', 'url', 'tel']);

function quiet(input: HTMLInputElement) {
  if (input.dataset.autocorrect === 'on' || !TEXT_TYPES.has((input.getAttribute('type') ?? '').toLowerCase())) return;
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');
  if (!input.hasAttribute('autocomplete')) input.setAttribute('autocomplete', 'off');
}

function quietAll(node: Node) {
  if (node instanceof HTMLInputElement) quiet(node);
  if (node instanceof Element) node.querySelectorAll('input').forEach(quiet);
}

/** Start watching the document; returns a function that stops. */
export function installNoAutocorrect(doc: Document): () => void {
  quietAll(doc.body);
  const observer = new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach(quietAll);
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
