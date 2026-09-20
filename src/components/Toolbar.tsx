import React, { useEffect, useRef, useState } from 'react';
import { FORMATS } from '../lib/prosemirror/commands';
import './Toolbar.css';

interface ToolbarProps {
  onFormat: (id: string, payload?: { href?: string }) => void;
  /** HTMLコメントを表示するか (既定: 非表示) */
  showComments: boolean;
  onToggleComments: () => void;
}

/** ツールバー内のドロップダウンメニュー (その他・表)。外側クリック・Escape で閉じる */
function ToolbarMenu({
  label,
  title,
  items,
  extra
}: {
  label: string;
  title: string;
  items: { id: string; label: string; title: string; onSelect: () => void }[];
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
  }, [open ]);

  return (
    <span ref={ref} className="toolbar-other">
      <button
        className="toolbar-button"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label} ▾
      </button>
      {open && (
        <span className="toolbar-other-menu" role="menu">
          {items.map((tool) => (
            <button
              key={tool.id}
              className="toolbar-button"
              title={tool.title}
              aria-label={tool.title}
              onClick={() => {
                tool.onSelect();
                setOpen(false);
              }}
            >
              {tool.label}
            </button>
          ))}
          {extra}
        </span>
      )}
    </span>
  );
}

export const Toolbar = React.memo(function Toolbar({
  onFormat,
  showComments,
  onToggleComments
}: ToolbarProps) {
  const [linkInputShown, setLinkInputShown] = useState(false);
  const [href, setHref] = useState('');

  const handleApplyLink = () => {
    onFormat('link', { href: href.trim() });
    setHref('');
    setLinkInputShown(false);
  };

  const mainFormats = FORMATS.filter((tool) => !tool.menu);
  const otherFormats = FORMATS.filter((tool) => tool.menu === 'other');
  const tableFormats = FORMATS.filter((tool) => tool.menu === 'table');
  const dateFormats = FORMATS.filter((tool) => tool.menu === 'date');

  return (
    <div className="toolbar">
      {mainFormats.map((tool) => (
        <button
          key={tool.id}
          className="toolbar-button"
          title={tool.title}
          aria-label={tool.title}
          onClick={() => (tool.id === 'link' ? setLinkInputShown((v) => !v) : onFormat(tool.id))}
        >
          {tool.label}
        </button>
      ))}

      {tableFormats.length > 0 && (
        <ToolbarMenu
          label="表"
          title="表の操作"
          items={tableFormats.map((tool) => ({
            ...tool,
            onSelect: () => onFormat(tool.id)
          }))}
        />
      )}

      {dateFormats.length > 0 && (
        <ToolbarMenu
          label="日付"
          title="日付・時刻の挿入"
          items={dateFormats.map((tool) => ({
            ...tool,
            onSelect: () => onFormat(tool.id)
          }))}
        />
      )}

      {(otherFormats.length > 0) && (
        <ToolbarMenu
          label="その他"
          title="その他の書式"
          items={otherFormats.map((tool) => ({
            ...tool,
            onSelect: () => onFormat(tool.id)
          }))}
          extra={
            <button
              className={
                showComments ? 'toolbar-button toolbar-button-active' : 'toolbar-button'
              }
              title="HTMLコメントの表示と非表示を切り替えます"
              aria-pressed={showComments}
              onClick={() => {
                onToggleComments();
              }}
            >
              {showComments ? '✓ コメント表示' : 'コメント表示'}
            </button>
          }
        />
      )}

      {linkInputShown && (
        <span className="toolbar-link-input">
          <input
            type="text"
            value={href}
            autoFocus
            placeholder="https://example.com"
            aria-label="リンク先の URL"
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleApplyLink();
              if (e.key === 'Escape') setLinkInputShown(false);
            }}
          />
          <button className="toolbar-button" title="リンクを適用します" onClick={handleApplyLink}>
            適用
          </button>
          <button
            className="toolbar-button"
            title="リンク入力を閉じます"
            onClick={() => setLinkInputShown(false)}
          >
            取消
          </button>
        </span>
      )}
    </div>
  );
});
