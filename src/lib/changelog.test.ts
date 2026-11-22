import { describe, expect, it } from 'vitest';
import { changelogBetween, compareVersions, parseChangelog } from './changelog';

const MD = `# Changelog

All notable changes to this project.

## [Unreleased]
- Work in progress

## [0.10.0] - 2027-02-01
### Added
- Ten

## [0.9.1] - 2027-01-15
### Fixed
- Nine one

## [0.2.0] - 2026-12-01
### Added
- Two

## [0.1.0] - 2026-11-22
### Added
- First release
`;

describe('compareVersions', () => {
  it('orders by number, not text, and tolerates a v prefix, a missing patch and prereleases', () => {
    expect(compareVersions('0.10.0', '0.9.1')).toBeGreaterThan(0);
    expect(compareVersions('v1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0);
  });
});

describe('parseChangelog', () => {
  it('reads each released version with its date and body, skipping Unreleased and the preamble', () => {
    const p = parseChangelog(MD);
    expect(p.map((s) => s.version)).toEqual(['0.10.0', '0.9.1', '0.2.0', '0.1.0']);
    expect(p[0]).toMatchObject({ date: '2027-02-01' });
    expect(p[0].body).toContain('### Added');
    expect(p[0].body).toContain('- Ten');
    expect(p[0].body).not.toContain('Nine');
  });
});

describe('changelogBetween', () => {
  it('lists every version after the installed one up to the target, newest first', () => {
    expect(changelogBetween(MD, '0.1.0', '0.10.0').map((s) => s.version)).toEqual(['0.10.0', '0.9.1', '0.2.0']);
    expect(changelogBetween(MD, '0.2.0', '0.9.1').map((s) => s.version)).toEqual(['0.9.1']);
  });
  it('is empty for the same version or a downgrade, and for text with no version headings', () => {
    expect(changelogBetween(MD, '0.2.0', '0.2.0')).toEqual([]);
    expect(changelogBetween(MD, '0.9.1', '0.2.0')).toEqual([]);
    expect(changelogBetween('Just some notes', '0.1.0', '0.2.0')).toEqual([]);
  });
});
