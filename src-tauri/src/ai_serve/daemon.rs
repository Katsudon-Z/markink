// opencode serve 子プロセスの起動・死活確認・停止・孤児回収。
// アプリが異常終了すると serve が取り残されるため、起動時に
// 「自分の serve か」をコマンドラインで判定して回収する (他人は殺さない)。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::http::http_json;
use crate::settings;

/// Windows: 子プロセスのコンソールウィンドウを出さないためのフラグ。
/// netstat / powershell / taskkill を起動すると一瞬コマンドプロンプトが
/// チラつくため、回収処理では必ずこのフラグを付ける。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 外部コマンドをコンソールウィンドウを出さずに実行し、結果を返す。
#[cfg(windows)]
fn hidden_output(cmd: &mut std::process::Command) -> std::io::Result<std::process::Output> {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW).output()
}

/// デーモンのPIDファイル (アプリ終了時に取り残された孤児の回収用)。
/// spawn 時に書き込み、stop で削除する。
#[derive(Serialize, Deserialize)]
struct DaemonPid {
    pid: u32,
    port: u16,
}

fn pid_file_path() -> PathBuf {
    settings::local_dir().join("ai-serve.json")
}

fn write_pid_file(pid: u32, port: u16) {
    let _ = std::fs::create_dir_all(settings::local_dir());
    let text = serde_json::to_string(&DaemonPid { pid, port }).unwrap_or_default();
    let _ = std::fs::write(pid_file_path(), text);
}

fn read_pid_file() -> Option<DaemonPid> {
    std::fs::read_to_string(pid_file_path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
}

pub(crate) fn remove_pid_file() {
    let _ = std::fs::remove_file(pid_file_path());
}

/// serve デーモンを起動し、health が通るまで待つ
pub(crate) fn spawn_daemon(bin: &str, port: u16, password: &str) -> Result<std::process::Child, String> {
    // ポート使用中は孤児 (前回アプリ終了時の取り残し) の回収を試みる
    if std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
        adopt_stale_daemon(port)?;
    }
    let log_path = settings::local_dir().join("ai-serve.log");
    let _ = std::fs::create_dir_all(settings::local_dir());
    let log = std::fs::File::create(&log_path).map_err(|e| e.to_string())?;
    let err_log = log.try_clone().map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", bin, "serve", "--port", &port.to_string(), "--hostname", "127.0.0.1"]);
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = std::process::Command::new(bin);
        c.args(["serve", "--port", &port.to_string(), "--hostname", "127.0.0.1"]);
        c
    };
    cmd.env("OPENCODE_SERVER_PASSWORD", password)
        .stdout(std::process::Stdio::from(log))
        .stderr(std::process::Stdio::from(err_log))
        .stdin(std::process::Stdio::null());
    let child = cmd.spawn().map_err(|e| {
        format!("opencode を起動できません ({}): {}。設定で実行ファイルの場所を指定してください", bin, e)
    })?;
    write_pid_file(child.id(), port);
    Ok(child)
}

/// ポート占有者が自分が取り残したデーモンなら殺して回収する。
/// 判定は占有者自身のコマンドラインで行う (`serve --port <port>` を含むか)。
/// PIDファイルは cmd ラッパーのPIDが残るため所有者比較には使えない
/// (netstat に出るのは serve 本体のPID)。他人物は殺さずエラーにする。
fn adopt_stale_daemon(port: u16) -> Result<(), String> {
    let busy_msg = format!(
        "ポート {} は使用中です。別の opencode serve を停止してください",
        port
    );
    let listener = listener_pid(port).ok_or_else(|| busy_msg.clone())?;
    let mut targets = vec![listener];
    // PIDファイルのプロセスも同型なら一緒に殺す (生き残った cmd ラッパー対策)
    if let Some(recorded) = read_pid_file() {
        if recorded.port == port && recorded.pid != listener {
            targets.push(recorded.pid);
        }
    }
    let mut adopted = false;
    for pid in targets {
        match process_command_line(pid) {
            Some(cmdline) if is_own_serve_command(&cmdline, port) => {
                kill_pid(pid)?;
                adopted = true;
            }
            _ => {}
        }
    }
    if !adopted {
        return Err(busy_msg);
    }
    // ポートが空くまで待つ
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
        if std::time::Instant::now() >= deadline {
            return Err(format!("ポート {} の解放待ちがタイムアウトしました", port));
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    remove_pid_file();
    Ok(())
}

/// プロセスのコマンドライン (Windows の CIM 経由。回収時の判定専用)
fn process_command_line(pid: u32) -> Option<String> {
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("powershell");
        cmd.args([
            "-NoProfile",
            "-Command",
            &format!(
                "(Get-CimInstance Win32_Process -Filter 'ProcessId = {}').CommandLine",
                pid
            ),
        ]);
        let out = hidden_output(&mut cmd).ok()?;
        if !out.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        None
    }
}

/// 自分が起動した serve のコマンドラインか
/// (例: `"...\opencode.exe"    serve --port 4096 --hostname 127.0.0.1`)
fn is_own_serve_command(cmdline: &str, port: u16) -> bool {
    cmdline.contains("serve") && cmdline.contains(&format!("--port {}", port))
}

/// ポートの LISTENING 所有者PID (Windows の netstat 優先、他は未対応)
fn listener_pid(port: u16) -> Option<u32> {
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("netstat");
        cmd.args(["-ano"]);
        let out = hidden_output(&mut cmd).ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        parse_listener_pid(&text, port)
    }
    #[cfg(not(windows))]
    {
        let _ = port;
        None
    }
}

/// netstat -ano 出力から指定ポートの LISTENING 所有者を抜き出す
fn parse_listener_pid(netstat_text: &str, port: u16) -> Option<u32> {
    let want = format!("127.0.0.1:{}", port);
    for line in netstat_text.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() == 5 && cols[0] == "TCP" && cols[1] == want && cols[3] == "LISTENING" {
            return cols[4].parse().ok();
        }
    }
    None
}

fn kill_pid(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("taskkill");
        cmd.args(["/F", "/PID", &pid.to_string()]);
        let out = hidden_output(&mut cmd)
            .map_err(|e| format!("プロセスを終了できません ({}): {}", pid, e))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!("プロセス {} を終了できませんでした", pid))
        }
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        Err("このOSでは自動回収に未対応です".to_string())
    }
}

/// serve の health が通るまで待つ (初回起動のみ実質待つ)
pub(crate) async fn wait_healthy(host: &str, port: u16, password: &str) -> Result<(), String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(25);
    loop {
        match http_json(host, port, password, "GET", "/global/health", None, 3).await {
            Ok(v) if v.get("healthy").and_then(|h| h.as_bool()) == Some(true) => return Ok(()),
            _ => {}
        }
        if std::time::Instant::now() >= deadline {
            return Err("AIサーバの起動確認がタイムアウトしました (ai-serve.log を確認してください)".to_string());
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_listener_pid_finds_listening_owner() {
        let sample = "\
  TCP    127.0.0.1:4096    0.0.0.0:0    LISTENING    5456\r\n\
  TCP    127.0.0.1:56775   127.0.0.1:4096   TIME_WAIT    0\r\n\
  TCP    127.0.0.1:42110   0.0.0.0:0    LISTENING    19284\r\n";
        assert_eq!(parse_listener_pid(sample, 4096), Some(5456));
        assert_eq!(parse_listener_pid(sample, 42110), Some(19284));
        assert_eq!(parse_listener_pid(sample, 9999), None);
    }

    #[test]
    fn own_serve_command_matches_spawn_shapes() {
        assert!(is_own_serve_command(
            "\"C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe\"    serve --port 4096 --hostname 127.0.0.1",
            4096
        ));
        assert!(is_own_serve_command(
            "\"cmd\" /C opencode serve --port 4096 --hostname 127.0.0.1",
            4096
        ));
        assert!(!is_own_serve_command(
            "\"C:\\Windows\\System32\\notepad.exe\" C:\\a.txt",
            4096
        ));
        assert!(!is_own_serve_command(
            "\"cmd\" /C opencode serve --port 4097 --hostname 127.0.0.1",
            4096
        ));
    }
}
