//! Per-plugin secrets stored in Windows Credential Manager.

#[cfg(windows)]
mod platform {
    use std::ptr;
    use windows_sys::Win32::Foundation::ERROR_NOT_FOUND;
    use windows_sys::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn target(id: &str, key: &str) -> Vec<u16> {
        wide(&format!("jp.markink.app/plugin/{id}/{key}"))
    }

    pub fn read(id: &str, key: &str) -> Result<Option<String>, String> {
        let target = target(id, key);
        let mut credential = ptr::null_mut();
        // SAFETY: target is NUL-terminated and credential receives an owned pointer.
        if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) } == 0 {
            if std::io::Error::last_os_error().raw_os_error() == Some(ERROR_NOT_FOUND as i32) {
                return Ok(None);
            }
            return Err("Windows資格情報ストアから秘密値を読み取れません".into());
        }
        // SAFETY: CredReadW returned a valid CREDENTIALW, freed exactly once by CredFree.
        let result = unsafe {
            let record: &CREDENTIALW = &*credential;
            let bytes = if record.CredentialBlobSize == 0 {
                &[][..]
            } else {
                std::slice::from_raw_parts(
                    record.CredentialBlob,
                    record.CredentialBlobSize as usize,
                )
            };
            String::from_utf8(bytes.to_vec())
                .map(Some)
                .map_err(|_| "資格情報ストアの秘密値がUTF-8ではありません".to_string())
        };
        // SAFETY: credential was allocated by CredReadW.
        unsafe { CredFree(credential.cast()) };
        result
    }

    pub fn write(id: &str, key: &str, value: &str) -> Result<(), String> {
        let mut target = target(id, key);
        let mut username = wide("markink");
        let mut bytes = value.as_bytes().to_vec();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            CredentialBlobSize: bytes.len() as u32,
            CredentialBlob: bytes.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: username.as_mut_ptr(),
            ..Default::default()
        };
        // SAFETY: all pointers remain valid for the duration of CredWriteW.
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            return Err("Windows資格情報ストアに秘密値を保存できません".into());
        }
        Ok(())
    }

    pub fn delete(id: &str, key: &str) -> Result<(), String> {
        let target = target(id, key);
        // SAFETY: target is NUL-terminated.
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0
            && std::io::Error::last_os_error().raw_os_error() != Some(ERROR_NOT_FOUND as i32)
        {
            return Err("Windows資格情報ストアから秘密値を削除できません".into());
        }
        Ok(())
    }
}

#[cfg(windows)]
pub use platform::{delete, read, write};

#[cfg(not(windows))]
pub fn read(_id: &str, _key: &str) -> Result<Option<String>, String> {
    Err("このOSでは秘密値の保存に対応していません".into())
}

#[cfg(not(windows))]
pub fn write(_id: &str, _key: &str, _value: &str) -> Result<(), String> {
    Err("このOSでは秘密値の保存に対応していません".into())
}

#[cfg(not(windows))]
pub fn delete(_id: &str, _key: &str) -> Result<(), String> {
    Err("このOSでは秘密値の保存に対応していません".into())
}
