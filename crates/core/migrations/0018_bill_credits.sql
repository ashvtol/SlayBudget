-- A bill can match other names (its statement name changed over time) and be paid back by credits
-- (a card's statement credit for a subscription). Both are newline-separated lists of names.
-- credit_names: NULL = never decided, '' = not paid back (a suggestion was declined).
ALTER TABLE recurrings ADD COLUMN also_names TEXT NOT NULL DEFAULT '';
ALTER TABLE recurrings ADD COLUMN credit_names TEXT;
