#!/usr/bin/env bash
# Runs the core test suite and exits non-zero on any failure, printing a pass count.
set -uo pipefail
out=$(cargo test -p slaybudget-core 2>&1)
status=$?
echo "$out" | grep -E "FAILED|panicked|^error" | head -20
if [ $status -ne 0 ]; then echo "RED"; exit 1; fi
echo "$out" | grep -E "^test result" | awk '{s+=$4} END{print "core passed:", s}'
