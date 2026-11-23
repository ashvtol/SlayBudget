import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every chart is drawn with visx (one library, the same look and pointer everywhere); ECharts is gone for good.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('charts', () => {
  it('nothing in the app imports ECharts', () => {
    const offenders = sources('src').filter((f) => /from ['"]echarts|import ['"]@\/test\/echarts-mock/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
  it('ECharts is not a dependency', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.echarts).toBeUndefined();
  });
});
