// Used by .github/workflows/release.yml.
//   node scripts/ci-release-notes.ts body v0.2.0      -> the GitHub release body (that version's notes + install steps)
//   node scripts/ci-release-notes.ts latest latest.json -> rewrites latest.json so its notes are the full changelog,
//                                                       which lets the app show every version since the installed one.
import { readFileSync, writeFileSync } from 'node:fs';
import { sectionFor } from '../src/lib/changelog.ts';

const [mode, arg] = process.argv.slice(2);
const changelog = readFileSync('CHANGELOG.md', 'utf8');

const INSTALL = `### Install

**Mac** (Apple Silicon and Intel)
1. Download **SlayBudget_*_universal.dmg** below.
2. Open it and drag **SlayBudget** to **Applications**.
3. First launch: right-click SlayBudget in Applications and choose **Open** (or System Settings > Privacy & Security > **Open Anyway**). This build isn't notarized by Apple yet.
   If macOS says the app is damaged, run \`xattr -dr com.apple.quarantine /Applications/SlayBudget.app\` in Terminal.

**Windows and Linux (untested)**: these builds are made automatically but haven't been tried on a real Windows or Linux machine yet. If something doesn't work, please [open an issue](https://github.com/ashvtol/SlayBudget/issues).
- **Windows**: download **SlayBudget_*_x64-setup.exe** (or the **.msi**) and run it. It isn't code-signed yet, so Windows SmartScreen may warn you: choose **More info > Run anyway**.
- **Linux**: download the **.AppImage** (make it executable with \`chmod +x\`, then run it) or the **.deb** (\`sudo apt install ./SlayBudget_*.deb\`).

Already installed? SlayBudget updates itself: it checks for new versions and shows what's new before installing.`;

if (mode === 'body') {
  const version = (arg ?? '').replace(/^v/, '');
  const section = sectionFor(changelog, version);
  if (!section) {
    console.error(`No CHANGELOG.md section for ${version}`);
    process.exit(1);
  }
  process.stdout.write(`## What's new in ${version}\n\n${section.body}\n\n${INSTALL}\n`);
} else if (mode === 'latest') {
  const json = JSON.parse(readFileSync(arg, 'utf8'));
  json.notes = changelog;
  writeFileSync(arg, `${JSON.stringify(json, null, 2)}\n`);
} else {
  console.error('usage: ci-release-notes.ts body <tag> | latest <latest.json>');
  process.exit(1);
}
