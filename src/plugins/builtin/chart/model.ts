/** chart フェンスのデータ模型と検証。JSON のみ (YAML は将来)。 */

export type ChartType = 'bar' | 'line' | 'pie';

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartData {
  type: ChartType;
  title: string;
  labels: string[];
  series: ChartSeries[];
}

export type ChartParseResult = { ok: true; chart: ChartData } | { ok: false; error: string };

const CHART_TYPES: ChartType[] = ['bar', 'line', 'pie'];

const MAX_LABELS = 60;
const MAX_SERIES = 8;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const toFiniteNumber = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * ```chart フェンス本文を検証する。不正時は理由を返す (表示はフォールバック)。
 * 形式: { type?, title?, labels: string[], series: [{ name?, values: number[] }] }
 */
export function parseChartSpec(text: string): ChartParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON として読めません' };
  }
  if (!isRecord(raw)) return { ok: false, error: '先頭は { } で書いてください' };

  const type: ChartType = CHART_TYPES.includes(raw.type as ChartType)
    ? (raw.type as ChartType)
    : 'bar';
  const title = typeof raw.title === 'string' ? raw.title : '';

  if (!Array.isArray(raw.labels) || raw.labels.length === 0) {
    return { ok: false, error: 'labels (項目名の配列) が必要です' };
  }
  if (raw.labels.length > MAX_LABELS) {
    return { ok: false, error: `labels は ${MAX_LABELS} 件までです` };
  }
  const labels = raw.labels.map((l) => String(l));

  if (!Array.isArray(raw.series) || raw.series.length === 0) {
    return { ok: false, error: 'series (数値配列の配列) が必要です' };
  }
  if (raw.series.length > MAX_SERIES) {
    return { ok: false, error: `series は ${MAX_SERIES} 件までです` };
  }
  const series: ChartSeries[] = [];
  for (let i = 0; i < raw.series.length; i += 1) {
    const s = raw.series[i];
    if (!isRecord(s) || !Array.isArray(s.values)) {
      return { ok: false, error: `series[${i}].values (数値配列) が必要です` };
    }
    const values: number[] = [];
    for (let j = 0; j < s.values.length; j += 1) {
      const n = toFiniteNumber(s.values[j]);
      if (n == null) return { ok: false, error: `series[${i}].values[${j}] が数値ではありません` };
      values.push(n);
    }
    if (values.length !== labels.length) {
      return { ok: false, error: `series[${i}] の件数 (${values.length}) が labels (${labels.length}) と合いません` };
    }
    series.push({ name: typeof s.name === 'string' && s.name ? s.name : `系列${i + 1}`, values });
  }
  if (type === 'pie' && series.length > 1) {
    return { ok: false, error: '円グラフは series を1件にしてください' };
  }
  return { ok: true, chart: { type, title, labels, series } };
}

/** 空の雛形 (挿入コマンド用の将来予約。今はテストと表示確認に使う)。 */
export function emptyChartSpec(): string {
  return JSON.stringify(
    {
      type: 'bar',
      title: '',
      labels: ['A', 'B', 'C'],
      series: [{ name: '系列1', values: [1, 2, 3] }]
    },
    null,
    2
  );
}
