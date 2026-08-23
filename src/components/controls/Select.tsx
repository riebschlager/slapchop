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
      <label htmlFor={id} className="text-[11px] text-gray-400 mb-1 block">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={cn(
          'w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200',
          'outline-none focus:ring-1 focus:ring-indigo-500'
        )}
      >
        {options.map((opt) => <option key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</option>)}
      </select>
    </div>
  );
}
