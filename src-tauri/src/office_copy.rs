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
    #[serde(default)]
    tables: Vec<DiagramTable>,
    #[serde(default)]
    images: Vec<DiagramImage>,
    #[serde(default)]
    clipboard_html: Option<String>,
    #[serde(default)]
    clipboard_text: Option<String>,
}

#[cfg(windows)]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiagramNode {
    #[serde(flatten)]
    style: OfficeStyle,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    kind: String,
    label: String,
    #[serde(default)]
    path_closed: Option<bool>,
    #[serde(default)]
    start_arrow: Option<String>,
    #[serde(default)]
    end_arrow: Option<String>,
    #[serde(default)]
    font_size: Option<f64>,
    #[serde(default)]
    text_color: Option<String>,
    #[serde(default)]
    fill_opacity: Option<f64>,
    #[serde(default)]
    node_id: Option<String>,
    #[serde(default)]
    group_id: Option<String>,
    #[serde(default)]
    rotation: Option<f64>,
    #[serde(default)]
    points: Vec<[f64; 2]>,
    #[serde(default)]
    connection_sites: Vec<[f64; 2]>,
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
#[serde(rename_all = "camelCase")]
struct DiagramEdge {
    #[serde(flatten)]
    style: OfficeStyle,
    points: Vec<[f64; 2]>,
    /// Optional custom cubic segments: control1, control2, endpoint.
    #[serde(default)]
    bezier_segments: Vec<[[f64; 2]; 3]>,
    #[serde(default)]
    start_node: Option<String>,
    #[serde(default)]
    end_node: Option<String>,
    #[serde(default)]
    start_site: Option<usize>,
    #[serde(default)]
    end_site: Option<usize>,
    #[serde(default)]
    start_cross_sites: Option<[usize; 4]>,
    #[serde(default)]
    end_cross_sites: Option<[usize; 4]>,
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
#[serde(rename_all = "camelCase")]
struct DiagramLabel {
    #[serde(flatten)]
    style: OfficeStyle,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    label: String,
    #[serde(default)]
    font_size: Option<f64>,
    #[serde(default)]
    text_color: Option<String>,
}

#[cfg(windows)]
fn valid_number(value: f64) -> bool {
    value.is_finite() && value.abs() < 100_000.0
}

#[cfg(windows)]
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct OfficeStyle {
    #[serde(default)]
    paragraphs: Vec<OfficeParagraph>,
    align: Option<String>,
    stroke_opacity: Option<f64>,
    text_opacity: Option<f64>,
    font_family: Option<String>,
    bold: Option<bool>,
    italic: Option<bool>,
    underline: Option<bool>,
    strike: Option<bool>,
    line_cap: Option<String>,
    line_join: Option<String>,
    #[serde(default)]
    dash_array: Vec<f64>,
    #[serde(default)]
    computed_style: std::collections::HashMap<String, String>,
    #[serde(default)]
    computed_text_style: std::collections::HashMap<String, String>,
}

#[cfg(windows)]
impl OfficeStyle {
    fn valid(&self) -> bool {
        let _ = (self.bold, self.italic, self.underline, self.strike);
        [self.stroke_opacity, self.text_opacity]
            .iter()
            .all(|v| v.is_none_or(|v| v.is_finite() && (0.0..=1.0).contains(&v)))
            && self
                .align
                .as_deref()
                .is_none_or(|v| matches!(v, "left" | "center" | "right"))
            && self.paragraphs.len() <= 1000
            && self.paragraphs.iter().all(|p| {
                p.runs.len() <= 2000
                    && p.runs.iter().all(|r| {
                        r.text.len() <= 16000
                            && r.style.paragraphs.is_empty()
                            && r.style.valid()
                            && valid_color(&r.text_color)
                            && r.font_size
                                .is_none_or(|v| v.is_finite() && (1.0..=200.0).contains(&v))
                    })
            })
            && self
                .font_family
                .as_ref()
                .is_none_or(|v| v.len() <= 200 && !v.chars().any(char::is_control))
            && self
                .line_cap
                .as_deref()
                .is_none_or(|v| matches!(v, "butt" | "round" | "square"))
            && self
                .line_join
                .as_deref()
                .is_none_or(|v| matches!(v, "miter" | "round" | "bevel"))
            && self.dash_array.len() <= 64
            && self
                .dash_array
                .iter()
                .all(|v| v.is_finite() && (0.0..=10000.0).contains(v))
            && self.computed_style.len() <= 1000
            && self
                .computed_style
                .iter()
                .all(|(k, v)| k.len() <= 200 && v.len() <= 10000)
            && self.computed_text_style.len() <= 1000
            && self
                .computed_text_style
                .iter()
                .all(|(k, v)| k.len() <= 200 && v.len() <= 10000)
    }
}

#[cfg(windows)]
#[derive(Deserialize)]
struct OfficeParagraph {
    runs: Vec<OfficeRun>,
}
#[cfg(windows)]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfficeRun {
    text: String,
    font_size: Option<f64>,
    text_color: Option<String>,
    #[serde(flatten)]
    style: OfficeStyle,
}
#[cfg(windows)]
#[derive(Deserialize)]
struct DiagramTable {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    columns: Vec<f64>,
    rows: Vec<TableRow>,
}
#[cfg(windows)]
#[derive(Deserialize)]
struct TableRow {
    height: f64,
    cells: Vec<TableCell>,
}
#[cfg(windows)]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableCell {
    label: String,
    #[serde(default = "one")]
    colspan: usize,
    #[serde(default = "one")]
    rowspan: usize,
    #[serde(default)]
    h_merge: bool,
    #[serde(default)]
    v_merge: bool,
    fill: Option<String>,
    #[serde(flatten)]
    style: OfficeStyle,
}
#[cfg(windows)]
fn one() -> usize {
    1
}
#[cfg(windows)]
#[derive(Deserialize)]
struct DiagramImage {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    png: String,
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
    let mut node_ids = std::collections::HashMap::new();
    if !valid_number(input.min_x)
        || !valid_number(input.min_y)
        || !valid_number(input.width)
        || !valid_number(input.height)
        || input.width <= 0.0
        || input.height <= 0.0
        || (input.shapes.is_empty()
            && input.tables.is_empty()
            && input.texts.is_empty()
            && input.images.is_empty())
        || input.shapes.len() > 2000
        || input.lines.len() > 4000
        || input.texts.len() > 4000
        || input.tables.len() > 100
        || input.images.len() > 200
    {
        return Err("Office図形のサイズまたは要素数が不正です".into());
    }
    if input
        .clipboard_html
        .as_ref()
        .is_some_and(|v| v.len() > 16 * 1024 * 1024)
        || input
            .clipboard_text
            .as_ref()
            .is_some_and(|v| v.len() > 16 * 1024 * 1024)
    {
        return Err("コピーする本文が大きすぎます".into());
    }
    for table in &input.tables {
        if ![table.x, table.y, table.w, table.h]
            .iter()
            .all(|v| valid_number(*v))
            || table.w <= 0.0
            || table.h <= 0.0
            || table.columns.is_empty()
            || table.columns.len() > 100
            || table.columns.iter().any(|v| !valid_number(*v) || *v <= 0.0)
            || table.rows.is_empty()
            || table.rows.len() > 1000
            || table.rows.iter().enumerate().any(|(ri, r)| {
                !valid_number(r.height)
                    || r.height <= 0.0
                    || r.cells.len() != table.columns.len()
                    || r.cells.iter().enumerate().any(|(ci, c)| {
                        c.label.len() > 16000
                            || c.colspan == 0
                            || c.rowspan == 0
                            || c.colspan > table.columns.len() - ci
                            || c.rowspan > table.rows.len() - ri
                            || (c.h_merge && ci == 0)
                            || (c.v_merge && ri == 0)
                            || !valid_color(&c.fill)
                            || !c.style.valid()
                    })
            })
        {
            return Err("Office表のデータが不正です".into());
        }
    }
    for image in &input.images {
        if ![image.x, image.y, image.w, image.h]
            .iter()
            .all(|v| valid_number(*v))
            || image.w <= 0.0
            || image.h <= 0.0
            || image.png.len() > 16 * 1024 * 1024
            || !image.png.starts_with("iVBORw0KGgo")
            || !image
                .png
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
        {
            return Err("Office画像のデータが不正です".into());
        }
    }
    for node in &input.shapes {
        if !node.style.valid() {
            return Err("Office図形のスタイルが不正です".into());
        }
        if let Some(id) = &node.node_id {
            let site_count = if node.connection_sites.is_empty() {
                4
            } else {
                node.connection_sites.len()
            };
            if id.is_empty() || id.len() > 500 || node_ids.insert(id.as_str(), site_count).is_some()
            {
                return Err("Office図形のノードIDが不正です".into());
            }
        }
        if ![node.x, node.y, node.w, node.h]
            .iter()
            .all(|v| valid_number(*v))
            || node.w <= 0.0
            || node.h <= 0.0
            || node.label.chars().count() > 1000
            || node
                .group_id
                .as_ref()
                .is_some_and(|id| id.is_empty() || id.len() > 500)
            || node
                .rotation
                .is_some_and(|angle| !angle.is_finite() || angle.abs() > 360.0)
            || !matches!(
                node.kind.as_str(),
                "rectangle"
                    | "ellipse"
                    | "bullseye"
                    | "diamond"
                    | "freeform"
                    | "roundRect"
                    | "flowChartPredefinedProcess"
                    | "can"
            )
            || node.points.len() > 128
            || (node.kind == "freeform"
                && node.points.len()
                    < if node.path_closed == Some(false) {
                        2
                    } else {
                        3
                    })
            || !node
                .points
                .iter()
                .flatten()
                .all(|value| valid_number(*value))
            || node.connection_sites.len() > 1024
            || (!node.connection_sites.is_empty()
                && !matches!(node.kind.as_str(), "freeform" | "bullseye"))
            || !node
                .connection_sites
                .iter()
                .flatten()
                .all(|value| valid_number(*value))
            || !valid_color(&node.fill)
            || !valid_color(&node.stroke)
            || !valid_color(&node.text_color)
            || node
                .font_size
                .is_some_and(|size| !size.is_finite() || !(1.0..=200.0).contains(&size))
            || node
                .fill_opacity
                .is_some_and(|opacity| !opacity.is_finite() || !(0.0..=1.0).contains(&opacity))
            || node.start_arrow.as_deref().is_some_and(|arrow| {
                !matches!(arrow, "none" | "triangle" | "oval" | "diamond" | "arrow")
            })
            || node.end_arrow.as_deref().is_some_and(|arrow| {
                !matches!(arrow, "none" | "triangle" | "oval" | "diamond" | "arrow")
            })
            || node
                .stroke_width
                .is_some_and(|width| !valid_number(width) || width < 0.0 || width > 100.0)
            || node
                .dash
                .as_deref()
                .is_some_and(|dash| !matches!(dash, "solid" | "dash" | "dot"))
            || node
                .layer
                .as_deref()
                .is_some_and(|layer| !matches!(layer, "background" | "foreground"))
        {
            return Err("Office図形の形状が不正です".into());
        }
    }
    for edge in &input.lines {
        if !edge.style.valid() {
            return Err("Office図形の線スタイルが不正です".into());
        }
        if edge
            .start_node
            .as_ref()
            .is_some_and(|id| !node_ids.contains_key(id.as_str()))
            || edge
                .end_node
                .as_ref()
                .is_some_and(|id| !node_ids.contains_key(id.as_str()))
            || edge.start_site.is_some_and(|site| {
                edge.start_node
                    .as_ref()
                    .and_then(|id| node_ids.get(id.as_str()))
                    .is_none_or(|count| site >= *count)
            })
            || edge.end_site.is_some_and(|site| {
                edge.end_node
                    .as_ref()
                    .and_then(|id| node_ids.get(id.as_str()))
                    .is_none_or(|count| site >= *count)
            })
            || edge.start_cross_sites.is_some_and(|sites| {
                edge.start_node
                    .as_ref()
                    .and_then(|id| node_ids.get(id.as_str()))
                    .is_none_or(|count| sites.iter().any(|site| site >= count))
            })
            || edge.end_cross_sites.is_some_and(|sites| {
                edge.end_node
                    .as_ref()
                    .and_then(|id| node_ids.get(id.as_str()))
                    .is_none_or(|count| sites.iter().any(|site| site >= count))
            })
        {
            return Err("Office図形の接続先が不正です".into());
        }
        if edge.points.len() < 2
            || edge.points.len() > 25
            || !edge.points.iter().flatten().all(|v| valid_number(*v))
            || edge.bezier_segments.len() > 32
            || !edge
                .bezier_segments
                .iter()
                .flatten()
                .flatten()
                .all(|v| valid_number(*v))
            || edge
                .bezier_segments
                .last()
                .zip(edge.points.last())
                .is_some_and(|(segment, end)| {
                    (segment[2][0] - end[0]).abs() > 0.000001
                        || (segment[2][1] - end[1]).abs() > 0.000001
                })
            || !valid_color(&edge.stroke)
            || edge
                .stroke_width
                .is_some_and(|width| !valid_number(width) || width < 0.0 || width > 100.0)
            || edge
                .dash
                .as_deref()
                .is_some_and(|dash| !matches!(dash, "solid" | "dash" | "dot"))
            || edge.start_arrow.as_deref().is_some_and(|arrow| {
                !matches!(
                    arrow,
                    "none" | "triangle" | "oval" | "diamond" | "cross" | "arrow"
                )
            })
            || edge.end_arrow.as_deref().is_some_and(|arrow| {
                !matches!(
                    arrow,
                    "none" | "triangle" | "oval" | "diamond" | "cross" | "arrow"
                )
            })
        {
            return Err("Office図形の線が不正です".into());
        }
    }
    for label in &input.texts {
        if !label.style.valid() {
            return Err("Office図形の文字スタイルが不正です".into());
        }
        if ![label.x, label.y, label.w, label.h]
            .iter()
            .all(|v| valid_number(*v))
            || label.label.chars().count() > 1000
            || !valid_color(&label.text_color)
            || label
                .font_size
                .is_some_and(|size| !size.is_finite() || !(1.0..=200.0).contains(&size))
        {
            return Err("Office図形の文字が不正です".into());
        }
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
        tokio::task::spawn_blocking(move || {
            crate::office_drawing::copy(
                serde_json::from_str(&json).map_err(|_| "Office図形のデータが不正です")?,
            )
        })
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
    if !matches!(format.as_str(), "text" | "png" | "html") || value.len() > 16 * 1024 * 1024 {
        return Err("コピーするデータが不正か大きすぎます".into());
    }
    #[cfg(windows)]
    {
        tokio::task::spawn_blocking(move || {
            if format == "png" {
                crate::clipboard::copy_png(&value)
            } else if format == "html" {
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields)]
                struct DocumentClipboard {
                    html: String,
                    text: String,
                }
                let document: DocumentClipboard =
                    serde_json::from_str(&value).map_err(|_| "書式付き文字列のデータが不正です")?;
                crate::clipboard::write(vec![
                    (
                        crate::clipboard::format("HTML Format")?,
                        crate::clipboard::html_bytes(&document.html),
                    ),
                    (13, crate::clipboard::text_bytes(&document.text)),
                ])
            } else {
                crate::clipboard::write(vec![(13, crate::clipboard::text_bytes(&value))])
            }
        })
        .await
        .map_err(|_| "クリップボードへコピーできません".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (format, value);
        Err("このコピー機能はWindowsのみ対応しています".into())
    }
}
