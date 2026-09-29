#[cfg(windows)]
use serde::Deserialize;

#[cfg(windows)]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Diagram {
    min_x: f64,
    min_y: f64,
    width: f64,
    height: f64,
    shapes: Vec<DiagramNode>,
    lines: Vec<DiagramEdge>,
    texts: Vec<DiagramLabel>,
}

#[cfg(windows)]
#[derive(Deserialize)]
struct DiagramNode {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    kind: String,
    label: String,
}

#[cfg(windows)]
#[derive(Deserialize)]
struct DiagramEdge {
    points: Vec<[f64; 2]>,
}

#[cfg(windows)]
#[derive(Deserialize)]
struct DiagramLabel {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    label: String,
}

#[cfg(windows)]
fn valid_number(value: f64) -> bool {
    value.is_finite() && value.abs() < 100_000.0
}

#[cfg(windows)]
fn validate(input: &Diagram) -> Result<(), String> {
    if !valid_number(input.min_x)
        || !valid_number(input.min_y)
        || !valid_number(input.width)
        || !valid_number(input.height)
        || input.width <= 0.0
        || input.height <= 0.0
        || input.shapes.is_empty()
        || input.shapes.len() > 200
        || input.lines.len() > 400
        || input.texts.len() > 400
    {
        return Err("Office図形のサイズまたは要素数が不正です".into());
    }
    for node in &input.shapes {
        if ![node.x, node.y, node.w, node.h].iter().all(|v| valid_number(*v))
            || node.w <= 0.0
            || node.h <= 0.0
            || node.label.chars().count() > 1000
            || !matches!(node.kind.as_str(), "rectangle" | "ellipse" | "diamond")
        {
            return Err("Office図形の形状が不正です".into());
        }
    }
    for edge in &input.lines {
        if edge.points.len() < 2
            || edge.points.len() > 25
            || !edge.points.iter().flatten().all(|v| valid_number(*v))
        {
            return Err("Office図形の線が不正です".into());
        }
    }
    for label in &input.texts {
        if ![label.x, label.y, label.w, label.h].iter().all(|v| valid_number(*v))
            || label.label.chars().count() > 1000
        {
            return Err("Office図形の文字が不正です".into());
        }
    }
    Ok(())
}

#[cfg(windows)]
fn run_powershell(script: &'static str, json: String) -> Result<(), String> {
    use std::io::Write;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    let mut child = Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Sta",
            "-Command",
            script,
        ])
        .creation_flags(0x0800_0000)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "Windows PowerShellを起動できません".to_string())?;
    child
        .stdin
        .take()
        .ok_or("Office図形を送信できません")?
        .write_all(json.as_bytes())
        .map_err(|_| "Office図形を送信できません".to_string())?;
    let output = child
        .wait_with_output()
        .map_err(|_| "Office図形の生成に失敗しました".to_string())?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(format!("クリップボードへコピーできません: {}", detail.trim()));
    }
    Ok(())
}

#[tauri::command]
pub async fn copy_office_drawing(json: String) -> Result<(), String> {
    if json.len() > 16 * 1024 * 1024 {
        return Err("Office図形が大きすぎます".into());
    }
    #[cfg(windows)]
    {
        let diagram: Diagram =
            serde_json::from_str(&json).map_err(|_| "Office図形のデータが不正です")?;
        validate(&diagram)?;
        tokio::task::spawn_blocking(move || run_powershell(include_str!("office_copy.ps1"), json))
            .await
            .map_err(|_| "Office図形の生成に失敗しました".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = json;
        Err("Office図形のコピーはWindowsのみ対応しています".into())
    }
}

#[tauri::command]
pub async fn copy_clipboard_data(format: String, value: String) -> Result<(), String> {
    if !matches!(format.as_str(), "text" | "png") || value.len() > 16 * 1024 * 1024 {
        return Err("コピーするデータが不正か大きすぎます".into());
    }
    #[cfg(windows)]
    {
        let input = serde_json::json!({ "format": format, "value": value }).to_string();
        tokio::task::spawn_blocking(move || run_powershell(include_str!("clipboard_copy.ps1"), input))
            .await
            .map_err(|_| "クリップボードへコピーできません".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (format, value);
        Err("このコピー機能はWindowsのみ対応しています".into())
    }
}
