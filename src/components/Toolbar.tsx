import React from 'react';
import './Toolbar.css';

interface ToolbarProps {
  onFormat: (format: string) => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ onFormat }) => {
  const tools = [
    { id: 'h1', label: 'H1', title: '大見出しを挿入します' },
    { id: 'h2', label: 'H2', title: '中見出しを挿入します' },
    { id: 'bold', label: 'B', title: '太字にします' },
    { id: 'italic', label: 'I', title: '斜体にします' },
    { id: 'list', label: '•', title: '箇条書きを作成します' },
    { id: 'quote', label: '❝', title: '引用を作成します' },
    { id: 'code', label: '</>', title: 'コードブロックを挿入します' },
    { id: 'link', label: '🔗', title: 'リンクを挿入します' }
  ];

  return (
    <div className="toolbar">
      {tools.map(tool => (
        <button
          key={tool.id}
          className="toolbar-button"
          title={tool.title}
          aria-label={tool.label}
          onClick={() => onFormat(tool.id)}
        >
          {tool.label}
        </button>
      ))}
    </div>
  );
};
