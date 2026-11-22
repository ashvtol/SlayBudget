//! Merchant similarity, ported from Financial-Tracker's `calculateSimilarity`.
//! Scores are in 0..=1; the learning model matches at 0.8 and above.

/// Threshold for a fuzzy merchant match.
pub const MATCH_THRESHOLD: f64 = 0.8;

pub fn similarity(a: &str, b: &str) -> f64 {
    if a == b {
        return 1.0;
    }
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    // "costco" matches "costco gas"
    if a.contains(b) || b.contains(a) {
        return 0.95;
    }
    let wa: Vec<&str> = a.split(' ').collect();
    let wb: Vec<&str> = b.split(' ').collect();
    if wa.len() >= 2 && wb.len() >= 2 {
        if wa[0] != wb[0] {
            return levenshtein_ratio(a, b);
        }
        if wa[1] == wb[1] {
            return 1.0;
        }
        let prefix = common_prefix_len(wa[1], wb[1]);
        let min_len = wa[1].chars().count().min(wb[1].chars().count());
        if prefix >= 4 {
            return 0.9;
        }
        if prefix >= 3 && min_len <= 5 {
            return 0.85;
        }
        // Same first word, clearly different second word: not a match.
        return 0.5;
    }
    levenshtein_ratio(a, b)
}

fn common_prefix_len(a: &str, b: &str) -> usize {
    a.chars().zip(b.chars()).take_while(|(x, y)| x == y).count()
}

fn levenshtein_ratio(a: &str, b: &str) -> f64 {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0; b.len() + 1];
    for i in 1..=a.len() {
        cur[0] = i;
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    let distance = prev[b.len()];
    1.0 - distance as f64 / a.len().max(b.len()) as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_and_containment() {
        assert_eq!(similarity("costco", "costco"), 1.0);
        assert_eq!(similarity("costco", "costco gas"), 0.95);
        assert_eq!(similarity("", "x"), 0.0);
    }

    #[test]
    fn two_word_merchants_compare_second_words() {
        assert_eq!(similarity("whole foods", "whole foods"), 1.0);
        assert_eq!(similarity("wholefds int", "wholefds mkt"), 0.5);
        assert_eq!(
            similarity("trader joes", "trader joe"),
            0.95,
            "containment wins first"
        );
        assert_eq!(similarity("starbucks store", "starbucks stores1"), 0.95);
        assert_eq!(
            similarity("amazon.com ab12cd34", "amazon.com hw4z69ja"),
            0.5
        );
        assert_eq!(similarity("uber trip", "uber tripx1"), 0.95);
        assert_eq!(similarity("safeway store", "safeway stork"), 0.9);
        assert_eq!(similarity("shell dsl", "shell dsx"), 0.5);
        assert_eq!(similarity("shell dslx", "shell dsly"), 0.85);
    }

    #[test]
    fn single_words_use_edit_distance() {
        assert!(similarity("netflix", "netflex") > MATCH_THRESHOLD);
        assert!(similarity("netflix", "spotify") < MATCH_THRESHOLD);
    }
}
