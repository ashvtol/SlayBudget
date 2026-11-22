-- Refunds are regular transactions, not transfers; the category stays excluded from totals.
UPDATE categories SET kind = 'expense' WHERE legacy_name = 'Credits/Refunds';

-- Existing rows take their type from their category's kind; no category changes.
UPDATE transactions SET type = (
    SELECT CASE c.kind WHEN 'income' THEN 'income' WHEN 'transfer' THEN 'transfer' ELSE 'regular' END
    FROM categories c WHERE c.id = transactions.category_id
) WHERE category_id IS NOT NULL;

-- Uncategorized split parts follow their parent.
UPDATE transactions SET type = (SELECT p.type FROM transactions p WHERE p.id = transactions.parent_id)
WHERE parent_id IS NOT NULL AND category_id IS NULL;
