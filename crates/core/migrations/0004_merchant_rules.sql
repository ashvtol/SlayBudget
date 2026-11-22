-- Rules can match the extracted merchant key ("merchant"), so exact-name rules survive
-- descriptions that carry store numbers. SQLite cannot alter a CHECK, so rebuild the table.
CREATE TABLE rules_new (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    match_kind    TEXT NOT NULL CHECK (match_kind IN ('contains', 'starts_with', 'equals', 'regex', 'merchant')),
    pattern       TEXT NOT NULL,
    min_cents     INTEGER,
    max_cents     INTEGER,
    source_id     INTEGER REFERENCES sources(id) ON DELETE CASCADE,
    category_id   INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    priority      INTEGER NOT NULL DEFAULT 0,
    enabled       INTEGER NOT NULL DEFAULT 1
);
INSERT INTO rules_new SELECT id, name, match_kind, pattern, min_cents, max_cents, source_id, category_id, priority, enabled FROM rules;
DROP TABLE rules;
ALTER TABLE rules_new RENAME TO rules;
