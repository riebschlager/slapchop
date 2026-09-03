import { ReactNode } from 'react';
import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, Trash2 } from 'lucide-react';

// Selection chrome is intentionally generic: it owns no mode vocabulary or
// document behavior, so mode inspectors can reuse it without aligning tabs.
export default function SubjectHeader({ name, hidden, onRename, onToggleHidden, onDuplicate, onMoveUp, onMoveDown, onDelete }: {
  name: string;
  hidden: boolean | undefined;
  onRename: (name: string) => void;
  onToggleHidden: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}): ReactNode {
  return (
    <div className="flex items-center justify-between mb-2 pb-2 border-b border-ui-border">
      <input
        type="text"
        value={name}
        onChange={(e) => onRename(e.target.value)}
        className="bg-transparent text-xs font-semibold text-ui-text border-b border-transparent hover:border-ui-border-strong focus:border-ui-accent focus:bg-ui-canvas focus:ring-2 focus:ring-ui-accent px-1 py-0.5 outline-none rounded truncate flex-1 mr-2"
        title="Click to rename"
      />
      <div className="flex items-center gap-0.5 shrink-0">
        <button onClick={onToggleHidden} className="p-1 hover:bg-ui-surface rounded text-ui-text-muted hover:text-ui-text transition-colors" title={hidden ? 'Show' : 'Hide'}>
          {hidden ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
        <button onClick={onDuplicate} className="p-1 hover:bg-ui-surface rounded text-ui-text-muted hover:text-ui-text transition-colors" title="Duplicate">
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button onClick={onMoveUp} className="p-1 hover:bg-ui-surface rounded text-ui-text-muted hover:text-ui-text transition-colors" title="Move Up in Order">
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button onClick={onMoveDown} className="p-1 hover:bg-ui-surface rounded text-ui-text-muted hover:text-ui-text transition-colors" title="Move Down in Order">
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
        <button onClick={onDelete} className="p-1 hover:bg-ui-surface rounded text-ui-text-muted hover:text-red-400 transition-colors" title="Delete">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
