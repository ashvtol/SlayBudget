// Pure query parser + in-memory search, mirroring crates/core/src/search.
// Backs the memory IPC double; the desktop app uses the Rust FTS version.

import { shiftMonths } from './analytics';
import type { Transaction } from './types';

export interface ParsedQuery {
  text: string;
  minAbsCents: number | null;
  maxAbsCents: number | null;
  from: string | null;
  to: string | null;
  incomeOnly: boolean;
  expenseOnly: boolean;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function money(tok: string): number | null {
  const cleaned = tok.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const v = Number.parseFloat(cleaned);
  return Number.isNaN(v) ? null : Math.round(v * 100);
}
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function lastOfMonth(year: number, month1: number): string {
  return new Date(Date.UTC(year, month1, 0)).toISOString().slice(0, 10);
}
function monthRange(year: number, month1: number): [string, string] {
  return [`${year}-${String(month1).padStart(2, '0')}-01`, lastOfMonth(year, month1)];
}

export function parseQuery(input: string, today: string): ParsedQuery {
  const tokens = input.toLowerCase().split(/\s+/).filter(Boolean);
  const q: ParsedQuery = { text: '', minAbsCents: null, maxAbsCents: null, from: null, to: null, incomeOnly: false, expenseOnly: false };
  const year = Number(today.slice(0, 4));
  const leftover: string[] = [];

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const next = tokens[i + 1];

    if ((t === 'over' || t === 'above' || t === '>' || t === 'more') && next && money(next) != null) {
      q.minAbsCents = money(next);
      i += 2;
      continue;
    }
    if ((t === 'under' || t === 'below' || t === '<' || t === 'less') && next && money(next) != null) {
      q.maxAbsCents = money(next);
      i += 2;
      continue;
    }
    if (t.startsWith('>') && money(t.slice(1)) != null) { q.minAbsCents = money(t.slice(1)); i += 1; continue; }
    if (t.startsWith('<') && money(t.slice(1)) != null) { q.maxAbsCents = money(t.slice(1)); i += 1; continue; }

    if (t === 'income') { q.incomeOnly = true; i += 1; continue; }
    if (t === 'expenses' || t === 'expense' || t === 'spending') { q.expenseOnly = true; i += 1; continue; }

    if ((t === 'this' || t === 'last') && next) {
      const back = t === 'last';
      if (next === 'week') {
        if (back) { q.from = addDays(today, -13); q.to = addDays(today, -7); }
        else { q.from = addDays(today, -6); q.to = today; }
        i += 2; continue;
      }
      if (next === 'month') {
        const anchor = back ? shiftMonths(today, -1) : today;
        const [s, e] = monthRange(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)));
        q.from = s; q.to = e; i += 2; continue;
      }
      if (next === 'year') {
        const y = back ? year - 1 : year;
        q.from = `${y}-01-01`; q.to = `${y}-12-31`; i += 2; continue;
      }
    }
    if (t === 'ytd' || (t === 'year' && next === 'to')) {
      q.from = `${year}-01-01`; q.to = today;
      i += t === 'ytd' ? 1 : 3;
      continue;
    }

    if (t === 'in' && next) {
      const idx = MONTHS.findIndex((m) => next.length >= 3 && m.startsWith(next));
      if (idx >= 0) {
        const maybeYear = Number(tokens[i + 2]);
        const useYear = maybeYear >= 2000 && maybeYear <= 2100 ? maybeYear : year;
        const [s, e] = monthRange(useYear, idx + 1);
        q.from = s; q.to = e;
        i += maybeYear >= 2000 && maybeYear <= 2100 ? 3 : 2;
        continue;
      }
      const y = Number(next);
      if (y >= 2000 && y <= 2100) { q.from = `${y}-01-01`; q.to = `${y}-12-31`; i += 2; continue; }
    }

    leftover.push(t);
    i += 1;
  }
  q.text = leftover.join(' ');
  return q;
}

/** Run a parsed query over an in-memory transaction list, newest first. */
export function runSearch(txs: Transaction[], q: ParsedQuery, limit: number): Transaction[] {
  const terms = q.text.split(/\s+/).map((w) => w.replace(/[^a-z0-9]/gi, '').toLowerCase()).filter(Boolean);
  const matches = txs.filter((t) => {
    if (q.minAbsCents != null && Math.abs(t.amountCents) < q.minAbsCents) return false;
    if (q.maxAbsCents != null && Math.abs(t.amountCents) > q.maxAbsCents) return false;
    if (q.from && t.postedOn < q.from) return false;
    if (q.to && t.postedOn > q.to) return false;
    // By type, as the core does: transfers are neither income nor spending.
    if (q.incomeOnly && (t.txType ?? 'regular') !== 'income') return false;
    if (q.expenseOnly && ((t.txType ?? 'regular') !== 'regular' || t.amountCents >= 0)) return false;
    if (terms.length) {
      const hay = `${t.description} ${t.merchant} ${t.notes ?? ''}`.toLowerCase();
      if (!terms.every((term) => hay.includes(term))) return false;
    }
    return true;
  });
  matches.sort((a, b) => b.postedOn.localeCompare(a.postedOn) || b.id - a.id);
  return matches.slice(0, limit);
}
