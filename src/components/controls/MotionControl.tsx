import { useId } from 'react';
import { MotionConfig, MotionType } from '../../types';
import Slider from './Slider';

export default function MotionControl({ label, config, onChange, maxAmplitude = 1000, stepAmplitude = 10 }: { label: string, config?: MotionConfig, onChange: (c: MotionConfig | undefined) => void, maxAmplitude?: number, stepAmplitude?: number }) {
  const typeId = useId();
  const isEnabled = config && config.type !== 'none';
  return (
    <div className="mb-2 border border-gray-800 p-2 rounded bg-gray-800/30">
      <div className="flex items-center justify-between">
        <label htmlFor={typeId} className="text-[11px] font-semibold text-gray-300">{label}</label>
        <select
          id={typeId}
          value={config?.type || 'none'}
          onChange={(e) => {
             const type = e.target.value as MotionType;
             if (type === 'none') {
               onChange(undefined);
             } else {
               onChange({ type, speed: config?.speed || 1, amplitude: config?.amplitude || (maxAmplitude / 10), phase: config?.phase || 0 });
             }
          }}
          className="bg-gray-900 text-[10px] text-gray-300 border border-gray-700 rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="none">None</option>
          <option value="sine">Sine</option>
          <option value="noise">Noise</option>
        </select>
      </div>
      {isEnabled && (
        <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-gray-800/50">
           <Slider
             size="xs"
             label="Spd"
             display={config!.speed.toFixed(1)}
             value={config!.speed}
             min={0.1} max={10} step={0.1}
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
