//! Categorization: merchant extraction, similarity, learned merchant model, rules.

pub mod export;
pub mod heuristics;
pub mod learning;
pub mod merchant;
pub mod recategorize;
pub mod rules;
pub mod similarity;

pub use merchant::{extract_merchant, is_payment_platform};
