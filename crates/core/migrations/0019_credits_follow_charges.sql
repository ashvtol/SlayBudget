-- Credits that pay a charge back are filed in the charge's category (credits::follow_charges). The database is backed
-- up before this version first moves them. Refund links are looked up by their charge.
CREATE INDEX IF NOT EXISTS idx_transactions_refund_of ON transactions(refund_of);
