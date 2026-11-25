-- Bills paid every 2, 3 or 4 years (multi-year subscriptions). Stored as frequency 'yearly' with a count of years,
-- so the frequency's own check is unchanged and no table is rebuilt.
ALTER TABLE recurrings ADD COLUMN every_years INTEGER NOT NULL DEFAULT 1 CHECK (every_years BETWEEN 1 AND 4);
