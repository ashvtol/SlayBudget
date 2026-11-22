import '@/test/echarts-mock';
import { render } from '@testing-library/react';
import * as echarts from 'echarts';
import { Chart } from './chart';

const chart = (echarts as unknown as { __chart: { setOption: ReturnType<typeof vi.fn> } }).__chart;

describe('Chart', () => {
  beforeEach(() => chart.setOption.mockClear());

  it('replaces the whole option by default', () => {
    render(<Chart option={{ series: [] }} />);
    expect(chart.setOption).toHaveBeenLastCalledWith({ series: [] }, true);
  });

  it('in merge mode keeps matching series (to animate) but drops ones that are gone', () => {
    render(<Chart option={{ series: [{ id: 'a', type: 'treemap' }] }} merge />);
    expect(chart.setOption).toHaveBeenLastCalledWith({ series: [{ id: 'a', type: 'treemap' }] }, { replaceMerge: ['series'] });
  });

  it('redraws from scratch when the reset key changes, even in merge mode', () => {
    const { rerender } = render(<Chart option={{ series: [{ id: 'a' }] }} merge resetKey="x" />);
    rerender(<Chart option={{ series: [{ id: 'a', name: 'n' }] }} merge resetKey="x" />);
    expect(chart.setOption).toHaveBeenLastCalledWith({ series: [{ id: 'a', name: 'n' }] }, { replaceMerge: ['series'] });
    rerender(<Chart option={{ series: [{ id: 'b' }] }} merge resetKey="y" />);
    expect(chart.setOption).toHaveBeenLastCalledWith({ series: [{ id: 'b' }] }, true);
  });
});
