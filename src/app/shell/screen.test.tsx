import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useNavStore } from '@/lib/stores/nav-store';
import { KeptScreen, useScreen } from './screen';

function Probe({ name }: { name: string }) {
  const { activation } = useScreen();
  return <span data-testid={name}>{activation}</span>;
}

describe('KeptScreen refresh', () => {
  it('a refresh re-runs the shown screen only', () => {
    render(
      <>
        <KeptScreen id="a" active>
          <Probe name="a" />
        </KeptScreen>
        <KeptScreen id="b" active={false}>
          <Probe name="b" />
        </KeptScreen>
      </>,
    );
    act(() => useNavStore.getState().refresh());
    expect(screen.getByTestId('a')).toHaveTextContent('1');
    expect(screen.getByTestId('b')).toHaveTextContent('0');
  });
});
