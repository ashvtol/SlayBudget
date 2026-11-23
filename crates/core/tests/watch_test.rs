use slaybudget_core::watch::{self, From};
use std::fs;
use std::path::PathBuf;

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("sb-watch-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}
fn touch(path: &PathBuf, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}
fn names(found: &[watch::Candidate]) -> Vec<String> {
    let mut v: Vec<String> = found.iter().map(|c| c.name.clone()).collect();
    v.sort();
    v
}

#[test]
fn the_watched_folder_is_searched_into_account_folders_for_statement_files_only() {
    let root = temp("watched");
    touch(&root.join("top.csv"), "x");
    touch(&root.join("Amex Gold/nov.CSV"), "x");
    touch(&root.join("Me/Citi/statement.pdf"), "x");
    touch(&root.join("Me/Citi/old/deep/too-deep.csv"), "x");
    touch(&root.join("notes.txt"), "x");
    touch(&root.join(".hidden/secret.csv"), "x");
    let found = watch::candidates(Some(&root), None);
    assert_eq!(names(&found), vec!["nov.CSV", "statement.pdf", "top.csv"]);
    assert!(found.iter().all(|c| c.from == From::Watched));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn downloads_only_counts_statement_files_that_arrived_after_watching_began() {
    let dl = temp("downloads");
    touch(&dl.join("old.csv"), "x");
    let since = watch::modified_ms(&dl.join("old.csv")).unwrap() + 1;
    std::thread::sleep(std::time::Duration::from_millis(20));
    touch(&dl.join("activity.csv"), "x");
    touch(&dl.join("photo.jpg"), "x");
    touch(&dl.join("folder/inside.csv"), "x");
    let found = watch::candidates(None, Some((&dl, since)));
    assert_eq!(
        names(&found),
        vec!["activity.csv"],
        "top level only, statements only, new only"
    );
    assert_eq!(found[0].from, From::Downloads);
    let _ = fs::remove_dir_all(&dl);
}

#[test]
fn only_files_inside_the_chosen_places_can_be_read() {
    let root = temp("allowed");
    touch(&root.join("a.csv"), "x");
    let roots = [root.clone()];
    assert!(watch::is_allowed(&root.join("a.csv"), &roots));
    assert!(!watch::is_allowed(&root.join("../escape.csv"), &roots));
    assert!(!watch::is_allowed(&PathBuf::from("/etc/passwd"), &roots));
    assert!(!watch::is_allowed(&root.join("missing.csv"), &roots));
    let _ = fs::remove_dir_all(&root);
}
