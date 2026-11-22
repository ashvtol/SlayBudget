// Our own small stroke icon set (16px grid, 1.6 stroke, currentColor).
// Kept in-house rather than pulling an icon package.

import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(name: string, body: ReactNode) {
  function Icon({ size = 16, ...rest }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
        {body}
      </svg>
    );
  }
  Icon.displayName = `Icon${name}`;
  return Icon;
}

export const IconDashboard = make('Dashboard', <path d="M2.5 7.2 13.5 2.5 8.8 13.5 7.6 8.4z" />);
export const IconTransactions = make('Transactions', <><path d="M8 2 14 5 8 8 2 5z" /><path d="M2 8l6 3 6-3" /><path d="M2 11l6 3 6-3" /></>);
export const IconCashflow = make('Cashflow', <><rect x="3" y="2" width="10" height="12" rx="1.5" /><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" /></>);
export const IconCategories = make('Categories', <><path d="M8 2a6 6 0 1 0 6 6H8z" /><path d="M10 2.3A6 6 0 0 1 13.7 6H10z" /></>);
export const IconRecurring = make('Recurring', <><path d="M13 8a5 5 0 1 1-1.5-3.6" /><path d="M13 2.5v3h-3" /></>);
export const IconInsights = make('Insights', <><path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M3.8 12.2l1.4-1.4M10.8 5.2l1.4-1.4" /></>);
export const IconImport = make('Import', <><path d="M8 2.5v7" /><path d="M5 6.8 8 9.8l3-3" /><path d="M2.5 10.5v1.5a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-1.5" /></>);
export const IconSettings = make('Settings', <><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" /></>);
export const IconHelp = make('Help', <><circle cx="8" cy="8" r="6" /><path d="M6.3 6.3a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1" /><path d="M8 11.3h.01" /></>);
export const IconSearch = make('Search', <><circle cx="7" cy="7" r="4.5" /><path d="m13.5 13.5-3.2-3.2" /></>);
export const IconFilter = make('Filter', <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />);
export const IconSort = make('Sort', <path d="M2.5 4h11M2.5 8h8M2.5 12h5" />);
export const IconPlus = make('Plus', <path d="M8 3v10M3 8h10" />);
export const IconDownload = make('Download', <><path d="M8 2.5v8" /><path d="M4.8 7.5 8 10.7l3.2-3.2" /><path d="M3 13.5h10" /></>);
export const IconCheck = make('Check', <path d="m3.2 8.4 3 3 6.6-6.8" />);
export const IconSplit = make('Split', <><path d="M3 8h10" /><circle cx="8" cy="4" r=".6" fill="currentColor" /><circle cx="8" cy="12" r=".6" fill="currentColor" /></>);
export const IconMore = make('More', <><circle cx="3.5" cy="8" r=".8" fill="currentColor" /><circle cx="8" cy="8" r=".8" fill="currentColor" /><circle cx="12.5" cy="8" r=".8" fill="currentColor" /></>);
export const IconArrowUpRight = make('ArrowUpRight', <path d="M5 11 11 5M6 5h5v5" />);
export const IconArrowDownRight = make('ArrowDownRight', <path d="M5 5l6 6M11 6v5H6" />);
export const IconEqual = make('Equal', <path d="M4 6.5h8M4 9.5h8" />);
export const IconChevronDown = make('ChevronDown', <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />);
export const IconChevronRight = make('ChevronRight', <path d="m6.5 4.5 3.5 3.5-3.5 3.5" />);
export const IconChevronLeft = make('ChevronLeft', <path d="m9.5 4.5-3.5 3.5 3.5 3.5" />);
export const IconTriangleDown = make('TriangleDown', <path d="M4.5 6h7L8 10.5z" fill="currentColor" stroke="none" />);
export const IconTriangleRight = make('TriangleRight', <path d="M6 4.5v7L10.5 8z" fill="currentColor" stroke="none" />);
export const IconClose = make('Close', <path d="m4 4 8 8M12 4l-8 8" />);
export const IconTag = make('Tag', <><path d="M2.5 2.5h5.2l5.8 5.8-5.2 5.2-5.8-5.8z" /><circle cx="5.3" cy="5.3" r=".7" fill="currentColor" /></>);
export const IconCalendar = make('Calendar', <><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></>);
export const IconRefresh = make('Refresh', <><path d="M13 8a5 5 0 1 1-1.5-3.6" /><path d="M13 2.5v3h-3" /></>);
export const IconBank = make('Bank', <><path d="M2 6 8 2.5 14 6" /><path d="M3.5 6.5v5M6.5 6.5v5M9.5 6.5v5M12.5 6.5v5M2 13.5h12" /></>);
export const IconCard = make('Card', <><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="M2 6.5h12" /></>);
export const IconNote = make('Note', <><rect x="3" y="2.5" width="10" height="11" rx="1.5" /><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" /></>);
export const IconBell = make('Bell', <><path d="M4 11.5V7.5a4 4 0 0 1 8 0v4l1 1H3z" /><path d="M6.6 13.6a1.5 1.5 0 0 0 2.8 0" /></>);
