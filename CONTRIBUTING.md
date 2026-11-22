# Contributing to SlayBudget

Thanks for helping make a free, private budgeting app better.

## Getting started

```sh
npm install
npm run dev            # the UI in your browser with sample data
npm run tauri dev      # the full Mac app
npm run check          # every gate: cargo test, clippy, fmt, typecheck, eslint, vitest
```

## Ground rules

- **Never commit real financial data.** Statements, exports and databases stay on your machine. Test fixtures must be
  synthetic.
- **Money is integer cents.** Never use floating point for amounts.
- **Tests first.** Add a failing test for the behavior, then make it pass. `npm run check` must be green.
- **Keep data local.** No telemetry, analytics or network calls with user data.

## Good first contributions

- A statement importer for your bank (`crates/core/src/import`), with a synthetic fixture and tests.
- Accessibility and keyboard improvements.
- Bug reports with steps to reproduce on the sample data.

## Pull requests

Keep them focused, describe the user-visible change, and include screenshots for UI changes (sample data only).
