-- Possible duplicates found on import: the new row (tx), the existing row it looks like (other), and why.
-- The pair's fingerprints are kept too, so a pair you dismissed is never flagged again, even after undo and re-import.
CREATE TABLE duplicate_flags (
    id          INTEGER PRIMARY KEY,
    tx_id       INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
    other_id    INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
    tx_hash     TEXT NOT NULL,
    other_hash  TEXT NOT NULL,
    import_id   INTEGER,
    confidence  TEXT NOT NULL CHECK (confidence IN ('certain', 'likely')),
    reason      TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    resolved_at TEXT,
    resolution  TEXT CHECK (resolution IN ('deleted', 'kept', 'other_deleted'))
);
CREATE INDEX idx_duplicate_flags_tx ON duplicate_flags(tx_id);
CREATE INDEX idx_duplicate_flags_other ON duplicate_flags(other_id);
