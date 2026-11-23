//! SlayBudget core: all business logic, independent of the Tauri shell.

pub mod accounts;
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
pub mod price_changes;
pub mod profiles;
pub mod recurrings;
pub mod search;
pub mod settings;
pub mod sources_merge;
pub mod tags;
pub mod transactions;
pub mod undo;
pub mod watch;

pub use error::CoreError;
