import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every chart is plain SVG on shared geometry (one look and pointer everywhere, d3 only for layouts); ECharts is gone for good.
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
  it('no chart library sits unused: visx is not a dependency, since the charts draw their own SVG', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith('@visx/'))).toEqual([]);
  });
});
