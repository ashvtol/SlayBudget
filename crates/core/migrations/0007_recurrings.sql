-- Saved recurring bills (Copilot): rules that claim matching transactions.
CREATE TABLE recurrings (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    match_kind    TEXT NOT NULL CHECK (match_kind IN ('merchant', 'contains')),
    pattern       TEXT NOT NULL,
    min_cents     INTEGER NOT NULL,
    max_cents     INTEGER NOT NULL,
    frequency     TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
    day_of_month  INTEGER,
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
ALTER TABLE transactions ADD COLUMN recurring_id INTEGER REFERENCES recurrings(id) ON DELETE SET NULL;
-- "Not recurring": the user unlinked this row; rules never claim it again.
ALTER TABLE transactions ADD COLUMN recurring_optout INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_transactions_recurring ON transactions(recurring_id);
-- Detected series the user dismissed from Suggestions.
CREATE TABLE recurring_dismissals (merchant TEXT PRIMARY KEY);
