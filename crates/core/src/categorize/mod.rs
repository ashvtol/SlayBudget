//! Categorization: merchant extraction, similarity, learned merchant model, rules.

pub mod export;
pub mod heuristics;
pub mod history;
pub mod learning;
pub mod merchant;
pub mod model;
pub mod recategorize;
pub mod rules;
pub mod similarity;
pub mod starter;
pub mod transfers;

pub use merchant::{extract_merchant, is_payment_platform};
