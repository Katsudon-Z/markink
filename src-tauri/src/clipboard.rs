//! Eager clipboard data: no child process, script runtime, or delayed rendering.
use base64::Engine;
use std::{ptr, sync::Mutex, time::Duration};
use windows_sys::Win32::{
    Foundation::{GlobalFree, HGLOBAL, HWND},
    System::{
        DataExchange::{
            CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW,
            SetClipboardData,
        },
        Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT},
    },
    UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow},
};

static WRITE_LOCK: Mutex<()> = Mutex::new(());
fn error(context: &str) -> String {
    format!("{context}: {}", std::io::Error::last_os_error())
}
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}
pub fn format(name: &str) -> Result<u32, String> {
    let name = wide(name);
    // SAFETY: name is a live NUL-terminated UTF-16 buffer.
    let id = unsafe { RegisterClipboardFormatW(name.as_ptr()) };
    if id == 0 {
        Err(error("コピー形式を登録できません"))
    } else {
        Ok(id)
    }
}
struct Memory(HGLOBAL);
impl Drop for Memory {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                GlobalFree(self.0);
            }
        }
    }
}
struct Owner(HWND);
impl Drop for Owner {
    fn drop(&mut self) {
        unsafe {
            DestroyWindow(self.0);
        }
    }
}
struct Open;
impl Drop for Open {
    fn drop(&mut self) {
        unsafe {
            CloseClipboard();
        }
    }
}

pub fn write(formats: Vec<(u32, Vec<u8>)>) -> Result<(), String> {
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| "クリップボード処理が利用できません")?;
    let mut buffers = Vec::with_capacity(formats.len());
    for (id, bytes) in formats {
        if id == 0 || bytes.is_empty() {
            return Err("コピーするデータが不正です".into());
        }
        // SAFETY: movable memory is required by SetClipboardData. Until accepted,
        // Memory owns it; all failure paths free it. No raw pointer escapes.
        let memory = Memory(unsafe { GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, bytes.len()) });
        if memory.0.is_null() {
            return Err(error("コピー用メモリを確保できません"));
        }
        let pointer = unsafe { GlobalLock(memory.0) };
        if pointer.is_null() {
            return Err(error("コピー用メモリを開けません"));
        }
        unsafe {
            ptr::copy_nonoverlapping(bytes.as_ptr(), pointer.cast(), bytes.len());
            GlobalUnlock(memory.0);
        }
        buffers.push((id, memory));
    }
    let class = wide("STATIC");
    let name = wide("markink clipboard");
    // A short-lived invisible owner on this worker thread; no message pump is
    // needed because every format is written immediately, with owned data.
    let owner = Owner(unsafe {
        CreateWindowExW(
            0,
            class.as_ptr(),
            name.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null(),
        )
    });
    if owner.0.is_null() {
        return Err(error("コピー用ウィンドウを作成できません"));
    }
    let mut opened = false;
    for _ in 0..5 {
        if unsafe { OpenClipboard(owner.0) } != 0 {
            opened = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    if !opened {
        return Err(error("他のアプリがクリップボードを使用しています"));
    }
    let _open = Open;
    if unsafe { EmptyClipboard() } == 0 {
        return Err(error("クリップボードを更新できません"));
    }
    for (id, mut memory) in buffers {
        if unsafe { SetClipboardData(id, memory.0.cast()) }.is_null() {
            return Err(error("クリップボードへコピーできません"));
        }
        // Windows now owns the handle, even after this worker's window closes.
        memory.0 = ptr::null_mut();
    }
    Ok(())
}
pub fn text_bytes(value: &str) -> Vec<u8> {
    value
        .encode_utf16()
        .chain(Some(0))
        .flat_map(u16::to_le_bytes)
        .collect()
}
pub fn html_bytes(fragment: &str) -> Vec<u8> {
    let prefix="<html xmlns:v=\"urn:schemas-microsoft-com:vml\" xmlns:o=\"urn:schemas-microsoft-com:office:office\"><head><meta charset=\"utf-8\"></head><body><!--StartFragment-->";
    let suffix = "<!--EndFragment--></body></html>";
    let header = |start, end, fs, fe| {
        format!("Version:1.0\r\nStartHTML:{start:010}\r\nEndHTML:{end:010}\r\nStartFragment:{fs:010}\r\nEndFragment:{fe:010}\r\n")
    };
    let start = header(0, 0, 0, 0).len();
    let fs = start + prefix.len();
    let fe = fs + fragment.len();
    let end = fe + suffix.len();
    format!("{}{prefix}{fragment}{suffix}\0", header(start, end, fs, fe)).into_bytes()
}
pub fn decode_png(value: &str) -> Result<Vec<u8>, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|_| "PNGデータが不正です")?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("PNGデータが不正です".into());
    }
    Ok(bytes)
}
pub fn copy_png(value: &str) -> Result<(), String> {
    let bytes = decode_png(value)?;
    let mut decoder = png::Decoder::new(std::io::Cursor::new(&bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|_| "PNG画像を読めません")?;
    let info = reader.info();
    let (width, height) = (info.width, info.height);
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 20_000_000 {
        return Err("PNG画像が大きすぎます".into());
    }
    let mut pixels = vec![0; reader.output_buffer_size()];
    let output = reader
        .next_frame(&mut pixels)
        .map_err(|_| "PNG画像を展開できません")?;
    let channels = match output.color_type {
        png::ColorType::Rgba => 4,
        png::ColorType::Rgb => 3,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Grayscale => 1,
        _ => return Err("PNGの色形式に対応していません".into()),
    };
    let mut dib = vec![0u8; 40];
    dib[0..4].copy_from_slice(&40u32.to_le_bytes());
    dib[4..8].copy_from_slice(&(width as i32).to_le_bytes());
    dib[8..12].copy_from_slice(&(-(height as i32)).to_le_bytes());
    dib[12..14].copy_from_slice(&1u16.to_le_bytes());
    dib[14..16].copy_from_slice(&32u16.to_le_bytes());
    dib[20..24].copy_from_slice(&(width * height * 4).to_le_bytes());
    dib.reserve((width * height * 4) as usize);
    for p in pixels[..output.buffer_size()].chunks_exact(channels) {
        let (r, g, b, a) = match channels {
            4 => (p[0], p[1], p[2], p[3]),
            3 => (p[0], p[1], p[2], 255),
            2 => (p[0], p[0], p[0], p[1]),
            _ => (p[0], p[0], p[0], 255),
        };
        let blend =
            |c: u8| ((u32::from(c) * u32::from(a) + 255 * (255 - u32::from(a)) + 127) / 255) as u8;
        dib.extend_from_slice(&[blend(b), blend(g), blend(r), 255]);
    }
    write(vec![(format("PNG")?, bytes), (8, dib)])
}
