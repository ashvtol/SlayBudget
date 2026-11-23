-- What each account is recognized by (remembered when you confirm which account a statement belongs to), and the
-- account's type and default tag.
ALTER TABLE sources ADD COLUMN account_type TEXT CHECK (account_type IN ('card', 'checking', 'savings'));
ALTER TABLE sources ADD COLUMN default_tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL;
CREATE TABLE account_clues (
    id         INTEGER PRIMARY KEY,
    source_id  INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('last4', 'layout')),
    -- last4: "<bank>|<digits>" (bank may be empty); layout: the file's layout signature.
    value      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (source_id, kind, value)
);
CREATE INDEX idx_account_clues_value ON account_clues(kind, value);
