const DEFAULT_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = '';
const MAX_CONTEXT = 8000;

const modes = {
  summary: {
    title: 'AI要約',
    system: 'あなたはMarkdown文書の要約者です。元の意味を保ち、簡潔な日本語で要約してください。'
  },
  continue: {
    title: 'AI続き',
    system: 'あなたはMarkdown文書の執筆補助です。与えられた文脈に自然につながる続きを書いてください。続きの本文だけを返してください。'
  },
  question: {
    title: 'AI質問',
    system: 'あなたはMarkdown文書について質問に答えます。文書にない事実は推測と明示してください。'
  },
  edit: {
    title: 'AI編集代行',
    system: 'あなたはMarkdown文書の編集者です。指示に従い、編集後のMarkdown本文だけを返してください。'
  }
};

async function run(api, mode) {
  const spec = modes[mode];
  const snapshot = await api.readDocument();
  const maxChars = Number(await api.getSetting('maxChars') || MAX_CONTEXT);
  const limit = Number.isInteger(maxChars) ? Math.max(1000, Math.min(100000, maxChars)) : MAX_CONTEXT;
  const selected = snapshot.selectedText.trim();
  const context = mode === 'continue'
    ? snapshot.textBeforeCursor.slice(-limit)
    : (selected || snapshot.markdown).slice(0, limit);
  if (!context.trim()) throw new Error('送信できる文書内容がありません');
  let instruction = '';
  if (mode === 'question' || mode === 'edit') {
    const answer = await api.prompt(mode === 'question' ? '文書への質問' : '編集指示');
    if (answer === null) return;
    instruction = answer.trim();
    if (!instruction) throw new Error('質問または編集指示を入力してください');
  }
  const url = await api.getSetting('apiUrl') || DEFAULT_URL;
  const model = await api.getSetting('model') || DEFAULT_MODEL;
  if (!model.trim()) throw new Error('プラグイン管理画面でモデル名を入力してください');
  const timeout = Number(await api.getSetting('timeoutSecs') || 120);
  const configuredKey = await api.getSetting('useApiKey');
  const useApiKey = configuredKey === 'yes' || (configuredKey === null && new URL(url).protocol === 'https:');
  const request = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: spec.system },
      { role: 'user', content: `${instruction ? `指示: ${instruction}\n\n` : ''}文書:\n${context}` }
    ],
    stream: false
  });
  await api.notify(`${spec.title}を実行中…`);
  const response = await api.requestJson(url, request, useApiKey, timeout);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`AIサーバが HTTP ${response.status} を返しました`);
  }
  const parsed = JSON.parse(response.body);
  const text = parsed?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('AIの応答に本文がありません');
  const choice = await api.showResult(spec.title, text.trim(), mode === 'edit' || !!selected);
  if (choice === 'cancel') return;
  const latest = await api.readDocument();
  if (latest.revision !== snapshot.revision) {
    throw new Error('AI処理中に文書が更新されました。結果を再確認してください');
  }
  const selection = snapshot.selection;
  if (!selection) throw new Error('編集できる選択位置がありません');
  const replacing = choice === 'replace';
  const from = replacing && !selected ? 0 : selection.from;
  const to = replacing ? (selected ? selection.to : snapshot.size) : selection.from;
  await api.applyEdit({
    baseRevision: snapshot.revision,
    from, to, markdown: text.trim(),
    reason: `${spec.title}の結果で文書全体を置き換えます。続けますか？`
  });
}

self.markinkPlugin = {
  async activate(api) {
    for (const [mode, spec] of Object.entries(modes)) {
      const shortcut = {
        summary: 'Mod-Shift-KeyS',
        continue: 'Mod-Space',
        question: 'Mod-Shift-KeyQ',
        edit: 'Mod-Shift-KeyE'
      }[mode];
      await api.registerCommand({
        id: mode, title: spec.title, placement: 'menu', shortcut, contextMenu: true
      }, () => run(api, mode));
    }
  }
};
