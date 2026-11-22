//! SlayBudget core: all business logic, independent of the Tauri shell.

pub mod analytics;
pub mod budgets;
pub mod categories;
pub mod categorize;
pub mod db;
pub mod duplicates;
pub mod error;
pub mod fx;
pub mod import;
pub mod imports;
pub mod notifications;
pub mod profiles;
pub mod recurrings;
pub mod search;
pub mod settings;
pub mod sources_merge;
pub mod tags;
pub mod transactions;

pub use error::CoreError;
