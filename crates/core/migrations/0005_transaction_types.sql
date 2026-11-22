-- Transaction types (Copilot): regular spending, income, or an internal transfer.
ALTER TABLE transactions ADD COLUMN type TEXT NOT NULL DEFAULT 'regular'
    CHECK (type IN ('regular', 'income', 'transfer'));
CREATE INDEX idx_transactions_type ON transactions(type);
