-- Copilot budgets: per-month overrides of a category's default budget,
-- shared group budgets, and rollovers (from a month on).
CREATE TABLE category_budget_months (
    category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    month        TEXT NOT NULL,            -- 'YYYY-MM'
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    PRIMARY KEY (category_id, month)
);
ALTER TABLE category_groups ADD COLUMN budget_cents INTEGER;
ALTER TABLE categories ADD COLUMN rollover_since TEXT;
