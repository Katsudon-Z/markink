// OpenAI互換の chat/completions API への直接呼び出し (AI呼び出しの api モード)。
// local モード (opencode serve) と違い、外部HTTP(S)エンドポイントへ文書を送る。
// クラウドAPIを選ぶと本文が外部へ出るため、既定は無効 (local) とする。

use serde_json::{json, Value};

use super::prompt::AiMode;
use crate::settings::Settings;

/// OpenAI互換 API を呼び、本文だけを返す。
/// ブロッキングの ureq を使うため spawn_blocking で包んで実行する。
pub(crate) async fn ask_api(
    s: &Settings,
    mode: AiMode,
    prompt: &str,
    context: &str,
) -> Result<String, String> {
    let user_text = mode.build_user_text(prompt, context)?;
    // モデル名は設定値をそのまま送る (加工しない)。空はエラー。
    let model = s.ai_api_model.trim().to_string();
    if model.is_empty() {
        return Err("APIのモデル名を設定してください".to_string());
    }
    let body = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": mode.system_prompt() },
            { "role": "user", "content": user_text },
        ],
        "stream": false,
    });
    let url = s.ai_api_url.trim().to_string();
    let key = s.ai_api_key.trim().to_string();
    let timeout = s.ai_timeout_secs.max(10);
    // 旧設定に残った空白混じりURLでも送れるよう、送信直前に空白を除去する
    let url: String = url.split_whitespace().collect();
    if url.is_empty() {
        return Err("API URL を設定してください".to_string());
    }
    let text = tokio::task::spawn_blocking(move || {
        post_completions(&url, &key, &body, timeout)
    })
    .await
    .map_err(|e| format!("AI呼び出しに失敗: {}", e))??;
    parse_completions(&text)
}

/// URL の検証 (http/https のみ、ホスト必須)。
/// ureq と同じ `url` クレートで解析し、設定時に不備を日本語で返す
/// (要求時の英語エラー "invalid port number" 等を出さないため)。
pub(crate) fn validate_api_url(url: &str) -> Result<(), String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("API URL を入力してください".to_string());
    }
    if url.chars().any(|c| c.is_whitespace()) {
        return Err("API URL に空白が含まれています".to_string());
    }
    let parsed = url::Url::parse(url).map_err(|e| match e {
        url::ParseError::InvalidPort => "ポート番号が不正です".to_string(),
        url::ParseError::EmptyHost => "ホストがありません".to_string(),
        url::ParseError::RelativeUrlWithoutBase => "http(s):// で始めてください".to_string(),
        _ => format!("URLが不正です: {}", e),
    })?;
    if parsed.host_str().map(|h| h.is_empty()).unwrap_or(true) {
        return Err("ホストがありません".to_string());
    }
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        _ => Err("API URL は http / https のみ対応しています".to_string()),
    }
}

fn post_completions(url: &str, key: &str, body: &Value, timeout_secs: u64) -> Result<String, String> {
    let mut req = ureq::post(url).timeout(std::time::Duration::from_secs(timeout_secs));
    req = req.set("User-Agent", "MDNotepad/1.0 (OpenAI-compatible client)");
    if !key.is_empty() {
        req = req.set("Authorization", &format!("Bearer {}", key));
    }
    match req.send_json(body) {
        Ok(resp) => resp
            .into_string()
            .map_err(|e| format!("APIの応答を読めませんでした: {}", e)),
        Err(ureq::Error::Status(status, resp)) => {
            // 非2xx: サーバの本文を添えて分かりやすくする (401/403 はキー起因が多い)
            let detail = resp
                .into_string()
                .ok()
                .filter(|s| !s.is_empty())
                .map(|s| s.chars().take(300).collect::<String>());
            let hint = if status == 401 || status == 403 {
                if key.is_empty() {
                    "APIキーが未設定です。設定でAPIキーを入力してください"
                } else {
                    "APIキーが無効か権限がありません。キーを確認してください"
                }
            } else {
                "APIサーバがエラーを返しました"
            };
            match detail {
                Some(d) => Err(format!("APIへの送信に失敗しました ({}) {}: {}", status, hint, d)),
                None => Err(format!("APIへの送信に失敗しました ({}): {}", status, hint)),
            }
        }
        Err(e) => Err(format!("APIへの送信に失敗しました: {}", e)),
    }
}

/// choices[0].message.content を抜き出す (OpenAI互換形式)
fn parse_completions(text: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(text)
        .map_err(|e| format!("APIの応答を解釈できません: {}", e))?;
    let content = v
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|c| c.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .ok_or_else(|| "APIの応答に本文がありません".to_string())?;
    if content.trim().is_empty() {
        return Err("APIからの本文が空です".to_string());
    }
    Ok(content.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_url_validates_scheme() {
        assert!(validate_api_url("https://api.openai.com/v1/chat/completions").is_ok());
        assert!(validate_api_url("http://localhost:11434/v1/chat/completions").is_ok());
        assert!(validate_api_url("http://192.168.1.38:1234/v1/chat/completions").is_ok());
        assert!(validate_api_url("ftp://example.com").is_err());
        assert!(validate_api_url("not-a-url").is_err());
        // 空白・不正ポートは設定時に日本語エラーにする
        assert!(validate_api_url("http://192.168.1.38:1234 /v1/chat/completions").is_err());
        assert!(validate_api_url("http://192.168.1.38:abc/v1/chat/completions").is_err());
        assert!(validate_api_url("").is_err());
    }

    #[test]
    fn parses_openai_style_response() {
        let text = r#"{"choices":[{"message":{"content":"こんにちは"}}]}"#;
        assert_eq!(parse_completions(text).unwrap(), "こんにちは");
        assert!(parse_completions(r#"{"choices":[]}"#).is_err());
        assert!(parse_completions(r#"{"choices":[{"message":{"content":""}}]}"#).is_err());
        assert!(parse_completions("garbage").is_err());
    }
}
