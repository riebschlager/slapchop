import { useId } from 'react';
import { formatRate } from '../../lib/sliderScale';
import { MotionConfig, MotionType } from '../../types';
import Slider from './Slider';

export default function MotionControl({ label, config, onChange, maxAmplitude = 1000, stepAmplitude = 10 }: { label: string, config?: MotionConfig, onChange: (c: MotionConfig | undefined) => void, maxAmplitude?: number, stepAmplitude?: number }) {
  const typeId = useId();
  const isEnabled = config && config.type !== 'none';
  return (
    <div className="mb-2 border border-ui-border p-2 rounded bg-ui-surface/40">
      <div className="flex items-center justify-between">
        <label htmlFor={typeId} className="text-[11px] font-semibold text-ui-text">{label}</label>
        <select
          id={typeId}
          value={config?.type || 'none'}
          onChange={(e) => {
             const type = e.target.value as MotionType;
             if (type === 'none') {
               onChange(undefined);
             } else {
               onChange({ type, speed: config?.speed ?? 1, amplitude: config?.amplitude || (maxAmplitude / 10), phase: config?.phase || 0 });
             }
          }}
          className="bg-ui-canvas text-[10px] text-ui-text-muted border border-ui-border-strong rounded px-1 py-0.5 outline-none focus:ring-2 focus:ring-ui-accent"
        >
          <option value="none">None</option>
          <option value="sine">Sine</option>
          <option value="noise">Noise</option>
        </select>
      </div>
      {isEnabled && (
        <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-ui-border/60">
           <Slider
             size="xs"
             label="Spd"
             display={formatRate(config!.speed)}
             value={config!.speed}
             min={0} max={10} step={0.001}
             scale="log" minPositive={0.001}
             onChange={(speed) => onChange({ ...config!, speed })}
           />
           <Slider
             size="xs"
             label="Amp"
             display={config!.amplitude.toFixed(stepAmplitude < 1 ? 1 : 0)}
             value={config!.amplitude}
             min={stepAmplitude} max={maxAmplitude} step={stepAmplitude}
             onChange={(amplitude) => onChange({ ...config!, amplitude })}
           />
           <Slider
             size="xs"
             label="Phs"
             display={config!.phase.toFixed(1)}
             value={config!.phase}
             min={0} max={Math.PI * 2} step={0.1}
             onChange={(phase) => onChange({ ...config!, phase })}
           />
        </div>
      )}
    </div>
  );
}
