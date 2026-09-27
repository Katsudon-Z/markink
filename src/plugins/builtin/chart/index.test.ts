import { describe, expect, it } from 'vitest';
import { emptyChartSpec, parseChartSpec } from './model';
import { renderChartSvg } from './render';
import { createChartElement } from './ui';
import { chartPlugin } from './index';
import { markdownParser, markdownSerializer } from '../../../lib/prosemirror/markdown';
import { createPluginContext } from '../../../lib/plugins/loader';
import { clearAllSlots, getCodeBlockRenderer } from '../../../lib/plugins/slots';

const VALID = emptyChartSpec();

describe('チャートプラグイン (Phase 3)', () => {
  it('正常な JSON を読む', () => {
    const r = parseChartSpec(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.chart.type).toBe('bar');
      expect(r.chart.labels).toEqual(['A', 'B', 'C']);
      expect(r.chart.series[0].values).toEqual([1, 2, 3]);
    }
  });

  it('不正は理由付きで弾く (例外なし)', () => {
    expect(parseChartSpec('{{{').ok).toBe(false);
    expect(parseChartSpec('[]').ok).toBe(false);
    expect(parseChartSpec('{"labels":[]}').ok).toBe(false);
    expect(parseChartSpec('{"labels":["A"],"series":[{"values":["x"]}]}').ok).toBe(false);
    expect(parseChartSpec('{"labels":["A","B"],"series":[{"values":[1]}]}').ok).toBe(false);
    expect(
      parseChartSpec('{"type":"pie","labels":["A"],"series":[{"values":[1]},{"values":[2]}]}').ok
    ).toBe(false);
  });

  it('3種の SVG を描く', () => {
    for (const type of ['bar', 'line', 'pie'] as const) {
      const r = parseChartSpec(
        JSON.stringify({ type, labels: ['A', 'B'], series: [{ name: 's', values: [3, 7] }] })
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        const svg = renderChartSvg(r.chart);
        expect(svg).toContain('<svg');
        expect(svg).toContain('</svg>');
      }
    }
  });

  it('表示はプレビュー＋編集欄、不正はコードにフォールバック', () => {
    const ok = createChartElement(VALID, 'chart');
    expect(ok.querySelector('svg')).not.toBeNull();
    expect(ok.querySelector('textarea')).not.toBeNull();
    expect(ok.getAttribute('data-plugin-ui')).toBe('true');
    const bad = createChartElement('{{{', 'chart');
    expect(bad.querySelector('svg')).toBeNull();
    expect(bad.querySelector('code')?.textContent).toBe('{{{');
  });

  it('編集の適用は検証後に edit.apply へ渡す', () => {
    const applied: string[] = [];
    const el = createChartElement(VALID, 'chart', {
      apply: (code) => {
        applied.push(code);
        return true;
      }
    });
    const area = el.querySelector('textarea');
    const btn = el.querySelector('button');
    expect(area).not.toBeNull();
    expect(btn).not.toBeNull();
    // 不正は弾く
    area!.value = '{{{';
    btn!.dispatchEvent(new Event('click', { bubbles: true }));
    expect(applied).toHaveLength(0);
    // 正常は渡す
    area!.value = JSON.stringify({ labels: ['X'], series: [{ values: [9] }] });
    btn!.dispatchEvent(new Event('click', { bubbles: true }));
    expect(applied).toHaveLength(1);
  });

  it('```chart フェンスは markdown 往復で言語を保つ', () => {
    const md = `\`\`\`chart\n${VALID}\n\`\`\`\n`;
    const doc = markdownParser.parse(md);
    const back = markdownSerializer.serialize(doc);
    expect(back).toContain('```chart');
    expect(back).toContain('"labels"');
  });

  it('プラグイン登録で chart 言語が引ける', async () => {
    clearAllSlots();
    await chartPlugin.activate(createPluginContext(chartPlugin.manifest));
    const renderer = getCodeBlockRenderer('chart');
    expect(renderer).toBeDefined();
    const el = renderer!.render(VALID, 'chart');
    expect(el.querySelector('svg')).not.toBeNull();
  });
});
