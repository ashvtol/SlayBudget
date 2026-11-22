import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import { BankConnectionsPane } from './bank-connections-pane';

afterEach(() => cleanup());

describe('BankConnectionsPane', () => {
  it('saves the Plaid client ID and keeps Connect disabled until setup is finished', async () => {
    const user = userEvent.setup();
    setIpc(createMemoryIpc());
    render(<BankConnectionsPane />);
    await waitFor(() => expect(screen.getByLabelText('Plaid client ID')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Connect a bank' })).toBeDisabled();
    const input = screen.getByLabelText('Plaid client ID');
    await user.type(input, 'abc123');
    await user.tab();
    await waitFor(() => expect(ipc().getSetting('plaid_client_id')).resolves.toBe('abc123'));
    expect(screen.getByText(/secret must be handled securely/)).toBeInTheDocument();
  });
});
