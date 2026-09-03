import { Dices, Grid2X2, Image as ImageIcon, Palette, Play, Plus, Waves, X } from 'lucide-react';
import { formatRate } from '../../../lib/sliderScale';
import { useStore } from '../../../store';
import {
  GifVoronoiArrangement,
  GifVoronoiBlankFill,
  GifVoronoiPhaseMode
} from '../../../types';
import Select, { SelectOption } from '../../controls/Select';
import Slider from '../../controls/Slider';
import MasterFxPanel from '../MasterFxPanel';

const ARRANGEMENT_OPTIONS: SelectOption<GifVoronoiArrangement>[] = [
  { value: 'scatter', label: 'Seeded scatter' },
  { value: 'scan', label: 'Top-to-bottom scan' },
  { value: 'radial', label: 'Center-out radial' }
];

const PHASE_OPTIONS: SelectOption<GifVoronoiPhaseMode>[] = [
  { value: 'staggered', label: 'Seeded stagger' },
  { value: 'sweep', label: 'Spatial sweep' },
  { value: 'sync', label: 'Synchronized' }
];

const BLANK_OPTIONS: SelectOption<GifVoronoiBlankFill>[] = [
  { value: 'palette', label: 'Palette cells' },
  { value: 'solid', label: 'Solid color' },
  { value: 'transparent', label: 'Reveal background' }
];

const PALETTE_PRESETS = [
  { name: 'Canopy', colors: ['#0b3d32', '#126b55', '#18a97f', '#8fdbb6'] },
  { name: 'Lichen', colors: ['#18230f', '#405b1e', '#82a92c', '#d8f075'] },
  { name: 'Mineral', colors: ['#10232b', '#175769', '#2fa5a7', '#b6eee5'] },
  { name: 'Ember', colors: ['#2b1110', '#7a271a', '#e15a25', '#ffc857'] },
  { name: 'Mono', colors: ['#0b0d0c', '#3f4542', '#8d9691', '#edf2ef'] }
];

function SectionTitle({ icon: Icon, children }: { icon: typeof Grid2X2; children: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ui-text-muted">
      <Icon className="size-3" />
      {children}
    </div>
  );
}

export default function GifVoronoiInspector() {
  const config = useStore(state => state.gifVoronoi);
  const assets = useStore(state => state.gifVoronoiAssets);
  const update = useStore(state => state.updateGifVoronoi);
  const reseed = useStore(state => state.reseedGifVoronoi);
  const occupied = assets.length > 0 ? Math.round(config.cellCount * config.occupancy) : 0;

  const updatePalette = (index: number, color: string) => {
    const palette = [...config.palette];
    palette[index] = color;
    update({ palette });
  };

  return (
    <div className="flex flex-col">
      <div className="border-b border-ui-border bg-ui-surface px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-ui-text">
              <Grid2X2 className="size-3.5" />
              <h2 className="text-xs font-bold uppercase tracking-[0.16em]">Voronoi Field</h2>
            </div>
            <p className="mt-1 text-[10px] text-ui-text-subtle">{assets.length} GIF sources · {occupied}/{Math.round(config.cellCount)} occupied cells</p>
          </div>
          <button
            type="button"
            onClick={reseed}
            className="flex items-center gap-1 rounded border border-ui-border bg-ui-surface-raised px-2 py-1 text-[10px] font-semibold text-ui-text-muted transition-colors hover:border-ui-accent hover:text-ui-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
            title="Generate a new deterministic mesh and scatter"
          >
            <Dices className="size-3" />
            Reseed
          </button>
        </div>
      </div>

      <section className="space-y-3 border-b border-ui-border p-3">
        <SectionTitle icon={Grid2X2}>Mesh</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Slider size="sm" label="Cells" display={Math.round(config.cellCount)} value={config.cellCount} min={4} max={120} step={1} onChange={cellCount => update({ cellCount })} />
          <Slider size="sm" label="Irregularity" display={`${Math.round(config.irregularity * 100)}%`} value={config.irregularity} min={0} max={1} step={0.01} onChange={irregularity => update({ irregularity })} />
        </div>
        <Slider label="Gutter Width" display={`${config.gutterWidth.toFixed(1)} px`} value={config.gutterWidth} min={0} max={32} step={0.5} onChange={gutterWidth => update({ gutterWidth })} />
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[10px] text-ui-text-muted">
            <span className="mb-1 block">Gutter</span>
            <input type="color" value={config.gutterColor} onChange={event => update({ gutterColor: event.target.value })} className="h-7 w-full cursor-pointer rounded border border-ui-border bg-ui-canvas p-0.5" />
          </label>
          <label className="text-[10px] text-ui-text-muted">
            <span className="mb-1 block">Background</span>
            <input type="color" value={config.backgroundColor} onChange={event => update({ backgroundColor: event.target.value })} className="h-7 w-full cursor-pointer rounded border border-ui-border bg-ui-canvas p-0.5" />
          </label>
        </div>
      </section>

      <section className="space-y-3 border-b border-ui-border p-3">
        <SectionTitle icon={Waves}>Point Drift</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Slider
            size="sm"
            label="Amount"
            display={`${Math.round(config.pointDriftAmount * 100)}%`}
            value={config.pointDriftAmount}
            min={0}
            max={1}
            step={0.01}
            onChange={pointDriftAmount => update({ pointDriftAmount })}
          />
          <Slider
            size="sm"
            label="Rate"
            display={`${formatRate(config.pointDriftSpeed)} Hz`}
            value={config.pointDriftSpeed}
            min={0}
            max={2}
            step={0.001}
            scale="log"
            minPositive={0.001}
            onChange={pointDriftSpeed => update({ pointDriftSpeed })}
          />
        </div>
        <div className="rounded border border-ui-border bg-ui-surface px-2 py-1.5 text-[9px] leading-relaxed text-ui-text-subtle">
          Seeded site motion reshapes the mesh over time while each point stays in its home region.
        </div>
      </section>

      <section className="space-y-3 border-b border-ui-border p-3">
        <SectionTitle icon={ImageIcon}>Assignment</SectionTitle>
        <Select label="Cell Arrangement" value={config.arrangement} options={ARRANGEMENT_OPTIONS} onChange={arrangement => update({ arrangement })} />
        <Slider label="GIF Occupancy" display={`${Math.round(config.occupancy * 100)}%`} value={config.occupancy} min={0} max={1} step={0.01} onChange={occupancy => update({ occupancy })} />
        <div className="rounded border border-ui-border bg-ui-surface px-2 py-1.5 text-[9px] leading-relaxed text-ui-text-subtle">
          Library order is preserved, then cycled across occupied cells. Drag sources in the Stack to change the sequence.
        </div>
      </section>

      <section className="space-y-3 border-b border-ui-border p-3">
        <SectionTitle icon={Play}>Playback & Cover</SectionTitle>
        <Slider label="GIF Speed" display={`${config.gifSpeed.toFixed(2)}×`} value={config.gifSpeed} min={0} max={3} step={0.01} scale="log" minPositive={0.05} onChange={gifSpeed => update({ gifSpeed })} />
        <Select label="Playback Phase" value={config.phaseMode} options={PHASE_OPTIONS} onChange={phaseMode => update({ phaseMode })} />
        {config.phaseMode !== 'sync' && (
          <Slider label="Phase Spread" display={`${Math.round(config.phaseSpread * 100)}%`} value={config.phaseSpread} min={0} max={1} step={0.01} onChange={phaseSpread => update({ phaseSpread })} />
        )}
        <Slider label="Cover Zoom" display={`${config.coverZoom.toFixed(2)}×`} value={config.coverZoom} min={1} max={3} step={0.01} onChange={coverZoom => update({ coverZoom })} />
        <div className="grid grid-cols-2 gap-3">
          <Slider size="sm" label="Crop X" display={`${Math.round(config.coverOffsetX * 100)}%`} value={config.coverOffsetX} min={-1} max={1} step={0.01} onChange={coverOffsetX => update({ coverOffsetX })} />
          <Slider size="sm" label="Crop Y" display={`${Math.round(config.coverOffsetY * 100)}%`} value={config.coverOffsetY} min={-1} max={1} step={0.01} onChange={coverOffsetY => update({ coverOffsetY })} />
        </div>
      </section>

      <section className="space-y-3 border-b border-ui-border p-3">
        <SectionTitle icon={Palette}>Blank Cells</SectionTitle>
        <Select label="Blank Treatment" value={config.blankFill} options={BLANK_OPTIONS} onChange={blankFill => update({ blankFill })} />
        {config.blankFill !== 'transparent' && (
          <Slider label="Blank Opacity" display={`${Math.round(config.blankOpacity * 100)}%`} value={config.blankOpacity} min={0} max={1} step={0.01} onChange={blankOpacity => update({ blankOpacity })} />
        )}
        {config.blankFill === 'solid' && (
          <label className="text-[10px] text-ui-text-muted">
            <span className="mb-1 block">Blank Color</span>
            <input type="color" value={config.blankColor} onChange={event => update({ blankColor: event.target.value })} className="h-7 w-full cursor-pointer rounded border border-ui-border bg-ui-canvas p-0.5" />
          </label>
        )}
        {config.blankFill === 'palette' && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {PALETTE_PRESETS.map(preset => (
                <button key={preset.name} type="button" onClick={() => update({ palette: [...preset.colors] })} className="rounded border border-ui-border bg-ui-surface px-2 py-1 text-[9px] font-semibold text-ui-text-muted transition-colors hover:border-ui-accent hover:text-ui-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent">
                  {preset.name}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {config.palette.map((color, index) => (
                <div key={`${index}-${color}`} className="flex items-center gap-2 rounded border border-ui-border bg-ui-canvas p-1.5">
                  <input type="color" value={color} onChange={event => updatePalette(index, event.target.value)} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0" aria-label={`Blank palette color ${index + 1}`} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-ui-text-subtle">{color}</span>
                  {config.palette.length > 2 && (
                    <button type="button" onClick={() => update({ palette: config.palette.filter((_, itemIndex) => itemIndex !== index) })} className="text-ui-text-subtle hover:text-red-300" aria-label={`Remove blank palette color ${index + 1}`}>
                      <X className="size-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {config.palette.length < 8 && (
              <button type="button" onClick={() => update({ palette: [...config.palette, '#ffffff'] })} className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-ui-border py-1.5 text-[10px] text-ui-text-subtle transition-colors hover:border-ui-accent hover:text-ui-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent">
                <Plus className="size-3" /> Add color
              </button>
            )}
          </>
        )}
      </section>

      <div className="px-3 pt-3 text-[9px] uppercase tracking-[0.18em] text-ui-text-subtle">
        Cover crop · deterministic cells
      </div>
      <MasterFxPanel />
    </div>
  );
}
