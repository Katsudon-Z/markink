use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use zip::{CompressionMethod, ZipArchive};

const MAX_ZIP_BYTES: u64 = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 100 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_ENTRY_SOURCE_BYTES: u64 = 1024 * 1024;
const MAX_ENTRIES: usize = 256;
const MAX_COMPRESSION_RATIO: u64 = 200;
static NEXT_STAGE: AtomicU64 = AtomicU64::new(0);
static SETTINGS_LOCK: Mutex<()> = Mutex::new(());
const MAX_SETTING_BYTES: usize = 16 * 1024;
const MAX_REQUEST_BYTES: usize = 512 * 1024;
const MAX_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;

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
    network_origins: Vec<String>,
    settings_fields: Vec<PluginSettingField>,
    entry: Option<String>,
    installed: bool,
    executable: bool,
}

#[derive(Serialize)]
pub struct PluginNetworkResponse {
    status: u16,
    body: String,
}

#[tauri::command]
pub async fn plugin_request_json(
    id: String,
    request_url: String,
    body: String,
    use_api_key: bool,
    timeout_secs: u64,
) -> Result<PluginNetworkResponse, String> {
    if !valid_id(&id)
        || request_url.len() > 2048
        || body.len() > MAX_REQUEST_BYTES
        || !(5..=120).contains(&timeout_secs)
    {
        return Err("通信要求が大きすぎるか不正です".into());
    }
    let directory = plugins_root().join("installed").join(&id);
    let metadata = fs::symlink_metadata(&directory)
        .map_err(|e| format!("導入済みプラグインを確認できません: {e}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("プラグインの保存先が不正です".into());
    }
    let plugin = read_installed(&directory)?;
    if !plugin
        .permissions
        .iter()
        .any(|permission| permission == "network.request")
    {
        return Err("network.request 権限がありません".into());
    }
    let parsed = url::Url::parse(&request_url).map_err(|_| "通信URLが不正です".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
        || !plugin
            .network_origins
            .iter()
            .any(|origin| origin == &parsed.origin().ascii_serialization())
    {
        return Err("manifestで許可されていない通信先です".into());
    }
    let api_key = if use_api_key {
        if !plugin
            .permissions
            .iter()
            .any(|permission| permission == "secrets.use")
        {
            return Err("secrets.use 権限がありません".into());
        }
        let key =
            crate::plugin_secrets::read(&id, "api-key")?.ok_or("APIキーが設定されていません")?;
        if key.contains('\r') || key.contains('\n') {
            return Err("APIキーに使用できない文字が含まれています".into());
        }
        Some(key)
    } else {
        None
    };
    tokio::task::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new()
            .redirects(0)
            .timeout(std::time::Duration::from_secs(timeout_secs))
            .build();
        let mut request = agent
            .post(&request_url)
            .set("Content-Type", "application/json")
            .set("Accept", "application/json");
        if let Some(key) = api_key {
            request = request.set("Authorization", &format!("Bearer {key}"));
        }
        let response = match request.send_string(&body) {
            Ok(response) => response,
            Err(ureq::Error::Status(_, response)) => response,
            Err(_) => return Err("プラグインのHTTP通信に失敗しました".into()),
        };
        let status = response.status();
        let mut text = String::new();
        response
            .into_reader()
            .take(MAX_RESPONSE_BYTES + 1)
            .read_to_string(&mut text)
            .map_err(|_| "HTTP応答をUTF-8として読み取れません".to_string())?;
        if text.len() as u64 > MAX_RESPONSE_BYTES {
            return Err("HTTP応答が2 MiBを超えています".into());
        }
        Ok(PluginNetworkResponse { status, body: text })
    })
    .await
    .map_err(|_| "プラグインのHTTP処理を完了できません".to_string())?
}

fn require_secret_plugin(id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err("プラグインIDの形式が不正です".into());
    }
    let directory = plugins_root().join("installed").join(id);
    let metadata = fs::symlink_metadata(&directory)
        .map_err(|e| format!("導入済みプラグインを確認できません: {e}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("プラグインの保存先が不正です".into());
    }
    let plugin = read_installed(&directory)?;
    if !plugin
        .permissions
        .iter()
        .any(|permission| permission == "secrets.use")
    {
        return Err("secrets.use 権限がありません".into());
    }
    Ok(())
}

#[tauri::command]
pub fn plugin_has_api_key(id: String) -> Result<bool, String> {
    require_secret_plugin(&id)?;
    Ok(crate::plugin_secrets::read(&id, "api-key")?.is_some())
}

#[tauri::command]
pub fn plugin_set_api_key(id: String, value: String) -> Result<(), String> {
    require_secret_plugin(&id)?;
    if value.is_empty() || value.len() > 2048 || value.contains(['\r', '\n']) {
        return Err("APIキーの形式が不正です".into());
    }
    crate::plugin_secrets::write(&id, "api-key", &value)
}

#[tauri::command]
pub fn plugin_delete_api_key(id: String) -> Result<(), String> {
    require_secret_plugin(&id)?;
    crate::plugin_secrets::delete(&id, "api-key")
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginSettingField {
    key: String,
    label: String,
    #[serde(rename = "type")]
    field_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<Vec<String>>,
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
    #[serde(default)]
    network_origins: Vec<String>,
    #[serde(default)]
    settings_fields: Vec<PluginSettingField>,
    entry: Option<String>,
}

const PERMISSIONS: &[&str] = &[
    "document.read",
    "document.edit",
    "ui.register",
    "ui.notify",
    "ui.dialog",
    "log.write",
    "settings.read",
    "settings.write",
    "network.request",
    "secrets.use",
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

fn valid_setting_key(key: &str) -> bool {
    (1..=64).contains(&key.len())
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        && key != "."
        && key != ".."
        && validate_archive_path(&format!("{key}.txt"), false).is_ok()
}

fn setting_directory(id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("プラグインIDの形式が不正です".into());
    }
    let installed = plugins_root().join("installed").join(id);
    let metadata = fs::symlink_metadata(&installed)
        .map_err(|e| format!("導入済みプラグインを確認できません: {e}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("プラグインの保存先が不正です".into());
    }
    read_installed(&installed)?;
    let root = plugins_root().join("settings");
    match fs::symlink_metadata(&root) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Err("設定の保存先が不正です".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("設定の保存先を確認できません: {error}")),
    }
    Ok(root.join(id))
}

#[tauri::command]
pub fn plugin_get_setting(id: String, key: String) -> Result<Option<String>, String> {
    if !valid_setting_key(&key) {
        return Err("設定キーの形式が不正です".into());
    }
    let _guard = SETTINGS_LOCK.lock().map_err(|e| e.to_string())?;
    let directory = setting_directory(&id)?;
    match fs::symlink_metadata(&directory) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Err("設定フォルダが不正です".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("設定フォルダを確認できません: {error}")),
    }
    let path = directory.join(format!("{key}.txt"));
    match fs::symlink_metadata(&path) {
        Ok(metadata)
            if metadata.is_file()
                && !metadata.file_type().is_symlink()
                && metadata.len() <= MAX_SETTING_BYTES as u64 => {}
        Ok(_) => return Err("設定ファイルが不正です".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("設定ファイルを確認できません: {error}")),
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|e| format!("設定を読み取れません: {e}"))
}

#[tauri::command]
pub fn plugin_set_setting(id: String, key: String, value: String) -> Result<(), String> {
    if !valid_setting_key(&key) || value.len() > MAX_SETTING_BYTES {
        return Err("設定キーまたは設定値が不正です".into());
    }
    let _guard = SETTINGS_LOCK.lock().map_err(|e| e.to_string())?;
    let directory = setting_directory(&id)?;
    match fs::symlink_metadata(&directory) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Err("設定フォルダが不正です".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(&directory)
                .map_err(|e| format!("設定フォルダを作成できません: {e}"))?;
        }
        Err(error) => return Err(format!("設定フォルダを確認できません: {error}")),
    }
    let target = directory.join(format!("{key}.txt"));
    let temporary = directory.join(format!("temp-{}", unique_name()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| format!("設定ファイルを作成できません: {e}"))?;
        file.write_all(value.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|e| format!("設定を書き込めません: {e}"))?;
        let had_old = match fs::symlink_metadata(&target) {
            Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => true,
            Ok(_) => return Err("既存の設定ファイルが不正です".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => return Err(format!("既存の設定を確認できません: {error}")),
        };
        let backup = directory.join(format!("backup-{}", unique_name()));
        if had_old {
            fs::rename(&target, &backup).map_err(|e| format!("既存の設定を退避できません: {e}"))?;
        }
        if let Err(error) = fs::rename(&temporary, &target) {
            if had_old {
                if let Err(rollback) = fs::rename(&backup, &target) {
                    return Err(format!("設定を保存できません: {error}。復元にも失敗しました: {rollback}。退避先: {}", backup.display()));
                }
            }
            return Err(format!("設定を保存できません: {error}"));
        }
        if had_old {
            let _ = fs::remove_file(backup);
        }
        Ok(())
    })();
    let _ = fs::remove_file(temporary);
    result
}

fn valid_version(version: &str) -> bool {
    let (main, build) = match version.split_once('+') {
        Some((main, build)) => (main, Some(build)),
        None => (version, None),
    };
    let (core, prerelease) = match main.split_once('-') {
        Some((core, prerelease)) => (core, Some(prerelease)),
        None => (main, None),
    };
    let valid_numeric = |part: &str| {
        !part.is_empty()
            && part.bytes().all(|b| b.is_ascii_digit())
            && (part == "0" || !part.starts_with('0'))
    };
    let numbers: Vec<_> = core.split('.').collect();
    let valid_identifiers = |suffix: &str, numeric_leading_zero: bool| {
        suffix.split('.').all(|part| {
            !part.is_empty()
                && part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                && (!numeric_leading_zero
                    || !part.bytes().all(|b| b.is_ascii_digit())
                    || valid_numeric(part))
        })
    };
    numbers.len() == 3
        && numbers.iter().all(|part| valid_numeric(part))
        && prerelease.map_or(true, |suffix| valid_identifiers(suffix, true))
        && build.map_or(true, |suffix| valid_identifiers(suffix, false))
}

fn validate_origin(origin: &str) -> Result<(), String> {
    let url = url::Url::parse(origin).map_err(|_| "通信先URLが不正です".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || url.origin().ascii_serialization() != origin
        || (url.scheme() == "http" && !is_loopback_host(url.host_str().unwrap_or("")))
    {
        return Err("通信先は http(s) の origin を指定してください".into());
    }
    Ok(())
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1")
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
    if manifest.network_origins.len() > 8
        || manifest
            .network_origins
            .iter()
            .any(|origin| origin.len() > 256 || validate_origin(origin).is_err())
        || manifest
            .network_origins
            .iter()
            .collect::<HashSet<_>>()
            .len()
            != manifest.network_origins.len()
    {
        return Err("manifest の通信先が不正または重複しています".into());
    }
    if !manifest.network_origins.is_empty()
        && !manifest
            .permissions
            .iter()
            .any(|permission| permission == "network.request")
    {
        return Err("通信先の指定には network.request 権限が必要です".into());
    }
    if manifest.settings_fields.len() > 16 {
        return Err("manifest の設定項目が多すぎます".into());
    }
    if !manifest.settings_fields.is_empty()
        && (!manifest.permissions.iter().any(|permission| permission == "settings.read")
            || !manifest.permissions.iter().any(|permission| permission == "settings.write"))
    {
        return Err("設定項目には settings.read と settings.write 権限が必要です".into());
    }
    let mut setting_keys = HashSet::new();
    for field in &manifest.settings_fields {
        if !valid_setting_key(&field.key)
            || !setting_keys.insert(&field.key)
            || field.label.trim().is_empty()
            || field.label.len() > 120
            || !matches!(field.field_type.as_str(), "text" | "number" | "choice")
            || field.default_value.as_ref().is_some_and(|value| value.trim().is_empty() || value.len() > 4096)
        {
            return Err("manifest の設定項目が不正です".into());
        }
        if field.field_type == "choice" {
            let options = field.options.as_ref().ok_or("選択式設定の候補がありません")?;
            if !(2..=8).contains(&options.len())
                || options.iter().any(|value| value.trim().is_empty() || value.len() > 120)
                || options.iter().collect::<HashSet<_>>().len() != options.len()
                || field.default_value.as_ref().is_some_and(|value| !options.contains(value))
            {
                return Err("選択式設定の候補が不正です".into());
            }
        } else if field.options.is_some() {
            return Err("選択式以外の設定に候補は指定できません".into());
        }
        if field.field_type == "number" && field.default_value.as_ref().is_some_and(|value| value.parse::<f64>().map_or(true, |number| !number.is_finite())) {
            return Err("数値設定の既定値が不正です".into());
        }
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
pub fn plugin_preview_zip(zip_path: String) -> Result<PluginInfo, String> {
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
    let entry = archive
        .by_name("manifest.json")
        .map_err(|_| "ZIPルートにmanifest.jsonがありません".to_string())?;
    if entry.size() > MAX_MANIFEST_BYTES {
        return Err("manifest.json が大きすぎます".into());
    }
    let mut bytes = Vec::new();
    entry
        .take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("manifest.jsonを読めません: {e}"))?;
    let manifest = validate_manifest(&bytes)?;
    Ok(PluginInfo {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        api_version: manifest.api_version,
        description: manifest.description,
        author: manifest.author,
        permissions: manifest.permissions,
        network_origins: manifest.network_origins,
        settings_fields: manifest.settings_fields,
        entry: manifest.entry.clone(),
        installed: false,
        executable: manifest.entry.is_some(),
    })
}

#[tauri::command]
pub fn plugin_install_zip(
    zip_path: String,
    expected_id: String,
    expected_version: String,
    expected_permissions: Vec<String>,
    expected_network_origins: Vec<String>,
    expected_settings_fields: Vec<PluginSettingField>,
) -> Result<PluginInfo, String> {
    if !valid_id(&expected_id) {
        return Err("プラグインIDの形式が不正です".into());
    }
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
        if manifest.id != expected_id
            || manifest.version != expected_version
            || manifest.permissions != expected_permissions
            || manifest.network_origins != expected_network_origins
            || manifest.settings_fields != expected_settings_fields
        {
            return Err("ZIPのmanifestが事前確認時から変更されました".into());
        }
        if let Some(entry) = &manifest.entry {
            let path = validate_archive_path(entry, false)?;
            let entry_path = stage.join(path);
            if !entry_path.is_file() {
                return Err("manifest の entry がZIP内にありません".into());
            }
            let entry_bytes =
                fs::read(&entry_path).map_err(|e| format!("実行entryを読み取れません: {e}"))?;
            if entry_bytes.len() as u64 > MAX_ENTRY_SOURCE_BYTES
                || std::str::from_utf8(&entry_bytes).is_err()
            {
                return Err("実行entryは1 MiB以下のUTF-8 JavaScriptにしてください".into());
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
                if let Err(rollback_error) = fs::rename(&backup, &target) {
                    return Err(format!(
                        "プラグインを導入できません: {error}。旧版の復元にも失敗しました: {rollback_error}。退避先: {}",
                        backup.display()
                    ));
                }
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
            network_origins: manifest.network_origins,
            settings_fields: manifest.settings_fields,
            entry: manifest.entry.clone(),
            installed: true,
            executable: manifest.entry.is_some(),
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
    if path.file_name().and_then(|name| name.to_str()) != Some(manifest.id.as_str()) {
        return Err("導入済みプラグインのIDと保存先が一致しません".into());
    }
    Ok(PluginInfo {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        api_version: manifest.api_version,
        description: manifest.description,
        author: manifest.author,
        permissions: manifest.permissions,
        network_origins: manifest.network_origins,
        settings_fields: manifest.settings_fields,
        entry: manifest.entry.clone(),
        installed: true,
        executable: manifest.entry.is_some(),
    })
}

#[tauri::command]
pub fn plugin_read_entry(id: String) -> Result<String, String> {
    if !valid_id(&id) {
        return Err("プラグインIDの形式が不正です".into());
    }
    let directory = plugins_root().join("installed").join(&id);
    let metadata = fs::symlink_metadata(&directory)
        .map_err(|e| format!("導入済みプラグインを確認できません: {e}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("導入済みプラグインの保存先が不正です".into());
    }
    let info = read_installed(&directory)?;
    let entry = info.entry.ok_or("実行entryがmanifestにありません")?;
    let relative = validate_archive_path(&entry, false)?;
    let canonical_root = fs::canonicalize(&directory).map_err(|e| e.to_string())?;
    let canonical_entry = fs::canonicalize(directory.join(relative))
        .map_err(|e| format!("実行entryを開けません: {e}"))?;
    if !canonical_entry.starts_with(&canonical_root) {
        return Err("実行entryがプラグイン保存先の外を指しています".into());
    }
    let metadata = fs::metadata(&canonical_entry).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_ENTRY_SOURCE_BYTES {
        return Err("実行entryが不正か、1 MiBを超えています".into());
    }
    fs::read_to_string(canonical_entry).map_err(|e| format!("実行entryを読めません: {e}"))
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
    #[cfg(windows)]
    crate::plugin_secrets::delete(&id, "api-key")?;
    fs::remove_dir_all(target).map_err(|e| format!("プラグインを削除できません: {e}"))?;
    let settings = plugins_root().join("settings").join(&id);
    match fs::symlink_metadata(&settings) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            fs::remove_dir_all(settings).map_err(|e| format!("プラグイン設定を削除できません: {e}"))
        }
        Ok(_) => Err("プラグイン設定の保存先が不正です".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("プラグイン設定を確認できません: {error}")),
    }
}
