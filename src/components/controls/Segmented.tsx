import { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: NoInfer<T>) => void;
  /**
   * `mode` is the raised, bordered switch used for top-level modes; `tab`
   * is the flat inline row used inside an inspector.
   */
  variant?: 'mode' | 'tab';
  /** Accessible name for the group. */
  label: string;
  className?: string;
}

// `focusOffset` names the colour behind each variant's items: the green focus
// ring would otherwise be invisible against the equally green selected fill, so
// it needs a 1px gap in the surrounding surface to read against.
const VARIANT = {
  mode: {
    group: 'flex gap-1 p-1 bg-ui-canvas rounded-lg border border-ui-border',
    item: 'flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-semibold transition-all',
    focusOffset: 'focus-visible:ring-offset-1 focus-visible:ring-offset-ui-canvas',
    on: 'bg-ui-accent text-ui-accent-contrast shadow',
    off: 'text-ui-text-muted hover:text-ui-text hover:bg-ui-surface'
  },
  tab: {
    group: 'flex items-center gap-1',
    item: 'flex-1 text-[11px] font-medium py-1 rounded transition-colors',
    focusOffset: 'focus-visible:ring-offset-1 focus-visible:ring-offset-ui-panel',
    on: 'bg-ui-accent text-ui-accent-contrast',
    off: 'text-ui-text-muted hover:bg-ui-surface hover:text-ui-text'
  }
} as const;

export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  variant = 'tab',
  label,
  className
}: SegmentedProps<T>) {
  const style = VARIANT[variant];
  return (
    <div role="group" aria-label={label} className={cn(style.group, className)}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              style.item,
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent',
              style.focusOffset,
              selected ? style.on : style.off
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
