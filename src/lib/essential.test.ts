import { describe, expect, it } from 'vitest';
import { defaultEssential } from './essential';

// Mirrors crates/core/tests/essential_test.rs.
describe('defaultEssential', () => {
  it('needs by name', () => {
    for (const n of ['Rent', 'Electric', 'Gas', 'Car Insurance', 'Mortgage', 'Pharmacy', 'Student Loan', 'Water', 'Phone & Internet', 'Groceries', 'Whole Foods', 'Public Transit', 'Healthcare'])
      expect(defaultEssential(n), n).toBe(true);
  });
  it('wants by name', () => {
    for (const n of ['Gym', 'Gas station snacks', 'Restaurants', 'Travel', 'Coffee', 'Rideshare']) expect(defaultEssential(n), n).toBe(false);
  });
});
