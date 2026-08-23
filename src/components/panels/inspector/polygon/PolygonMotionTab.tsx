import { PolygonLayer } from '../../../../types';
import MotionControl from '../../../controls/MotionControl';
import Slider from '../../../controls/Slider';

export default function PolygonMotionTab({ polygon, onChange }: { polygon: PolygonLayer; onChange: (updates: Partial<PolygonLayer>) => void }) {
  return (
    <div className="space-y-2 pb-1">
      <div className="pb-2 mb-1 border-b border-gray-800">
        <MotionControl
          label="Vertex Deformation (Jelly)"
          config={polygon.vertexNoise}
          onChange={(vertexNoise) => onChange({
            vertexNoise: vertexNoise ? { ...vertexNoise, incoherence: polygon.vertexNoise?.incoherence ?? 0.6 } : undefined
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
            onChange={(incoherence) => onChange({ vertexNoise: { ...polygon.vertexNoise!, incoherence } })}
          />
        )}
      </div>
      <MotionControl label="Texture Scale Pulse" config={polygon.motionTextureScale} onChange={motionTextureScale => onChange({ motionTextureScale })} maxAmplitude={2} stepAmplitude={0.05} />
      <MotionControl label="Texture Spin" config={polygon.motionTextureRotation} onChange={motionTextureRotation => onChange({ motionTextureRotation })} maxAmplitude={360} stepAmplitude={1} />
      <MotionControl label="Texture Offset X Drift" config={polygon.motionTextureOffsetX} onChange={motionTextureOffsetX => onChange({ motionTextureOffsetX })} maxAmplitude={500} stepAmplitude={5} />
      <MotionControl label="Texture Offset Y Drift" config={polygon.motionTextureOffsetY} onChange={motionTextureOffsetY => onChange({ motionTextureOffsetY })} maxAmplitude={500} stepAmplitude={5} />
    </div>
  );
}
