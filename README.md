# SlayBudget: free, open-source, local-first budgeting app for Mac

**SlayBudget** is a private personal finance and budget tracker for macOS. Import your bank and credit card
statements, let it categorize your spending automatically, set monthly budgets, track recurring bills and
subscriptions, and see where your money goes. There's no subscription, no account and no cloud: your financial data
stays in one SQLite file on your Mac.

If you want a **Copilot Money, YNAB or Mint alternative** that keeps everything offline, this is it.

> Built with Tauri 2, a Rust core over SQLite, and React. Fast, small (a native macOS app, not Electron), and fully
> offline.

## Features

- **Import bank statements**: CSV, PDF and QFX/OFX statements, with built-in layouts for American Express, Citi
  credit cards and Citi checking, plus a generic CSV importer. Duplicates are skipped and a watched folder imports
  new statements automatically.
- **Automatic categorization**: learns from your corrections (merchant learning), explicit rules, and bank-provided
  categories. Clean up "Other" in bulk with suggestions.
- **Budgets**: monthly budgets per category or per group, per-month overrides, rollovers, and a one-click
  rebalance.
- **Dashboard**: free to spend this month, net income, transactions to review, top categories and upcoming bills.
- **Categories view**: spending vs budget over 24 months; click any month to see that month's categories and
  transactions, and edit a transaction in place.
- **Cash flow**: income vs spending by week, month or year.
- **Recurring bills and subscriptions**: detected automatically, with due dates, reminders and pause/archive.
- **Insights**: an interactive spending map (treemap) by category and merchant.
- **Transactions**: fast search, filters (category, tag, account, type, amount, date), splits, refunds, notes,
  tags, transfers and income types, and the original statement details.
- **Multiple profiles**: separate household members' accounts, viewed alone or combined.
- **Privacy first**: no telemetry and no bank logins. Back up the database with one click, and export your
  categorization rules without any personal information.
- **Accessible and themeable**: light, dark and system themes, reduced motion, and keyboard shortcuts.

## Why local-first?

Budgeting apps usually need your bank credentials and keep your transactions on their servers. SlayBudget reads
the statements you download yourself and never sends them anywhere. You own the data, it works offline, and
there's nothing to cancel.

## Install and run (macOS)

Prerequisites: Xcode Command Line Tools (`xcode-select --install`), Rust (via rustup) and Node.js 20+.

```sh
git clone https://github.com/ashvtol/SlayBudget.git
cd SlayBudget
npm install
npm run tauri dev                              # run in development
npx tauri build --debug --bundles app          # build SlayBudget.app
```

Your database lives at `~/Library/Application Support/dev.ashvtol.slaybudget/slaybudget.db`.

## Develop

```sh
npm run check          # every gate: cargo test, clippy, fmt, typecheck, eslint, vitest
cargo test -p slaybudget-core
npm test
```

Project layout:

- `crates/core`: Rust business logic (storage and migrations, importers, categorization, analytics)
- `src-tauri`: the Tauri app shell and commands
- `src`: the React UI (Zustand stores, ECharts charts)

Money is stored as integer cents and never as floating point. See `SPEC.md`, `CONSTRAINTS.md` and `docs/adr/` for
design decisions.

## Tech stack

Tauri 2 · Rust · SQLite (rusqlite) · React 19 · TypeScript · Vite · Tailwind CSS · ECharts · Zustand · Vitest

## Contributing

Issues and pull requests are welcome. Please run `npm run check` before opening a PR, and never commit real
statements or financial data: test fixtures must be synthetic.

## License

[MIT](LICENSE)

---

SlayBudget is an independent project and is not affiliated with Copilot Money, YNAB, Intuit or Mint.
