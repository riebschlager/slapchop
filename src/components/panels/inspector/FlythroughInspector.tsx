import { Dices, Gauge, Orbit, PanelsTopLeft } from 'lucide-react';
import { useStore } from '../../../store';
import { FlythroughPlane } from '../../../types';
import MotionControl from '../../controls/MotionControl';
import Select, { SelectOption } from '../../controls/Select';
import Slider from '../../controls/Slider';
import MasterFxPanel from '../MasterFxPanel';

const PLANE_OPTIONS: SelectOption<FlythroughPlane>[] = [
  { value: 'billboard', label: 'Camera-facing billboards' },
  { value: 'xy', label: 'XY · screen parallel' },
  { value: 'xz', label: 'XZ · horizontal flight deck' },
  { value: 'yz', label: 'YZ · vertical side wall' }
];

export default function FlythroughInspector() {
  const config = useStore(s => s.flythrough);
  const assets = useStore(s => s.flythroughAssets);
  const update = useStore(s => s.updateFlythrough);
  const reseed = useStore(s => s.reseedFlythrough);
  const canvasBg = useStore(s => s.canvasBg);
  const setCanvasBg = useStore(s => s.setCanvasBg);

  return (
    <div className="flex flex-col">
      <div className="px-3 py-3 border-b border-cyan-950/80 bg-[radial-gradient(circle_at_top_right,rgba(8,145,178,0.12),transparent_55%)]">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-cyan-300">
              <Orbit className="w-3.5 h-3.5" />
              <h2 className="text-xs font-bold uppercase tracking-[0.16em]">Flight Director</h2>
            </div>
            <p className="text-[10px] text-gray-500 mt-1">{assets.length} GIF sources · seeded field</p>
          </div>
          <button
            type="button"
            onClick={reseed}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-cyan-200 bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-800/60 rounded transition-colors"
            title="Generate a new deterministic arrangement"
          >
            <Dices className="w-3 h-3" />
            Reseed
          </button>
        </div>
      </div>

      <section className="p-3 space-y-3 border-b border-gray-800">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          <Gauge className="w-3 h-3 text-cyan-400" />
          Particle Field
        </div>
        <Slider label="Population" display={`${Math.round(config.particleCount)} planes`} value={config.particleCount} min={1} max={160} step={1} onChange={particleCount => update({ particleCount })} />
        <Slider label="Flight Speed" display={`${Math.round(config.speed)} u/s`} value={config.speed} min={0} max={2400} step={20} onChange={speed => update({ speed })} />
        <Slider label="Tunnel Depth" display={`${Math.round(config.depth)} u`} value={config.depth} min={1200} max={18000} step={100} onChange={depth => update({ depth })} />
        <div className="grid grid-cols-2 gap-3">
          <Slider size="sm" label="Spread X" display={Math.round(config.spreadX)} value={config.spreadX} min={500} max={10000} step={100} onChange={spreadX => update({ spreadX })} />
          <Slider size="sm" label="Spread Y" display={Math.round(config.spreadY)} value={config.spreadY} min={1000} max={16000} step={100} onChange={spreadY => update({ spreadY })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Slider size="sm" label="Min Size" display={Math.round(config.minSize)} value={config.minSize} min={40} max={1200} step={10} onChange={minSize => update({ minSize: Math.min(minSize, config.maxSize) })} />
          <Slider size="sm" label="Max Size" display={Math.round(config.maxSize)} value={config.maxSize} min={80} max={1800} step={10} onChange={maxSize => update({ maxSize: Math.max(maxSize, config.minSize) })} />
        </div>
      </section>

      <section className="p-3 space-y-3 border-b border-gray-800">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          <PanelsTopLeft className="w-3 h-3 text-cyan-400" />
          Plane & Lens
        </div>
        <Select label="GIF Plane" value={config.plane} options={PLANE_OPTIONS} onChange={plane => update({ plane })} />
        <Slider label="Field of View" display={`${Math.round(config.fov)}°`} value={config.fov} min={25} max={120} step={1} onChange={fov => update({ fov })} />
        <Slider label="Opacity" display={`${Math.round(config.opacity * 100)}%`} value={config.opacity} min={0.05} max={1} step={0.01} onChange={opacity => update({ opacity })} />
      </section>

      <section className="p-3 pb-1 border-b border-gray-800">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 block mb-2">Modulation</label>
        <MotionControl label="Velocity Pulse" config={config.motionSpeed} onChange={motionSpeed => update({ motionSpeed })} maxAmplitude={1200} stepAmplitude={20} />
        <MotionControl label="Horizontal Drift" config={config.motionDriftX} onChange={motionDriftX => update({ motionDriftX })} maxAmplitude={2400} stepAmplitude={20} />
        <MotionControl label="Vertical Drift" config={config.motionDriftY} onChange={motionDriftY => update({ motionDriftY })} maxAmplitude={3200} stepAmplitude={20} />
        <MotionControl label="Plane Spin" config={config.motionRotation} onChange={motionRotation => update({ motionRotation })} maxAmplitude={360} stepAmplitude={1} />
        <MotionControl label="Scale Breathing" config={config.motionScale} onChange={motionScale => update({ motionScale })} maxAmplitude={1.5} stepAmplitude={0.05} />
      </section>

      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Void Color</label>
        <input type="color" value={canvasBg} onChange={event => setCanvasBg(event.target.value)} className="w-8 h-6 rounded cursor-pointer border-0 bg-gray-800 p-0" />
      </div>
      <MasterFxPanel />
    </div>
  );
}
