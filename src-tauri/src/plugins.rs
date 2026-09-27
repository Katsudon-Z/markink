use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use zip::{CompressionMethod, ZipArchive};

const MAX_ZIP_BYTES: u64 = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 100 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_ENTRIES: usize = 256;
const MAX_COMPRESSION_RATIO: u64 = 200;
static NEXT_STAGE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    id: String,
    name: String,
    version: String,
    api_version: u32,
    description: Option<String>,
    author: Option<String>,
    permissions: Vec<String>,
    entry: Option<String>,
    installed: bool,
    executable: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginManifest {
    id: String,
    name: String,
    version: String,
    api_version: u32,
    description: Option<String>,
    author: Option<String>,
    permissions: Vec<String>,
    entry: Option<String>,
}

const PERMISSIONS: &[&str] = &[
    "document.read",
    "document.edit",
    "ui.register",
    "ui.notify",
    "log.write",
];

fn plugins_root() -> PathBuf {
    crate::settings::local_dir().join("plugins")
}

fn valid_id(id: &str) -> bool {
    (3..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"._-".contains(&b))
        && id
            .as_bytes()
            .first()
            .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

fn valid_version(version: &str) -> bool {
    if version.ends_with('-') || version.ends_with('+') {
        return false;
    }
    let core = version.split(['-', '+']).next().unwrap_or("");
    let mut parts = core.split('.');
    let numbers: Vec<_> = parts.by_ref().collect();
    numbers.len() == 3
        && numbers.iter().all(|part| {
            !part.is_empty()
                && part.bytes().all(|b| b.is_ascii_digit())
                && (part == &"0" || !part.starts_with('0'))
        })
        && version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".+-".contains(&b))
}

fn validate_manifest(bytes: &[u8]) -> Result<PluginManifest, String> {
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("manifest.json が大きすぎます".into());
    }
    let manifest: PluginManifest = serde_json::from_slice(bytes)
        .map_err(|e| format!("manifest.json を読み取れません: {e}"))?;
    if !valid_id(&manifest.id) {
        return Err("manifest のプラグインIDが不正です".into());
    }
    if manifest.name.trim().is_empty() || manifest.name.len() > 120 {
        return Err("manifest の名称が不正です".into());
    }
    if manifest
        .description
        .as_ref()
        .is_some_and(|s| s.trim().is_empty() || s.len() > 2000)
        || manifest
            .author
            .as_ref()
            .is_some_and(|s| s.trim().is_empty() || s.len() > 120)
    {
        return Err("manifest の説明または作者名が不正です".into());
    }
    if !valid_version(&manifest.version) {
        return Err("manifest のバージョンが不正です".into());
    }
    if manifest.api_version != 1 {
        return Err(format!(
            "未対応の Extension API バージョンです: {}",
            manifest.api_version
        ));
    }
    if manifest.permissions.len() > PERMISSIONS.len() {
        return Err("manifest の権限数が上限を超えています".into());
    }
    let mut permissions = HashSet::new();
    if manifest
        .permissions
        .iter()
        .any(|p| !PERMISSIONS.contains(&p.as_str()) || !permissions.insert(p))
    {
        return Err("manifest の権限が不正または重複しています".into());
    }
    if let Some(entry) = &manifest.entry {
        validate_archive_path(entry, false)?;
    }
    Ok(manifest)
}

fn validate_archive_path(name: &str, is_dir: bool) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains('\\') || name.starts_with('/') || name.starts_with('\\') {
        return Err(format!("ZIP内のパスが不正です: {name}"));
    }
    let normalized = if is_dir {
        name.trim_end_matches('/')
    } else {
        name
    };
    if normalized.is_empty() {
        return Err("ZIP内に空のパスがあります".into());
    }
    let path = Path::new(normalized);
    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                let part = part
                    .to_str()
                    .ok_or_else(|| "ZIP内のパスがUTF-8ではありません".to_string())?;
                let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
                let reserved_device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                    || ["COM", "LPT"].iter().any(|prefix| {
                        stem.strip_prefix(prefix).is_some_and(|suffix| {
                            suffix.len() == 1 && matches!(suffix.as_bytes()[0], b'1'..=b'9')
                        })
                    });
                if part.is_empty()
                    || part.ends_with(['.', ' '])
                    || part.chars().any(|ch| ch < ' ' || "<>:\"|?*".contains(ch))
                    || reserved_device
                {
                    return Err(format!("ZIP内のパスが不正です: {name}"));
                }
                clean.push(part);
            }
            _ => return Err(format!("ZIP内のパスに禁止要素があります: {name}")),
        }
    }
    Ok(clean)
}

fn unique_name() -> String {
    let ticks = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!(
        "{}-{}-{}",
        std::process::id(),
        ticks,
        NEXT_STAGE.fetch_add(1, Ordering::Relaxed)
    )
}

#[tauri::command]
pub fn plugin_install_zip(zip_path: String) -> Result<PluginInfo, String> {
    let archive_path = PathBuf::from(zip_path);
    let metadata = fs::metadata(&archive_path).map_err(|e| format!("ZIPを開けません: {e}"))?;
    if !metadata.is_file() || metadata.len() > MAX_ZIP_BYTES {
        return Err("ZIPファイルが不正か、50 MiBの上限を超えています".into());
    }
    let file = File::open(&archive_path).map_err(|e| format!("ZIPを開けません: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("ZIPとして読み取れません: {e}"))?;
    if archive.len() == 0 || archive.len() > MAX_ENTRIES {
        return Err(format!("ZIP内のエントリ数は1〜{MAX_ENTRIES}にしてください"));
    }

    let root = plugins_root();
    let staging_root = root.join("staging");
    let install_root = root.join("installed");
    fs::create_dir_all(&staging_root).map_err(|e| format!("一時フォルダを作成できません: {e}"))?;
    fs::create_dir_all(&install_root)
        .map_err(|e| format!("プラグインフォルダを作成できません: {e}"))?;
    let stage = staging_root.join(unique_name());
    fs::create_dir(&stage).map_err(|e| format!("一時フォルダを作成できません: {e}"))?;

    let result = (|| {
        let mut seen: HashSet<String> = HashSet::new();
        let mut seen_files: HashSet<String> = HashSet::new();
        let mut total = 0u64;
        let mut manifest_bytes = None;
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|e| format!("ZIPエントリを読み取れません: {e}"))?;
            let name = entry.name().to_string();
            let is_dir = entry.is_dir();
            let relative = validate_archive_path(&name, is_dir)?;
            let key = relative.to_string_lossy().to_lowercase();
            if !seen.insert(key) {
                return Err(format!("ZIP内に重複パスがあります: {name}"));
            }
            let key = relative.to_string_lossy().to_lowercase();
            let mut parent = relative.parent();
            while let Some(path) = parent {
                if seen_files.contains(&path.to_string_lossy().to_lowercase()) {
                    return Err(format!("ファイルとフォルダのパスが衝突しています: {name}"));
                }
                parent = path.parent();
            }
            if !is_dir {
                let prefix = format!("{key}/");
                if seen_files
                    .iter()
                    .any(|existing| existing.starts_with(&prefix))
                {
                    return Err(format!("ファイルとフォルダのパスが衝突しています: {name}"));
                }
                seen_files.insert(key);
            }
            if let Some(mode) = entry.unix_mode() {
                let kind = mode & 0o170000;
                if kind == 0o120000 || (kind != 0 && kind != 0o100000 && kind != 0o040000) {
                    return Err(format!("リンクまたは特殊ファイルは導入できません: {name}"));
                }
            }
            let method = entry.compression();
            if method != CompressionMethod::Stored && method != CompressionMethod::Deflated {
                return Err(format!("未対応の圧縮方式です: {name}"));
            }
            let declared = entry.size();
            let compressed = entry.compressed_size();
            if declared > MAX_FILE_BYTES {
                return Err(format!("ZIP内のファイルが32 MiBを超えています: {name}"));
            }
            if declared > 0
                && (compressed == 0 || declared > compressed.saturating_mul(MAX_COMPRESSION_RATIO))
            {
                return Err(format!("圧縮率が上限を超えています: {name}"));
            }
            total = total
                .checked_add(declared)
                .ok_or("展開サイズが上限を超えています")?;
            if total > MAX_TOTAL_BYTES {
                return Err("ZIPの展開合計が100 MiBを超えています".into());
            }
            let destination = stage.join(&relative);
            if is_dir {
                fs::create_dir_all(&destination)
                    .map_err(|e| format!("フォルダを作成できません: {e}"))?;
                continue;
            }
            let parent = destination.parent().ok_or("ZIP内のパスが不正です")?;
            fs::create_dir_all(parent).map_err(|e| format!("フォルダを作成できません: {e}"))?;
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&destination)
                .map_err(|e| format!("ファイルを作成できません: {e}"))?;
            let mut file_bytes = Vec::new();
            let mut buffer = [0u8; 16 * 1024];
            loop {
                let read = entry
                    .read(&mut buffer)
                    .map_err(|e| format!("ZIPエントリが破損しています: {e}"))?;
                if read == 0 {
                    break;
                }
                if file_bytes.len() as u64 + read as u64 > declared
                    || file_bytes.len() as u64 + read as u64 > MAX_FILE_BYTES
                {
                    return Err(format!("ZIPエントリの実サイズが宣言と異なります: {name}"));
                }
                output
                    .write_all(&buffer[..read])
                    .map_err(|e| format!("ファイルを書き込めません: {e}"))?;
                if name == "manifest.json" {
                    if file_bytes.len() as u64 + read as u64 > MAX_MANIFEST_BYTES {
                        return Err("manifest.json が大きすぎます".into());
                    }
                    file_bytes.extend_from_slice(&buffer[..read]);
                }
            }
            if file_bytes.is_empty() && name == "manifest.json" {
                return Err("manifest.json が空です".into());
            }
            if entry.size() != fs::metadata(&destination).map(|m| m.len()).unwrap_or(0) {
                return Err(format!("ZIPエントリのサイズが一致しません: {name}"));
            }
            if name == "manifest.json" {
                manifest_bytes = Some(file_bytes);
            }
        }
        let manifest = validate_manifest(
            manifest_bytes
                .as_deref()
                .ok_or("ZIPルートにmanifest.jsonがありません")?,
        )?;
        if let Some(entry) = &manifest.entry {
            let path = validate_archive_path(entry, false)?;
            if !stage.join(path).is_file() {
                return Err("manifest の entry がZIP内にありません".into());
            }
        }
        let target = install_root.join(&manifest.id);
        let backup = root.join(format!("backup-{}-{}", manifest.id, unique_name()));
        let had_old = match fs::symlink_metadata(&target) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err("既存プラグインの導入先が通常のフォルダではありません".into());
            }
            Ok(_) => true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => return Err(format!("既存プラグインを確認できません: {error}")),
        };
        if had_old {
            fs::rename(&target, &backup)
                .map_err(|e| format!("既存プラグインを退避できません: {e}"))?;
        }
        if let Err(error) = fs::rename(&stage, &target) {
            if had_old {
                let _ = fs::rename(&backup, &target);
            }
            return Err(format!("プラグインを導入できません: {error}"));
        }
        if had_old {
            let _ = fs::remove_dir_all(backup);
        }
        Ok(PluginInfo {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            api_version: manifest.api_version,
            description: manifest.description,
            author: manifest.author,
            permissions: manifest.permissions,
            entry: manifest.entry,
            installed: true,
            executable: false,
        })
    })();
    if stage.exists() {
        let _ = fs::remove_dir_all(stage);
    }
    result
}

fn read_installed(path: &Path) -> Result<PluginInfo, String> {
    let bytes =
        fs::read(path.join("manifest.json")).map_err(|e| format!("manifestを読めません: {e}"))?;
    let manifest = validate_manifest(&bytes)?;
    Ok(PluginInfo {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        api_version: manifest.api_version,
        description: manifest.description,
        author: manifest.author,
        permissions: manifest.permissions,
        entry: manifest.entry,
        installed: true,
        executable: false,
    })
}

#[tauri::command]
pub fn plugin_list() -> Result<Vec<PluginInfo>, String> {
    let root = plugins_root().join("installed");
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut plugins = Vec::new();
    for item in fs::read_dir(root).map_err(|e| format!("プラグイン一覧を読めません: {e}"))?
    {
        let item = item.map_err(|e| format!("プラグイン一覧を読めません: {e}"))?;
        let file_type = item.file_type().map_err(|e| e.to_string())?;
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        plugins.push(read_installed(&item.path())?);
    }
    plugins.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(plugins)
}

#[tauri::command]
pub fn plugin_uninstall(id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("プラグインIDの形式が不正です".into());
    }
    let target = plugins_root().join("installed").join(&id);
    if !target.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(&target).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("削除対象がプラグインフォルダではありません".into());
    }
    fs::remove_dir_all(target).map_err(|e| format!("プラグインを削除できません: {e}"))
}
