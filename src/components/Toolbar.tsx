import React, { useEffect, useRef, useState } from 'react';
import { FORMATS } from '../lib/prosemirror/commands';
import './Toolbar.css';

interface ToolbarProps {
  onFormat: (id: string, payload?: { href?: string }) => void;
  /** HTMLコメントを表示するか (既定: 非表示) */
  showComments: boolean;
  onToggleComments: () => void;
}

export const Toolbar = React.memo(function Toolbar({
  onFormat,
  showComments,
  onToggleComments
}: ToolbarProps) {
  const [linkInputShown, setLinkInputShown] = useState(false);
  const [href, setHref] = useState('');
  const [otherOpen, setOtherOpen] = useState(false);
  const otherRef = useRef<HTMLSpanElement>(null);

  // その他メニューは外側クリック・Escape で閉じる
  useEffect(() => {
    if (!otherOpen) return;
    const onDown = (e: MouseEvent) => {
      if (otherRef.current && !otherRef.current.contains(e.target as Node)) setOtherOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOtherOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [otherOpen]);

  const handleApplyLink = () => {
    onFormat('link', { href: href.trim() });
    setHref('');
    setLinkInputShown(false);
  };

  const mainFormats = FORMATS.filter((tool) => tool.inToolbar !== false);
  const otherFormats = FORMATS.filter((tool) => tool.inToolbar === false);

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

      {otherFormats.length > 0 && (
        <span ref={otherRef} className="toolbar-other">
          <button
            className="toolbar-button"
            title="その他の書式"
            aria-haspopup="menu"
            aria-expanded={otherOpen}
            onClick={() => setOtherOpen((v) => !v)}
          >
            その他 ▾
          </button>
          {otherOpen && (
            <span className="toolbar-other-menu" role="menu">
              {otherFormats.map((tool) => (
                <button
                  key={tool.id}
                  className="toolbar-button"
                  title={tool.title}
                  aria-label={tool.title}
                  onClick={() => {
                    onFormat(tool.id);
                    setOtherOpen(false);
                  }}
                >
                  {tool.label}
                </button>
              ))}
            </span>
          )}
        </span>
      )}

      <button
        className={showComments ? 'toolbar-button toolbar-button-active' : 'toolbar-button'}
        title="HTMLコメントの表示と非表示を切り替えます"
        aria-pressed={showComments}
        onClick={onToggleComments}
      >
        コメント表示
      </button>

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
