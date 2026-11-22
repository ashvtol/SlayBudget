-- Tags (Copilot): each tag has a color shown as a dot beside its name.
ALTER TABLE tags ADD COLUMN color TEXT NOT NULL DEFAULT '#8e8e93';
CREATE INDEX idx_transaction_tags_tag ON transaction_tags(tag_id);
