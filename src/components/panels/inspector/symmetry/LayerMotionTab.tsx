import { Layer } from '../../../../types';
import MotionControl from '../../../controls/MotionControl';

export default function LayerMotionTab({ layer, onChange }: { layer: Layer; onChange: (updates: Partial<Layer>) => void }) {
  return (
    <div className="space-y-2 pb-1">
      <MotionControl label="X-Axis" config={layer.motionX} onChange={motionX => onChange({ motionX })} maxAmplitude={500} stepAmplitude={5} />
      <MotionControl label="Y-Axis" config={layer.motionY} onChange={motionY => onChange({ motionY })} maxAmplitude={500} stepAmplitude={5} />
      <MotionControl label="Rotation" config={layer.motionRotation} onChange={motionRotation => onChange({ motionRotation })} maxAmplitude={360} stepAmplitude={1} />
      <MotionControl label="Scale" config={layer.motionScale} onChange={motionScale => onChange({ motionScale })} maxAmplitude={3} stepAmplitude={0.05} />
    </div>
  );
}
