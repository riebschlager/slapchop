import { useId } from 'react';
import { cn } from '../../lib/utils';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

/** Labelled dropdown used for blend modes, symmetry engines, and lattices. */
export default function Select<T extends string>({ label, value, options, onChange, className }: SelectProps<T>) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="text-[11px] text-ui-text-muted mb-1 block">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={cn(
          'w-full bg-ui-canvas border border-ui-border-strong rounded px-2 py-1.5 text-xs text-ui-text',
          'outline-none focus:ring-2 focus:ring-ui-accent'
        )}
      >
        {options.map((opt) => <option key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</option>)}
      </select>
    </div>
  );
}
