import { Page } from './page';

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <Page title={title}>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>Coming soon.</p>
    </Page>
  );
}
