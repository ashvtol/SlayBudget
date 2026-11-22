# Constraints

The quality bar every change must clear. Checked by `npm run check`.

| Check | Command | Threshold |
|---|---|---|
| Rust tests | `cargo test -p slaybudget-core` | all pass |
| Rust lint | `cargo clippy -p slaybudget-core -- -D warnings` | zero warnings |
| Rust format | `cargo fmt --check` | clean |
| UI tests | `vitest run` | all pass |
| Types | `tsc --noEmit` | zero errors |
| UI lint | `eslint src` | zero errors |
| Core coverage | `cargo llvm-cov` (when installed) | ≥ 85% lines |

Rules that are not automated:
- Money is `i64` cents. A float in a money path is a bug.
- Every repository function is exercised by at least one integration test against a temp database.
- Every importer has a fixture test and a dedupe test.
- No test is marked ignored or skipped to make a run green. Fix it or delete it with a replacement.
- No real financial data in the repository, ever.
