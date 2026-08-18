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
  onChange: (value: T) => void;
  /**
   * `mode` is the raised, bordered switch used for top-level modes; `tab`
   * is the flat inline row used inside an inspector.
   */
  variant?: 'mode' | 'tab';
  /** Accessible name for the group. */
  label: string;
  className?: string;
}

const VARIANT = {
  mode: {
    group: 'flex gap-1 p-1 bg-gray-950 rounded-lg border border-gray-800',
    item: 'flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-semibold transition-all',
    on: 'bg-indigo-600 text-white shadow',
    off: 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
  },
  tab: {
    group: 'flex items-center gap-1',
    item: 'flex-1 text-[11px] font-medium py-1 rounded transition-colors',
    on: 'bg-indigo-600 text-white',
    off: 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
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
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
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
