//! Office drawing package generation in-process. Input is validated by office_copy.
use crate::clipboard;
use serde_json::Value;
use std::{
    collections::HashMap,
    io::{Cursor, Write},
};

fn list<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v[key].as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn text<'a>(v: &'a Value, key: &str, default: &'a str) -> &'a str {
    v[key].as_str().unwrap_or(default)
}
fn num(v: &Value, key: &str, default: f64) -> f64 {
    v[key].as_f64().unwrap_or(default)
}
fn yes(v: &Value, key: &str) -> bool {
    v[key].as_bool().unwrap_or(false)
}
fn point(v: &Value) -> [f64; 2] {
    [v[0].as_f64().unwrap_or(0.0), v[1].as_f64().unwrap_or(0.0)]
}
fn unit(v: f64) -> i64 {
    (v * 9525.0).round_ties_even() as i64
}
fn e(s: &str) -> String {
    s.chars()
        .filter(|c| *c >= ' ' || matches!(c, '\t' | '\n' | '\r'))
        .map(|c| match c {
            '&' => "&amp;".to_owned(),
            '<' => "&lt;".to_owned(),
            '>' => "&gt;".to_owned(),
            '"' => "&quot;".to_owned(),
            '\'' => "&apos;".to_owned(),
            _ => c.to_string(),
        })
        .collect()
}
fn fill(color: &str, opacity: f64) -> String {
    if color == "none" {
        return "<a:noFill/>".into();
    }
    let alpha = if opacity < 1.0 {
        format!(
            "<a:alpha val=\"{}\"/>",
            (opacity * 100000.0).round_ties_even() as i64
        )
    } else {
        String::new()
    };
    format!(
        "<a:solidFill><a:srgbClr val=\"{}\">{alpha}</a:srgbClr></a:solidFill>",
        e(&color.trim_start_matches('#').to_uppercase())
    )
}
fn line(v: &Value, start: &str, end: &str) -> String {
    let width = num(v, "strokeWidth", 1.333333);
    let cap = match text(v, "lineCap", "") {
        "round" => "rnd",
        "square" => "sq",
        _ => "flat",
    };
    let mut xml = format!(
        "<a:ln w=\"{}\" cap=\"{cap}\">{}",
        unit(width),
        fill(text(v, "stroke", "#334155"), num(v, "strokeOpacity", 1.0))
    );
    let dash = list(v, "dashArray");
    if !dash.is_empty() && width > 0.0 {
        xml.push_str("<a:custDash>");
        for i in (0..dash.len()).step_by(2) {
            let percent = |v: &Value| {
                ((v.as_f64().unwrap_or(0.0) / width * 100000.0).round_ties_even() as i64)
                    .clamp(0, i32::MAX as i64)
            };
            xml.push_str(&format!(
                "<a:ds d=\"{}\" sp=\"{}\"/>",
                percent(&dash[i]),
                percent(&dash[(i + 1) % dash.len()])
            ));
        }
        xml.push_str("</a:custDash>");
    } else if matches!(text(v, "dash", ""), "dash" | "dot") {
        xml.push_str(&format!("<a:prstDash val=\"{}\"/>", text(v, "dash", "")));
    }
    xml.push_str(match text(v, "lineJoin", "") {
        "round" => "<a:round/>",
        "bevel" => "<a:bevel/>",
        "miter" => "<a:miter lim=\"800000\"/>",
        _ => "",
    });
    if start != "none" && !start.is_empty() {
        xml.push_str(&format!("<a:headEnd type=\"{}\"/>", e(start)));
    }
    if end != "none" && !end.is_empty() {
        xml.push_str(&format!("<a:tailEnd type=\"{}\"/>", e(end)));
    }
    xml.push_str("</a:ln>");
    xml
}
fn run(value: &str, size: f64, color: &str, style: &Value) -> String {
    let mut attrs = String::new();
    for (field, attr) in [
        ("bold", "b=\"1\""),
        ("italic", "i=\"1\""),
        ("underline", "u=\"sng\""),
        ("strike", "strike=\"sngStrike\""),
    ] {
        if yes(style, field) {
            attrs.push(' ');
            attrs.push_str(attr);
        }
    }
    let family = text(style, "fontFamily", "");
    let font = if family.is_empty() {
        String::new()
    } else {
        format!(
            "<a:latin typeface=\"{}\"/><a:ea typeface=\"{}\"/><a:cs typeface=\"{}\"/>",
            e(family),
            e(family),
            e(family)
        )
    };
    format!("<a:r><a:rPr lang=\"ja-JP\" sz=\"{}\"{attrs}>{}{font}</a:rPr><a:t xml:space=\"preserve\">{}</a:t></a:r>",(size*75.0).round_ties_even() as i64,fill(color,num(style,"textOpacity",1.0)),e(value))
}
fn paragraphs(value: &str, size: f64, color: &str, style: &Value) -> String {
    let align = match text(style, "align", "") {
        "left" => "l",
        "right" => "r",
        _ => "ctr",
    };
    let mut xml = String::new();
    let ps = list(style, "paragraphs");
    if !ps.is_empty() {
        for p in ps {
            xml.push_str(&format!("<a:p><a:pPr algn=\"{align}\"/>"));
            for r in list(p, "runs") {
                xml.push_str(&run(
                    text(r, "text", ""),
                    num(r, "fontSize", 1100.0 / 75.0),
                    text(r, "textColor", "#0F172A"),
                    r,
                ));
            }
            xml.push_str("</a:p>");
        }
    } else {
        for row in value.split('\n') {
            xml.push_str(&format!(
                "<a:p><a:pPr algn=\"{align}\"/>{}</a:p>",
                run(row.trim_end_matches('\r'), size, color, style)
            ));
        }
    }
    xml
}
fn text_body(v: &Value) -> String {
    format!("<a:txSp><a:txBody><a:bodyPr wrap=\"square\" anchor=\"ctr\" lIns=\"0\" rIns=\"0\" tIns=\"0\" bIns=\"0\"><a:normAutofit/></a:bodyPr><a:lstStyle/>{}</a:txBody><a:useSpRect/></a:txSp>",paragraphs(text(v,"label",""),num(v,"fontSize",1100.0/75.0),text(v,"textColor","#0F172A"),v))
}
const SHAPE_STYLE: &str="<a:style><a:lnRef idx=\"1\"><a:schemeClr val=\"dk1\"/></a:lnRef><a:fillRef idx=\"1\"><a:schemeClr val=\"lt1\"/></a:fillRef><a:effectRef idx=\"0\"><a:schemeClr val=\"accent1\"/></a:effectRef><a:fontRef idx=\"minor\"><a:schemeClr val=\"dk1\"/></a:fontRef></a:style>";
const CONNECTOR_STYLE: &str="<a:style><a:lnRef idx=\"1\"><a:schemeClr val=\"accent1\"/></a:lnRef><a:fillRef idx=\"0\"><a:schemeClr val=\"accent1\"/></a:fillRef><a:effectRef idx=\"0\"><a:schemeClr val=\"accent1\"/></a:effectRef><a:fontRef idx=\"minor\"><a:schemeClr val=\"tx1\"/></a:fontRef></a:style>";
struct Drawing<'a> {
    value: &'a Value,
    min: [f64; 2],
    nodes: HashMap<&'a str, (usize, &'a Value)>,
}
impl Drawing<'_> {
    fn box_xml(&self, x: f64, y: f64, w: f64, h: f64, attrs: &str) -> String {
        format!(
            "<a:xfrm{attrs}><a:off x=\"{}\" y=\"{}\"/><a:ext cx=\"{}\" cy=\"{}\"/></a:xfrm>",
            unit(x - self.min[0]),
            unit(y - self.min[1]),
            unit(w),
            unit(h)
        )
    }
    fn shape(&self, v: &Value, id: usize) -> String {
        let (x, y, w, h) = (
            num(v, "x", 0.0),
            num(v, "y", 0.0),
            num(v, "w", 0.0),
            num(v, "h", 0.0),
        );
        let kind = text(v, "kind", "rectangle");
        let geometry = if matches!(kind, "freeform" | "bullseye") {
            let mut path = String::new();
            if kind == "bullseye" {
                path.push_str("<a:path w=\"21600\" h=\"21600\" fill=\"none\"><a:moveTo><a:pt x=\"21600\" y=\"10800\"/></a:moveTo><a:arcTo wR=\"10800\" hR=\"10800\" stAng=\"0\" swAng=\"10800000\"/><a:arcTo wR=\"10800\" hR=\"10800\" stAng=\"10800000\" swAng=\"10800000\"/><a:close/></a:path><a:path w=\"21600\" h=\"21600\" stroke=\"false\"><a:moveTo><a:pt x=\"14657\" y=\"10800\"/></a:moveTo><a:arcTo wR=\"3857\" hR=\"3857\" stAng=\"0\" swAng=\"10800000\"/><a:arcTo wR=\"3857\" hR=\"3857\" stAng=\"10800000\" swAng=\"10800000\"/><a:close/></a:path>");
            } else {
                path.push_str(&format!("<a:path w=\"{}\" h=\"{}\">", unit(w), unit(h)));
                for (i, p) in list(v, "points").iter().enumerate() {
                    let p = point(p);
                    let tag = if i == 0 { "moveTo" } else { "lnTo" };
                    path.push_str(&format!(
                        "<a:{tag}><a:pt x=\"{}\" y=\"{}\"/></a:{tag}>",
                        unit(p[0] - x),
                        unit(p[1] - y)
                    ));
                }
                if v["pathClosed"].as_bool() != Some(false) {
                    path.push_str("<a:close/>");
                }
                path.push_str("</a:path>");
            }
            let sites: Vec<[f64; 2]> = if list(v, "connectionSites").is_empty() {
                vec![
                    [x + w / 2.0, y],
                    [x, y + h / 2.0],
                    [x + w / 2.0, y + h],
                    [x + w, y + h / 2.0],
                ]
            } else {
                list(v, "connectionSites").iter().map(point).collect()
            };
            let mut guides = String::new();
            let mut ports = String::new();
            for (i, p) in sites.iter().enumerate() {
                let (sx, sy) = (p[0] - x, p[1] - y);
                guides.push_str(&format!("<a:gd name=\"csX{i}\" fmla=\"*/ {} w {}\"/><a:gd name=\"csY{i}\" fmla=\"*/ {} h {}\"/>",unit(sx),unit(w).max(1),unit(sy),unit(h).max(1)));
                let angle = ((sy - h / 2.0).atan2(sx - w / 2.0) * 10800000.0 / std::f64::consts::PI)
                    .round_ties_even() as i64;
                ports.push_str(&format!(
                    "<a:cxn ang=\"{}\"><a:pos x=\"csX{i}\" y=\"csY{i}\"/></a:cxn>",
                    angle.rem_euclid(21600000)
                ));
            }
            format!("<a:custGeom><a:avLst/><a:gdLst>{guides}</a:gdLst><a:ahLst/><a:cxnLst>{ports}</a:cxnLst><a:rect l=\"l\" t=\"t\" r=\"r\" b=\"b\"/><a:pathLst>{path}</a:pathLst></a:custGeom>")
        } else {
            let preset = if kind == "rectangle" { "rect" } else { kind };
            format!("<a:prstGeom prst=\"{preset}\"><a:avLst/></a:prstGeom>")
        };
        let rot = v["rotation"]
            .as_f64()
            .map(|r| format!(" rot=\"{}\"", (r * 60000.0).round_ties_even() as i64))
            .unwrap_or_default();
        format!("<a:sp><a:nvSpPr><a:cNvPr id=\"{id}\" name=\"Shape {id}\"/><a:cNvSpPr/></a:nvSpPr><a:spPr>{}{geometry}{}{}</a:spPr>{}{SHAPE_STYLE}</a:sp>",self.box_xml(x,y,w,h,&rot),fill(text(v,"fill","#FFFFFF"),num(v,"fillOpacity",1.0)),line(v,text(v,"startArrow","none"),text(v,"endArrow","none")),text_body(v))
    }
    fn connection(&self, node: &str, site: Option<usize>, p: [f64; 2], side: &str) -> String {
        let Some((id, shape)) = self.nodes.get(node) else {
            return String::new();
        };
        let (x, y, w, h) = (
            num(shape, "x", 0.0),
            num(shape, "y", 0.0),
            num(shape, "w", 0.0),
            num(shape, "h", 0.0),
        );
        let site = site.unwrap_or_else(|| {
            [
                [x + w / 2.0, y],
                [x, y + h / 2.0],
                [x + w / 2.0, y + h],
                [x + w, y + h / 2.0],
            ]
            .iter()
            .enumerate()
            .min_by(|(_, a), (_, b)| {
                ((a[0] - p[0]).powi(2) + (a[1] - p[1]).powi(2))
                    .total_cmp(&((b[0] - p[0]).powi(2) + (b[1] - p[1]).powi(2)))
            })
            .map(|(i, _)| i)
            .unwrap_or(0)
        });
        format!("<a:{side}Cxn id=\"{id}\" idx=\"{site}\"/>")
    }
    fn connector(&self, v: &Value, id: &mut usize) -> String {
        let points = list(v, "points");
        let start = point(&points[0]);
        let end = point(&points[points.len() - 1]);
        let (dx, dy) = (end[0] - start[0], end[1] - start[1]);
        let distance = dx.hypot(dy);
        let straight = distance > 0.01
            && points.iter().all(|p| {
                let p = point(p);
                ((p[0] - start[0]) * dy - (p[1] - start[1]) * dx).abs() / distance <= 0.75
            });
        let attrs = |h, v, rot| {
            format!(
                "{}{}{}",
                if h { " flipH=\"1\"" } else { "" },
                if v { " flipV=\"1\"" } else { "" },
                if rot { " rot=\"5400000\"" } else { "" }
            )
        };
        let box_xml = if !straight && dy.abs() > dx.abs() {
            let w = dy.abs().max(0.01);
            let h = dx.abs().max(0.01);
            self.box_xml(
                (start[0] + end[0] - w) / 2.0,
                (start[1] + end[1] - h) / 2.0,
                w,
                h,
                &attrs(dy < 0.0, dx > 0.0, true),
            )
        } else {
            self.box_xml(
                start[0].min(end[0]),
                start[1].min(end[1]),
                dx.abs().max(0.01),
                dy.abs().max(0.01),
                &attrs(dx < 0.0, dy < 0.0, false),
            )
        };
        let start_arrow = text(v, "startArrow", "none");
        let end_arrow = text(
            v,
            "endArrow",
            if yes(v, "arrow") { "triangle" } else { "none" },
        );
        let connections = self.connection(
            text(v, "startNode", ""),
            v["startSite"].as_u64().map(|v| v as usize),
            start,
            "st",
        ) + &self.connection(
            text(v, "endNode", ""),
            v["endSite"].as_u64().map(|v| v as usize),
            end,
            "end",
        );
        let mut xml=format!("<a:cxnSp><a:nvCxnSpPr><a:cNvPr id=\"{id}\" name=\"Connector {id}\"/><a:cNvCxnSpPr>{connections}</a:cNvCxnSpPr></a:nvCxnSpPr><a:spPr>{box_xml}<a:prstGeom prst=\"{}\"><a:avLst/></a:prstGeom><a:noFill/>{}</a:spPr>{CONNECTOR_STYLE}</a:cxnSp>",if straight{"straightConnector1"}else{"curvedConnector3"},line(v,if start_arrow=="cross"{"none"}else{start_arrow},if end_arrow=="cross"{"none"}else{end_arrow}));
        *id += 1;
        for (arrow, p, node_key, sites_key) in [
            (start_arrow, start, "startNode", "startCrossSites"),
            (end_arrow, end, "endNode", "endCrossSites"),
        ] {
            if arrow != "cross" {
                continue;
            }
            for diagonal in 0..2 {
                let box_xml = self.box_xml(
                    p[0] - 4.0,
                    p[1] - 4.0,
                    8.0,
                    8.0,
                    if diagonal == 1 { " flipV=\"1\"" } else { "" },
                );
                let sites = list(v, sites_key);
                let connections = if sites.len() == 4 {
                    self.connection(
                        text(v, node_key, ""),
                        sites[diagonal * 2].as_u64().map(|v| v as usize),
                        p,
                        "st",
                    ) + &self.connection(
                        text(v, node_key, ""),
                        sites[diagonal * 2 + 1].as_u64().map(|v| v as usize),
                        p,
                        "end",
                    )
                } else {
                    String::new()
                };
                let stroke = serde_json::json!({"stroke":v["stroke"],"strokeWidth":v["strokeWidth"],"strokeOpacity":v["strokeOpacity"]});
                xml.push_str(&format!("<a:cxnSp><a:nvCxnSpPr><a:cNvPr id=\"{id}\" name=\"Cross {id}\"/><a:cNvCxnSpPr>{connections}</a:cNvCxnSpPr></a:nvCxnSpPr><a:spPr>{box_xml}<a:prstGeom prst=\"straightConnector1\"><a:avLst/></a:prstGeom>{}</a:spPr>{CONNECTOR_STYLE}</a:cxnSp>",line(&stroke,"none","none")));
                *id += 1;
            }
        }
        xml
    }
    fn xml(&self) -> String {
        let mut xml=String::from("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><a:graphic xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas\"><lc:lockedCanvas xmlns:lc=\"http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas\">");
        let (w, h) = (
            unit(num(self.value, "width", 0.0)),
            unit(num(self.value, "height", 0.0)),
        );
        xml.push_str(&format!("<a:nvGrpSpPr><a:cNvPr id=\"0\" name=\"\"/><a:cNvGrpSpPr/></a:nvGrpSpPr><a:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"{w}\" cy=\"{h}\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"{w}\" cy=\"{h}\"/></a:xfrm></a:grpSpPr>"));
        let shapes = list(self.value, "shapes");
        for background in [true, false] {
            for (i, s) in shapes.iter().enumerate() {
                if text(s, "groupId", "").is_empty()
                    && (text(s, "layer", "") == "background") == background
                {
                    xml.push_str(&self.shape(s, i + 2));
                }
            }
        }
        let mut id = shapes.len() + 2;
        let mut groups: Vec<(&str, Vec<usize>)> = Vec::new();
        for (i, s) in shapes.iter().enumerate() {
            let key = text(s, "groupId", "");
            if key.is_empty() {
                continue;
            }
            if let Some((_, members)) = groups.iter_mut().find(|(name, _)| *name == key) {
                members.push(i);
            } else {
                groups.push((key, vec![i]));
            }
        }
        for (key, members) in groups {
            let mut left = f64::INFINITY;
            let mut top = f64::INFINITY;
            let mut right = f64::NEG_INFINITY;
            let mut bottom = f64::NEG_INFINITY;
            for i in &members {
                let s = &shapes[*i];
                left = left.min(num(s, "x", 0.0));
                top = top.min(num(s, "y", 0.0));
                right = right.max(num(s, "x", 0.0) + num(s, "w", 0.0));
                bottom = bottom.max(num(s, "y", 0.0) + num(s, "h", 0.0));
            }
            let (x, y, w, h) = (
                unit(left - self.min[0]),
                unit(top - self.min[1]),
                unit(right - left),
                unit(bottom - top),
            );
            xml.push_str(&format!("<a:grpSp><a:nvGrpSpPr><a:cNvPr id=\"{id}\" name=\"{}\"/><a:cNvGrpSpPr/></a:nvGrpSpPr><a:grpSpPr><a:xfrm><a:off x=\"{x}\" y=\"{y}\"/><a:ext cx=\"{w}\" cy=\"{h}\"/><a:chOff x=\"{x}\" y=\"{y}\"/><a:chExt cx=\"{w}\" cy=\"{h}\"/></a:xfrm></a:grpSpPr>",e(key)));
            for i in members {
                xml.push_str(&self.shape(&shapes[i], i + 2));
            }
            xml.push_str("</a:grpSp>");
            id += 1;
        }
        for edge in list(self.value, "lines") {
            xml.push_str(&self.connector(edge, &mut id));
        }
        for label in list(self.value, "texts") {
            xml.push_str(&format!("<a:sp><a:nvSpPr><a:cNvPr id=\"{id}\" name=\"Text {id}\"/><a:cNvSpPr txBox=\"1\"/></a:nvSpPr><a:spPr>{}<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></a:spPr>{}{SHAPE_STYLE}</a:sp>",self.box_xml(num(label,"x",0.0),num(label,"y",0.0),num(label,"w",0.0),num(label,"h",0.0),""),text_body(label)));
            id += 1;
        }
        for table in list(self.value, "tables") {
            let mut content = String::from("<a:tbl><a:tblPr/><a:tblGrid>");
            for col in list(table, "columns") {
                content.push_str(&format!(
                    "<a:gridCol w=\"{}\"/>",
                    unit(col.as_f64().unwrap_or(0.0))
                ));
            }
            content.push_str("</a:tblGrid>");
            for row in list(table, "rows") {
                content.push_str(&format!("<a:tr h=\"{}\">", unit(num(row, "height", 0.0))));
                for cell in list(row, "cells") {
                    let mut attrs = String::new();
                    for (key, name) in [("colspan", "gridSpan"), ("rowspan", "rowSpan")] {
                        if num(cell, key, 1.0) > 1.0 {
                            attrs
                                .push_str(&format!(" {name}=\"{}\"", num(cell, key, 1.0) as usize));
                        }
                    }
                    for key in ["hMerge", "vMerge"] {
                        if yes(cell, key) {
                            attrs.push_str(&format!(" {key}=\"1\""));
                        }
                    }
                    content.push_str(&format!("<a:tc{attrs}><a:txBody><a:bodyPr/><a:lstStyle/>{}</a:txBody><a:tcPr marL=\"76200\" marR=\"76200\" marT=\"38100\" marB=\"38100\">",paragraphs(text(cell,"label",""),16.0,"#0F172A",cell)));
                    for side in ["L", "R", "T", "B"] {
                        content.push_str(&format!("<a:ln{side} w=\"9525\"><a:solidFill><a:srgbClr val=\"CBD5E1\"/></a:solidFill></a:ln{side}>"));
                    }
                    content.push_str(&fill(text(cell, "fill", "#FFFFFF"), 1.0));
                    content.push_str("</a:tcPr></a:tc>");
                }
                content.push_str("</a:tr>");
            }
            content.push_str("</a:tbl>");
            xml.push_str(&format!("<a:graphicFrame><a:nvGraphicFramePr><a:cNvPr id=\"{id}\" name=\"Table {id}\"/><a:cNvGraphicFramePr/></a:nvGraphicFramePr><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/table\">{content}</a:graphicData></a:graphic>{}</a:graphicFrame>",self.box_xml(num(table,"x",0.0),num(table,"y",0.0),num(table,"w",0.0),num(table,"h",0.0),"")));
            id += 1;
        }
        for (i, image) in list(self.value, "images").iter().enumerate() {
            xml.push_str(&format!("<a:pic><a:nvPicPr><a:cNvPr id=\"{id}\" name=\"Image {id}\"/><a:cNvPicPr/></a:nvPicPr><a:blipFill><a:blip xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" r:embed=\"image{}\"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:spPr>{}<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></a:spPr></a:pic>",i+1,self.box_xml(num(image,"x",0.0),num(image,"y",0.0),num(image,"w",0.0),num(image,"h",0.0),"")));
            id += 1;
        }
        xml.push_str("</lc:lockedCanvas></a:graphicData></a:graphic>");
        xml
    }
}
pub fn copy(value: Value) -> Result<(), String> {
    let drawing = Drawing {
        min: [num(&value, "minX", 0.0), num(&value, "minY", 0.0)],
        nodes: list(&value, "shapes")
            .iter()
            .enumerate()
            .filter_map(|(i, s)| s["nodeId"].as_str().map(|id| (id, (i + 2, s))))
            .collect(),
        value: &value,
    };
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut add = |name: &str, bytes: &[u8]| -> Result<(), String> {
        zip.start_file(name, options)
            .map_err(|_| "Officeパッケージを作れません")?;
        zip.write_all(bytes)
            .map_err(|_| "Officeパッケージを書けません".into())
    };
    add("[Content_Types].xml",b"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"png\" ContentType=\"image/png\"/><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/clipboard/drawings/drawing1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.drawing+xml\"/><Override PartName=\"/clipboard/theme/theme1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/></Types>")?;
    add("_rels/.rels",b"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing\" Target=\"clipboard/drawings/drawing1.xml\"/></Relationships>")?;
    add("clipboard/drawings/drawing1.xml", drawing.xml().as_bytes())?;
    add(
        "clipboard/theme/theme1.xml",
        include_bytes!("office_theme.xml"),
    )?;
    let mut rels=String::from("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme\" Target=\"../theme/theme1.xml\"/>");
    for (i, image) in list(&value, "images").iter().enumerate() {
        let index = i + 1;
        add(
            &format!("clipboard/media/image{index}.png"),
            &clipboard::decode_png(text(image, "png", ""))?,
        )?;
        rels.push_str(&format!("<Relationship Id=\"image{index}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/image{index}.png\"/>"));
    }
    rels.push_str("</Relationships>");
    add(
        "clipboard/drawings/_rels/drawing1.xml.rels",
        rels.as_bytes(),
    )?;
    let bytes = zip
        .finish()
        .map_err(|_| "Officeパッケージを完成できません")?
        .into_inner();
    let mut formats = vec![(clipboard::format("Art::GVML ClipFormat")?, bytes)];
    if let Some(html) = value["clipboardHtml"].as_str().filter(|v| !v.is_empty()) {
        formats.push((
            clipboard::format("HTML Format")?,
            clipboard::html_bytes(html),
        ));
    }
    if let Some(text) = value["clipboardText"].as_str() {
        formats.push((13, clipboard::text_bytes(text)));
    }
    clipboard::write(formats)
}
