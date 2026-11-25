# SlayBudget architecture

SlayBudget is a local-first Mac app: one SQLite file on your computer, a Rust core that owns every rule, and a React
interface. Nothing leaves your machine.

```
┌──────────────────────────── React UI (src/) ─────────────────────────────┐
│  features/*  screens and their pure models (recurrings-model, bill-credits) │
│  lib/ipc.ts  one interface for every call into the core                     │
│      ├─ tauri-ipc.ts   the Mac app: Tauri commands                          │
│      └─ createMemoryIpc  the browser preview and tests: an in-memory copy    │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     │  invoke('command', args)
┌────────────────────── Tauri shell (src-tauri/) ──────────────────────────┐
│  commands.rs   thin commands: open the database, call the core, record undo │
│  lib.rs        windows, menus, the folder watcher, native notifications     │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     │
┌──────────────────────── Rust core (crates/core/) ────────────────────────┐
│  db/          open, migrate (migrations/*.sql), back up before big changes  │
│  import/      CSV, PDF, OFX/QFX parsers and the import pipeline             │
│  categorize/  rules, learned merchants, the on-device classifier, transfers │
│  recurrings   saved bills: rules that claim charges, seeding, matching      │
│  price_changes  "new price?" checks, merging bills, look-alike bills        │
│  analytics/   budgets, cash flow, recurring detection, refunds              │
│  notifications/  what to tell you and when                                  │
│  undo         SQLite session changesets for ⌘Z and ⇧⌘Z                      │
└───────────────────────────────────────────────────────────────────────────┘
```

## Principles

- **The core owns the rules.** Matching a charge to a bill, deciding a price changed or a category moved: all of it is
  Rust in `crates/core`, tested there. Commands in `src-tauri` only open the database, call the core and record undo.
- **Money is integer cents.** Amounts are `i64` cents everywhere; conversion to other currencies is done for display
  with each month's built-in exchange rate.
- **Rules, not edits.** A fix is a rule the app applies to every transaction and bill, triggered by an import, a change
  you make, or opening the app. Data is never patched by hand in the code paths.
- **Computed when shown, stored when chosen.** What you decide (a bill's rules, "paid back by", "not the same") is
  stored. What follows from it (credits paired with charges, price arrows, merge suggestions) is computed each time a
  screen loads, so it can't go stale.
- **Nothing is removed for you.** Destructive actions ask first, back up the database and can be undone.

## The two IPC implementations

`src/lib/ipc.ts` defines the `Ipc` interface the UI uses. The Mac app uses `tauri-ipc.ts`, which calls Rust commands.
The browser preview (`npm run dev`) and the Vitest suite use `createMemoryIpc`, an in-memory implementation seeded
with synthetic data (`src/lib/sample-data.ts`). The memory version mirrors the Rust behavior; comments in it name the
Rust function each part mirrors ("Mirrors `recurrings::rematch`"). When you change a rule in Rust, change its mirror
and add a test on both sides.

## When rules run

| Trigger | What runs |
|---|---|
| An import | New charges join their bills (`recurrings::after_import`), price changes are checked, transfers paired, duplicates flagged, categories suggested |
| Opening the app | Migrations (with a backup first), then charges an earlier version's rules skipped are linked (`recurrings::link_unlinked`) |
| Changing a category | The merchant's other transactions follow, and each affected bill takes its latest charge's category (`recurrings::follow_charges`) |
| Opening a screen | Pure models compute what's shown: `buildRecurrings` (credits, totals), `suggestPayback`, price arrows, merge groups |

## Recurring bills, in more detail

A saved bill (`recurrings`) is a rule: a name to match (the merchant, or "contains"), other names it goes by, an amount
range, a frequency and an optional due day. A charge joins a bill when its name and amount fit, on the due day, or off
it when that billing period has no other charge. Payment apps (Venmo, Zelle, PayPal) only count when the bill names the
person the payment went to.

- **Price changes** (`price_changes::detect`): a charge whose name fits a bill but whose amount is outside its range is
  asked about once. Answers move the bill to the new price with a price history, note a one-off, or start a new bill.
- **Look-alikes** (`price_changes::look_alikes`): bills with the same merchant, or one subscription whose statement
  name changed (one bill stops as the other starts, with related names or the same price on the same day). The UI
  groups pairs into one suggestion per subscription.
- **Merging** keeps the older bill, all charges, every name and the credits, and compares prices where one bill hands
  over to the other.
- **Credits** (`src/features/recurrings/bill-credits.ts`): a bill can be "paid back by" named credits. Credits are
  paired with charges across all bills at once, nearest first, so a credit shared by several bills counts once.

## Storage

One SQLite database (`slaybudget.db`) in the app's data folder. Migrations live in `crates/core/migrations` and run
in order on open; migrations that change how data is kept copy the database beside itself first
(`slaybudget.before-<change>-<time>.db`). Undo uses SQLite's session extension: each action's changeset is kept, and
undo applies its inverse.

## Tests

- `cargo test -p slaybudget-core`: the rules, against an in-memory database (`crates/core/tests`).
- `npx vitest run`: pure models, the memory IPC and every screen with Testing Library (`*.test.ts(x)` next to the code).
- `npm run check` runs both plus clippy, rustfmt, TypeScript and ESLint. It must be green before a commit.

## Releases

`npm run release -- x.y.z` promotes the changelog, `npm run release:rehearse` builds and checks the Mac app locally,
and `npm run publish:github -- --tag` publishes a scrubbed copy of the tree; GitHub Actions builds signed installers and
the update feed. See [RELEASE.md](RELEASE.md).

Design decisions are recorded in [docs/adr](docs/adr), the product spec in [SPEC.md](SPEC.md) and the hard limits in
[CONSTRAINTS.md](CONSTRAINTS.md).
