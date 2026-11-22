# Spec: SlayBudget — V1

Status: approved.

## Objective

A personal, local-first budgeting app for macOS with the feature set of Copilot Money and no subscription. One person with optional extra profiles (household members), each with their own statement sources, viewable alone or combined.

Success looks like: you drop your card and bank statements (Amex, Citi and generic CSV/PDF/QFX layouts) into the app, every transaction is categorized the way you have taught it, and the dashboard, cash flow, categories and recurring views answer "where did the money go" in under a second with no cloud account.

User stories for V1:
1. Import statements (CSV, PDF, OFX/QFX) from files or a watched folder; re-importing a file never duplicates transactions.
2. See transactions grouped by day, with category pills, review status, search, filters, sort, bulk edit, split, notes, tags.
3. Have transactions auto-categorized by rules and a learning merchant model; corrections teach the model; payment platforms and gas stations never batch-learn.
4. Organize categories in two tiers (group, category) with emoji, color, monthly budget, and an "excluded" flag.
   Add categories from the Categories screen (templates or a form), edit them (name, emoji, color, group, Regular/Excluded), and delete them (transactions move to "Other", which cannot be deleted). Spec: `docs/superpowers/specs/2026-11-21-category-management-design.md`.
5. Dashboard: left this month vs budget with a projection, net this month, to-review list, top categories, next two weeks of recurring charges.
6. Cash flow by period with comparison to the previous period; categories page with budgets and monthly bars; recurring detection with rules and upcoming bills.
7. Switch themes (Navy, Graphite, Daylight, Aurora) from Settings or the View menu; switch profiles from the sidebar.
8. Show amounts in another currency using the rate on the transaction date, the monthly average, or the latest rate.
9. Reminders and notifications: bill due, budget threshold, import reminder, unusual charge.
10. Migrate the existing Financial-Tracker data (1,855 transactions, 292 learned merchants, 10 custom categories) on first launch.
11. Auto-update from GitHub Releases.

## Capability Map

| Module id | Responsibility | Depends on |
|---|---|---|
| core-db | SQLite schema, migrations, typed repository API | — |
| categorize | Merchant extraction, learning model, rules engine, refund matching | core-db |
| import | CSV/PDF/OFX parsers, dedupe, legacy JSON migration, watched folder | core-db, categorize |
| analytics | Monthly, category, cash-flow aggregations, budgets, recurring detection, projections | core-db |
| currency | FX rate store, fetch, conversion by date/month/latest | core-db |
| search | FTS5 index, query parser (amount/date phrases), command palette entries | core-db |
| shell-ui | Tauri app, window, menu bar, sidebar, theme tokens, settings panes, profile switcher | core-db |
| transactions-ui | List, detail pane, filters, bulk actions, category picker, split | shell-ui, categorize, search |
| dashboard-ui | Dashboard, cash flow, categories, recurring, insights views, charts | shell-ui, analytics |
| notify | Reminder scheduler, macOS notifications, autostart, menu bar glance | shell-ui, analytics |
| bank-sync | Plaid (then Teller) connections as an import source | import |
| distribute | Updater, release workflow, signing-free DMG | shell-ui |

Build order: core-db → categorize, analytics, currency, search → import → shell-ui → transactions-ui → dashboard-ui → notify → bank-sync → distribute.

## Tech Stack

- Tauri 2.x (Rust 1.97, `tauri` 2, `tauri-plugin-updater`, `-notification`, `-autostart`, `-dialog`, `-fs`, `-store`, `-window-state`, `-global-shortcut`)
- Rust core crate `slaybudget-core` (no Tauri dependency): `rusqlite` 0.43 bundled with FTS5, `chrono`, `serde`, `serde_json`, `thiserror`, `csv`, `rust_decimal`
- Frontend: Vite 8, React 19, TypeScript 5, Tailwind 4, Zustand, ECharts (canvas charts), TanStack Virtual
- Tests: `cargo test` (core), Vitest + Testing Library (UI), WebdriverIO/tauri-driver for a handful of E2E flows on the Mac
- PDF parsing: pdf.js in the webview for V1 (ported parsers), text handed to Rust for structuring

Money is stored as integer minor units (cents) in SQLite; never floats.

## Commands

```
Core tests:        cargo test -p slaybudget-core
Core focused:      cargo test -p slaybudget-core <name>
Core lint:         cargo clippy -p slaybudget-core -- -D warnings && cargo fmt --check
UI tests:          npm test            (vitest run)
UI focused:        npx vitest run <file>
UI lint/types:     npm run lint && npm run typecheck
Dev app (Mac):     npm run tauri dev
Build app (Mac):   npm run tauri build
All checks:        npm run check       (cargo test + clippy + vitest + typecheck)
```

## Project Structure

```
SPEC.md, CONSTRAINTS.md        → spec and quality bar
tasks/plan.md, tasks/todo.md   → implementation plan and task list
docs/adr/                      → architecture decision records
crates/core/                   → Rust core library (all business logic)
  src/db/                      → schema, migrations, repositories
  src/categorize/, import/, analytics/, currency/, search/
  tests/                       → integration tests against a temp SQLite file
  tests/fixtures/              → synthetic statements in real layouts (no real data)
src-tauri/                     → Tauri shell: commands, menu, notifications, updater
src/                           → React app
  app/                         → shell, routing, theme, settings
  features/<name>/             → one folder per screen (transactions, dashboard, ...)
  components/                  → shared UI primitives
  lib/                         → IPC client, formatters, stores
  test/                        → test setup and shared test utils
```

## Code Style

Rust: 2021 edition, `rustfmt` defaults, `clippy` clean, errors via `thiserror`, no `unwrap` outside tests. Repository functions take `&Connection` and return `Result<T, CoreError>`.

```rust
pub fn insert_transaction(conn: &Connection, tx: &NewTransaction) -> Result<TransactionId, CoreError> {
    conn.execute(
        "INSERT INTO transactions (profile_id, source_id, posted_on, description, amount_cents) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![tx.profile_id, tx.source_id, tx.posted_on, tx.description, tx.amount_cents],
    )?;
    Ok(TransactionId(conn.last_insert_rowid()))
}
```

TypeScript: strict, function components, named exports, Zustand stores in `lib/stores`, no default exports except pages. Theme colors only through CSS variables (`var(--accent)`), never literal hex in components.

```tsx
export function AmountText({ cents, currency }: { cents: number; currency: string }) {
  return <span className="tabular-nums" style={{ color: cents < 0 ? 'var(--neg)' : 'var(--text)' }}>{formatMoney(cents, currency)}</span>;
}
```

Naming: `snake_case` in Rust and SQL, `camelCase` in TS, `kebab-case` files in `src/`. Em dashes are not used in any text.

## Testing Strategy

- Red, green, refactor for every behavior. A bug is reproduced by a failing test before it is fixed.
- Pyramid: ~80% unit (pure Rust functions, pure TS functions, component tests), ~15% integration (repositories against a temp SQLite, importers over fixtures, IPC command tests), ~5% E2E on the Mac.
- Fixtures are synthetic statements that copy the real files' column layout and line structure only. No real transactions, balances or account numbers are committed.
- Core coverage target: 85% lines. UI: every feature folder has component tests for its main states.
- CI (GitHub Actions, later): `npm run check` on push; Mac build on tags.

## Boundaries

- Always: run the focused tests before and after each slice, run `npm run check` before each commit, commit one slice at a time, keep money in integer cents, keep all data local, record ADRs for decisions that change the data model or a dependency.
- Ask first: schema changes after the first release of a table, adding a dependency over 1 MB or with native code, anything that sends data off the machine (rates, bank sync), deleting user data.
- Never: commit real statements or the legacy JSON, commit secrets or API keys, store money as floats, silence a failing test, remove a test without a replacement, use em dashes.

## Success Criteria

- `npm run check` passes with core coverage ≥ 85%.
- Importing the three fixture statement sets yields the expected transaction counts, and importing them twice yields no new rows.
- The legacy migration imports 1,855 transactions and 292 learned merchants from a real Financial-Tracker export with zero category changes.
- Transactions list scrolls at 60 fps with 10,000 rows (virtualized) and search returns results in under 50 ms on that set.
- Theme switch, profile switch and currency switch each re-render every visible amount and color with no reload.
- A reminder fires as a macOS notification while the window is closed.
- An update published as `latest.json` on GitHub Releases installs from the app.

## Out of Scope (Deferred)

- Goals, Accounts and Investments views: depend on balances that only bank sync provides. V2 after bank-sync.
- Teller as a second sync provider: after Plaid works.
- Rust-native PDF parsing (pdfium): only if pdf.js proves slow.
- iCloud or any sync between Macs.
- An AI assistant: rules and the learning model cover categorization.
- Apple notarization: personal app.

## Open Questions

- Default currency target (EUR vs INR) for the currency picker. Default to USD display with INR as the first alternative.
- Whether search stays open after selecting a result. Default: closes.
