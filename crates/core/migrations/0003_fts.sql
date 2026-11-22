-- Full-text search over transactions. External-content FTS5 mirrors the
-- transactions table and is kept in sync by triggers.
CREATE VIRTUAL TABLE transactions_fts USING fts5(
    description,
    merchant,
    notes,
    content='transactions',
    content_rowid='id'
);

-- Backfill rows that already exist.
INSERT INTO transactions_fts (rowid, description, merchant, notes)
SELECT id, description, merchant, coalesce(notes, '') FROM transactions;

CREATE TRIGGER transactions_fts_ai AFTER INSERT ON transactions BEGIN
    INSERT INTO transactions_fts (rowid, description, merchant, notes)
    VALUES (new.id, new.description, new.merchant, coalesce(new.notes, ''));
END;

CREATE TRIGGER transactions_fts_ad AFTER DELETE ON transactions BEGIN
    INSERT INTO transactions_fts (transactions_fts, rowid, description, merchant, notes)
    VALUES ('delete', old.id, old.description, old.merchant, coalesce(old.notes, ''));
END;

CREATE TRIGGER transactions_fts_au AFTER UPDATE ON transactions BEGIN
    INSERT INTO transactions_fts (transactions_fts, rowid, description, merchant, notes)
    VALUES ('delete', old.id, old.description, old.merchant, coalesce(old.notes, ''));
    INSERT INTO transactions_fts (rowid, description, merchant, notes)
    VALUES (new.id, new.description, new.merchant, coalesce(new.notes, ''));
END;
