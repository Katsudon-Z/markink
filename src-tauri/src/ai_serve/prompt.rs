// エディタ起点AI呼び出しの用途別プロンプト (requirements.md §11)。
// 会話は継続せず都度破棄するため、用途ごとの system 指示をここに一元化する。

/// AI呼び出しの用途 (フロントの右クリックメニューに対応)
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum AiMode {
    Summary,
    Continue,
    Question,
    Edit,
}

impl AiMode {
    pub(crate) fn parse(s: &str) -> Result<Self, String> {
        match s {
            "summary" => Ok(AiMode::Summary),
            "continue" => Ok(AiMode::Continue),
            "question" => Ok(AiMode::Question),
            "edit" => Ok(AiMode::Edit),
            _ => Err(format!("未知のAIモード: {}", s)),
        }
    }

    pub(crate) fn title(&self) -> &'static str {
        match self {
            AiMode::Summary => "AI要約",
            AiMode::Continue => "AI続き",
            AiMode::Question => "AI質問",
            AiMode::Edit => "AI編集代行",
        }
    }

    /// 用途別の system 指示 (本文のみ出力させ、前置きを禁じる)
    pub(crate) fn system_prompt(&self) -> &'static str {
        match self {
            AiMode::Summary => {
                "あなたは文書要約アシスタントです。次の文書を日本語5行以内の箇条書きで要約してください。要約のみを出力し、前置き・説明は不要です。"
            }
            AiMode::Continue => {
                "あなたは文章作成アシスタントです。次の文章の続きを自然に2〜3文で書いてください。続きの本文のみを出力し、前置き・説明・引用符は不要です。"
            }
            AiMode::Question => {
                "あなたは文書アシスタントです。与えられた文書の内容に基づいて質問に日本語で簡潔に答えてください。答えのみを出力してください。"
            }
            AiMode::Edit => {
                "あなたは文書編集アシスタントです。指示に従って文書を書き換えた全文のみを出力してください。前置き・説明・コードフェンスは不要です。"
            }
        }
    }

    /// 要求本文を組み立てる (prompt は質問・編集代行で必須)
    pub(crate) fn build_user_text(&self, prompt: &str, context: &str) -> Result<String, String> {
        let prompt = prompt.trim();
        match self {
            AiMode::Summary => {
                let extra = if prompt.is_empty() {
                    String::new()
                } else {
                    format!("追加の指示: {}\n", prompt)
                };
                Ok(format!("{}文書:\n{}", extra, context))
            }
            AiMode::Continue => {
                let extra = if prompt.is_empty() {
                    String::new()
                } else {
                    format!("方向性: {}\n", prompt)
                };
                Ok(format!("{}次の文章の続きを書いてください:\n{}", extra, context))
            }
            AiMode::Question => {
                if prompt.is_empty() {
                    return Err("質問内容を入力してください".to_string());
                }
                Ok(format!("文書:\n{}\n質問: {}", context, prompt))
            }
            AiMode::Edit => {
                if prompt.is_empty() {
                    return Err("編集指示を入力してください".to_string());
                }
                Ok(format!("文書:\n{}\n指示: {}", context, prompt))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mode_parses_and_builds_user_text() {
        assert!(AiMode::parse("summary").is_ok());
        assert!(AiMode::parse("unknown").is_err());
        assert!(AiMode::Question.build_user_text("", "ctx").is_err(), "質問は必須");
        assert!(AiMode::Edit.build_user_text("", "ctx").is_err(), "指示は必須");
        let t = AiMode::Question.build_user_text("q?", "文書本文").unwrap();
        assert!(t.contains("文書本文") && t.contains("q?"));
        assert!(!AiMode::Summary.system_prompt().is_empty());
    }
}
