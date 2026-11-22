//! Merchant extraction, ported from Financial-Tracker's `extractMerchant`.
//!
//! The merchant key is what the learning model is keyed on, so the rules here
//! must stay stable: changing them silently re-keys every learned merchant.

use regex::Regex;
use std::sync::LazyLock;

/// Platforms and variable merchants where every transaction may need its own category.
/// Gas stations are here because the same station sells fuel and groceries.
pub const PAYMENT_PLATFORMS: &[&str] = &[
    "venmo",
    "zelle",
    "paypal",
    "cashapp",
    "cash app",
    "apple cash",
    "wise",
    "wire transfer",
    "wire from",
    "capital one transfer",
    "shell oil",
    "shell gas",
    "exxon",
    "mobil",
    "bp oil",
    "bp gas",
    "chevron",
    "texaco",
    "sunoco",
    "citgo",
    "marathon",
    "speedway",
    "valero",
    "arco",
    "pilot travel",
    "flying j",
    "loves travel",
    "kwik trip",
    "sheetz",
    "casey",
    "circle k",
    "wawa",
    "quiktrip",
    "racetrac",
    "murphy oil",
    "murphy express",
    "thorntons",
    "getgo",
];

static PREFIXES: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"^ach electronic (?:credit|debit)\s+",
        r"^debit card purchase\s+[\d/]+\s+[\d:]+[ap]?\s*#?\d*\s*",
        r"^incoming wire transfer\s+(?:wire\s+)?(?:from\s+)?",
        r"^transfer to\s+",
        r"^zelle (?:debit|credit|payment)\s+",
    ]
    .iter()
    .map(|p| Regex::new(p).expect("valid prefix regex"))
    .collect()
});

static SPLIT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\s\-#*]+").unwrap());
static TX_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{6,}$").unwrap());
static NUMERIC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[\d:]+$").unwrap());

const SKIP_WORDS: &[&str] = &["pay", "payment", "id", "org", "fee", "vs", "edi"];

/// True when the merchant key belongs to a payment platform or gas station.
pub fn is_payment_platform(merchant: &str) -> bool {
    let lower = merchant.to_lowercase();
    PAYMENT_PLATFORMS.iter().any(|p| lower.contains(p))
}

/// Reduce a raw statement description to a short, lower-case merchant key.
pub fn extract_merchant(description: &str) -> String {
    let lower = description.to_lowercase();
    let mut processed = lower.as_str();
    for prefix in PREFIXES.iter() {
        if let Some(m) = prefix.find(processed) {
            processed = &processed[m.end()..];
            break;
        }
    }

    let words: Vec<&str> = SPLIT.split(processed).filter(|w| !w.is_empty()).collect();

    // Detect the platform on the full description: a stripped prefix ("zelle payment")
    // must still mark the row as a platform payment.
    if let Some(platform) = PAYMENT_PLATFORMS.iter().find(|p| lower.contains(*p)) {
        // Keep the platform name plus the transaction id so each payment stays distinct.
        if let Some(id) = words.iter().find(|w| TX_ID.is_match(w)) {
            return format!("{platform} {id}");
        }
        return words.iter().take(3).copied().collect::<Vec<_>>().join(" ");
    }

    let meaningful: Vec<&str> = words
        .iter()
        .copied()
        .filter(|w| !SKIP_WORDS.contains(w) && !NUMERIC.is_match(w))
        .collect();
    let picked = if meaningful.is_empty() {
        &words
    } else {
        &meaningful
    };
    picked.iter().take(2).copied().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_bank_prefixes() {
        assert_eq!(
            extract_merchant("ACH Electronic Credit MICROSOFT PAYROLL"),
            "microsoft payroll"
        );
        assert_eq!(
            extract_merchant("Debit Card Purchase 12/20 04:55p #1234 STORE NAME"),
            "store name"
        );
        assert_eq!(
            extract_merchant("Incoming Wire Transfer WIRE FROM JOHN DOE"),
            "john doe"
        );
        assert_eq!(extract_merchant("Transfer to Bankcard 1234"), "bankcard");
    }

    #[test]
    fn keeps_first_two_meaningful_words() {
        assert_eq!(
            extract_merchant("WHOLE FOODS MKT 10234 SEATTLE WA"),
            "whole foods"
        );
        assert_eq!(
            extract_merchant("AMAZON.COM*AB12CD34 AMZN.COM/BILL"),
            "amazon.com ab12cd34"
        );
        assert_eq!(extract_merchant("NETFLIX.COM"), "netflix.com");
    }

    #[test]
    fn skips_filler_words_and_numbers() {
        assert_eq!(extract_merchant("PAYMENT ID 4431 COMCAST"), "comcast");
        assert_eq!(extract_merchant("12345 6789"), "12345 6789");
    }

    #[test]
    fn payment_platforms_keep_their_transaction_id() {
        assert_eq!(
            extract_merchant("VENMO PAYMENT 1032551688 WEB ID: 3264681992"),
            "venmo 1032551688"
        );
        assert_eq!(
            extract_merchant("Zelle Payment PAY ID: 12345678 TO JANE"),
            "zelle 12345678"
        );
        assert_eq!(
            extract_merchant("SHELL OIL 575729373 EDMONDS WA"),
            "shell oil 575729373"
        );
    }

    #[test]
    fn payment_platform_without_id_uses_three_words() {
        assert_eq!(
            extract_merchant("PAYPAL INSTANT TRANSFER WEB"),
            "paypal instant transfer"
        );
    }

    #[test]
    fn platform_detection() {
        assert!(is_payment_platform("venmo 1032551688"));
        assert!(is_payment_platform("Shell Oil 1"));
        assert!(!is_payment_platform("whole foods"));
    }
}
