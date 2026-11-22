-- Daily FX rates: units of `quote` per 1 unit of `base`, on `as_of`.
-- e.g. base='USD', quote='INR', rate=83.12 means 1 USD = 83.12 INR.
CREATE TABLE fx_rates (
    base    TEXT NOT NULL,
    quote   TEXT NOT NULL,
    as_of   TEXT NOT NULL,          -- YYYY-MM-DD
    rate    REAL NOT NULL,
    PRIMARY KEY (base, quote, as_of)
);

CREATE INDEX idx_fx_rates_lookup ON fx_rates (base, quote, as_of);
