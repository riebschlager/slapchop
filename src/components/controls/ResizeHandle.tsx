import type React from 'react';
import { PanelLeftClose, PanelRightClose } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ResizeHandleProps {
  /** Which window edge the panel this handle belongs to is docked at. */
  side: 'left' | 'right';
  panelLabel: string;
  onResizeStart: (e: React.PointerEvent) => void;
  onCollapse: () => void;
}

// Drag-to-resize strip for a side column, docked to its inner edge (the edge
// facing the canvas). Sits absolutely inside a `relative` panel root so it
// doesn't consume column width itself. The collapse button rides along it,
// always faintly visible rather than hover-gated — consistent with this
// codebase's "only destructive actions hide until hover" convention.
export default function ResizeHandle({ side, panelLabel, onResizeStart, onCollapse }: ResizeHandleProps) {
  const CollapseIcon = side === 'left' ? PanelLeftClose : PanelRightClose;
  return (
    <div
      onPointerDown={onResizeStart}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${panelLabel}`}
      className={cn(
        'group/handle absolute inset-y-0 z-20 w-2.5 cursor-col-resize',
        side === 'left' ? 'right-0 translate-x-1/2' : 'left-0 -translate-x-1/2'
      )}
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/handle:bg-ui-accent/60" />
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onCollapse}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded border border-ui-border-strong bg-ui-surface p-1 text-ui-text-subtle transition-colors hover:bg-ui-surface-raised hover:text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
        title={`Collapse ${panelLabel}`}
      >
        <CollapseIcon className="w-3 h-3" />
      </button>
    </div>
  );
}
