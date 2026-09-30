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
    #[serde(default)]
    node_id: Option<String>,
    #[serde(default)]
    points: Vec<[f64; 2]>,
    #[serde(default)]
    fill: Option<String>,
    #[serde(default)]
    stroke: Option<String>,
    #[serde(default)]
    stroke_width: Option<f64>,
    #[serde(default)]
    dash: Option<String>,
    #[serde(default)]
    layer: Option<String>,
}

#[cfg(windows)]
#[derive(Deserialize)]
struct DiagramEdge {
    points: Vec<[f64; 2]>,
    #[serde(default)]
    start_node: Option<String>,
    #[serde(default)]
    end_node: Option<String>,
    #[serde(default)]
    stroke: Option<String>,
    #[serde(default)]
    stroke_width: Option<f64>,
    #[serde(default)]
    dash: Option<String>,
    #[serde(default)]
    start_arrow: Option<String>,
    #[serde(default)]
    end_arrow: Option<String>,
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
fn valid_color(value: &Option<String>) -> bool {
    value.as_deref().is_none_or(|color| {
        color == "none"
            || (color.len() == 7
                && color.starts_with('#')
                && color[1..].bytes().all(|byte| byte.is_ascii_hexdigit()))
    })
}

#[cfg(windows)]
fn validate(input: &Diagram) -> Result<(), String> {
    let mut node_ids = std::collections::HashSet::new();
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
        if let Some(id) = &node.node_id {
            if id.is_empty() || id.len() > 500 || !node_ids.insert(id.as_str()) {
                return Err("Office図形のノードIDが不正です".into());
            }
        }
        if ![node.x, node.y, node.w, node.h].iter().all(|v| valid_number(*v))
            || node.w <= 0.0
            || node.h <= 0.0
            || node.label.chars().count() > 1000
            || !matches!(node.kind.as_str(), "rectangle" | "ellipse" | "diamond" | "freeform")
            || node.points.len() > 128
            || (node.kind == "freeform" && node.points.len() < 3)
            || !node.points.iter().flatten().all(|value| valid_number(*value))
            || !valid_color(&node.fill)
            || !valid_color(&node.stroke)
            || node.stroke_width.is_some_and(|width| !valid_number(width) || width < 0.0 || width > 100.0)
            || node.dash.as_deref().is_some_and(|dash| !matches!(dash, "solid" | "dash" | "dot"))
            || node.layer.as_deref().is_some_and(|layer| !matches!(layer, "background" | "foreground"))
        {
            return Err("Office図形の形状が不正です".into());
        }
    }
    for edge in &input.lines {
        if edge.start_node.as_ref().is_some_and(|id| !node_ids.contains(id.as_str()))
            || edge.end_node.as_ref().is_some_and(|id| !node_ids.contains(id.as_str()))
        {
            return Err("Office図形の接続先が不正です".into());
        }
        if edge.points.len() < 2
            || edge.points.len() > 25
            || !edge.points.iter().flatten().all(|v| valid_number(*v))
            || !valid_color(&edge.stroke)
            || edge.stroke_width.is_some_and(|width| !valid_number(width) || width < 0.0 || width > 100.0)
            || edge.dash.as_deref().is_some_and(|dash| !matches!(dash, "solid" | "dash" | "dot"))
            || edge.start_arrow.as_deref().is_some_and(|arrow| !matches!(arrow, "none" | "triangle" | "oval" | "diamond"))
            || edge.end_arrow.as_deref().is_some_and(|arrow| !matches!(arrow, "none" | "triangle" | "oval" | "diamond"))
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
