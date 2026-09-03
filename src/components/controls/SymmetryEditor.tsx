import { SymmetryType, SymmetryParams, WallpaperLattice, DEFAULT_SYMMETRY_PARAMS } from '../../types';
import Select, { SelectOption } from './Select';
import Slider from './Slider';

const WALLPAPER_LATTICE_OPTIONS: SelectOption<WallpaperLattice>[] = [
  { value: 'p3', label: 'P3 — Triangular' },
  { value: 'p4m', label: 'P4M — Square + Mirror' },
  { value: 'p6', label: 'P6 — Hexagonal' },
];

/**
 * Parameter editor for the repeat/partition implementation the two current
 * 2D modes still share. Each owning mode supplies its own product vocabulary
 * and available choices; sharing this control does not imply feature parity.
 */
export default function SymmetryEditor({
  symmetry, radialSegments, symmetryParams, options, selectLabel, originHint, onChange
}: {
  symmetry: SymmetryType;
  radialSegments: number;
  symmetryParams?: SymmetryParams;
  options: readonly SelectOption<SymmetryType>[];
  selectLabel: string;
  originHint: string;
  onChange: (updates: Partial<{ symmetry: SymmetryType; radialSegments: number; symmetryParams: SymmetryParams }>) => void;
}) {
  const params = { ...DEFAULT_SYMMETRY_PARAMS, ...symmetryParams };
  const updateParams = (p: Partial<SymmetryParams>) => onChange({ symmetryParams: { ...params, ...p } });

  return (
    <>
      <Select
        label={selectLabel}
        value={symmetry}
        options={options}
        onChange={(v) => onChange({ symmetry: v })}
      />

      {symmetry === 'radial' && (
        <Slider
          label="Radial Segments"
          value={radialSegments}
          min={2} max={24} step={1}
          onChange={(v) => onChange({ radialSegments: v })}
        />
      )}

      {symmetry === 'spiral' && (
        <div className="space-y-2">
          <Slider
            label="Copies"
            value={params.spiralInstances}
            min={2} max={30} step={1}
            onChange={(spiralInstances) => updateParams({ spiralInstances })}
          />
          <Slider
            label="Angle Step"
            display={`${params.spiralAngleStep.toFixed(0)}°`}
            value={params.spiralAngleStep}
            min={1} max={90} step={1}
            onChange={(spiralAngleStep) => updateParams({ spiralAngleStep })}
          />
          <Slider
            label="Growth (shrink / grow per copy)"
            display={params.spiralGrowth.toFixed(2)}
            value={params.spiralGrowth}
            min={0.5} max={1.3} step={0.01}
            onChange={(spiralGrowth) => updateParams({ spiralGrowth })}
          />
        </div>
      )}

      {symmetry === 'wallpaper' && (
        <div className="space-y-2">
          <Select
            label="Lattice Type"
            value={params.wallpaperLattice}
            options={WALLPAPER_LATTICE_OPTIONS}
            onChange={(wallpaperLattice) => updateParams({ wallpaperLattice })}
          />
          <Slider
            label="Cell Size"
            display={`${Math.round(params.wallpaperCellSize)}px`}
            value={params.wallpaperCellSize}
            min={60} max={600} step={10}
            onChange={(wallpaperCellSize) => updateParams({ wallpaperCellSize })}
          />
        </div>
      )}

      {symmetry === 'poincare' && (
        <div className="space-y-2">
          <Slider
            label="Copies per Ring"
            value={radialSegments}
            min={2} max={24} step={1}
            onChange={(v) => onChange({ radialSegments: v })}
          />
          <Slider
            label="Rings"
            value={params.poincareRings}
            min={1} max={8} step={1}
            onChange={(poincareRings) => updateParams({ poincareRings })}
          />
          <Slider
            label="Boundary Radius"
            display={`${Math.round(params.poincareRadius)}px`}
            value={params.poincareRadius}
            min={100} max={900} step={10}
            onChange={(poincareRadius) => updateParams({ poincareRadius })}
          />
        </div>
      )}

      {symmetry === 'voronoi' && (
        <div className="space-y-2">
          <Slider
            label="Shard Count"
            value={params.voronoiCells}
            min={5} max={50} step={1}
            onChange={(voronoiCells) => updateParams({ voronoiCells })}
          />
          <Slider
            label="Seed"
            value={params.voronoiSeed}
            min={1} max={999} step={1}
            onChange={(voronoiSeed) => updateParams({ voronoiSeed })}
          />
          <Slider
            label="Phase Variation"
            display={`${Math.round(params.voronoiPhaseVariation * 100)}%`}
            value={params.voronoiPhaseVariation}
            min={0} max={1} step={0.05}
            onChange={(voronoiPhaseVariation) => updateParams({ voronoiPhaseVariation })}
          />
        </div>
      )}

      {symmetry !== 'none' && symmetry !== 'voronoi' && (
        <div className="pt-1 text-[10px] text-ui-text-subtle">
          {originHint}
        </div>
      )}
    </>
  );
}
