import { describe, expect, it } from 'vitest';
import { bumpVersions, parseBlocklist, findBlocked, isPublished, promoteChangelog } from './release-lib.ts';

const MD = `# Changelog\n\n## [Unreleased]\n### Added\n- Goals\n\n## [0.1.0] - 2026-11-22\n- First\n`;

describe('promoteChangelog', () => {
  it('turns Unreleased notes into a dated section and leaves an empty Unreleased', () => {
    const out = promoteChangelog(MD, '0.2.0', '2026-12-01');
    expect(out).toContain('## [Unreleased]\n\n## [0.2.0] - 2026-12-01\n### Added\n- Goals');
    expect(out).toContain('## [0.1.0] - 2026-11-22');
  });
  it('keeps an existing dated section as it is', () => {
    const md = MD.replace('## [Unreleased]\n### Added\n- Goals\n', '## [Unreleased]\n\n## [0.2.0] - 2026-11-30\n- Done\n');
    expect(promoteChangelog(md, '0.2.0', '2026-12-01')).toBe(md);
  });
  it('refuses a release with no notes', () => {
    const md = MD.replace('### Added\n- Goals\n', '');
    expect(() => promoteChangelog(md, '0.2.0', '2026-12-01')).toThrow(/no changelog/i);
  });
});

describe('bumpVersions', () => {
  const files = {
    packageJson: '{\n  "name": "slaybudget",\n  "version": "0.1.0",\n  "type": "module"\n}\n',
    packageLock: '{\n  "name": "slaybudget",\n  "version": "0.1.0",\n  "packages": {\n    "": {\n      "name": "slaybudget",\n      "version": "0.1.0"\n    },\n    "node_modules/x": { "version": "0.1.0" }\n  }\n}\n',
    tauriConf: '{\n  "productName": "SlayBudget",\n  "version": "0.1.0"\n}\n',
    cargoToml: '[workspace.package]\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nfoo = { version = "0.1.0" }\n',
  };
  it('bumps the app version in every file, and nothing else', () => {
    const out = bumpVersions(files, '0.2.0');
    expect(JSON.parse(out.packageJson).version).toBe('0.2.0');
    const lock = JSON.parse(out.packageLock);
    expect(lock.version).toBe('0.2.0');
    expect(lock.packages[''].version).toBe('0.2.0');
    expect(lock.packages['node_modules/x'].version).toBe('0.1.0');
    expect(JSON.parse(out.tauriConf).version).toBe('0.2.0');
    expect(out.cargoToml).toContain('[workspace.package]\nversion = "0.2.0"');
    expect(out.cargoToml).toContain('foo = { version = "0.1.0" }');
  });
  it('refuses a malformed version or one that is not newer', () => {
    expect(() => bumpVersions(files, '0.2')).toThrow(/x\.y\.z/);
    expect(() => bumpVersions(files, '0.1.0')).toThrow(/newer/);
  });
});

describe('publishing filters', () => {
  it('leaves private folders out', () => {
    expect(isPublished('src/app/app.tsx')).toBe(true);
    expect(isPublished('docs/screenshots/dashboard.png')).toBe(true);
    for (const p of ['tasks/todo.md', 'docs/superpowers/specs/x.md', 'docs/launch/show-hn.md', '.claude/launch.json', '.publish-blocklist']) {
      expect(isPublished(p)).toBe(false);
    }
  });
  it('reads blocklist patterns, ignoring blanks and comments, and finds files that match', () => {
    const patterns = parseBlocklist('# personal\njane\n\nexample@mail\\.com\n');
    expect(patterns).toHaveLength(2);
    const hits = findBlocked([{ path: 'a.ts', content: 'const user = "Jane";' }, { path: 'b.ts', content: 'ok' }], patterns);
    expect(hits).toEqual([{ path: 'a.ts', pattern: 'jane' }]);
  });
});
