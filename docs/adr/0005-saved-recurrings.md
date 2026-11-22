# ADR 0005: Saved recurrings with rules; detection only seeds and suggests

Date: 2026-11-21. Status: accepted.

## Context
Recurring bills were detected on every read (`analytics::recurring::detect`), so nothing could be
edited, paused or archived (spec `docs/superpowers/specs/2026-11-21-managing-recurrings-design.md`).

## Decision
- Table `recurrings` (name, category, match kind merchant|contains, pattern, amount range, frequency,
  optional day of month, status active|paused|archived). Migration 0007.
- `transactions.recurring_id` links a charge to its bill; `recurring_optout` marks "Not recurring"
  rows that rules must never claim again. A charge belongs to at most one bill.
- Rules claim Regular, top-level charges only; editing a bill re-matches past charges.
- On the first open after this change, detected bills are saved once (setting `recurrings_seeded`);
  afterwards detection only lists Suggestions (detected series not covered by a saved bill or
  dismissed in `recurring_dismissals`).
- The Recurrings screen keeps its view shape (`analytics::recurring::Recurring`), now built from
  saved bills and their linked charges, with the rule in `saved`.

## Consequences
New imports are linked by `recurrings::match_new`; a payment to a paused bill reactivates it.
Deleting a bill unlinks its charges and leaves them otherwise unchanged.
