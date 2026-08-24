import { ReactNode } from 'react';
import {
  DEFAULT_NOISE_DEFORMER,
  DEFAULT_SINE_WAVE_DEFORMER,
  DEFAULT_TWIST_DEFORMER,
  DEFAULT_VERTEX_JELLY,
  Mesh3dLayer,
  NoiseDisplacementMode,
  SineWaveAxis,
  TwistAxis
} from '../../../types';
import Select, { SelectOption } from '../../controls/Select';
import Slider from '../../controls/Slider';
import Toggle from '../../controls/Toggle';
import { formatRate } from '../../../lib/sliderScale';

const SINE_AXIS_OPTIONS: SelectOption<SineWaveAxis>[] = [
  { value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' },
  { value: 'radial', label: 'Radial' }, { value: 'uv', label: 'UV' },
];
const TWIST_AXIS_OPTIONS: SelectOption<TwistAxis>[] = [
  { value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' },
];
const NOISE_MODE_OPTIONS: SelectOption<NoiseDisplacementMode>[] = [
  { value: 'normal', label: 'Along Normal' }, { value: 'axis', label: 'Axis-Locked' }, { value: 'spherical', label: 'Spherical' },
];

// Deformers apply in a fixed pipeline — twist, then sine wave, then noise,
// then vertex jelly (see deformation3d.ts) — so they're presented in that
// same order here, letting the reader trace what happens to a vertex top to
// bottom instead of alphabetically.
export default function Deform3dTab({ mesh, onChange }: { mesh: Mesh3dLayer; onChange: (updates: Partial<Mesh3dLayer>) => void }) {
  const twist = mesh.twistDeformer ?? DEFAULT_TWIST_DEFORMER;
  const sine = mesh.sineWaveDeformer ?? DEFAULT_SINE_WAVE_DEFORMER;
  const noise = mesh.noiseDeformer ?? DEFAULT_NOISE_DEFORMER;
  const jelly = mesh.vertexJelly ?? DEFAULT_VERTEX_JELLY;

  return (
    <div className="space-y-3">
      <DeformerSection title="Twist" enabled={twist.enabled} onToggle={(enabled) => onChange({ twistDeformer: { ...twist, enabled } })}>
        <div className="grid grid-cols-2 gap-2">
          <Select label="Axis" value={twist.axis} options={TWIST_AXIS_OPTIONS} onChange={(axis) => onChange({ twistDeformer: { ...twist, axis } })} />
          <Slider size="sm" label="Angle" display={`${Math.round(twist.angle)}°`} value={twist.angle} min={-720} max={720} step={5} onChange={(angle) => onChange({ twistDeformer: { ...twist, angle } })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Slider size="sm" label="Speed" display={formatRate(twist.speed)} value={twist.speed} min={0} max={5} step={0.001} scale="log" minPositive={0.001} onChange={(speed) => onChange({ twistDeformer: { ...twist, speed } })} />
          <Slider size="sm" label="Phase" display={twist.phase.toFixed(1)} value={twist.phase} min={0} max={Math.PI * 2} step={0.1} onChange={(phase) => onChange({ twistDeformer: { ...twist, phase } })} />
        </div>
      </DeformerSection>

      <DeformerSection title="Sine Wave" enabled={sine.enabled} onToggle={(enabled) => onChange({ sineWaveDeformer: { ...sine, enabled } })}>
        <Select label="Axis" value={sine.axis} options={SINE_AXIS_OPTIONS} onChange={(axis) => onChange({ sineWaveDeformer: { ...sine, axis } })} />
        <div className="grid grid-cols-2 gap-2">
          <Slider size="sm" label="Amplitude" display={`${Math.round(sine.amplitude)}px`} value={sine.amplitude} min={0} max={300} step={5} onChange={(amplitude) => onChange({ sineWaveDeformer: { ...sine, amplitude } })} />
          <Slider size="sm" label="Frequency" display={sine.frequency.toFixed(2)} value={sine.frequency} min={0.05} max={10} step={0.05} onChange={(frequency) => onChange({ sineWaveDeformer: { ...sine, frequency } })} />
          <Slider size="sm" label="Speed" display={formatRate(sine.speed)} value={sine.speed} min={0} max={5} step={0.001} scale="log" minPositive={0.001} onChange={(speed) => onChange({ sineWaveDeformer: { ...sine, speed } })} />
          <Slider size="sm" label="Phase" display={sine.phase.toFixed(1)} value={sine.phase} min={0} max={Math.PI * 2} step={0.1} onChange={(phase) => onChange({ sineWaveDeformer: { ...sine, phase } })} />
        </div>
        <Slider size="sm" label="Decay (falloff from origin)" display={sine.decay.toFixed(2)} value={sine.decay} min={0} max={1} step={0.05} onChange={(decay) => onChange({ sineWaveDeformer: { ...sine, decay } })} />
      </DeformerSection>

      <DeformerSection title="Noise" enabled={noise.enabled} onToggle={(enabled) => onChange({ noiseDeformer: { ...noise, enabled } })}>
        <Select label="Displacement Mode" value={noise.displacementMode} options={NOISE_MODE_OPTIONS} onChange={(displacementMode) => onChange({ noiseDeformer: { ...noise, displacementMode } })} />
        <div className="grid grid-cols-2 gap-2">
          <Slider size="sm" label="Amplitude" display={`${Math.round(noise.amplitude)}px`} value={noise.amplitude} min={0} max={200} step={5} onChange={(amplitude) => onChange({ noiseDeformer: { ...noise, amplitude } })} />
          <Slider size="sm" label="Scale" display={noise.scale.toFixed(2)} value={noise.scale} min={0.05} max={10} step={0.05} onChange={(scale) => onChange({ noiseDeformer: { ...noise, scale } })} />
          <Slider size="sm" label="Octaves" display={noise.octaves.toString()} value={noise.octaves} min={1} max={6} step={1} onChange={(octaves) => onChange({ noiseDeformer: { ...noise, octaves } })} />
          <Slider size="sm" label="Roughness" display={noise.roughness.toFixed(2)} value={noise.roughness} min={0} max={1} step={0.05} onChange={(roughness) => onChange({ noiseDeformer: { ...noise, roughness } })} />
          <Slider size="sm" label="Speed" display={formatRate(noise.speed)} value={noise.speed} min={0} max={5} step={0.001} scale="log" minPositive={0.001} onChange={(speed) => onChange({ noiseDeformer: { ...noise, speed } })} />
          <Slider size="sm" label="Phase" display={noise.phase.toFixed(1)} value={noise.phase} min={0} max={Math.PI * 2} step={0.1} onChange={(phase) => onChange({ noiseDeformer: { ...noise, phase } })} />
        </div>
        <Slider size="sm" label="Seed" display={noise.seed.toString()} value={noise.seed} min={1} max={999} step={1} onChange={(seed) => onChange({ noiseDeformer: { ...noise, seed } })} />
      </DeformerSection>

      <DeformerSection title="Vertex Jelly" enabled={jelly.enabled} onToggle={(enabled) => onChange({ vertexJelly: { ...jelly, enabled } })}>
        <div className="grid grid-cols-2 gap-2">
          <Slider size="sm" label="Amplitude" display={`${Math.round(jelly.amplitude)}px`} value={jelly.amplitude} min={0} max={100} step={2} onChange={(amplitude) => onChange({ vertexJelly: { ...jelly, amplitude } })} />
          <Slider size="sm" label="Speed" display={formatRate(jelly.speed)} value={jelly.speed} min={0} max={5} step={0.001} scale="log" minPositive={0.001} onChange={(speed) => onChange({ vertexJelly: { ...jelly, speed } })} />
          <Slider size="sm" label="Phase" display={jelly.phase.toFixed(1)} value={jelly.phase} min={0} max={Math.PI * 2} step={0.1} onChange={(phase) => onChange({ vertexJelly: { ...jelly, phase } })} />
          <Slider size="sm" label="Incoherence" display={`${Math.round(jelly.incoherence * 100)}%`} value={jelly.incoherence} min={0} max={1} step={0.05} onChange={(incoherence) => onChange({ vertexJelly: { ...jelly, incoherence } })} />
        </div>
      </DeformerSection>
    </div>
  );
}

// Shared enable-toggle-then-reveal shell for the four deformer blocks —
// same idea as MotionControl's type-select-then-reveal, but each deformer's
// field set is distinct enough (unlike MotionConfig's uniform speed/
// amplitude/phase) that the revealed content is authored per-block above
// rather than generalized into shared markup.
function DeformerSection({ title, enabled, onToggle, children }: {
  title: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="border border-gray-800 rounded bg-gray-800/30 p-2">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-semibold text-gray-300">{title}</label>
        <Toggle checked={enabled} onChange={onToggle} title={`${title} enabled`} />
      </div>
      {enabled && <div className="mt-2 pt-2 border-t border-gray-800/50 space-y-2">{children}</div>}
    </div>
  );
}
