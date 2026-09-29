import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/utils';

type SectionState = { all?: boolean; sections: Record<string, boolean> };
type SectionContextValue = {
  state: SectionState;
  setSection: (key: string, open: boolean) => void;
  setAll: (open: boolean) => void;
};
const SectionPath = createContext('');
const SectionContext = createContext<SectionContextValue | null>(null);

// UI-only preferences survive selection and tab changes without entering document history.
export function ControlSections({ scope, children }: { scope: string; children: ReactNode }) {
  const [scopes, setScopes] = useState<Record<string, SectionState>>({});
  const state = scopes[scope] ?? { sections: {} };
  return <SectionContext.Provider value={{
    state,
    setSection: (key, open) => setScopes(previous => ({
      ...previous,
      [scope]: { ...previous[scope], sections: { ...previous[scope]?.sections, [key]: open } }
    })),
    setAll: open => setScopes(previous => ({ ...previous, [scope]: { all: open, sections: {} } }))
  }}>{children}</SectionContext.Provider>;
}

export function SectionActions({ label = 'Controls' }: { label?: string }) {
  const context = useContext(SectionContext);
  if (!context) return null;
  const buttonClass = 'flex items-center gap-1 rounded px-1.5 py-1.5 text-[10px] font-medium text-ui-text-muted hover:bg-ui-surface-raised hover:text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent';
  return <div className="flex shrink-0 items-center justify-between gap-1 border-b border-ui-border bg-ui-panel px-3 py-1.5">
    <span className="text-[10px] font-semibold uppercase tracking-wider text-ui-text-subtle">{label}</span>
    <div className="flex items-center gap-0.5">
      <button type="button" className={buttonClass} onClick={() => context.setAll(true)} title={`Expand all ${label.toLowerCase()}`}><ChevronsUpDown className="size-3" />Expand all</button>
      <button type="button" className={buttonClass} onClick={() => context.setAll(false)} title={`Collapse all ${label.toLowerCase()}`}><ChevronsDownUp className="size-3" />Collapse all</button>
    </div>
  </div>;
}

export default function ControlSection({ title, sectionKey, children, actions, defaultOpen = true, className, contentClassName }: {
  title: ReactNode;
  sectionKey: string;
  children: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
}) {
  const context = useContext(SectionContext);
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const contentId = useId();
  const parentPath = useContext(SectionPath);
  const key = `${parentPath}/${sectionKey}`;
  const open = context ? (context.state.sections[key] ?? context.state.all ?? defaultOpen) : localOpen;
  return <section className={cn('min-w-0 border-b border-ui-border', className)}>
    <div className="flex min-h-9 items-center gap-2">
      <button type="button" aria-expanded={open} aria-controls={contentId}
        onClick={() => context ? context.setSection(key, !open) : setLocalOpen(!open)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-ui-text-muted transition-colors hover:bg-ui-surface hover:text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ui-accent">
        <ChevronDown aria-hidden="true" className={cn('size-3 shrink-0 transition-transform', !open && '-rotate-90')} />
        <span className="min-w-0 flex-1">{title}</span>
      </button>
      {actions && <div className="shrink-0 pr-3">{actions}</div>}
    </div>
    {/* Keep editors mounted so folding a group preserves transient input state. */}
    <div id={contentId} hidden={!open}>
      <div className={cn('space-y-3 px-3 pb-3 pt-1', contentClassName)}><SectionPath.Provider value={key}>{children}</SectionPath.Provider></div>
    </div>
  </section>;
}
