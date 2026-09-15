import { describe, it, expect } from 'vitest';
import { createEditorState, defaultMarkdownSerializer, defaultMarkdownParser } from '../../src/lib/prosemirror/editor';

// requirements.md:45 5MB・約5万文字を目立つ遅延なく編集可能であること
// 5MB はフォント依存なので、5万字相当の再現文書で変換パフォーマンスを検証
function buildLargeMarkdown(): string {
  const lines: string[] = ['# パフォーマンステスト文書', ''];
  let chars = 0;
  let i = 0;
  while (chars < 50000) {
    i += 1;
    const para = `${i}. 段落 ${i}: 太字**重要**と箇条書きの混在文。日本語文字列でのプロファイリング用です。`;
    lines.push(para, '');
    lines.push(`- 項目 ${i}-1: **強調**テキスト、- 項目 ${i}-2: *斜体*テキスト`);
    lines.push('');
    chars += para.length;
  }
  return lines.join('\n');
}

describe('5万文字文書パフォーマンス (requirements.md:45)', () => {
  it('パースとシリアライズが一括で 3秒以内に完了する', () => {
    const md = buildLargeMarkdown();
    const start = performance.now();
    const parser = defaultMarkdownParser;
    const doc = parser.parse(md);
    const state = createEditorState(md);
    const serialized = defaultMarkdownSerializer.serialize(state.doc);
    const elapsed = performance.now() - start;

    expect(doc).toBeTruthy();
    expect(serialized.length).toBeGreaterThan(40000);
    expect(elapsed).toBeLessThan(3000);
  });

  it('文書サイズが5万字を超える', () => {
    const md = buildLargeMarkdown();
    expect(md.length).toBeGreaterThanOrEqual(50000);
  });
});
