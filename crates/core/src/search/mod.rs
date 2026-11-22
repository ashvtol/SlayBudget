//! Natural-language transaction search: a small query parser plus an FTS5-backed
//! lookup. Parses fragments like "groceries over $100 last month" into a
//! structured query, then runs full-text + range filters.

pub mod parser;

use crate::error::Result;
use crate::profiles::ProfileId;
use crate::transactions::{row_to_tx, Transaction, SELECT_COLS};
use parser::ParsedQuery;
use rusqlite::{types::Value, Connection};

/// `SELECT_COLS` with every column qualified by the `t` alias, so the FTS join
/// (whose table shares column names) stays unambiguous.
fn qualified_cols() -> String {
    SELECT_COLS
        .split(", ")
        .map(|c| format!("t.{c}"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Run a parsed query for a profile (or combined). Results newest first.
pub fn search(
    conn: &Connection,
    profile_id: Option<ProfileId>,
    q: &ParsedQuery,
    limit: usize,
) -> Result<Vec<Transaction>> {
    let mut clauses = vec!["t.parent_id IS NULL".to_string()];
    let mut args: Vec<Value> = Vec::new();

    let fts_join = if !q.text.is_empty() {
        clauses.push("f.transactions_fts MATCH ?".to_string());
        args.push(Value::from(fts_match_expr(&q.text)));
        "JOIN transactions_fts f ON f.rowid = t.id"
    } else {
        ""
    };

    if let Some(p) = profile_id {
        clauses.push("t.profile_id = ?".to_string());
        args.push(Value::from(p));
    }
    if let Some(min) = q.min_abs_cents {
        clauses.push("abs(t.amount_cents) >= ?".to_string());
        args.push(Value::from(min));
    }
    if let Some(max) = q.max_abs_cents {
        clauses.push("abs(t.amount_cents) <= ?".to_string());
        args.push(Value::from(max));
    }
    if let Some(from) = q.from {
        clauses.push("t.posted_on >= ?".to_string());
        args.push(Value::from(from.to_string()));
    }
    if let Some(to) = q.to {
        clauses.push("t.posted_on <= ?".to_string());
        args.push(Value::from(to.to_string()));
    }
    // By type, as everywhere else: income is Income rows; spending is money out on regular rows
    // (card payments and other transfers are neither).
    if q.income_only {
        clauses.push("t.type = 'income'".to_string());
    }
    if q.expense_only {
        clauses.push("t.type = 'regular' AND t.amount_cents < 0".to_string());
    }

    let sql = format!(
        "SELECT {} FROM transactions t {fts_join} WHERE {} ORDER BY t.posted_on DESC, t.id DESC LIMIT ?",
        qualified_cols(),
        clauses.join(" AND ")
    );
    args.push(Value::from(limit as i64));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args), row_to_tx)?;
    let mut rows: Vec<Transaction> = rows.collect::<std::result::Result<_, _>>()?;
    crate::transactions::fill_tags(conn, &mut rows)?;
    Ok(rows)
}

/// Turn free words into a prefix AND match, quoting each term for FTS5 safety.
fn fts_match_expr(text: &str) -> String {
    text.split_whitespace()
        .filter_map(|w| {
            let cleaned: String = w.chars().filter(|c| c.is_alphanumeric()).collect();
            if cleaned.is_empty() {
                None
            } else {
                Some(format!("\"{cleaned}\"*"))
            }
        })
        .collect::<Vec<_>>()
        .join(" AND ")
}
