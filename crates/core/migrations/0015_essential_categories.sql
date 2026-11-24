-- Categories that are needs (rent, groceries, bills you can't skip) rather than wants. The default needs are
-- marked once by categories::apply_default_essentials, which shares the rule with new databases.
ALTER TABLE categories ADD COLUMN essential INTEGER NOT NULL DEFAULT 0;
-- Marks that the default needs still have to be applied (cleared once they are).
CREATE TABLE essential_defaults_pending (pending INTEGER NOT NULL);
INSERT INTO essential_defaults_pending VALUES (1);
