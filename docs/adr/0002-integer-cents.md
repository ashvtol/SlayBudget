# ADR 0002: Money is stored and computed as integer cents

Status: accepted, 2026-11-16

## Decision
`amount_cents: i64`, negative for money out. Parsing converts decimal strings to cents at the boundary. Currency conversion yields integer cents, rounded once. No `f64` in a money path.

## Consequences
Sums are exact; display divides by 100 at render time.
