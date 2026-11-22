# Changelog

All notable changes to SlayBudget are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

## [0.3.0] - 2026-11-22
### Added
- **Possible duplicates.** When an import brings in a row that looks like one you already have but doesn't match
  exactly, it's tagged "Possible duplicate" (amber), marked to review, and explained: the same charge worded
  differently, a tip added later, a card hold replaced by the final charge, or a pending charge that posted up to a
  week later. Rows the new file repeats exactly are never flagged, so weekly habits stay quiet.
  - The import results list them ("3 to check"), and the bell gets one item per import.
  - In a flagged transaction: **Delete this one**, **Delete the other one**, or **Not a duplicate** (that pair is
    never flagged again).
- **Delete transactions**, one or many, from the selection bar or the trash button next to Review.
- **Undo an import** from the new Recent imports list on the Import page. It removes only what that file added, so
  you can import it again.
- A backup of your data is made before every delete or undo (the newest 3 of each are kept).

## [0.2.1] - 2026-11-22
### Changed
- Toggles slide smoothly, the way macOS switches do.

### Removed
- The "Send a test banner" button in notification settings.

## [0.2.0] - 2026-11-22
### Added
- **Notifications.** A bell in the top bar of every screen collects alerts, with an unread count; click one to jump
  straight to it.
  - Upcoming bills (you choose how many days before, and again on the due day) and bills that look missed.
  - Subscription price increases, possible double charges and large transactions.
  - Over budget or on pace to overspend, a monthly recap on the 1st, and a weekly "to review" reminder.
  - Paychecks and refunds arriving, and new versions of SlayBudget.
- **Mac banners** for the same alerts while SlayBudget is open; clicking one opens exactly what it's about. Quiet
  hours hold them overnight, and a burst of alerts arrives as one summary.
- **Notification settings**: turn each kind on or off for the bell and banners, and tune every threshold.

### Changed
- Bill reminders now follow the recurring bills you've saved, instead of guessing from your history.
- Settings switches are now macOS-style slide toggles.

## [0.1.0] - 2026-11-22

The first public release.

### Added
- Import bank and card statements: CSV, PDF and QFX/OFX, with built-in layouts for American Express, Citi credit
  cards and Citi checking, a generic CSV importer, duplicate detection and a watched folder.
- Automatic categorization that learns from your corrections, explicit rules, bank-provided categories, and a
  Clean up Other review.
- Dashboard with free to spend, net income, transactions to review, top categories and upcoming bills.
- Transactions with instant search, filters, splits, refunds, notes, tags, transaction types and statement details.
- Categories with budgets per category or group, per-month overrides, rollovers, rebalancing and 24 months of
  history; click a month to see it, and edit any transaction in a side pane.
- Cash flow, recurring bills and subscriptions with reminders, and an Insights spending map.
- Profiles for household members, four themes, accessibility settings and keyboard shortcuts.
- One-click database backup, and export of categorization rules with nothing that identifies you.
- Automatic update checks that show what's new between your version and the latest one.
