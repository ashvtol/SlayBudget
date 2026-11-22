-- SlayBudget schema, version 1.
-- Money is stored as integer minor units (cents). Dates are ISO-8601 text.

CREATE TABLE profiles (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    color       TEXT NOT NULL DEFAULT '#5b8cff',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A source is where transactions come from: a statement folder, a bank connection, manual entry.
CREATE TABLE sources (
    id           INTEGER PRIMARY KEY,
    profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('csv', 'pdf', 'ofx', 'bank', 'manual')),
    institution  TEXT,
    currency     TEXT NOT NULL DEFAULT 'USD',
    color        TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (profile_id, name)
);

CREATE TABLE category_groups (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    emoji       TEXT,
    color       TEXT NOT NULL DEFAULT '#8e8e93',
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE categories (
    id           INTEGER PRIMARY KEY,
    group_id     INTEGER NOT NULL REFERENCES category_groups(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    emoji        TEXT,
    color        TEXT,
    budget_cents INTEGER,
    excluded     INTEGER NOT NULL DEFAULT 0,
    kind         TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense', 'income', 'transfer')),
    sort_order   INTEGER NOT NULL DEFAULT 0,
    archived     INTEGER NOT NULL DEFAULT 0,
    legacy_name  TEXT UNIQUE,            -- Financial-Tracker name, e.g. 'Transportation - Fuel'
    UNIQUE (group_id, name)
);

CREATE TABLE transactions (
    id             INTEGER PRIMARY KEY,
    profile_id     INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    source_id      INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    posted_on      TEXT NOT NULL,
    description    TEXT NOT NULL,
    merchant       TEXT NOT NULL,
    amount_cents   INTEGER NOT NULL,        -- negative = money out, positive = money in
    currency       TEXT NOT NULL DEFAULT 'USD',
    category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    category_locked INTEGER NOT NULL DEFAULT 0,
    reviewed       INTEGER NOT NULL DEFAULT 0,
    notes          TEXT,
    refund_of      INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
    parent_id      INTEGER REFERENCES transactions(id) ON DELETE CASCADE,  -- for splits
    dedupe_hash    TEXT NOT NULL UNIQUE,
    import_id      INTEGER,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_transactions_profile_date ON transactions(profile_id, posted_on);
CREATE INDEX idx_transactions_category ON transactions(category_id);
CREATE INDEX idx_transactions_merchant ON transactions(merchant);

CREATE TABLE tags (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE
);
CREATE TABLE transaction_tags (
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    tag_id         INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (transaction_id, tag_id)
);

-- Learned merchant -> category mapping (the old "AI model").
CREATE TABLE merchant_rules (
    id           INTEGER PRIMARY KEY,
    merchant     TEXT NOT NULL,
    category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    profile_id   INTEGER REFERENCES profiles(id) ON DELETE CASCADE,   -- NULL = all profiles
    hits         INTEGER NOT NULL DEFAULT 1,
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- NULL profile_id means global; coalesce so global rules are unique too.
CREATE UNIQUE INDEX idx_merchant_rules_key ON merchant_rules(merchant, coalesce(profile_id, 0));

-- Explicit user rules, applied before the learned model.
CREATE TABLE rules (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    match_kind    TEXT NOT NULL CHECK (match_kind IN ('contains', 'starts_with', 'equals', 'regex')),
    pattern       TEXT NOT NULL,
    min_cents     INTEGER,
    max_cents     INTEGER,
    source_id     INTEGER REFERENCES sources(id) ON DELETE CASCADE,
    category_id   INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    priority      INTEGER NOT NULL DEFAULT 0,
    enabled       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE imports (
    id            INTEGER PRIMARY KEY,
    source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    file_name     TEXT NOT NULL,
    file_hash     TEXT NOT NULL,
    imported_rows INTEGER NOT NULL DEFAULT 0,
    skipped_rows  INTEGER NOT NULL DEFAULT 0,
    imported_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (source_id, file_hash)
);

CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
