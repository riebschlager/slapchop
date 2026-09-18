import { useStore } from '../../store';
import Slider from '../../components/controls/Slider';
import Toggle from '../../components/controls/Toggle';
import MasterFxPanel from '../../components/panels/MasterFxPanel';
import type { RingsConfig } from './model';

type NumberKey = { [K in keyof RingsConfig]: RingsConfig[K] extends number ? K : never }[keyof RingsConfig];
const sections: { title: string; controls: [NumberKey, string, number, number, number][] }[] = [
  { title: 'Ring geometry', controls: [
    ['gifsPerRing', 'GIFs per Ring', 1, 48, 1], ['ringCount', 'Visible Rings', 4, 48, 1],
    ['radius', 'Ring Radius', 100, 2400, 10], ['spacing', 'Ring Spacing', 100, 2400, 10],
    ['gifSize', 'GIF Size', 20, 1600, 10]
  ] },
  { title: 'Flight & rotation', controls: [
    ['speed', 'Travel Speed', -2400, 2400, 10], ['twist', 'Twist per Ring', -180, 180, 1],
    ['rotationSpeed', 'Ring Rotation °/s', -90, 90, 0.5]
  ] },
  { title: 'Camera', controls: [
    ['fov', 'Field of View', 30, 120, 1], ['cameraX', 'Offset X', -1600, 1600, 10],
    ['cameraY', 'Offset Y', -1600, 1600, 10], ['cameraRoll', 'Camera Roll', -180, 180, 1]
  ] },
  { title: 'GIF playback', controls: [
    ['gifSpeed', 'Playback Speed', 0, 4, 0.001], ['ringPhase', 'Phase per Ring', 0, 1, 0.01]
  ] }
];

export default function RingsInspector() {
  const config = useStore(s => s.rings);
  const update = useStore(s => s.updateRings);
  const reseed = useStore(s => s.reseedRings);
  return <div className="flex flex-col">
    <div className="border-b border-ui-border bg-ui-surface p-3">
      <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-ui-text">Ring Flight</h2>
      <p className="mt-1 text-[10px] text-ui-text-subtle">One GIF per ring · an endless open corridor</p>
    </div>
    {sections.map(section => <section key={section.title} className="space-y-3 border-b border-ui-border p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ui-text-muted">{section.title}</h3>
      {section.controls.map(([key, label, min, max, step]) => <Slider key={key} size="sm" label={label}
        value={config[key]} min={min} max={max} step={step}
        scale={key === 'gifSpeed' ? 'log' : 'linear'}
        onChange={value => update({ [key]: value })} />)}
    </section>)}
    <section className="space-y-3 border-b border-ui-border p-3">
      <div className="flex items-center justify-between text-[11px] text-ui-text-muted">
        Radial GIF orientation
        <Toggle checked={config.radialOrientation} onChange={radialOrientation => update({ radialOrientation })} title="Orient GIFs around the ring" />
      </div>
      <div className="flex items-center justify-between text-[11px] text-ui-text-muted">
        Seeded shuffle
        <Toggle checked={config.shuffle} onChange={shuffle => update({ shuffle })} title="Shuffle the ring sequence" />
      </div>
      {config.shuffle && <button type="button" onClick={reseed} className="rounded border border-ui-border px-2 py-1 text-[10px] text-ui-text-muted hover:text-ui-accent focus-visible:ring-2 focus-visible:ring-ui-accent">Reseed sequence</button>}
      <p className="text-[10px] text-ui-text-subtle">With shuffle off, rings cycle through your library in order. Copies within a ring play in sync.</p>
    </section>
    <section className="space-y-3 border-b border-ui-border p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ui-text-muted">Void & depth</h3>
      <Slider size="sm" label="Depth Fog" value={config.fog} display={config.fog.toFixed(5)} min={0} max={0.001} step={0.00001} onChange={fog => update({ fog })} />
      <label className="flex items-center justify-between text-[11px] text-ui-text-muted">Void Color
        <input type="color" value={config.backgroundColor} onChange={e => update({ backgroundColor: e.target.value })} className="h-7 w-12 cursor-pointer rounded border border-ui-border bg-ui-canvas" />
      </label>
    </section>
    <MasterFxPanel />
  </div>;
}
