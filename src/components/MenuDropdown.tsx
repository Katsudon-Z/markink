import { useEffect, useRef, useState } from 'react';

/**
 * 汎用ドロップダウンメニュー (ツールバー・ヘッダー共用)。
 * 外側クリック・Escape で閉じる。
 */
export function MenuDropdown({
  label,
  title,
  buttonClassName = 'toolbar-button',
  items,
  extra
}: {
  label: string;
  title: string;
  buttonClassName?: string;
  items: { id: string; label: string; title?: string; onSelect: () => void }[];
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <span ref={ref} className="toolbar-other">
      <button
        className={buttonClassName}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label} ▾
      </button>
      {open && (
        <span className="toolbar-other-menu" role="menu">
          {items.map((item) => (
            <button
              key={item.id}
              className="toolbar-button"
              title={item.title ?? item.label}
              aria-label={item.title ?? item.label}
              onClick={() => {
                item.onSelect();
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
          {extra}
        </span>
      )}
    </span>
  );
}
