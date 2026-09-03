import { DEFAULT_SYMMETRY3D_PARAMS, Mesh3dLayer, Symmetry3dParams, Symmetry3dType } from '../../../types';
import Select, { SelectOption } from '../../controls/Select';
import Slider from '../../controls/Slider';

const SYMMETRY3D_OPTIONS: SelectOption<Symmetry3dType>[] = [
  { value: 'none', label: 'None' },
  { value: 'mirror-x', label: 'Mirror X' },
  { value: 'mirror-y', label: 'Mirror Y' },
  { value: 'mirror-z', label: 'Mirror Z' },
  { value: 'radial-y', label: 'Radial (around Y)' },
  { value: 'radial-z', label: 'Radial (around Z)' },
  { value: 'helix', label: 'Helix' },
  { value: 'cubic-grid', label: 'Cubic Grid' },
  { value: 'spherical-shell', label: 'Spherical Shell' },
];

// Each symmetry3d type reads only a subset of Symmetry3dParams' origin/
// mode-specific fields (see getSymmetry3dTransforms in symmetry3d.ts) —
// this tab shows only the fields the active type actually consumes, same
// rationale as Geometry3dTab's per-primitive field set.
export default function Symmetry3dTab({ mesh, onChange }: { mesh: Mesh3dLayer; onChange: (updates: Partial<Mesh3dLayer>) => void }) {
  const symmetry3d = mesh.symmetry3d ?? 'none';
  const radialSegments3d = mesh.radialSegments3d ?? 6;
  const params = { ...DEFAULT_SYMMETRY3D_PARAMS, ...mesh.symmetry3dParams };
  const updateParams = (p: Partial<Symmetry3dParams>) => onChange({ symmetry3dParams: { ...params, ...p } });

  return (
    <div className="space-y-3">
      <Select
        label="Symmetry Type"
        value={symmetry3d}
        options={SYMMETRY3D_OPTIONS}
        onChange={(v) => onChange({ symmetry3d: v })}
      />

      {symmetry3d === 'mirror-x' && (
        <Slider label="Mirror Origin X" display={`${Math.round(params.originX)}px`} value={params.originX} min={-1000} max={1000} step={5} onChange={(originX) => updateParams({ originX })} />
      )}
      {symmetry3d === 'mirror-y' && (
        <Slider label="Mirror Origin Y" display={`${Math.round(params.originY)}px`} value={params.originY} min={-1000} max={1000} step={5} onChange={(originY) => updateParams({ originY })} />
      )}
      {symmetry3d === 'mirror-z' && (
        <Slider label="Mirror Origin Z" display={`${Math.round(params.originZ)}px`} value={params.originZ} min={-1000} max={1000} step={5} onChange={(originZ) => updateParams({ originZ })} />
      )}

      {(symmetry3d === 'radial-y' || symmetry3d === 'radial-z') && (
        <div className="space-y-2">
          <Slider label="Copies" value={radialSegments3d} min={2} max={24} step={1} onChange={(v) => onChange({ radialSegments3d: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Slider size="sm" label="Origin X" display={`${Math.round(params.originX)}px`} value={params.originX} min={-1000} max={1000} step={5} onChange={(originX) => updateParams({ originX })} />
            <Slider
              size="sm"
              label={symmetry3d === 'radial-y' ? 'Origin Z' : 'Origin Y'}
              display={`${Math.round(symmetry3d === 'radial-y' ? params.originZ : params.originY)}px`}
              value={symmetry3d === 'radial-y' ? params.originZ : params.originY}
              min={-1000} max={1000} step={5}
              onChange={(v) => updateParams(symmetry3d === 'radial-y' ? { originZ: v } : { originY: v })}
            />
          </div>
        </div>
      )}

      {symmetry3d === 'helix' && (
        <div className="space-y-2">
          <Slider label="Copies" value={params.helixInstances} min={2} max={48} step={1} onChange={(helixInstances) => updateParams({ helixInstances })} />
          <Slider label="Turns" display={params.helixTurns.toFixed(2)} value={params.helixTurns} min={0.25} max={10} step={0.25} onChange={(helixTurns) => updateParams({ helixTurns })} />
          <Slider label="Rise per Full Length" display={`${Math.round(params.helixRise)}px`} value={params.helixRise} min={0} max={2000} step={10} onChange={(helixRise) => updateParams({ helixRise })} />
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-ui-border">
            <Slider size="sm" label="Origin X" display={`${Math.round(params.originX)}px`} value={params.originX} min={-1000} max={1000} step={5} onChange={(originX) => updateParams({ originX })} />
            <Slider size="sm" label="Origin Z" display={`${Math.round(params.originZ)}px`} value={params.originZ} min={-1000} max={1000} step={5} onChange={(originZ) => updateParams({ originZ })} />
          </div>
        </div>
      )}

      {symmetry3d === 'cubic-grid' && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Slider size="sm" label="Count X" value={params.cubicGridCountX} min={1} max={10} step={1} onChange={(cubicGridCountX) => updateParams({ cubicGridCountX })} />
            <Slider size="sm" label="Count Y" value={params.cubicGridCountY} min={1} max={10} step={1} onChange={(cubicGridCountY) => updateParams({ cubicGridCountY })} />
            <Slider size="sm" label="Count Z" value={params.cubicGridCountZ} min={1} max={10} step={1} onChange={(cubicGridCountZ) => updateParams({ cubicGridCountZ })} />
          </div>
          <Slider label="Spacing" display={`${Math.round(params.cubicGridSpacing)}px`} value={params.cubicGridSpacing} min={10} max={800} step={10} onChange={(cubicGridSpacing) => updateParams({ cubicGridSpacing })} />
        </div>
      )}

      {symmetry3d === 'spherical-shell' && (
        <div className="space-y-2">
          <Slider label="Shell Count" value={params.sphericalShellCount} min={2} max={200} step={2} onChange={(sphericalShellCount) => updateParams({ sphericalShellCount })} />
          <Slider label="Shell Radius" display={`${Math.round(params.sphericalShellRadius)}px`} value={params.sphericalShellRadius} min={10} max={1500} step={10} onChange={(sphericalShellRadius) => updateParams({ sphericalShellRadius })} />
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-ui-border">
            <Slider size="sm" label="Origin X" value={params.originX} min={-1000} max={1000} step={5} onChange={(originX) => updateParams({ originX })} />
            <Slider size="sm" label="Origin Y" value={params.originY} min={-1000} max={1000} step={5} onChange={(originY) => updateParams({ originY })} />
            <Slider size="sm" label="Origin Z" value={params.originZ} min={-1000} max={1000} step={5} onChange={(originZ) => updateParams({ originZ })} />
          </div>
        </div>
      )}

      {(symmetry3d === 'cubic-grid' && params.cubicGridCountX * params.cubicGridCountY * params.cubicGridCountZ > 200) && (
        <div className="text-[10px] text-amber-400/80">Instance count is capped at 200; extents will shrink evenly to fit.</div>
      )}
    </div>
  );
}
