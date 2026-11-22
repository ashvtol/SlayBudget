import { vi } from 'vitest';

// jsdom has no canvas; mock echarts.init so <Chart> mounts without rendering.
vi.mock('echarts', () => {
  const chart = {
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn(),
  };
  return { init: vi.fn(() => chart), __chart: chart };
});
