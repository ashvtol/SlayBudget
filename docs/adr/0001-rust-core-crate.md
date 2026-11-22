# ADR 0001: All business logic lives in a Tauri-free Rust crate

Status: accepted, 2026-11-16

## Context
Development happens in a Linux cloud workspace where the Tauri shell cannot be compiled (no WebKitGTK), while the app itself runs on macOS. Every behavior must be testable where development happens.

## Decision
`crates/core` (`slaybudget-core`) holds storage, import, categorization, analytics, currency and search with no dependency on Tauri. `src-tauri` is a thin layer: it opens the database, holds the connection behind a mutex, and maps each core use case to one command. The workspace's default members exclude `src-tauri`, so `cargo test` and `cargo clippy` run on Linux; the shell compiles on the Mac with `npm run tauri dev`.

## Consequences
- Core carries the test coverage; the shell stays small enough to review by eye.
- Shell compile errors surface only on the Mac, so the shell changes in small steps.
