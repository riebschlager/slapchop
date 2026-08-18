import Slider from '../../controls/Slider';
import MotionControl from '../../controls/MotionControl';
import { InspectorSubject } from './types';

// Shared tab position, but the two kinds animate genuinely different
// fields (a layer's own transform vs. a polygon's per-vertex jelly and
// texture drift) so the content branches wholesale rather than merging
// field-by-field the way Style/Symmetry do.
export default function MotionTab({ subject }: { subject: InspectorSubject }) {
  if (subject.kind === 'layer') {
    const { layer, onChange } = subject;
    return (
      <div className="space-y-2 pb-1">
        <MotionControl label="X-Axis" config={layer.motionX} onChange={c => onChange({ motionX: c })} maxAmplitude={500} stepAmplitude={5} />
        <MotionControl label="Y-Axis" config={layer.motionY} onChange={c => onChange({ motionY: c })} maxAmplitude={500} stepAmplitude={5} />
        <MotionControl label="Rotation" config={layer.motionRotation} onChange={c => onChange({ motionRotation: c })} maxAmplitude={360} stepAmplitude={1} />
        <MotionControl label="Scale" config={layer.motionScale} onChange={c => onChange({ motionScale: c })} maxAmplitude={3} stepAmplitude={0.05} />
      </div>
    );
  }

  const { polygon, onChange } = subject;
  return (
    <div className="space-y-2 pb-1">
      <div className="pb-2 mb-1 border-b border-gray-800">
        <MotionControl
          label="Vertex Deformation (Jelly)"
          config={polygon.vertexNoise}
          onChange={(c) => onChange({
            vertexNoise: c ? { ...c, incoherence: polygon.vertexNoise?.incoherence ?? 0.6 } : undefined
          })}
          maxAmplitude={150}
          stepAmplitude={2}
        />
        {polygon.vertexNoise && polygon.vertexNoise.type !== 'none' && (
          <Slider
            size="xs"
            className="-mt-2 border border-t-0 border-gray-800 p-2 rounded-b bg-gray-800/30"
            label="Incoherence (desync per vertex)"
            display={`${Math.round(polygon.vertexNoise.incoherence * 100)}%`}
            value={polygon.vertexNoise.incoherence}
            min={0} max={1} step={0.05}
            onChange={(incoherence) => onChange({
              vertexNoise: { ...polygon.vertexNoise!, incoherence }
            })}
          />
        )}
      </div>
      <MotionControl
        label="Texture Scale Pulse"
        config={polygon.motionTextureScale}
        onChange={c => onChange({ motionTextureScale: c })}
        maxAmplitude={2}
        stepAmplitude={0.05}
      />
      <MotionControl
        label="Texture Spin"
        config={polygon.motionTextureRotation}
        onChange={c => onChange({ motionTextureRotation: c })}
        maxAmplitude={360}
        stepAmplitude={1}
      />
      <MotionControl
        label="Texture Offset X Drift"
        config={polygon.motionTextureOffsetX}
        onChange={c => onChange({ motionTextureOffsetX: c })}
        maxAmplitude={500}
        stepAmplitude={5}
      />
      <MotionControl
        label="Texture Offset Y Drift"
        config={polygon.motionTextureOffsetY}
        onChange={c => onChange({ motionTextureOffsetY: c })}
        maxAmplitude={500}
        stepAmplitude={5}
      />
    </div>
  );
}
