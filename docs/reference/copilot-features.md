# Copilot Money: feature reference

Paraphrased from the Copilot Money help center (help.copilot.money, all 16 collections, ~115
articles), read 2026-11-21, plus hands-on checks of the Mac app in demo mode. Used to write
SlayBudget specs. Not a copy of the docs; see the help center for the source.

## Categories
- **Tab:** top chart of this month's spend vs total budget (vs last month when budgeting is off). List sorted by spend. Bar colors: green on pace, yellow/orange heading over, red over; outlined part = expected spend from unpaid recurrings. Past months only green or red.
- **Key metrics:** spent per year (incl. current month so far); average monthly spend = complete months only (current month excluded until it ends).
- **Create (Mac):** "+" at the top of the tab opens a menu: "Start a new one from scratch" plus ~26 templates (Bars & Nightlife, Beauty, Car, Children, Clothing, Dance, Donations, Education, Entertainment, Groceries, Gym, Healthcare, Home, Insurance, Loans, Personal Care, Pets, Recreation, Rent, Restaurants, Senior Care, Shops, Sports, Subscriptions, Transportation, Travel & Vacation, Utilities). A template creates the category immediately (emoji + name, small default budget). From scratch opens a form: Regular/Excluded toggle, emoji, name, budget (default $100), 15 color swatches, Save in the chosen color.
- **Edit:** select a category; name is edited in place (then Save), emoji tapped to change. "⋯" menu: Spending category group ›, Spending category type › (Regular/Excluded), Delete.
- **Delete:** confirm dialog ("can't be undone"). The category's transactions move to **Other**. **Other** can't be deleted, only renamed; it holds anything not categorized.
- **Groups:** one level (groups contain categories). Create from a category's ⋯ > Spending category group > Start a new group. Remove one from a group, or "Ungroup these categories" from the group's menu. A group can have an *unassigned budget* shared by its categories, which also absorbs their overspend.
- **Excluded categories:** don't count toward budget or total spend but still show key metrics. Business spend, renovations, etc.
- **Budgets:** same budget for all months, or different per month (per-month edits flow forward until a month that already has its own). History starts at the category's first transaction; 12 future months.
- **Rebalance:** suggests budget changes to match actual spend while keeping the total; preview; apply "only this month" or "from now on".
- **Rollovers:** opt-in from a start month; cumulative over/under spend carries forward; can be turned off per category.
- **Optional budgeting:** turning budgets off compares spend to last month instead; turning back on restores budgets.
- No income categories (income is a transaction type; tags for income sources). Transfers can't be categorized.

## Transactions
- Types: **Regular** (categorized, budgeted, can be recurring), **Income** (own section, not budgeted, positive amounts only), **Internal transfer** (excluded from budgets). Badges [I], [T], [R].
- Review: unreviewed = blue dot; Dashboard "To review"; bulk mark reviewed. Gray dot = tip included; red dot = split doesn't add up.
- Detail: edit name and date; type; category; split; mark recurring; notes; tags; goal; similar transactions (same name, monthly totals).
- Rules: on recategorize, offer a rule by exact name, partial name (substring), or bank category; applies to past and future; shown before applying; same-name rule overwrites.
- Intelligence: per-user model after 30 reviewed transactions; applies a category only when confident ("Intelligence" badge); top two guesses first in the picker.
- Split: by amount/percentage or equally (3/4/5 parts), or spread over 3/6/12 months with per-split dates; Save blocked until it balances; restore by removing parts.
- Exclude a transaction (not recurrings). Refunds: keep in the original category, optionally redate to the purchase.
- Tags: any transaction type, no budgets, unique names, bulk apply, filter by tag, managed in Settings > Features > Tags.
- Manual transactions: Regular / Income / Transfer; transfers need both sides.
- Bulk edit (Mac): checkbox select; bar at bottom; keys arrows, X select, R reviewed, C category, F filters, ⌘A / ⌘⇧A.
- Filters (web list): account, category, date, recurring, review status, tag, type; sort by date or amount; totals for spent, income, net. Export CSV of filtered set (date, name, amount, status, category + parent, excluded, type, account + mask, notes, recurrings).
- Month / Year in Review slides.

## Recurrings
- Created from an existing transaction (Recurrings "+": search a name, pick one or all matching; or from a transaction's Recurring button). Frequency estimated, then confirmed: weekly, bi-weekly, monthly, non-monthly (e.g. yearly). Detected automatically during onboarding.
- Filters: name match (stable part, e.g. "Uber"), amount range, expected day(s) of month or any day, frequency. Matching transactions get [R]; list shows the recurring's name.
- Edit any field; changing a filter or adding a transaction asks: future only, or past too. Add/remove transactions ("Not recurring").
- Several recurrings per merchant allowed (split by amount/date; identical charges via "#1/#2").
- **Pause** (expected spend removed; next payment reactivates), **Archive** (stops, history kept), **Activate**, **Delete** (transactions unchanged, recurring history lost). Sections: Active (monthly and future), Paused, Archived.
- Unpaid recurrings count as expected spend this month (outlined bars). No recurring income.
- Detail (Mac): rules, key metrics, last account used, transactions.

## Cash flow
- Income, spending (stacked by category), net income. Ranges: YTD, month to date, last 12 months, last 3 months, last 4 weeks. Only up to today (no unpaid recurrings, no future-dated).
- Compares with the previous equal-length period (dotted line); month to date compares the same day span of last month. Comparison can be hidden.
- "Show excluded spend" toggle adds excluded spend (also to Dashboard Net this month). Spend details include an Excluded Transactions section.

## Dashboard
- Spending graph "Free to spend / $X left": solid actual spend vs dotted ideal pace; recurrings expected this month left out. Line color: green under ideal, light orange behind by <20%, dark orange >20%, red over budget.
- To review (mark reviewed, quick category edit), Budgets (categories by budget used, excluding recurrings), Upcoming recurrings, Net this month (month to date vs previous month to date).

## Accounts, goals, investments (need balances; deferred in SlayBudget)
- Accounts: grouped by type (credit cards, depository, investments, loans, real estate, other), net worth graph (assets minus debts, one or two lines, timeframes), exclude from net worth, hide (reversible), mark closed (keeps history), delete (permanent), rename, manual accounts (no history, today's balance editable), credit utilization dot (green ≤33%, yellow→orange to 90%, red >90%), connection health ("stopped syncing", "found new accounts"), duplicates merged by support.
- Goals: target + date or monthly contribution; fund from account balances (allocations) or linked transactions; Active / Ready to spend / Archived (archive permanent); reactivate when funds dip; optionally lift category budget when spending from a goal.
- Investments: returns or balances, live estimates, benchmarks, top movers, allocation by security type, holdings, manual holdings with buy/sell/transfer movements, time-weighted returns, daily updates.

## Platform, settings, other
- Mac: ⌘1-⌘8 tabs, ⌘F search (transactions, accounts, categories, recurrings, holdings), ⌘R refresh, ⌘←/⌘→ history, ⌘, Settings; requires the Mac password / Touch ID to open.
- Settings: demo mode; Features (Budgeting toggle, Tags); Connections; Appearance (dark mode on/off/system, tab order); Labs; Notifications (bank fee, big expense >$500 non-recurring, budget overrun, credit utilization 30/60/90%, income ≥$10, low balance <$100, recurring paid, weekly spending Monday, uncategorized transfer); Rollovers; Account (export, Face ID lock, delete); Accessibility (+/− signs on amounts, accessible colors); Advanced (clear local cache).
- Labs: Amazon order itemization (match same amount within 2 days), Venmo via email forwarding (#copilot note auto-categorizes).
- Money Assistant (AI chat, proactive fixes), read-only MCP connector, iPhone widgets.
