import type { ChartData } from './model';

/** 自前 SVG 描画 (外部依存なし)。例外は投げない (呼出側がフォールバックする)。 */

const W = 480;
const H = 300;
const PAD = { left: 46, right: 12, top: 30, bottom: 46 };

const PALETTE = [
  '#4c9aff',
  '#ff8b6a',
  '#57d9a3',
  '#c39ddb',
  '#ffd666',
  '#6ad6ff',
  '#ff9dc6',
  '#a3b18a'
];

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmt = (n: number): string => {
  const r = Math.round(n * 100) / 100;
  return String(r);
};

function frame(title: string, body: string): string {
  return (
    `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(title || 'グラフ')}">` +
    (title ? `<text x="${W / 2}" y="18" text-anchor="middle" font-size="14">${esc(title)}</text>` : '') +
    body +
    `</svg>`
  );
}

function yRange(values: number[]): { min: number; max: number } {
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  return { min, max };
}

function renderBar(chart: ChartData): string {
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const all = chart.series.flatMap((s) => s.values);
  const { min, max } = yRange(all);
  const y = (v: number): number => PAD.top + plotH - ((v - min) / (max - min)) * plotH;
  const zeroY = y(0);
  const n = chart.labels.length;
  const groupW = plotW / n;
  const barW = Math.max(2, groupW / (chart.series.length + 1));
  let body = `<line x1="${PAD.left}" y1="${zeroY}" x2="${W - PAD.right}" y2="${zeroY}" stroke="#999"/>`;
  chart.series.forEach((s, si) => {
    s.values.forEach((v, i) => {
      const x = PAD.left + i * groupW + ((si + 1) * groupW - chart.series.length * barW) / 2;
      const top = Math.min(y(v), zeroY);
      const height = Math.max(1, Math.abs(y(v) - zeroY));
      body += `<rect x="${fmt(x)}" y="${fmt(top)}" width="${fmt(barW)}" height="${fmt(height)}" fill="${PALETTE[si % PALETTE.length]}"><title>${esc(`${s.name} ${chart.labels[i]}: ${v}`)}</title></rect>`;
    });
  });
  chart.labels.forEach((label, i) => {
    const x = PAD.left + i * groupW + groupW / 2;
    body += `<text x="${fmt(x)}" y="${H - 28}" text-anchor="middle" font-size="11">${esc(label)}</text>`;
  });
  body += `<text x="12" y="${fmt(y(max))}" font-size="11">${esc(fmt(Math.round(max * 100) / 100))}</text>`;
  body += legend(chart);
  return frame(chart.title, body);
}

function renderLine(chart: ChartData): string {
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const all = chart.series.flatMap((s) => s.values);
  const { min, max } = yRange(all);
  const n = chart.labels.length;
  const x = (i: number): number => (n === 1 ? PAD.left + plotW / 2 : PAD.left + (i / (n - 1)) * plotW);
  const y = (v: number): number => PAD.top + plotH - ((v - min) / (max - min)) * plotH;
  let body = `<line x1="${PAD.left}" y1="${fmt(y(0))}" x2="${W - PAD.right}" y2="${fmt(y(0))}" stroke="#999"/>`;
  chart.series.forEach((s, si) => {
    const pts = s.values.map((v, i) => `${fmt(x(i))},${fmt(y(v))}`).join(' ');
    body += `<polyline points="${pts}" fill="none" stroke="${PALETTE[si % PALETTE.length]}" stroke-width="2"/>`;
    s.values.forEach((v, i) => {
      body += `<circle cx="${fmt(x(i))}" cy="${fmt(y(v))}" r="3" fill="${PALETTE[si % PALETTE.length]}"><title>${esc(`${s.name} ${chart.labels[i]}: ${v}`)}</title></circle>`;
    });
  });
  chart.labels.forEach((label, i) => {
    body += `<text x="${fmt(x(i))}" y="${H - 28}" text-anchor="middle" font-size="11">${esc(label)}</text>`;
  });
  body += legend(chart);
  return frame(chart.title, body);
}

function renderPie(chart: ChartData): string {
  const s = chart.series[0];
  const total = s.values.reduce((a, b) => a + b, 0);
  const cx = 170;
  const cy = 160;
  const r = 100;
  let body = '';
  if (total <= 0) {
    body = `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="12">合計が0のため描けません</text>`;
  } else {
    let angle = -Math.PI / 2;
    s.values.forEach((v, i) => {
      const frac = v / total;
      const a0 = angle;
      const a1 = angle + frac * Math.PI * 2;
      angle = a1;
      if (frac <= 0) return;
      const large = frac > 0.5 ? 1 : 0;
      const x0 = cx + r * Math.cos(a0);
      const y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1);
      const y1 = cy + r * Math.sin(a1);
      body +=
        `<path d="M ${fmt(cx)} ${fmt(cy)} L ${fmt(x0)} ${fmt(y0)} A ${r} ${r} 0 ${large} 1 ${fmt(x1)} ${fmt(y1)} Z" ` +
        `fill="${PALETTE[i % PALETTE.length]}"><title>${esc(`${chart.labels[i]}: ${v}`)}</title></path>`;
    });
  }
  chart.labels.forEach((label, i) => {
    const yy = 60 + i * 20;
    body += `<rect x="300" y="${yy - 10}" width="12" height="12" fill="${PALETTE[i % PALETTE.length]}"/>`;
    body += `<text x="318" y="${yy}" font-size="11">${esc(`${label}: ${s.values[i]}`)}</text>`;
  });
  return frame(chart.title || s.name, body);
}

function legend(chart: ChartData): string {
  return chart.series
    .map(
      (s, i) =>
        `<rect x="${W - PAD.right - 130}" y="${30 + i * 18 - 10}" width="12" height="12" fill="${PALETTE[i % PALETTE.length]}"/>` +
        `<text x="${W - PAD.right - 112}" y="${30 + i * 18}" font-size="11">${esc(s.name)}</text>`
    )
    .join('');
}

export function renderChartSvg(chart: ChartData): string {
  switch (chart.type) {
    case 'line':
      return renderLine(chart);
    case 'pie':
      return renderPie(chart);
    default:
      return renderBar(chart);
  }
}
