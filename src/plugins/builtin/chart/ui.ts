import type { CodeBlockEditContext } from '../../../lib/plugins/types';
import { parseChartSpec } from './model';
import { renderChartSvg } from './render';

/**
 * chart フェンスの表示＋簡易編集 (vanilla DOM。React 化しない)。
 * - 正常：SVG プレビュー＋折りたたみ JSON 編集
 * - 不正：コード表示にフォールバック (例外は投げない)
 * - プラグイン UI 内の操作は ProseMirror に届けない (data-plugin-ui 標識)
 */
export function createChartElement(
  code: string,
  lang: string,
  edit?: CodeBlockEditContext
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'chart-block';
  root.setAttribute('data-plugin-ui', 'true');
  for (const type of ['keydown', 'mousedown', 'paste', 'drop', 'copy', 'cut']) {
    root.addEventListener(type, (e) => e.stopPropagation());
  }

  const parsed = parseChartSpec(code);
  if (!parsed.ok) {
    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    codeEl.textContent = code;
    pre.appendChild(codeEl);
    const note = document.createElement('p');
    note.className = 'restore-message';
    note.textContent = `グラフとして読めません (${parsed.error})。\`${lang || 'chart'}\` の JSON を直してください。`;
    root.append(pre, note);
    return root;
  }

  const preview = document.createElement('div');
  preview.className = 'chart-preview';
  preview.innerHTML = renderChartSvg(parsed.chart);
  root.appendChild(preview);

  const details = document.createElement('details');
  details.className = 'chart-editor';
  const summary = document.createElement('summary');
  summary.textContent = 'データを編集';
  const area = document.createElement('textarea');
  area.rows = 8;
  area.value = code;
  area.setAttribute('aria-label', 'グラフの JSON');
  const error = document.createElement('p');
  error.className = 'ai-settings-error';
  error.hidden = true;
  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'btn';
  applyBtn.textContent = '適用';
  applyBtn.addEventListener('click', () => {
    const next = area.value;
    const check = parseChartSpec(next);
    if (!check.ok) {
      error.textContent = check.error;
      error.hidden = false;
      return;
    }
    error.hidden = true;
    if (!edit || !edit.apply(next)) {
      error.textContent = '文書への反映に失敗しました';
      error.hidden = false;
    }
  });
  details.append(summary, area, applyBtn, error);
  root.appendChild(details);
  return root;
}
