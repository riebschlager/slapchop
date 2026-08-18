import { ReactNode, useId } from 'react';
import { cn } from '../../lib/utils';

/**
 * The label / readout / range trio the inspector panels are built from.
 *
 * `size` reproduces the three densities already in use: `xs` inside motion
 * modulators, `sm` inside the Master FX modules, and `md` — the only one with a
 * monospaced readout — for layer, polygon, and symmetry parameters.
 */
export interface SliderProps {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Formatted readout shown opposite the label; defaults to the raw value. */
  display?: ReactNode;
  size?: 'xs' | 'sm' | 'md';
  /** Track height, for the rare taller slider. */
  trackClassName?: string;
  /**
   * Overrides merged over the `size` defaults, for the few sliders the panels
   * emphasize with their own colour or spacing.
   */
  headerClassName?: string;
  labelClassName?: string;
  displayClassName?: string;
  className?: string;
}

const HEADER_CLASS = {
  xs: 'flex justify-between text-[9px] text-gray-400 mb-1',
  sm: 'flex justify-between text-[10px] text-gray-400 mb-1',
  md: 'flex items-center justify-between mb-1'
} as const;

export default function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  size = 'md',
  trackClassName = 'h-1',
  headerClassName,
  labelClassName,
  displayClassName,
  className
}: SliderProps) {
  const id = useId();
  const base = size === 'md';
  return (
    <div className={className}>
      <div className={cn(HEADER_CLASS[size], headerClassName)}>
        <label htmlFor={id} className={cn(base && 'text-[11px] text-gray-400', labelClassName)}>
          {label}
        </label>
        <span className={cn(base && 'text-[11px] font-mono', displayClassName)}>
          {display ?? value}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={cn('w-full accent-indigo-500', trackClassName)}
      />
    </div>
  );
}
