use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const ARCHIVE_COUNT: usize = 3;
const MAX_MESSAGE_BYTES: usize = 16 * 1024;

struct FileLogger {
    state: Mutex<LoggerState>,
}

struct LoggerState {
    enabled: bool,
    level: log::LevelFilter,
    path: PathBuf,
    writer: Option<BufWriter<File>>,
    size: u64,
}

static LOGGER: OnceLock<FileLogger> = OnceLock::new();

fn parse_level(level: &str) -> Result<log::LevelFilter, String> {
    match level {
        "error" => Ok(log::LevelFilter::Error),
        "warn" => Ok(log::LevelFilter::Warn),
        "info" => Ok(log::LevelFilter::Info),
        "debug" => Ok(log::LevelFilter::Debug),
        _ => Err("ログレベルは error、warn、info、debug のいずれかを指定してください".into()),
    }
}

pub fn initialize(enabled: bool, level: &str) -> Result<(), String> {
    let logger = LOGGER.get_or_init(|| FileLogger {
        state: Mutex::new(LoggerState {
            enabled: false,
            level: log::LevelFilter::Off,
            path: crate::settings::local_dir()
                .join("logs")
                .join("markink.log"),
            writer: None,
            size: 0,
        }),
    });

    log::set_logger(logger).map_err(|_| "ログ機能を初期化できません".to_string())?;
    configure(enabled, level)
}

pub fn configure(enabled: bool, level: &str) -> Result<(), String> {
    let level = parse_level(level)?;
    let logger = LOGGER
        .get()
        .ok_or_else(|| "ログ機能が初期化されていません".to_string())?;
    let mut state = logger
        .state
        .lock()
        .map_err(|_| "ログ状態を取得できません".to_string())?;

    if enabled {
        let parent = state
            .path
            .parent()
            .ok_or_else(|| "ログ保存先が不正です".to_string())?;
        fs::create_dir_all(parent).map_err(|e| format!("ログフォルダを作成できません: {}", e))?;
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&state.path)
            .map_err(|e| format!("ログファイルを開けません: {}", e))?;
        state.size = file.metadata().map(|m| m.len()).unwrap_or(0);
        state.writer = Some(BufWriter::new(file));
    } else {
        state.writer = None;
        state.size = 0;
    }

    state.enabled = enabled;
    state.level = if enabled {
        level
    } else {
        log::LevelFilter::Off
    };
    log::set_max_level(state.level);
    Ok(())
}

#[tauri::command]
pub fn plugin_log(plugin_id: String, level: String, message: String) -> Result<(), String> {
    if plugin_id.len() > 64
        || plugin_id.is_empty()
        || !plugin_id.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
        })
    {
        return Err("プラグインIDの形式が不正です".into());
    }
    if message.len() > 4096 {
        return Err("ログメッセージが長すぎます".into());
    }
    match level.as_str() {
        "error" => log::error!(target: "plugin", "[{}] {}", plugin_id, message),
        "warn" => log::warn!(target: "plugin", "[{}] {}", plugin_id, message),
        "info" => log::info!(target: "plugin", "[{}] {}", plugin_id, message),
        "debug" => log::debug!(target: "plugin", "[{}] {}", plugin_id, message),
        _ => return Err("ログレベルが不正です".into()),
    }
    Ok(())
}

impl FileLogger {
    fn rotate(state: &mut LoggerState) -> std::io::Result<()> {
        if let Some(mut writer) = state.writer.take() {
            writer.flush()?;
        }
        let oldest = state.path.with_extension(format!("log.{}", ARCHIVE_COUNT));
        let _ = fs::remove_file(oldest);
        for index in (1..ARCHIVE_COUNT).rev() {
            let from = state.path.with_extension(format!("log.{}", index));
            let to = state.path.with_extension(format!("log.{}", index + 1));
            if from.exists() {
                let _ = fs::rename(from, to);
            }
        }
        let first = state.path.with_extension("log.1");
        if state.path.exists() {
            let _ = fs::rename(&state.path, first);
        }
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&state.path)?;
        state.writer = Some(BufWriter::new(file));
        state.size = 0;
        Ok(())
    }
}

impl log::Log for FileLogger {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        self.state
            .lock()
            .map(|state| state.enabled && metadata.level() <= state.level)
            .unwrap_or(false)
    }

    fn log(&self, record: &log::Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let mut message = record.args().to_string();
        if message.len() > MAX_MESSAGE_BYTES {
            let mut end = MAX_MESSAGE_BYTES;
            while !message.is_char_boundary(end) {
                end -= 1;
            }
            message.truncate(end);
            message.push_str("…[truncated]");
        }
        let seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let line = format!(
            "{} {} [{}] {}\n",
            seconds,
            record.level(),
            record.target(),
            message
        );
        if state.size.saturating_add(line.len() as u64) > MAX_FILE_BYTES {
            if Self::rotate(&mut state).is_err() {
                state.enabled = false;
                state.writer = None;
                state.level = log::LevelFilter::Off;
                log::set_max_level(log::LevelFilter::Off);
                return;
            }
        }
        if let Some(writer) = state.writer.as_mut() {
            if writer.write_all(line.as_bytes()).is_ok() {
                state.size = state.size.saturating_add(line.len() as u64);
            } else {
                state.enabled = false;
                state.writer = None;
                state.level = log::LevelFilter::Off;
                log::set_max_level(log::LevelFilter::Off);
            }
        }
    }

    fn flush(&self) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(writer) = state.writer.as_mut() {
                let _ = writer.flush();
            }
        }
    }
}
