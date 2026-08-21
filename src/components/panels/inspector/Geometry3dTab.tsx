import { Mesh3dLayer } from '../../../types';
import Slider from '../../controls/Slider';

// Which of width/height/depth/subdivisionX/subdivisionY actually feed a
// primitive's geometry generator — and what each axis means for it — varies
// per shape (see generateMesh3dGeometry's dispatch in geometry3d.ts). This
// tab shows only the sliders that primitive reads, labeled the way that
// generator interprets them, rather than nine generic XYZ/subdivision knobs
// that would mislead for e.g. a sphere (radius only) or a torus (subdivisionX
// is the tube's cross-section, subdivisionY is the ring).
export default function Geometry3dTab({ mesh, onChange }: { mesh: Mesh3dLayer; onChange: (updates: Partial<Mesh3dLayer>) => void }) {
  return (
    <div className="space-y-3">
      <div className="pb-2 border-b border-gray-800 flex items-center justify-between">
        <label className="text-[11px] text-gray-400">Primitive</label>
        <span className="text-xs font-mono text-gray-200 capitalize">{mesh.primitive.replace('-', ' ')}</span>
      </div>

      {mesh.primitive === 'plane' && (
        <>
          <DimSlider label="Width" value={mesh.width} onChange={(width) => onChange({ width })} />
          <DimSlider label="Height" value={mesh.height} onChange={(height) => onChange({ height })} />
          <SubdivRow
            xLabel="Subdivisions X" yLabel="Subdivisions Y"
            x={mesh.subdivisionX} y={mesh.subdivisionY} min={1} max={64}
            onChange={(subdivisionX, subdivisionY) => onChange({ subdivisionX, subdivisionY })}
          />
        </>
      )}

      {mesh.primitive === 'box' && (
        <>
          <DimSlider label="Width" value={mesh.width} onChange={(width) => onChange({ width })} />
          <DimSlider label="Height" value={mesh.height} onChange={(height) => onChange({ height })} />
          <DimSlider label="Depth" value={mesh.depth} onChange={(depth) => onChange({ depth })} />
          <SubdivRow
            xLabel="Subdivisions X" yLabel="Subdivisions Y"
            x={mesh.subdivisionX} y={mesh.subdivisionY} min={1} max={32}
            onChange={(subdivisionX, subdivisionY) => onChange({ subdivisionX, subdivisionY })}
          />
        </>
      )}

      {mesh.primitive === 'custom-mesh' && (
        <>
          <div className="text-[11px] text-amber-400/80 bg-amber-950/30 border border-amber-900/50 rounded px-2 py-1.5">
            No mesh importer yet — renders as a box using the dimensions below as a placeholder.
          </div>
          <DimSlider label="Width" value={mesh.width} onChange={(width) => onChange({ width })} />
          <DimSlider label="Height" value={mesh.height} onChange={(height) => onChange({ height })} />
          <DimSlider label="Depth" value={mesh.depth} onChange={(depth) => onChange({ depth })} />
        </>
      )}

      {mesh.primitive === 'cylinder' && (
        <>
          <DimSlider label="Diameter" value={mesh.width} min={10} onChange={(width) => onChange({ width })} />
          <DimSlider label="Height" value={mesh.height} onChange={(height) => onChange({ height })} />
          <SubdivRow
            xLabel="Radial Segments" yLabel="Height Segments"
            x={mesh.subdivisionX} y={mesh.subdivisionY} min={3} max={64}
            onChange={(subdivisionX, subdivisionY) => onChange({ subdivisionX, subdivisionY })}
          />
        </>
      )}

      {mesh.primitive === 'torus' && (
        <>
          <DimSlider label="Ring Diameter" value={mesh.width} min={10} onChange={(width) => onChange({ width })} />
          <DimSlider label="Tube Diameter" value={mesh.depth} min={4} max={500} onChange={(depth) => onChange({ depth })} />
          <SubdivRow
            xLabel="Tube Segments" yLabel="Ring Segments"
            x={mesh.subdivisionX} y={mesh.subdivisionY} min={3} max={64}
            onChange={(subdivisionX, subdivisionY) => onChange({ subdivisionX, subdivisionY })}
          />
        </>
      )}

      {mesh.primitive === 'sphere' && (
        <>
          <DimSlider label="Diameter" value={mesh.width} min={10} onChange={(width) => onChange({ width })} />
          <SubdivRow
            xLabel="Longitude Segments" yLabel="Latitude Segments"
            x={mesh.subdivisionX} y={mesh.subdivisionY} min={3} max={64}
            onChange={(subdivisionX, subdivisionY) => onChange({ subdivisionX, subdivisionY })}
          />
        </>
      )}

      {mesh.primitive === 'ribbon' && (
        <>
          <DimSlider label="Length" value={mesh.width} onChange={(width) => onChange({ width })} />
          <DimSlider label="Width" value={mesh.height} min={4} max={500} onChange={(height) => onChange({ height })} />
          <Slider
            label="Length Segments"
            display={mesh.subdivisionX.toString()}
            value={mesh.subdivisionX}
            min={1} max={128} step={1}
            onChange={(subdivisionX) => onChange({ subdivisionX })}
          />
        </>
      )}

      {mesh.primitive === 'extruded-polygon' && (
        <>
          <div className="text-[11px] text-gray-500">
            Contour points are drawn on canvas, same as Tiled GIF polygons — not yet wired for 3D mode's viewport.
          </div>
          <DimSlider label="Extrusion Depth" value={mesh.depth} min={2} max={500} onChange={(depth) => onChange({ depth })} />
          <Slider
            label="Bevel Size"
            display={`${(mesh.bevelSize ?? 0).toFixed(0)}px`}
            value={mesh.bevelSize ?? 0}
            min={0} max={100} step={1}
            onChange={(bevelSize) => onChange({ bevelSize })}
          />
        </>
      )}
    </div>
  );
}

function DimSlider({ label, value, min = 20, max = 2000, onChange }: { label: string; value: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <Slider
      label={label}
      display={`${Math.round(value)}px`}
      value={value}
      min={min} max={max} step={10}
      onChange={onChange}
    />
  );
}

function SubdivRow({ xLabel, yLabel, x, y, min, max, onChange }: {
  xLabel: string; yLabel: string; x: number; y: number; min: number; max: number;
  onChange: (x: number, y: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-800">
      <Slider size="sm" label={xLabel} display={x.toString()} value={x} min={min} max={max} step={1} onChange={(v) => onChange(v, y)} />
      <Slider size="sm" label={yLabel} display={y.toString()} value={y} min={min} max={max} step={1} onChange={(v) => onChange(x, v)} />
    </div>
  );
}
