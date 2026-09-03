import { ReactNode, useEffect, useId, useState } from 'react';
import { cn } from '../../lib/utils';
import {
  logSliderPositionToValue,
  SLIDER_POSITION_MAX,
  snapSliderValue,
  valueToLogSliderPosition
} from '../../lib/sliderScale';

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
  /** Logarithmic mapping gives each order of magnitude equal track space. */
  scale?: 'linear' | 'log';
  /** Smallest non-zero value on a logarithmic track whose `min` is zero. */
  minPositive?: number;
  /** Allows the readout to be clicked and replaced with an exact numeric input. */
  editable?: boolean;
}

const HEADER_CLASS = {
  xs: 'flex justify-between text-[9px] text-ui-text-muted mb-1',
  sm: 'flex justify-between text-[10px] text-ui-text-muted mb-1',
  md: 'flex items-center justify-between mb-1'
} as const;

const EDITOR_CLASS = {
  xs: 'w-11 text-[9px]',
  sm: 'w-14 text-[10px]',
  md: 'w-16 text-[11px]'
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
  className,
  scale = 'linear',
  minPositive,
  editable = true
}: SliderProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const base = size === 'md';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const isLog = scale === 'log';
  const positiveFloor = minPositive ?? (min > 0 ? min : step);
  const logOptions = { min, max, minPositive: positiveFloor };
  const rangeValue = isLog ? valueToLogSliderPosition(value, logOptions) : value;
  const rangeDisplay = display ?? value;
  const ariaValueText = typeof rangeDisplay === 'string' || typeof rangeDisplay === 'number'
    ? String(rangeDisplay)
    : undefined;

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [editing, value]);

  const commitDraft = () => {
    const parsed = draft.trim() === '' ? NaN : Number(draft);
    if (Number.isFinite(parsed)) {
      onChange(snapSliderValue(parsed, min, max, step));
    }
    setEditing(false);
  };

  const handleRangeChange = (rawValue: number) => {
    const documentValue = isLog
      ? logSliderPositionToValue(rawValue, logOptions)
      : rawValue;
    onChange(snapSliderValue(documentValue, min, max, step));
  };

  return (
    <div className={className}>
      <div className={cn(HEADER_CLASS[size], headerClassName)}>
        <label id={labelId} htmlFor={id} className={cn(base && 'text-[11px] text-ui-text-muted', labelClassName)}>
          {label}
        </label>
        {editing ? (
          <input
            autoFocus
            aria-labelledby={labelId}
            inputMode="decimal"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitDraft();
              if (event.key === 'Escape') setEditing(false);
            }}
            className={cn(
              'h-4 rounded-sm border border-ui-accent/70 bg-ui-canvas px-1 text-right font-mono text-ui-text outline-none ring-1 ring-ui-accent/30',
              EDITOR_CLASS[size],
              displayClassName
            )}
          />
        ) : editable ? (
          <button
            type="button"
            aria-label={typeof label === 'string' ? `Edit ${label} value` : 'Edit slider value'}
            title="Click to enter an exact value"
            onClick={() => setEditing(true)}
            className={cn(
              'min-w-0 cursor-text rounded-sm px-1 -mr-1 text-right hover:bg-ui-surface-raised hover:text-ui-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent',
              base && 'text-[11px] font-mono',
              displayClassName
            )}
          >
            {rangeDisplay}
          </button>
        ) : (
          <span className={cn(base && 'text-[11px] font-mono', displayClassName)}>
            {rangeDisplay}
          </span>
        )}
      </div>
      <input
        id={id}
        type="range"
        min={isLog ? 0 : min}
        max={isLog ? SLIDER_POSITION_MAX : max}
        step={isLog ? 1 : step}
        value={rangeValue}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={ariaValueText}
        onChange={(e) => handleRangeChange(parseFloat(e.target.value))}
        className={cn('w-full accent-ui-accent', trackClassName)}
      />
    </div>
  );
}
