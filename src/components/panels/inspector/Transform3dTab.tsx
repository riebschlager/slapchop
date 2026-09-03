import { Mesh3dLayer } from '../../../types';
import Slider from '../../controls/Slider';
import MotionControl from '../../controls/MotionControl';

// Mesh3d's first tab bundles the static transform *and* its motion
// modulators in one place (unlike the 2D Layer inspector, which splits
// Transform and Motion into separate tabs) — see the 3D mode implementation
// plan's Component 4 spec. Position/rotation/scale/pivot each get their own
// XYZ row so the tab reads as one grid rather than nine unrelated sliders.
export default function Transform3dTab({ mesh, onChange }: { mesh: Mesh3dLayer; onChange: (updates: Partial<Mesh3dLayer>) => void }) {
  return (
    <div className="space-y-3">
      <AxisRow
        label="Position"
        values={[mesh.x, mesh.y, mesh.z]}
        min={-1000} max={1000} step={5}
        onChange={([x, y, z]) => onChange({ x, y, z })}
      />
      <AxisRow
        label="Rotation"
        values={[mesh.rotationX, mesh.rotationY, mesh.rotationZ]}
        min={-180} max={180} step={1}
        display={(v) => `${Math.round(v)}°`}
        onChange={([rotationX, rotationY, rotationZ]) => onChange({ rotationX, rotationY, rotationZ })}
      />
      <AxisRow
        label="Scale"
        values={[mesh.scaleX, mesh.scaleY, mesh.scaleZ]}
        min={0.1} max={5} step={0.05}
        display={(v) => v.toFixed(2)}
        onChange={([scaleX, scaleY, scaleZ]) => onChange({ scaleX, scaleY, scaleZ })}
      />
      <AxisRow
        label="Pivot"
        values={[mesh.pivotX, mesh.pivotY, mesh.pivotZ]}
        min={-1000} max={1000} step={5}
        onChange={([pivotX, pivotY, pivotZ]) => onChange({ pivotX, pivotY, pivotZ })}
      />

      <div className="pt-2 border-t border-ui-border space-y-2">
        <label className="text-[10px] font-semibold text-ui-text-muted uppercase tracking-wider block">Motion Modulators</label>
        <MotionControl label="Position X" config={mesh.motionX} onChange={c => onChange({ motionX: c })} maxAmplitude={500} stepAmplitude={5} />
        <MotionControl label="Position Y" config={mesh.motionY} onChange={c => onChange({ motionY: c })} maxAmplitude={500} stepAmplitude={5} />
        <MotionControl label="Position Z" config={mesh.motionZ} onChange={c => onChange({ motionZ: c })} maxAmplitude={500} stepAmplitude={5} />
        <MotionControl label="Rotation X" config={mesh.motionRotX} onChange={c => onChange({ motionRotX: c })} maxAmplitude={360} stepAmplitude={1} />
        <MotionControl label="Rotation Y" config={mesh.motionRotY} onChange={c => onChange({ motionRotY: c })} maxAmplitude={360} stepAmplitude={1} />
        <MotionControl label="Rotation Z" config={mesh.motionRotZ} onChange={c => onChange({ motionRotZ: c })} maxAmplitude={360} stepAmplitude={1} />
        <MotionControl label="Scale X" config={mesh.motionScaleX} onChange={c => onChange({ motionScaleX: c })} maxAmplitude={3} stepAmplitude={0.05} />
        <MotionControl label="Scale Y" config={mesh.motionScaleY} onChange={c => onChange({ motionScaleY: c })} maxAmplitude={3} stepAmplitude={0.05} />
        <MotionControl label="Scale Z" config={mesh.motionScaleZ} onChange={c => onChange({ motionScaleZ: c })} maxAmplitude={3} stepAmplitude={0.05} />
      </div>
    </div>
  );
}

// Shared X/Y/Z slider triple for Position/Rotation/Scale/Pivot — one grid
// instead of four near-identical blocks of three sliders each.
function AxisRow({ label, values, min, max, step, display, onChange }: {
  label: string;
  values: [number, number, number];
  min: number;
  max: number;
  step: number;
  display?: (v: number) => string;
  onChange: (values: [number, number, number]) => void;
}) {
  const [x, y, z] = values;
  return (
    <div>
      <label className="text-[11px] text-ui-text-muted mb-1 block">{label}</label>
      <div className="grid grid-cols-3 gap-2">
        <Slider size="sm" label="X" display={display ? display(x) : undefined} value={x} min={min} max={max} step={step} onChange={(v) => onChange([v, y, z])} />
        <Slider size="sm" label="Y" display={display ? display(y) : undefined} value={y} min={min} max={max} step={step} onChange={(v) => onChange([x, v, z])} />
        <Slider size="sm" label="Z" display={display ? display(z) : undefined} value={z} min={min} max={max} step={step} onChange={(v) => onChange([x, y, v])} />
      </div>
    </div>
  );
}
