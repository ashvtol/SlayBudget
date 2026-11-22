-- Extra statement columns kept at import (Status, Member name, Amex's extended details...),
-- as a JSON array of [label, value] pairs.
ALTER TABLE transactions ADD COLUMN details TEXT;
