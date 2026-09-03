import { cn } from '../../lib/utils';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name; also the hover tooltip. */
  title: string;
  className?: string;
}

/** Small on/off switch used for enabling whole effect modules. */
export default function Toggle({ checked, onChange, title, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={title}
      title={title}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ui-panel',
        checked ? 'bg-ui-accent' : 'bg-ui-border-strong',
        className
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-3 w-3 transform rounded-full bg-ui-text shadow ring-0 transition duration-200 ease-in-out',
          checked ? 'translate-x-3' : 'translate-x-0'
        )}
      />
    </button>
  );
}
