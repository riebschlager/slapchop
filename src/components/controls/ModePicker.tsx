import { ComponentType, KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ModeOption<T extends string> {
  value: T;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}

interface ModePickerProps<T extends string> {
  options: readonly ModeOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

const SEARCH_THRESHOLD = 7;

export default function ModePicker<T extends string>({
  options,
  value,
  onChange,
  label,
  className
}: ModePickerProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef(new Map<T, HTMLButtonElement>());
  const listboxId = useId();
  const searchId = useId();
  const active = options.find(option => option.value === value) ?? options[0];
  const searchable = options.length >= SEARCH_THRESHOLD;
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return options;
    return options.filter(option =>
      `${option.label} ${option.description}`.toLocaleLowerCase().includes(normalizedQuery)
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open || searchable) return;
    const frame = requestAnimationFrame(() => optionRefs.current.get(value)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, searchable, value]);

  if (!active) return null;
  const ActiveIcon = active.icon;

  const selectMode = (nextValue: T) => {
    onChange(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectMode(filteredOptions[index].value);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowDown') nextIndex = (index + 1) % filteredOptions.length;
    if (event.key === 'ArrowUp') nextIndex = (index - 1 + filteredOptions.length) % filteredOptions.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = filteredOptions.length - 1;
    optionRefs.current.get(filteredOptions[nextIndex].value)?.focus();
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen(current => !current)}
        className={cn(
          'group w-full flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
          'bg-gray-950 border-gray-800 hover:border-gray-700 hover:bg-gray-800/70',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400'
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-indigo-600 text-white shadow-sm shadow-indigo-950/50">
          <ActiveIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[9px] font-semibold uppercase tracking-[0.16em] text-gray-500">{label}</span>
          <span className="block truncate text-xs font-semibold text-gray-100">{active.label}</span>
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-gray-500 transition-transform', open && 'rotate-180 text-gray-300')} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-lg border border-gray-700 bg-gray-950 shadow-2xl shadow-black/60">
          <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Choose mode</span>
            <span className="text-[10px] tabular-nums text-gray-600">{options.length}</span>
          </div>

          {searchable && (
            <div className="relative border-b border-gray-800 p-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-gray-500" />
              <label htmlFor={searchId} className="sr-only">Search modes</label>
              <input
                id={searchId}
                autoFocus
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search modes…"
                className="w-full rounded-md border border-gray-800 bg-gray-900 py-1.5 pl-8 pr-2 text-xs text-gray-100 outline-none placeholder:text-gray-600 focus:border-indigo-500"
              />
            </div>
          )}

          <div id={listboxId} role="listbox" aria-label={label} className="max-h-80 overflow-y-auto p-1.5">
            {filteredOptions.map((option, index) => {
              const Icon = option.icon;
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  ref={node => {
                    if (node) optionRefs.current.set(option.value, node);
                    else optionRefs.current.delete(option.value);
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => selectMode(option.value)}
                  onKeyDown={event => handleOptionKeyDown(event, index)}
                  className={cn(
                    'group/option flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                    'focus:outline-none focus-visible:bg-gray-800',
                    selected ? 'bg-indigo-500/15' : 'hover:bg-gray-800/80'
                  )}
                >
                  <span className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors',
                    selected
                      ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-300'
                      : 'border-gray-800 bg-gray-900 text-gray-500 group-hover/option:text-gray-300'
                  )}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-xs font-semibold', selected ? 'text-white' : 'text-gray-200')}>{option.label}</span>
                    <span className="block truncate text-[10px] leading-4 text-gray-500">{option.description}</span>
                  </span>
                  {selected && <Check className="size-3.5 shrink-0 text-indigo-400" />}
                </button>
              );
            })}
            {filteredOptions.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-gray-500">No matching modes</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
