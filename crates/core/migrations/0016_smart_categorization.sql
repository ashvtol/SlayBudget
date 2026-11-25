-- Where each category came from, so automatic changes never touch one you chose; a suggestion to check; the other
-- side of a transfer between your own accounts; and the learning classifier's counts.
ALTER TABLE transactions ADD COLUMN category_source TEXT NOT NULL DEFAULT 'keyword';
ALTER TABLE transactions ADD COLUMN category_reason TEXT;
ALTER TABLE transactions ADD COLUMN suggested_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE transactions ADD COLUMN suggested_reason TEXT;
ALTER TABLE transactions ADD COLUMN transfer_pair_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL;
-- The true source of older rows is unknown: the ones you reviewed count as yours.
UPDATE transactions SET category_source = 'user' WHERE reviewed = 1;
CREATE INDEX transactions_suggested ON transactions(suggested_category_id) WHERE suggested_category_id IS NOT NULL;

CREATE TABLE model_counts (
    feature TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    weight REAL NOT NULL,
    PRIMARY KEY (feature, category_id)
);
CREATE TABLE model_totals (
    category_id INTEGER PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
    docs REAL NOT NULL,
    tokens REAL NOT NULL
);
