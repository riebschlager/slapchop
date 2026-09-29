import ControlSection from '../../components/controls/ControlSection';
import { useState } from 'react';
import { useStore } from '../../store';
import Slider from '../../components/controls/Slider';
import Select from '../../components/controls/Select';
import Toggle from '../../components/controls/Toggle';
import MasterFxPanel from '../../components/panels/MasterFxPanel';
import type { GridAxis } from './model';

function AxisEditor({ axis, title, count }: { axis: 'x' | 'y'; title: string; count: number }) {
  const config = useStore(s => s.grid[axis]);
  const update = useStore(s => s.updateGrid);
  const [selected, setSelected] = useState('0');
  const index = Math.min(Number(selected), count - 1);
  const change = (patch: Partial<GridAxis>) => update({ [axis]: { ...config, ...patch } });
  return <ControlSection sectionKey={`${title} distortion`} title={<span>{title} distortion</span>}>
    <Slider size="sm" label="Stretch strength" value={config.amount} min={0} max={2.5} step={0.01} onChange={amount => change({ amount })} />
    <Slider size="sm" label="Wave speed · cycles/s" value={config.speed} min={0} max={2} step={0.001} scale="log" onChange={speed => change({ speed })} />
    <Slider size="sm" label="Waves across grid" value={config.frequency} min={0} max={4} step={0.01} onChange={frequency => change({ frequency })} />
    <Slider size="sm" label="Wave phase" value={config.phase} min={0} max={1} step={0.001} onChange={phase => change({ phase })} />
    <Slider size="sm" label="Secondary wave" value={config.harmonic} min={0} max={1} step={0.01} onChange={harmonic => change({ harmonic })} />
    <div className="flex items-center justify-between text-[11px] text-ui-text-muted">Reverse direction
      <Toggle checked={config.reverse} onChange={reverse => change({ reverse })} title={`Reverse ${title.toLowerCase()} wave`} />
    </div>
    <div className="space-y-3 rounded border border-ui-border bg-ui-canvas p-2">
      <Select label={`${title} to adjust`} value={String(index)} onChange={setSelected}
        options={Array.from({ length: count }, (_, i) => ({ value: String(i), label: `${title} ${i + 1}` }))} />
      <Slider size="sm" label="Base size weight" value={config.weights[index] ?? 1} min={0.2} max={5} step={0.01}
        onChange={value => { const weights = Array.from({ length: count }, (_, i) => config.weights[i] ?? 1); weights[index] = value; change({ weights }); }} />
      <button type="button" className="text-[10px] text-ui-text-muted hover:text-ui-accent focus-visible:ring-2 focus-visible:ring-ui-accent" onClick={() => change({ weights: [] })}>Equalize all {title.toLowerCase()}s</button>
    </div>
  </ControlSection>;
}
export default function GridInspector() {
  const c = useStore(s => s.grid);
  const update = useStore(s => s.updateGrid);
  return <div>
    <div className="border-b border-ui-border bg-ui-surface p-3">
      <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-ui-text">Elastic Grid</h2>
      <p className="mt-1 text-[10px] leading-relaxed text-ui-text-subtle">Stretch every frame. Rows and columns breathe independently inside a fixed stage.</p>
    </div>
    <ControlSection sectionKey="Grid layout" title={<span>Grid layout</span>}>
      <Slider size="sm" label="Columns" value={c.columns} min={1} max={24} step={1} onChange={columns => update({ columns })} />
      <Slider size="sm" label="Rows" value={c.rows} min={1} max={24} step={1} onChange={rows => update({ rows })} />
      <Slider size="sm" label="Gutter · px" value={c.gutter} min={0} max={40} step={1} onChange={gutter => update({ gutter })} />
      <Slider size="sm" label="Outer margin · px" value={c.margin} min={0} max={200} step={1} onChange={margin => update({ margin })} />
    </ControlSection>
    <AxisEditor axis="x" title="Column" count={c.columns} />
    <AxisEditor axis="y" title="Row" count={c.rows} />
    <ControlSection sectionKey="GIF playback & assignment" title={<span>GIF playback & assignment</span>}>
      <Slider size="sm" label="Playback speed" value={c.gifSpeed} min={0} max={4} step={0.001} scale="log" onChange={gifSpeed => update({ gifSpeed })} />
      <Slider size="sm" label="Playback phase per cell" value={c.cellPhase} min={0} max={1} step={0.001} onChange={cellPhase => update({ cellPhase })} />
      <div className="flex items-center justify-between text-[11px] text-ui-text-muted">Seeded shuffle
        <Toggle checked={c.shuffle} onChange={shuffle => update({ shuffle })} title="Shuffle GIF assignment" />
      </div>
      {c.shuffle && <Slider size="sm" label="Shuffle seed" value={c.seed} min={0} max={100000} step={1} onChange={seed => update({ seed })} />}
      <p className="text-[10px] leading-relaxed text-ui-text-subtle">GIFs repeat left to right, then top to bottom. Full images stretch to the cell edges. Zero wave speed freezes distortion; zero playback speed freezes GIFs.</p>
      <label className="flex items-center justify-between text-[11px] text-ui-text-muted">Background
        <input type="color" value={c.backgroundColor} onChange={e => update({ backgroundColor: e.target.value })} className="h-7 w-12 rounded border border-ui-border bg-ui-canvas" />
      </label>
    </ControlSection>
    <MasterFxPanel />
  </div>;
}
