# ADR 0003: Rules match the merchant key; "contains" matches a normalized description

Date: 2026-11-21. Status: accepted.

## Context
Recategorizing with rules (spec `docs/superpowers/specs/2026-11-21-recategorize-rules-design.md`)
saves a rule when the user applies a category to "All named X". Raw descriptions carry store
numbers and punctuation ("WSDOT-GOODTOGO 1234"), so an `equals` rule on the description would
miss most future rows, and a `contains` rule on the merchant key could miss the very row it came from.

## Decision
- New match kind `merchant`: equals the extracted merchant key (`extract_merchant`).
  Migration 0004 rebuilds `rules` to widen the CHECK constraint.
- `contains` compares normalized text: lower-cased, with `-`, `#`, `*` and whitespace runs turned
  into single spaces, on both the description and the pattern.
- `save_or_replace` replaces a rule with the same kind and pattern and gives the new one the
  highest priority, so the newest rule wins.
- Rules stay global (no profile column), like the learned model.

## Consequences
Existing `contains` rules now also match across punctuation, which only widens matches.
