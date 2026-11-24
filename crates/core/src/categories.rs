//! Two-tier categories: a group (Home, Food & Drink) holds categories (Rent, Groceries).

use crate::error::{CoreError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub type GroupId = i64;
pub type CategoryId = i64;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CategoryKind {
    Expense,
    Income,
    Transfer,
}

impl CategoryKind {
    pub fn as_str(self) -> &'static str {
        match self {
            CategoryKind::Expense => "expense",
            CategoryKind::Income => "income",
            CategoryKind::Transfer => "transfer",
        }
    }
    fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "expense" => CategoryKind::Expense,
            "income" => CategoryKind::Income,
            "transfer" => CategoryKind::Transfer,
            other => return Err(CoreError::Invalid(format!("unknown category kind {other}"))),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CategoryGroup {
    pub id: GroupId,
    pub name: String,
    pub emoji: Option<String>,
    pub color: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Category {
    pub id: CategoryId,
    pub group_id: GroupId,
    pub name: String,
    pub emoji: Option<String>,
    pub color: Option<String>,
    pub budget_cents: Option<i64>,
    pub excluded: bool,
    pub kind: CategoryKind,
    pub sort_order: i64,
    pub archived: bool,
    pub legacy_name: Option<String>,
    /// A need (rent, groceries, bills you can't skip) rather than a want.
    #[serde(default)]
    pub essential: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewCategory {
    pub group: String,
    pub name: String,
    pub emoji: Option<String>,
    pub color: Option<String>,
    pub budget_cents: Option<i64>,
    pub excluded: bool,
    pub kind: CategoryKind,
}

/// Fields to change; `None` leaves a field alone. `budget_cents: Some(None)` clears the budget.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CategoryPatch {
    pub name: Option<String>,
    pub emoji: Option<Option<String>>,
    pub color: Option<Option<String>>,
    pub budget_cents: Option<Option<i64>>,
    pub excluded: Option<bool>,
    pub archived: Option<bool>,
    pub group_id: Option<GroupId>,
    pub essential: Option<bool>,
}

/// (group, group emoji, group color, category, category emoji, legacy name, kind, excluded)
type Seed = (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    CategoryKind,
    bool,
);

const E: CategoryKind = CategoryKind::Expense;
const I: CategoryKind = CategoryKind::Income;
const T: CategoryKind = CategoryKind::Transfer;

/// Financial-Tracker's 31 predefined categories mapped onto two tiers.
const DEFAULTS: &[Seed] = &[
    (
        "Food & Drink",
        "🍽️",
        "#ff9500",
        "Restaurants",
        "🍜",
        "Food & Dining",
        E,
        false,
    ),
    (
        "Food & Drink",
        "🍽️",
        "#ff9500",
        "Groceries",
        "🛒",
        "Groceries",
        E,
        false,
    ),
    (
        "Food & Drink",
        "🍽️",
        "#ff9500",
        "Whole Foods",
        "🥬",
        "Whole Foods Groceries",
        E,
        false,
    ),
    (
        "Entertainment",
        "🎬",
        "#af52de",
        "Entertainment",
        "🎟️",
        "Entertainment",
        E,
        false,
    ),
    (
        "Entertainment",
        "🎬",
        "#af52de",
        "Digital Entertainment",
        "🎮",
        "Digital Entertainment",
        E,
        false,
    ),
    (
        "Entertainment",
        "🎬",
        "#af52de",
        "Subscriptions",
        "🔁",
        "Subscriptions",
        E,
        false,
    ),
    (
        "Transportation",
        "🚗",
        "#5856d6",
        "Parking",
        "🅿️",
        "Transportation - Parking",
        E,
        false,
    ),
    (
        "Transportation",
        "🚗",
        "#5856d6",
        "Rideshare",
        "🚕",
        "Transportation - Cab/Rideshare",
        E,
        false,
    ),
    (
        "Transportation",
        "🚗",
        "#5856d6",
        "Fuel",
        "⛽",
        "Transportation - Fuel",
        E,
        false,
    ),
    (
        "Transportation",
        "🚗",
        "#5856d6",
        "Tolls",
        "🛣️",
        "Transportation - Tolls",
        E,
        false,
    ),
    (
        "Transportation",
        "🚗",
        "#5856d6",
        "Public Transit",
        "🚌",
        "Transportation - Public Transit",
        E,
        false,
    ),
    (
        "Transportation",
        "🚗",
        "#5856d6",
        "Other Transport",
        "🚲",
        "Transportation - Other",
        E,
        false,
    ),
    (
        "Transportation",
        "🚗",
        "#5856d6",
        "Car Maintenance",
        "🔧",
        "Car Maintenance",
        E,
        false,
    ),
    (
        "Home",
        "🏠",
        "#34c759",
        "Housing & Utilities",
        "💡",
        "Housing & Utilities",
        E,
        false,
    ),
    (
        "Home",
        "🏠",
        "#34c759",
        "Phone & Internet",
        "📶",
        "Phone & Internet",
        E,
        false,
    ),
    (
        "Shopping", "🛍️", "#007aff", "Shopping", "🛍️", "Shopping", E, false,
    ),
    (
        "Health & Care",
        "🩺",
        "#ff3b30",
        "Healthcare",
        "🩺",
        "Healthcare",
        E,
        false,
    ),
    (
        "Health & Care",
        "🩺",
        "#ff3b30",
        "Personal Care",
        "💇",
        "Personal Care",
        E,
        false,
    ),
    (
        "Education",
        "🎓",
        "#00a67d",
        "Education",
        "📚",
        "Education",
        E,
        false,
    ),
    (
        "Travel", "✈️", "#ff6482", "Travel", "✈️", "Travel", E, false,
    ),
    (
        "Finance",
        "🏦",
        "#8e8e93",
        "Investments",
        "📈",
        "Investments",
        T,
        true,
    ),
    (
        "Finance",
        "🏦",
        "#8e8e93",
        "Insurance",
        "🛡️",
        "Insurance",
        E,
        false,
    ),
    (
        "Finance",
        "🏦",
        "#8e8e93",
        "Bank Fees",
        "🧾",
        "Bank Fees",
        E,
        false,
    ),
    (
        "Giving",
        "🎁",
        "#ff9500",
        "Gifts & Donations",
        "🎁",
        "Gifts & Donations",
        E,
        false,
    ),
    (
        "Income",
        "💵",
        "#34c759",
        "Salary",
        "💼",
        "Income - Salary",
        I,
        false,
    ),
    (
        "Income",
        "💵",
        "#34c759",
        "Interest",
        "🪙",
        "Income - Interest",
        I,
        false,
    ),
    (
        "Income",
        "💵",
        "#34c759",
        "Other Income",
        "💵",
        "Income - Other",
        I,
        false,
    ),
    (
        "Transfers",
        "🔄",
        "#8e8e93",
        "Payment",
        "💳",
        "Payment",
        T,
        true,
    ),
    (
        "Transfers",
        "🔄",
        "#8e8e93",
        "Transfer",
        "🔄",
        "Transfer",
        T,
        true,
    ),
    (
        "Transfers",
        "🔄",
        "#8e8e93",
        "Credits & Refunds",
        "↩️",
        "Credits/Refunds",
        // Refunds are regular transactions (Copilot); the category stays excluded from totals.
        E,
        true,
    ),
    ("Other", "📦", "#8e8e93", "Other", "📦", "Other", E, false),
];

/// Insert the default groups and categories if the tables are empty. Idempotent.
pub fn seed_defaults(conn: &Connection) -> Result<()> {
    let count: i64 = conn.query_row("SELECT count(*) FROM categories", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }
    for (i, (group, gemoji, gcolor, name, emoji, legacy, kind, excluded)) in
        DEFAULTS.iter().enumerate()
    {
        let group_id = find_or_create_group(conn, group, Some(gemoji), Some(gcolor))?;
        conn.execute(
            "INSERT INTO categories (group_id, name, emoji, kind, excluded, sort_order, legacy_name, essential)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                group_id,
                name,
                emoji,
                kind.as_str(),
                *excluded as i64,
                i as i64,
                legacy,
                (*kind == CategoryKind::Expense && default_essential(name)) as i64
            ],
        )?;
    }
    Ok(())
}

/// Word stems that make a category a need by default ("grocer" covers Groceries).
const ESSENTIAL_STEMS: &[&str] = &[
    "rent",
    "mortgage",
    "housing",
    "grocer",
    "utilit",
    "electric",
    "water",
    "internet",
    "phone",
    "insurance",
    "medical",
    "health",
    "pharmacy",
    "childcare",
    "fuel",
    "transit",
    "loan",
    "debt",
];
const ESSENTIAL_PHRASES: &[&str] = &["whole foods", "car payment"];

/// Whether a category with this name starts out as a need: a word beginning with one of the stems, one of the
/// phrases, or exactly "Gas" (so "Gas station snacks" isn't caught).
pub fn default_essential(name: &str) -> bool {
    let lower = name.to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();
    if words == ["gas"] {
        return true;
    }
    let joined = words.join(" ");
    words
        .iter()
        .any(|w| ESSENTIAL_STEMS.iter().any(|s| w.starts_with(s)))
        || ESSENTIAL_PHRASES.iter().any(|p| joined.contains(p))
}

/// Mark the default needs once in a database made before essentials existed; later choices are left alone.
pub fn apply_default_essentials(conn: &Connection) -> Result<()> {
    let pending: i64 =
        conn.query_row("SELECT count(*) FROM essential_defaults_pending", [], |r| {
            r.get(0)
        })?;
    if pending == 0 {
        return Ok(());
    }
    for c in list(conn)? {
        if c.kind == CategoryKind::Expense && default_essential(&c.name) {
            conn.execute("UPDATE categories SET essential = 1 WHERE id = ?1", [c.id])?;
        }
    }
    conn.execute("DELETE FROM essential_defaults_pending", [])?;
    Ok(())
}

pub fn find_or_create_group(
    conn: &Connection,
    name: &str,
    emoji: Option<&str>,
    color: Option<&str>,
) -> Result<GroupId> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CoreError::Invalid("group name is empty".into()));
    }
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM category_groups WHERE name = ?1",
            [name],
            |r| r.get(0),
        )
        .optional()?
    {
        return Ok(id);
    }
    let next: i64 = conn.query_row(
        "SELECT coalesce(max(sort_order), 0) + 1 FROM category_groups",
        [],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO category_groups (name, emoji, color, sort_order) VALUES (?1, ?2, coalesce(?3, '#8e8e93'), ?4)",
        params![name, emoji, color, next],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_groups(conn: &Connection) -> Result<Vec<CategoryGroup>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, emoji, color, sort_order FROM category_groups ORDER BY sort_order, id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(CategoryGroup {
            id: r.get(0)?,
            name: r.get(1)?,
            emoji: r.get(2)?,
            color: r.get(3)?,
            sort_order: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

const SELECT: &str = "SELECT id, group_id, name, emoji, color, budget_cents, excluded, kind, sort_order, archived, legacy_name, essential FROM categories";

fn row_to_category(r: &rusqlite::Row<'_>) -> rusqlite::Result<(Category, String)> {
    let kind: String = r.get(7)?;
    Ok((
        Category {
            id: r.get(0)?,
            group_id: r.get(1)?,
            name: r.get(2)?,
            emoji: r.get(3)?,
            color: r.get(4)?,
            budget_cents: r.get(5)?,
            excluded: r.get::<_, i64>(6)? != 0,
            kind: CategoryKind::Expense,
            sort_order: r.get(8)?,
            archived: r.get::<_, i64>(9)? != 0,
            legacy_name: r.get(10)?,
            essential: r.get::<_, i64>(11)? != 0,
        },
        kind,
    ))
}

fn finish(row: (Category, String)) -> Result<Category> {
    let (mut c, kind) = row;
    c.kind = CategoryKind::parse(&kind)?;
    Ok(c)
}

pub fn list(conn: &Connection) -> Result<Vec<Category>> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY group_id, sort_order, id"))?;
    let rows = stmt.query_map([], row_to_category)?;
    rows.map(|r| finish(r?)).collect()
}

pub fn get(conn: &Connection, id: CategoryId) -> Result<Category> {
    let row = conn
        .query_row(&format!("{SELECT} WHERE id = ?1"), [id], row_to_category)
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("category {id}")))?;
    finish(row)
}

pub fn find_by_legacy_name(conn: &Connection, legacy: &str) -> Result<Option<Category>> {
    let legacy = legacy.trim();
    let row = conn
        .query_row(
            &format!("{SELECT} WHERE legacy_name = ?1 OR name = ?1 LIMIT 1"),
            [legacy],
            row_to_category,
        )
        .optional()?;
    row.map(finish).transpose()
}

/// Resolve a Financial-Tracker name, creating a custom category when unknown.
/// "Wedding - Venue" becomes group Wedding, category Venue; "Hobbies" goes under Other.
pub fn find_or_create_by_legacy_name(conn: &Connection, legacy: &str) -> Result<CategoryId> {
    if let Some(c) = find_by_legacy_name(conn, legacy)? {
        return Ok(c.id);
    }
    let (group, name) = match legacy.split_once(" - ") {
        Some((g, n)) => (g.trim().to_string(), n.trim().to_string()),
        None => ("Other".to_string(), legacy.trim().to_string()),
    };
    let id = create(
        conn,
        &NewCategory {
            group,
            name,
            emoji: Some(suggest_emoji(legacy).to_string()),
            color: None,
            budget_cents: None,
            excluded: false,
            kind: CategoryKind::Expense,
        },
    )?;
    conn.execute(
        "UPDATE categories SET legacy_name = ?1 WHERE id = ?2",
        params![legacy.trim(), id],
    )?;
    Ok(id)
}

pub fn create(conn: &Connection, cat: &NewCategory) -> Result<CategoryId> {
    let name = cat.name.trim();
    if name.is_empty() {
        return Err(CoreError::Invalid("category name is empty".into()));
    }
    let group_id = find_or_create_group(conn, &cat.group, None, None)?;
    let next: i64 = conn.query_row(
        "SELECT coalesce(max(sort_order), 0) + 1 FROM categories WHERE group_id = ?1",
        [group_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO categories (group_id, name, emoji, color, budget_cents, excluded, kind, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![group_id, name, cat.emoji, cat.color, cat.budget_cents, cat.excluded as i64, cat.kind.as_str(), next],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Name used to compare categories: no emoji or punctuation, single spaces, lowercase.
/// "  ☕️ Coffee " and "coffee" compare equal.
pub fn normalized_name(name: &str) -> String {
    let kept: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c.is_whitespace() {
                c
            } else {
                ' '
            }
        })
        .collect();
    kept.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Refuse a blank name or one another category already uses (by `normalized_name`).
fn ensure_name_free(conn: &Connection, name: &str, except: Option<CategoryId>) -> Result<()> {
    let wanted = normalized_name(name);
    if wanted.is_empty() {
        return Err(CoreError::Invalid("category name is empty".into()));
    }
    for c in list(conn)? {
        if Some(c.id) != except && normalized_name(&c.name) == wanted {
            return Err(CoreError::Invalid(format!(
                "a category named {} already exists",
                c.name
            )));
        }
    }
    Ok(())
}

/// `create` for the app's own Add actions: the name must be unique across all categories.
pub fn create_unique(conn: &Connection, cat: &NewCategory) -> Result<CategoryId> {
    ensure_name_free(conn, &cat.name, None)?;
    create(conn, cat)
}

/// The fallback category ("Other"), found by its seeded legacy name so a rename keeps it.
pub fn is_other(conn: &Connection, id: CategoryId) -> Result<bool> {
    Ok(get(conn, id)?.legacy_name.as_deref() == Some("Other"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteReport {
    /// Transactions (including split parts) moved to Other.
    pub moved: i64,
}

/// How many transactions (including split parts) a delete would move to Other.
pub fn usage(conn: &Connection, id: CategoryId) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM transactions WHERE category_id = ?1",
        [id],
        |r| r.get(0),
    )?)
}

/// Delete a category: its transactions move to Other, its learned merchants and rules
/// go with it (cascade), and its group is removed if left empty. Other can't be deleted.
pub fn delete(conn: &Connection, id: CategoryId) -> Result<DeleteReport> {
    let cat = get(conn, id)?;
    if is_other(conn, id)? {
        return Err(CoreError::Invalid("Other can't be deleted".into()));
    }
    let other: CategoryId = conn
        .query_row(
            "SELECT id FROM categories WHERE legacy_name = 'Other'",
            [],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| CoreError::NotFound("the Other category".into()))?;
    let tx = conn.unchecked_transaction()?;
    let moved = tx.execute(
        &format!(
            "UPDATE transactions SET category_id = ?1, type = {} WHERE category_id = ?2",
            crate::transactions::type_of_category_sql("?1")
        ),
        params![other, id],
    )? as i64;
    tx.execute("DELETE FROM categories WHERE id = ?1", [id])?;
    tx.execute(
        "DELETE FROM category_groups WHERE id = ?1
         AND NOT EXISTS (SELECT 1 FROM categories WHERE group_id = ?1)",
        [cat.group_id],
    )?;
    tx.commit()?;
    Ok(DeleteReport { moved })
}

/// Where a category goes: an existing group, a new group, or its own group
/// (named after the category, which the screens show as a top-level category).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GroupTarget {
    Existing(GroupId),
    New(String),
    Own,
}

fn group_named(conn: &Connection, name: &str) -> Result<Option<(GroupId, String)>> {
    let wanted = normalized_name(name);
    Ok(list_groups(conn)?
        .into_iter()
        .find(|g| normalized_name(&g.name) == wanted)
        .map(|g| (g.id, g.name)))
}

fn group_size(conn: &Connection, group: GroupId) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM categories WHERE group_id = ?1",
        [group],
        |r| r.get(0),
    )?)
}

fn new_group(conn: &Connection, name: &str) -> Result<GroupId> {
    if normalized_name(name).is_empty() {
        return Err(CoreError::Invalid("group name is empty".into()));
    }
    if let Some((_, existing)) = group_named(conn, name)? {
        return Err(CoreError::Invalid(format!(
            "a group named {existing} already exists"
        )));
    }
    find_or_create_group(conn, name, None, None)
}

/// Resolve a target to a group id for a category called `cat_name` currently in `current`.
fn resolve_target(
    conn: &Connection,
    target: &GroupTarget,
    cat_name: &str,
    current: Option<GroupId>,
) -> Result<GroupId> {
    match target {
        GroupTarget::Existing(id) => {
            list_groups(conn)?
                .into_iter()
                .find(|g| g.id == *id)
                .ok_or_else(|| CoreError::NotFound(format!("group {id}")))?;
            Ok(*id)
        }
        GroupTarget::New(name) => new_group(conn, name),
        GroupTarget::Own => match group_named(conn, cat_name)? {
            Some((id, _)) if Some(id) == current => Ok(id),
            Some((id, existing)) => {
                let others = group_size(conn, id)?;
                if others > 0 {
                    Err(CoreError::Invalid(format!(
                        "a group named {existing} already exists"
                    )))
                } else {
                    Ok(id)
                }
            }
            None => find_or_create_group(conn, cat_name.trim(), None, None),
        },
    }
}

fn prune_empty_groups(conn: &Connection) -> Result<()> {
    conn.execute(
        "DELETE FROM category_groups WHERE NOT EXISTS
         (SELECT 1 FROM categories WHERE categories.group_id = category_groups.id)",
        [],
    )?;
    Ok(())
}

/// Create a category with a unique name in the chosen group (the app's Add actions).
pub fn create_in(conn: &Connection, cat: &NewCategory, target: GroupTarget) -> Result<CategoryId> {
    ensure_name_free(conn, &cat.name, None)?;
    let group_id = resolve_target(conn, &target, &cat.name, None)?;
    let group_name: String = conn.query_row(
        "SELECT name FROM category_groups WHERE id = ?1",
        [group_id],
        |r| r.get(0),
    )?;
    create(
        conn,
        &NewCategory {
            group: group_name,
            ..cat.clone()
        },
    )
}

/// Move a category into an existing group, a new group, or its own group.
pub fn move_to_group(conn: &Connection, id: CategoryId, target: GroupTarget) -> Result<()> {
    let cat = get(conn, id)?;
    let tx = conn.unchecked_transaction()?;
    let group_id = resolve_target(&tx, &target, &cat.name, Some(cat.group_id))?;
    tx.execute(
        "UPDATE categories SET group_id = ?1 WHERE id = ?2",
        params![group_id, id],
    )?;
    prune_empty_groups(&tx)?;
    tx.commit()?;
    Ok(())
}

pub fn rename_group(conn: &Connection, id: GroupId, name: &str) -> Result<()> {
    if normalized_name(name).is_empty() {
        return Err(CoreError::Invalid("group name is empty".into()));
    }
    if let Some((other, existing)) = group_named(conn, name)? {
        if other != id {
            return Err(CoreError::Invalid(format!(
                "a group named {existing} already exists"
            )));
        }
    }
    conn.execute(
        "UPDATE category_groups SET name = ?1 WHERE id = ?2",
        params![name.trim(), id],
    )?;
    Ok(())
}

/// Give every category in the group its own group, then remove the emptied group.
/// Checked up front: nothing changes if any category can't get its own group.
pub fn ungroup(conn: &Connection, id: GroupId) -> Result<()> {
    let members: Vec<Category> = list(conn)?
        .into_iter()
        .filter(|c| c.group_id == id)
        .collect();
    let tx = conn.unchecked_transaction()?;
    for c in &members {
        let target = resolve_target(&tx, &GroupTarget::Own, &c.name, Some(c.group_id))?;
        tx.execute(
            "UPDATE categories SET group_id = ?1 WHERE id = ?2",
            params![target, c.id],
        )?;
    }
    prune_empty_groups(&tx)?;
    tx.commit()?;
    Ok(())
}

pub fn update(conn: &Connection, id: CategoryId, patch: &CategoryPatch) -> Result<()> {
    get(conn, id)?;
    if let Some(name) = &patch.name {
        ensure_name_free(conn, name, Some(id))?;
        // A top-level category lives alone in a group of its own name: keep the two in step.
        let cat = get(conn, id)?;
        if group_size(conn, cat.group_id)? == 1 {
            if let Some((gid, _)) = group_named(conn, &cat.name)? {
                if gid == cat.group_id {
                    rename_group(conn, gid, name)?;
                }
            }
        }
        conn.execute(
            "UPDATE categories SET name = ?1 WHERE id = ?2",
            params![name.trim(), id],
        )?;
    }
    if let Some(emoji) = &patch.emoji {
        conn.execute(
            "UPDATE categories SET emoji = ?1 WHERE id = ?2",
            params![emoji, id],
        )?;
    }
    if let Some(color) = &patch.color {
        conn.execute(
            "UPDATE categories SET color = ?1 WHERE id = ?2",
            params![color, id],
        )?;
    }
    if let Some(budget) = patch.budget_cents {
        conn.execute(
            "UPDATE categories SET budget_cents = ?1 WHERE id = ?2",
            params![budget, id],
        )?;
    }
    if let Some(excluded) = patch.excluded {
        conn.execute(
            "UPDATE categories SET excluded = ?1 WHERE id = ?2",
            params![excluded as i64, id],
        )?;
    }
    if let Some(essential) = patch.essential {
        conn.execute(
            "UPDATE categories SET essential = ?1 WHERE id = ?2",
            params![essential as i64, id],
        )?;
    }
    if let Some(archived) = patch.archived {
        conn.execute(
            "UPDATE categories SET archived = ?1 WHERE id = ?2",
            params![archived as i64, id],
        )?;
    }
    if let Some(group_id) = patch.group_id {
        conn.execute(
            "UPDATE categories SET group_id = ?1 WHERE id = ?2",
            params![group_id, id],
        )?;
    }
    Ok(())
}

/// An emoji for a category name, by keyword (used when a category is created without one).
pub fn suggest_emoji(name: &str) -> &'static str {
    const BY_WORD: &[(&str, &str)] = &[
        ("wedding", "💍"),
        ("legal", "⚖️"),
        ("lawyer", "⚖️"),
        ("coffee", "☕"),
        ("nespresso", "☕"),
        ("cafe", "☕"),
        ("rent", "🏠"),
        ("mortgage", "🏠"),
        ("home", "🏠"),
        ("outdoor", "🏕️"),
        ("camping", "🏕️"),
        ("addiction", "🚬"),
        ("tobacco", "🚬"),
        ("alcohol", "🍷"),
        ("bar", "🍸"),
        ("productivity", "🗂️"),
        ("software", "💻"),
        ("subscription", "🔁"),
        ("pet", "🐾"),
        ("gym", "🏋️"),
        ("fitness", "🏋️"),
        ("travel", "✈️"),
        ("hotel", "🏨"),
        ("gift", "🎁"),
        ("donation", "🎁"),
        ("child", "🧸"),
        ("kid", "🧸"),
        ("baby", "🍼"),
        ("school", "📚"),
        ("education", "📚"),
        ("book", "📚"),
        ("health", "🩺"),
        ("doctor", "🩺"),
        ("dental", "🦷"),
        ("pharmacy", "💊"),
        ("insurance", "🛡️"),
        ("tax", "🧾"),
        ("fee", "🧾"),
        ("car", "🚗"),
        ("parking", "🅿️"),
        ("fuel", "⛽"),
        ("gas", "⛽"),
        ("phone", "📱"),
        ("internet", "🌐"),
        ("utilities", "💡"),
        ("electric", "💡"),
        ("water", "🚰"),
        ("grocer", "🛒"),
        ("food", "🍽️"),
        ("restaurant", "🍽️"),
        ("dining", "🍽️"),
        ("shop", "🛍️"),
        ("cloth", "👕"),
        ("beauty", "💄"),
        ("hair", "💇"),
        ("music", "🎵"),
        ("game", "🎮"),
        ("entertain", "🎟️"),
        ("movie", "🎬"),
        ("sport", "🏅"),
        ("invest", "📈"),
        ("saving", "🏦"),
        ("income", "💰"),
        ("salary", "💰"),
    ];
    let lower = name.to_lowercase();
    // Prefer the most specific part ("Housing & Utilities - Rent" -> "rent").
    let parts: Vec<&str> = lower.rsplit(" - ").collect();
    for part in parts {
        let words: Vec<&str> = part
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
            .collect();
        if let Some((_, e)) = BY_WORD.iter().find(|(key, _)| {
            // The key, or the key with a common ending ("outdoors", "groceries", "entertainment").
            const ENDINGS: &[&str] = &["", "s", "es", "ies", "ren", "ment", "ing"];
            words.iter().any(|w| {
                w.strip_prefix(key)
                    .is_some_and(|rest| ENDINGS.contains(&rest))
            })
        }) {
            return e;
        }
    }
    "🏷️"
}

/// Give every category without an emoji one suggested from its name. Returns how many changed.
pub fn fill_missing_emojis(conn: &Connection) -> Result<usize> {
    let mut stmt = conn.prepare(
        "SELECT id, coalesce(legacy_name, name) FROM categories WHERE emoji IS NULL OR trim(emoji) = ''",
    )?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<std::result::Result<_, _>>()?;
    for (id, name) in &rows {
        conn.execute(
            "UPDATE categories SET emoji = ?1 WHERE id = ?2",
            params![suggest_emoji(name), id],
        )?;
    }
    Ok(rows.len())
}
