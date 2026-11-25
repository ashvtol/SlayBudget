//! Undo and redo for the changes you make. SQLite's session extension records exactly which rows one action changed
//! (a changeset, kept as bytes); undo applies its inverse and redo applies it again. The changeset already holds every
//! cascade (split parts, tags, refund and flag links), so it is applied with foreign keys off, or those would happen
//! twice. If any row changed since (something outside the stack touched it), the whole apply is aborted and rolled
//! back by SQLite: never half-applied.

use crate::error::{CoreError, Result};
use rusqlite::session::{invert_strm, ConflictAction, ConflictType, Session};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

/// How many steps of undo are kept; the oldest falls off.
pub const DEPTH: usize = 15;

/// Tables that hold your edits. Left out: the search index (its triggers follow the transactions table on apply),
/// settings, notifications and exchange rates.
const TRACKED: [&str; 20] = [
    "profiles",
    "sources",
    "category_groups",
    "categories",
    "category_budget_months",
    "transactions",
    "tags",
    "transaction_tags",
    "merchant_rules",
    "rules",
    "imports",
    "recurrings",
    "recurring_dismissals",
    "duplicate_flags",
    "account_clues",
    "price_checks",
    "recurring_prices",
    "recurring_apart",
    "model_counts",
    "model_totals",
];

struct Step {
    /// Never reused, so a caller can name exactly the step it made.
    id: u64,
    label: String,
    changeset: Vec<u8>,
}

/// What the Edit menu shows: the next step to undo and to redo.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoState {
    pub undo: Option<String>,
    pub redo: Option<String>,
}

pub struct UndoStack {
    depth: usize,
    next_id: u64,
    undo: VecDeque<Step>,
    redo: Vec<Step>,
}

impl Default for UndoStack {
    fn default() -> Self {
        Self::new()
    }
}

impl UndoStack {
    pub fn new() -> Self {
        UndoStack {
            depth: DEPTH,
            next_id: 1,
            undo: VecDeque::new(),
            redo: Vec::new(),
        }
    }

    pub fn state(&self) -> UndoState {
        UndoState {
            undo: self.undo.back().map(|s| s.label.clone()),
            redo: self.redo.last().map(|s| s.label.clone()),
        }
    }

    /// Run one action you took and remember what it changed as one step. An action that changed nothing (or failed)
    /// isn't a step. A new step clears redo.
    pub fn record<T>(
        &mut self,
        conn: &Connection,
        label: &str,
        f: impl FnOnce(&Connection) -> Result<T>,
    ) -> Result<T> {
        let mut session = Session::new(conn)?;
        session.table_filter(Some(|table: &str| TRACKED.contains(&table)));
        session.attach(None::<&str>)?;
        let value = f(conn)?;
        if session.is_empty() {
            return Ok(value);
        }
        let mut changeset = Vec::new();
        session.changeset_strm(&mut changeset)?;
        drop(session);
        if changeset.is_empty() {
            return Ok(value);
        }
        self.next_id += 1;
        self.undo.push_back(Step {
            id: self.next_id - 1,
            label: label.to_string(),
            changeset,
        });
        while self.undo.len() > self.depth {
            self.undo.pop_front();
        }
        self.redo.clear();
        Ok(value)
    }

    /// The id of the step Undo would take back next.
    pub fn latest_id(&self) -> Option<u64> {
        self.undo.back().map(|s| s.id)
    }

    /// Take back step `id` only while it is still the latest; otherwise change nothing and say why.
    pub fn undo_step(&mut self, conn: &Connection, id: u64) -> Result<Option<String>> {
        if self.latest_id() != Some(id) {
            return Err(CoreError::Invalid(
                "That change was already undone, or something else changed after it.".into(),
            ));
        }
        self.undo(conn)
    }

    /// Take back the latest step; returns its label, or None when there's nothing to undo.
    pub fn undo(&mut self, conn: &Connection) -> Result<Option<String>> {
        let Some(step) = self.undo.back() else {
            return Ok(None);
        };
        let mut inverse = Vec::new();
        invert_strm(&mut step.changeset.as_slice(), &mut inverse)?;
        apply(conn, &inverse, "undo", &step.label)?;
        let step = self.undo.pop_back().expect("checked above");
        let label = step.label.clone();
        self.redo.push(step);
        Ok(Some(label))
    }

    /// Put back the latest undone step; returns its label, or None when there's nothing to redo.
    pub fn redo(&mut self, conn: &Connection) -> Result<Option<String>> {
        let Some(step) = self.redo.last() else {
            return Ok(None);
        };
        apply(conn, &step.changeset, "redo", &step.label)?;
        let step = self.redo.pop().expect("checked above");
        let label = step.label.clone();
        self.undo.push_back(step);
        Ok(Some(label))
    }
}

fn apply(conn: &Connection, changeset: &[u8], verb: &str, label: &str) -> Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = OFF")?;
    let result = conn.apply_strm(
        &mut &changeset[..],
        None::<fn(&str) -> bool>,
        |_kind: ConflictType, _item| ConflictAction::SQLITE_CHANGESET_ABORT,
    );
    conn.execute_batch("PRAGMA foreign_keys = ON")?;
    result.map_err(|_| {
        CoreError::Invalid(format!(
            "Couldn't {verb} “{label}”: those rows changed since."
        ))
    })
}
