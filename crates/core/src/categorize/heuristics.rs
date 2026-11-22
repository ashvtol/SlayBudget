//! Keyword fallback used when no rule and no learned merchant applies.
//! Ported from Financial-Tracker's `categorizeTransaction`; keys are legacy category names.

/// Credits (money in) on a card statement: a payment toward the bill, or a real refund.
pub fn credit_category(description: &str) -> &'static str {
    let d = description.to_lowercase();
    const PAYMENT: &[&str] = &[
        "online payment",
        "mobile payment",
        "autopay payment",
        "payment - thank you",
        "payment thank you",
        "payment received",
    ];
    if PAYMENT.iter().any(|p| d.contains(p)) {
        "Payment"
    } else {
        "Credits/Refunds"
    }
}

/// Money in on a checking statement.
pub fn income_category(description: &str) -> &'static str {
    let d = description.to_lowercase();
    if d.contains("payroll") || d.contains("direct dep") || d.contains("salary") {
        "Income - Salary"
    } else if d.contains("transfer") {
        "Transfer"
    } else if d.contains("interest") {
        "Income - Interest"
    } else if d.contains("refund") {
        "Credits/Refunds"
    } else {
        "Income - Other"
    }
}

/// Money out on a checking statement that is really a credit card payment.
pub fn is_card_payment(description: &str) -> bool {
    let d = description.to_lowercase();
    [
        "american expr",
        "amex",
        "citi autopay",
        "bankcard",
        "credit card",
    ]
    .iter()
    .any(|p| d.contains(p))
}

/// Spending (money out) keyword heuristics, in the original priority order.
pub fn spending_category(description: &str) -> &'static str {
    let d = description.to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| d.contains(w));
    if has(&["netflix", "spotify", "hulu", "disney+", "amazon prime"]) {
        return "Digital Entertainment";
    }
    if has(&["movie", "theater", "concert", "event"]) {
        return "Entertainment";
    }
    if has(&[
        "restaurant",
        "cafe",
        "dining",
        "pizza",
        "mcdonald",
        "starbucks",
    ]) {
        return "Food & Dining";
    }
    if has(&[
        "grocery",
        "market",
        "walmart",
        "target",
        "costco",
        "whole foods",
    ]) {
        return "Groceries";
    }
    if has(&["parking", "meter", "garage", "valet"]) {
        return "Transportation - Parking";
    }
    if has(&["uber", "lyft", "taxi", "cab", "rideshare"]) {
        return "Transportation - Cab/Rideshare";
    }
    if has(&["gas", "fuel", "shell", "exxon", "chevron", "bp", "mobil"]) {
        return "Transportation - Fuel";
    }
    if has(&["toll", "bridge", "turnpike", "fastrak", "ezpass"]) {
        return "Transportation - Tolls";
    }
    if has(&["metro", "subway", "bus", "train", "transit", "mta", "bart"]) {
        return "Transportation - Public Transit";
    }
    if has(&[
        "car rental",
        "hertz",
        "enterprise",
        "avis",
        "budget",
        "zipcar",
    ]) {
        return "Transportation - Other";
    }
    if has(&["rent", "mortgage", "utilities", "electric", "water"]) {
        return "Housing & Utilities";
    }
    if d.contains("amazon.com*") && d.contains("amzn.com/bill") {
        return "Whole Foods Groceries";
    }
    if (d.contains("amazon") && !d.contains("prime")) || has(&["shopping", "mall"]) {
        return "Shopping";
    }
    if has(&["doctor", "pharmacy", "medical", "health"]) {
        return "Healthcare";
    }
    if has(&["school", "university", "education", "tuition"]) {
        return "Education";
    }
    if has(&["hotel", "flight", "airline", "travel"]) {
        return "Travel";
    }
    if has(&["investment", "stock", "bond", "401k"]) {
        return "Investments";
    }
    if has(&["insurance", "premium"]) {
        return "Insurance";
    }
    if has(&["fee", "atm", "overdraft"]) {
        return "Bank Fees";
    }
    if has(&["salon", "spa", "gym", "fitness"]) {
        return "Personal Care";
    }
    if has(&["gift", "donation", "charity"]) {
        return "Gifts & Donations";
    }
    if has(&["subscription", "monthly"]) {
        return "Subscriptions";
    }
    if has(&["phone", "internet", "verizon", "at&t"]) {
        return "Phone & Internet";
    }
    "Other"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credits_split_payments_from_refunds() {
        assert_eq!(credit_category("AUTOPAY PAYMENT - THANK YOU"), "Payment");
        assert_eq!(credit_category("AMAZON.COM"), "Credits/Refunds");
    }

    #[test]
    fn income_keywords() {
        assert_eq!(
            income_category("ACH Electronic Credit ACME PAYROLL"),
            "Income - Salary"
        );
        assert_eq!(income_category("Interest Paid"), "Income - Interest");
        assert_eq!(income_category("Zelle from Sam"), "Income - Other");
    }

    #[test]
    fn spending_keywords_follow_priority_order() {
        assert_eq!(spending_category("NETFLIX.COM"), "Digital Entertainment");
        assert_eq!(spending_category("WHOLE FOODS MKT"), "Groceries");
        assert_eq!(spending_category("SHELL OIL 123"), "Transportation - Fuel");
        assert_eq!(
            spending_category("AMAZON.COM*AB12 AMZN.COM/BILL"),
            "Whole Foods Groceries"
        );
        assert_eq!(spending_category("AMAZON MKTPLACE"), "Shopping");
        assert_eq!(spending_category("ZZZ UNKNOWN"), "Other");
        assert!(is_card_payment("Transfer to Bankcard AMERICAN EXPRESS"));
    }
}
