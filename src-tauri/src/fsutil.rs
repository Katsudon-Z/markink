use std::path::Path;

/// 保存先の親フォルダ存在チェック (各コマンドで共通の事前条件)
pub fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err("保存先のフォルダが見つかりません。保存場所を確認してください。".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_missing_parent() {
        let missing = std::env::temp_dir().join("mdn-no-such-dir-xyz").join("a.md");
        assert!(ensure_parent_dir(&missing).is_err());
    }

    #[test]
    fn accepts_existing_parent() {
        let existing = std::env::temp_dir().join("mdn-fsutil-test.md");
        assert!(ensure_parent_dir(&existing).is_ok());
    }
}
