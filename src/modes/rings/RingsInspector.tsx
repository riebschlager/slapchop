import ControlSection from '../../components/controls/ControlSection';
import { useStore } from '../../store';
import Slider from '../../components/controls/Slider';
import Toggle from '../../components/controls/Toggle';
import MasterFxPanel from '../../components/panels/MasterFxPanel';
import { formatRate } from '../../lib/sliderScale';
import type { RingsConfig, RingsSizeMotion } from './model';

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
  const sizeMotion = config.sizeMotion;
  const updateSizeMotion = (updates: Partial<RingsSizeMotion>) => update({ sizeMotion: { ...sizeMotion, ...updates } });
  return <div className="flex flex-col">
    <div className="border-b border-ui-border bg-ui-surface p-3">
      <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-ui-text">Ring Flight</h2>
      <p className="mt-1 text-[10px] text-ui-text-subtle">One GIF per ring · an endless open corridor</p>
    </div>
    {sections.map(section => <ControlSection sectionKey={section.title} title={<span>{section.title}</span>} key={section.title}>
      {section.controls.filter(([key]) => !(key === 'gifSize' && sizeMotion.sweep)).map(([key, label, min, max, step]) => <Slider key={key} size="sm" label={label}
        value={config[key]} min={min} max={max} step={step}
        scale={key === 'gifSpeed' ? 'log' : 'linear'}
        onChange={value => update({ [key]: value })} />)}
    </ControlSection>)}
    <ControlSection sectionKey="GIF size motion" title={<span>GIF size motion</span>}>
      <ControlSection
        sectionKey="rings-size-sweep"
        title="Size Sweep"
        className="rounded border border-ui-border bg-ui-surface/40"
        contentClassName={sizeMotion.sweep ? 'px-2 pb-2' : 'hidden'}
        actions={<Toggle checked={sizeMotion.sweep} onChange={sweep => updateSizeMotion({ sweep })} title="Toggle sine GIF size sweep" />}
      >
        {sizeMotion.sweep && <div className="mt-2 grid grid-cols-2 gap-2 border-t border-ui-border/60 pt-2">
          <Slider size="xs" label="From" display={Math.round(sizeMotion.min)} value={sizeMotion.min} min={20} max={1600} step={10} onChange={min => updateSizeMotion({ min })} />
          <Slider size="xs" label="To" display={Math.round(sizeMotion.max)} value={sizeMotion.max} min={20} max={1600} step={10} onChange={max => updateSizeMotion({ max })} />
          <Slider size="xs" label="Speed" display={formatRate(sizeMotion.speed)} value={sizeMotion.speed} min={0} max={10} step={0.001} scale="log" minPositive={0.001} onChange={speed => updateSizeMotion({ speed })} />
          <Slider size="xs" label="Ring Spread" display={sizeMotion.ringSpread.toFixed(2)} value={sizeMotion.ringSpread} min={-0.5} max={0.5} step={0.01} onChange={ringSpread => updateSizeMotion({ ringSpread })} />
        </div>}
      </ControlSection>
      <ControlSection
        sectionKey="rings-size-noise"
        title="Size Noise"
        className="rounded border border-ui-border bg-ui-surface/40"
        contentClassName={sizeMotion.noise ? 'px-2 pb-2' : 'hidden'}
        actions={<Toggle checked={sizeMotion.noise} onChange={noise => updateSizeMotion({ noise })} title="Toggle per-GIF size noise" />}
      >
        {sizeMotion.noise && <div className="mt-2 grid grid-cols-2 gap-2 border-t border-ui-border/60 pt-2">
          <Slider size="xs" label="Amplitude" display={`±${Math.round(sizeMotion.noiseAmplitude)}`} value={sizeMotion.noiseAmplitude} min={0} max={800} step={5} onChange={noiseAmplitude => updateSizeMotion({ noiseAmplitude })} />
          <Slider size="xs" label="Period" display={`${sizeMotion.noisePeriod.toFixed(2)}s`} value={sizeMotion.noisePeriod} min={0.05} max={10} step={0.05} onChange={noisePeriod => updateSizeMotion({ noisePeriod })} />
        </div>}
      </ControlSection>
    </ControlSection>
    <ControlSection sectionKey="assignment" title="Orientation & assignment">
      <div className="flex items-center justify-between text-[11px] text-ui-text-muted">
        Radial GIF orientation
        <Toggle checked={config.radialOrientation} onChange={radialOrientation => update({ radialOrientation })} title="Orient GIFs around the ring" />
      </div>
      <Slider size="sm" label="GIF Rotation" display={`${Math.round(config.gifRotation)}°`} value={config.gifRotation} min={-180} max={180} step={1} onChange={gifRotation => update({ gifRotation })} />
      <div className="flex items-center justify-between text-[11px] text-ui-text-muted">
        Seeded shuffle
        <Toggle checked={config.shuffle} onChange={shuffle => update({ shuffle })} title="Shuffle the ring sequence" />
      </div>
      {config.shuffle && <button type="button" onClick={reseed} className="rounded border border-ui-border px-2 py-1 text-[10px] text-ui-text-muted hover:text-ui-accent focus-visible:ring-2 focus-visible:ring-ui-accent">Reseed sequence</button>}
      <p className="text-[10px] text-ui-text-subtle">With shuffle off, rings cycle through your library in order. Copies within a ring play in sync.</p>
    </ControlSection>
    <ControlSection sectionKey="Void & depth" title={<span>Void & depth</span>}>
      <Slider size="sm" label="Depth Fog" value={config.fog} display={config.fog.toFixed(5)} min={0} max={0.001} step={0.00001} onChange={fog => update({ fog })} />
      <label className="flex items-center justify-between text-[11px] text-ui-text-muted">Void Color
        <input type="color" value={config.backgroundColor} onChange={e => update({ backgroundColor: e.target.value })} className="h-7 w-12 cursor-pointer rounded border border-ui-border bg-ui-canvas" />
      </label>
    </ControlSection>
    <MasterFxPanel />
  </div>;
}
