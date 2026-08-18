import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

interface PanelState {
  width: number;
  collapsed: boolean;
}

export interface UsePanelStateOptions {
  /** localStorage key this panel's width/collapse state persists under. */
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /** Which window edge the panel docks to — determines drag direction, since
   *  a left-docked panel's handle sits on its right edge (drag right to grow)
   *  while a right-docked panel's handle sits on its left edge (drag left to grow). */
  side: 'left' | 'right';
}

function readStored(storageKey: string, defaultWidth: number, minWidth: number, maxWidth: number): PanelState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { width: defaultWidth, collapsed: false };
    const parsed = JSON.parse(raw) as Partial<PanelState>;
    const width = typeof parsed.width === 'number' && Number.isFinite(parsed.width)
      ? Math.min(maxWidth, Math.max(minWidth, parsed.width))
      : defaultWidth;
    return { width, collapsed: !!parsed.collapsed };
  } catch {
    return { width: defaultWidth, collapsed: false };
  }
}

// Drag-to-resize and collapse for a Stack/Inspector side column. Width and
// collapse are UI preference, not document state — they stay out of the
// undo-tracked store (see store.ts's partialize) and persist to localStorage
// instead, so resizing a panel never touches undo history or .slapchop files.
export function usePanelState({ storageKey, defaultWidth, minWidth, maxWidth, side }: UsePanelStateOptions) {
  const [state, setState] = useState<PanelState>(() => readStored(storageKey, defaultWidth, minWidth, maxWidth));
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Best-effort: a full or disabled localStorage shouldn't break resizing, just persistence.
    }
  }, [storageKey, state]);

  const toggleCollapsed = useCallback(() => {
    setState((s) => ({ ...s, collapsed: !s.collapsed }));
  }, []);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    if (stateRef.current.collapsed) return;
    const startX = e.clientX;
    const startWidth = stateRef.current.width;
    const sign = side === 'left' ? 1 : -1;

    const onMove = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) * sign;
      const next = Math.min(maxWidth, Math.max(minWidth, startWidth + delta));
      setState((s) => ({ ...s, width: next }));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [side, minWidth, maxWidth]);

  return {
    width: state.width,
    collapsed: state.collapsed,
    toggleCollapsed,
    startResize
  };
}
