# Contributing to SlayBudget

Thanks for helping make a free, private budgeting app better. Read [ARCHITECTURE.md](ARCHITECTURE.md) first: it
explains where each rule lives and how the pieces fit.

## Getting started

You need Node 22 (what the release builds use), Rust (stable) and, for the Mac app, Xcode's command line tools.

```sh
npm install
npm run dev            # the UI in your browser with synthetic sample data
npm run tauri dev      # the full Mac app, with its own database
npm run check          # every gate: cargo test, clippy, fmt, typecheck, eslint, vitest
```

`npm run dev` never touches a real database: it runs on an in-memory copy seeded from `src/lib/sample-data.ts`. Use it
for UI work and screenshots.

## Ground rules

- **Never commit real financial data.** Statements, exports and databases stay on your machine. Test fixtures and
  screenshots use synthetic data only.
- **Money is integer cents.** Never use floating point for amounts.
- **Tests first.** Write a test that fails for the reason you expect, then make it pass. `npm run check` must be green.
- **Rules, not one-offs.** A fix is a rule the app applies to every transaction and bill, and it should trigger by
  itself (on import, on a change you make, or when the app opens). If the app could suggest it, make it suggest it.
- **Rust and its mirror move together.** A rule in `crates/core` has a mirror in `createMemoryIpc` (`src/lib/ipc.ts`).
  Change both and test both.
- **Keep data local.** No telemetry, analytics or network calls with user data.
- **Back up before changing data.** Migrations and bulk changes copy the database first; anything destructive asks
  and can be undone.

## Where things go

| You're changing | Put it in | Test it in |
|---|---|---|
| A rule (matching, categorizing, bills, budgets) | `crates/core/src` | `crates/core/tests/*_test.rs`, plus the memory mirror in `src/lib/*.test.ts` |
| A database change | a new `crates/core/migrations/00NN_*.sql`, listed in `db/mod.rs` | a core test that opens a migrated database |
| A command the UI calls | `src-tauri/src/commands.rs`, registered in `lib.rs`, typed in `src/lib/ipc.ts` and `tauri-ipc.ts` | the screen test that uses it |
| What a screen shows | a pure model next to the screen (`recurrings-model.ts`, `bill-credits.ts`) | `*.test.ts` beside the model |
| A screen | `src/features/<area>` | `*.test.tsx` with Testing Library and the memory IPC |
| A bank's statement format | `crates/core/src/import` | a synthetic fixture and a parser test |

## Writing copy

Plain words, short sentences, no em dashes. Say what happened and what the person can do ("Merged into Walmart+.",
"Do they pay it back?"). Name things the way the screen names them.

## Good first contributions

- A statement importer for your bank, with a synthetic fixture and tests.
- Accessibility and keyboard improvements.
- Bug reports with steps to reproduce on the sample data.

## Pull requests

Keep them focused, describe the user-visible change, add a line to `CHANGELOG.md` under **Unreleased**, update the
README when a feature changes, and include screenshots for UI changes (sample data only).
