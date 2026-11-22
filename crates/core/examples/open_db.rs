//! Open a database (running any pending migrations) and print its schema version.
fn main() {
    let path = std::env::args().nth(1).expect("db path");
    let conn = slaybudget_core::db::open_db(std::path::Path::new(&path)).unwrap();
    println!(
        "schema version {}",
        slaybudget_core::db::schema_version(&conn).unwrap()
    );
}
