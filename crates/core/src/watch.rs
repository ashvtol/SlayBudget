//! Finding statement files in the background: the watched folder (searched a few levels deep, so account folders and
//! profile folders count) and, if you turned it on, the top of your Downloads folder (only files that arrived after
//! you did). Files are only ever read, never moved or changed.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const STATEMENT_EXTENSIONS: [&str; 5] = ["csv", "tsv", "ofx", "qfx", "pdf"];
/// watched/<profile>/<account>/file.csv is as deep as it goes.
const MAX_DEPTH: usize = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum From {
    Watched,
    Downloads,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub path: String,
    pub name: String,
    pub modified_ms: i64,
    pub size: u64,
    pub from: From,
}

pub fn modified_ms(path: &Path) -> Option<i64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(
        modified
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_millis() as i64,
    )
}

fn is_statement_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| STATEMENT_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

fn hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with('.'))
}

fn walk(dir: &Path, depth: usize, from: From, since: i64, out: &mut Vec<Candidate>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if hidden(&path) {
            continue;
        }
        if path.is_dir() {
            if depth > 0 {
                walk(&path, depth - 1, from, since, out);
            }
            continue;
        }
        if !is_statement_file(&path) {
            continue;
        }
        let Some(modified) = modified_ms(&path) else {
            continue;
        };
        if modified < since {
            continue;
        }
        out.push(Candidate {
            path: path.to_string_lossy().to_string(),
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            modified_ms: modified,
            size: std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
            from,
        });
    }
}

/// Statement-looking files in the watched folder, and new ones at the top of Downloads (since `since` ms).
pub fn candidates(watched: Option<&Path>, downloads: Option<(&Path, i64)>) -> Vec<Candidate> {
    let mut out = Vec::new();
    if let Some(dir) = watched {
        walk(dir, MAX_DEPTH - 1, From::Watched, i64::MIN, &mut out);
    }
    if let Some((dir, since)) = downloads {
        walk(dir, 0, From::Downloads, since, &mut out);
    }
    out
}

/// Only files that exist inside one of the chosen places can be read (no "..", no links out).
pub fn is_allowed(path: &Path, roots: &[PathBuf]) -> bool {
    let Ok(real) = path.canonicalize() else {
        return false;
    };
    real.is_file()
        && roots
            .iter()
            .filter_map(|r| r.canonicalize().ok())
            .any(|root| real.starts_with(root))
}
