// 手書き最小 HTTP クライアント (Content-Length と chunked の両対応) と応答解析。
// opencode serve は /session 作成が Content-Length、/message 応答が chunked で返る。
// 依存を増やさないため tokio TcpStream + BufReader で実装する。

use std::path::PathBuf;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

/// 最小の Base64 エンコーダ (Basic認証用。依存追加を避ける)
pub(crate) fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let mut n: u32 = 0;
        for (i, &b) in chunk.iter().enumerate() {
            n |= (b as u32) << (16 - 8 * i);
        }
        let pad = 3 - chunk.len();
        for i in 0..4 - pad {
            out.push(TABLE[((n >> (18 - 6 * i)) & 63) as usize] as char);
        }
        for _ in 0..pad {
            out.push('=');
        }
    }
    out
}

/// HTTP 要求を送り、ステータス + JSON 本文を返す (localhost 専用)。
pub(crate) async fn http_json(
    host: &str,
    port: u16,
    password: &str,
    method: &str,
    path: &str,
    body: Option<&Value>,
    timeout_secs: u64,
) -> Result<Value, String> {
    let body_text = body.map(|b| b.to_string()).unwrap_or_default();
    let req = format!(
        "{} {} HTTP/1.1\r\nHost: {}\r\nAuthorization: Basic {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        method,
        path,
        host,
        base64_encode(format!("opencode:{}", password).as_bytes()),
        body_text.len(),
        body_text
    );
    let addr = format!("{}:{}", host, port);
    let work = async {
        let stream = tokio::net::TcpStream::connect(&addr)
            .await
            .map_err(|e| format!("AIサーバに接続できません ({}): {}", addr, e))?;
        let mut reader = BufReader::new(stream);
        reader
            .write_all(req.as_bytes())
            .await
            .map_err(|e| format!("AIサーバへの送信に失敗: {}", e))?;
        // ステータス行 + ヘッダを空行まで読む
        let mut header_text = String::new();
        loop {
            let mut line = String::new();
            let n = reader
                .read_line(&mut line)
                .await
                .map_err(|e| format!("AIサーバからの受信に失敗: {}", e))?;
            if n == 0 {
                return Err("AIサーバが応答を閉じました".to_string());
            }
            if line == "\r\n" || line == "\n" {
                break;
            }
            header_text.push_str(&line);
            if header_text.len() > 64 * 1024 {
                return Err("AIサーバの応答ヘッダが大きすぎます".to_string());
            }
        }
        let status: u16 = header_text
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|c| c.parse().ok())
            .ok_or_else(|| "AIサーバの応答を解釈できません".to_string())?;
        let header_value = |name: &str| {
            header_text
                .lines()
                .filter_map(|l| l.split_once(':'))
                .find(|(k, _)| k.trim().eq_ignore_ascii_case(name))
                .map(|(_, v)| v.trim().to_string())
        };
        // 本文の枠: chunked 優先 (/message は chunked で返る)、次に Content-Length
        let body_bytes = if header_value("transfer-encoding")
            .map(|v| v.to_ascii_lowercase().contains("chunked"))
            .unwrap_or(false)
        {
            read_chunked_body(&mut reader).await?
        } else {
            let content_length: usize = header_value("content-length")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            if content_length > 16 * 1024 * 1024 {
                return Err("AIサーバの応答が大きすぎます".to_string());
            }
            let mut body = vec![0u8; content_length];
            if content_length > 0 {
                reader
                    .read_exact(&mut body)
                    .await
                    .map_err(|e| format!("AIサーバからの受信に失敗: {}", e))?;
            }
            body
        };
        if !(200..300).contains(&status) {
            let preview = String::from_utf8_lossy(&body_bytes);
            let mut err = format!("AIサーバが {} を返しました: {}", status, preview.chars().take(200).collect::<String>());
            // 5xx は opencode 内部エラーのため、ログ末尾の実原因を添える
            if (500..600).contains(&status) {
                if let Some(tail) = opencode_error_tail() {
                    err.push_str(&format!(" (サーバログ: {})", tail));
                }
            }
            return Err(err);
        }
        if body_bytes.is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_slice(&body_bytes).map_err(|e| format!("AIサーバの応答を解釈できません: {}", e))
    };
    tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), work)
        .await
        .map_err(|_| "AIサーバの応答がタイムアウトしました".to_string())?
}

/// chunked 本文を復号する (/session/:id/message の応答用)
async fn read_chunked_body<R>(reader: &mut BufReader<R>) -> Result<Vec<u8>, String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut out = Vec::new();
    loop {
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .await
            .map_err(|e| format!("AIサーバからの受信に失敗: {}", e))?;
        let size_str = line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_str, 16)
            .map_err(|_| "AIサーバの応答を解釈できません (chunk)".to_string())?;
        if size == 0 {
            // トレーラを空行まで読み飛ばす
            loop {
                let mut trailer = String::new();
                reader
                    .read_line(&mut trailer)
                    .await
                    .map_err(|e| format!("AIサーバからの受信に失敗: {}", e))?;
                if trailer == "\r\n" || trailer == "\n" || trailer.is_empty() {
                    break;
                }
            }
            break;
        }
        if out.len() + size > 16 * 1024 * 1024 {
            return Err("AIサーバの応答が大きすぎます".to_string());
        }
        let mut chunk = vec![0u8; size];
        reader
            .read_exact(&mut chunk)
            .await
            .map_err(|e| format!("AIサーバからの受信に失敗: {}", e))?;
        out.extend_from_slice(&chunk);
        let mut crlf = [0u8; 2];
        reader
            .read_exact(&mut crlf)
            .await
            .map_err(|e| format!("AIサーバからの受信に失敗: {}", e))?;
    }
    Ok(out)
}

/// opencode 自身のログ末尾から最新の ERROR 内容を抜き出す (5xx 時の原因表示用)。
/// opencode serve の HTTP 500 本文は不親切なため、実原因を添える。
/// 取得できなければ None。
fn opencode_error_tail() -> Option<String> {
    let base = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))?;
    let log = base
        .join(".local")
        .join("share")
        .join("opencode")
        .join("log")
        .join("opencode.log");
    let data = std::fs::read(&log).ok()?;
    if data.is_empty() {
        return None;
    }
    // 末尾 64KB だけ見る
    let start = data.len().saturating_sub(64 * 1024);
    let text = String::from_utf8_lossy(&data[start..]);
    let mut last: Option<&str> = None;
    for line in text.lines() {
        if line.contains("level=ERROR") {
            last = Some(line);
        }
    }
    let line = last?;
    let msg = extract_quoted_field(line, "error")
        .or_else(|| extract_quoted_field(line, "message"))
        .unwrap_or_else(|| line.to_string());
    let short: String = msg.chars().take(300).collect();
    if short.trim().is_empty() {
        None
    } else {
        Some(short)
    }
}

/// ログ行の `key="..."` フィールド値を抜き出す (末尾の `"` まで)。
fn extract_quoted_field(line: &str, key: &str) -> Option<String> {
    let needle = format!("{}=\"", key);
    let start = line.find(&needle)? + needle.len();
    let rest = &line[start..];
    let end = rest.rfind('"')?;
    Some(rest[..end].to_string())
}

/// 応答 parts から text 部分だけを抜き出す
pub(crate) fn extract_texts(response: &Value) -> Result<String, String> {
    let parts = response
        .get("parts")
        .and_then(|p| p.as_array())
        .ok_or_else(|| "AIサーバの応答形式が不正です".to_string())?;
    let mut out = Vec::new();
    for part in parts {
        if part.get("type").and_then(|t| t.as_str()) == Some("text") {
            if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                out.push(text.to_string());
            }
        }
    }
    if out.is_empty() {
        return Err("AIからの本文がありませんでした".to_string());
    }
    Ok(out.join("\n").trim().to_string())
}

/// モデル指定 "provider/model" を message 用オブジェクトに変換する。
/// 空なら None (serve 側の既定を使う)。'/' 無しは None (呼び出し側でエラーにする)。
pub(crate) fn parse_model(s: &str) -> Option<Value> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    s.split_once('/')
        .map(|(provider, id)| serde_json::json!({ "providerID": provider, "modelID": id }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn base64_matches_rfc_vector() {
        assert_eq!(base64_encode(b"opencode:pw"), "b3BlbmNvZGU6cHc=");
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
    }

    #[test]
    fn parse_model_splits_provider_and_id() {
        assert_eq!(parse_model(""), None);
        assert_eq!(parse_model("   "), None);
        assert_eq!(parse_model("noflash"), None);
        assert_eq!(
            parse_model("opencode-go/kimi-k3").unwrap(),
            json!({ "providerID": "opencode-go", "modelID": "kimi-k3" })
        );
    }

    #[test]
    fn extract_quoted_field_pulls_error() {
        let line = r#"timestamp=2026-09-18T15:29:19 level=ERROR run=abc message=failed ref=err_x error="ProviderModelNotFoundError: Model not found: x. Did you mean: y?""#;
        assert_eq!(
            extract_quoted_field(line, "error").as_deref(),
            Some("ProviderModelNotFoundError: Model not found: x. Did you mean: y?")
        );
        assert_eq!(extract_quoted_field(line, "missing"), None);
        // error が無ければ message を使う側で処理する (ここでは None 確認のみ)
        let plain = "timestamp=... level=ERROR run=abc";
        assert_eq!(extract_quoted_field(plain, "error"), None);
    }

    #[test]
    fn extract_texts_joins_text_parts() {        let v = json!({
            "parts": [
                { "type": "step-start" },
                { "type": "text", "text": "あいう" },
                { "type": "text", "text": "えお" },
                { "type": "step-finish" },
            ]
        });
        assert_eq!(extract_texts(&v).unwrap(), "あいう\nえお");
        assert!(extract_texts(&json!({ "parts": [] })).is_err());
        assert!(extract_texts(&json!({})).is_err());
    }

    /// chunked 本文の復号 (/message 応答用)。実 serve と同じ枠で検証する。
    #[tokio::test]
    async fn chunked_body_decodes() {
        let part1 = "{\"parts\":[{\"type\":\"text\",";
        let part2 = "\"text\":\"モック\"}]}";
        let raw = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{}\r\n{:x}\r\n{}\r\n0\r\n\r\n",
            part1.len(),
            part1,
            part2.len(),
            part2
        );
        let (mut writer, reader) = tokio::io::duplex(65536);
        writer.write_all(raw.as_bytes()).await.unwrap();
        drop(writer);
        let mut reader = BufReader::new(reader);
        // http_json と同じ手順でヘッダを読み飛ばす
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).await.unwrap();
            if line == "\r\n" {
                break;
            }
        }
        let body = read_chunked_body(&mut reader).await.expect("復号できる");
        let v: Value = serde_json::from_slice(&body).expect("JSONとして読める");
        assert_eq!(extract_texts(&v).unwrap(), "モック");
    }
}
