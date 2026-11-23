-- Charges that may be a bill at a new price (asked once each), and each bill's price history.
CREATE TABLE price_checks (
    id           INTEGER PRIMARY KEY,
    tx_id        INTEGER NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
    recurring_id INTEGER NOT NULL REFERENCES recurrings(id) ON DELETE CASCADE,
    old_cents    INTEGER NOT NULL,
    new_cents    INTEGER NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    answered_at  TEXT,
    answer       TEXT CHECK (answer IN ('new_price', 'one_off', 'separate'))
);
CREATE TABLE recurring_prices (
    id           INTEGER PRIMARY KEY,
    recurring_id INTEGER NOT NULL REFERENCES recurrings(id) ON DELETE CASCADE,
    changed_on   TEXT NOT NULL,
    from_cents   INTEGER NOT NULL,
    to_cents     INTEGER NOT NULL
);
CREATE INDEX idx_recurring_prices_bill ON recurring_prices(recurring_id, changed_on);
-- Pairs of bills you said are not the same subscription (never suggested for merging again).
CREATE TABLE recurring_apart (
    a INTEGER NOT NULL REFERENCES recurrings(id) ON DELETE CASCADE,
    b INTEGER NOT NULL REFERENCES recurrings(id) ON DELETE CASCADE,
    PRIMARY KEY (a, b)
);
