import { Camera, Circle, CloudFog, Dices, Image as ImageIcon, Palette, Plus, Route, Shuffle, X } from 'lucide-react';
import { useStore } from '../../../store';
import { TunnelPaneFill } from '../../../types';
import MotionControl from '../../controls/MotionControl';
import Select, { SelectOption } from '../../controls/Select';
import Slider from '../../controls/Slider';
import Toggle from '../../controls/Toggle';
import MasterFxPanel from '../MasterFxPanel';

const FILL_OPTIONS: SelectOption<TunnelPaneFill>[] = [
  { value: 'palette', label: 'Cycle palette colors' },
  { value: 'transparent', label: 'Leave panes transparent' }
];

const PALETTE_PRESETS = [
  { name: 'Signal', colors: ['#ff3d81', '#ffb000', '#16e0bd', '#2d7dff'] },
  { name: 'Acid', colors: ['#d8ff00', '#00ffc8', '#ff2bd6', '#281cff'] },
  { name: 'Heat', colors: ['#ff2a00', '#ff7a00', '#ffd000', '#fff1cc'] },
  { name: 'Deep', colors: ['#071952', '#088395', '#37b7c3', '#ebf4f6'] },
  { name: 'Mono', colors: ['#f4f4f0', '#a5a5a0', '#4a4a48', '#111111'] }
];

function SectionTitle({ icon: Icon, children }: { icon: typeof Circle; children: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
      <Icon className="size-3 text-teal-400" />
      {children}
    </div>
  );
}

export default function TunnelInspector() {
  const config = useStore(state => state.tunnel);
  const assets = useStore(state => state.tunnelAssets);
  const update = useStore(state => state.updateTunnel);
  const reseed = useStore(state => state.reseedTunnel);

  const updatePalette = (index: number, color: string) => {
    const palette = [...config.palette];
    palette[index] = color;
    update({ palette });
  };

  return (
    <div className="flex flex-col">
      <div className="border-b border-teal-950/80 bg-[radial-gradient(circle_at_top_right,rgba(20,184,166,0.14),transparent_58%)] px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-teal-300">
              <Circle className="size-3.5" />
              <h2 className="text-xs font-bold uppercase tracking-[0.16em]">Tunnel Director</h2>
            </div>
            <p className="mt-1 text-[10px] text-gray-500">{assets.length} sources · {config.sides}-sided endless field</p>
          </div>
          <button
            type="button"
            onClick={reseed}
            className="flex items-center gap-1 rounded border border-teal-800/60 bg-teal-950/60 px-2 py-1 text-[10px] font-semibold text-teal-200 transition-colors hover:bg-teal-900/60"
            title="Generate a new deterministic shuffled sequence"
          >
            <Dices className="size-3" />
            Reseed
          </button>
        </div>
      </div>

      <section className="space-y-3 border-b border-gray-800 p-3">
        <SectionTitle icon={Circle}>Tunnel Geometry</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Slider size="sm" label="Sides" display={Math.round(config.sides)} value={config.sides} min={3} max={24} step={1} onChange={sides => update({
            sides,
            gifEvery: Math.min(config.gifEvery, sides),
            ringPatternOffset: Math.min(config.ringPatternOffset, sides - 1)
          })} />
          <Slider size="sm" label="Visible Rings" display={Math.round(config.ringCount)} value={config.ringCount} min={6} max={48} step={1} onChange={ringCount => update({ ringCount })} />
          <Slider size="sm" label="Radius" display={Math.round(config.radius)} value={config.radius} min={240} max={1800} step={20} onChange={radius => update({ radius })} />
          <Slider size="sm" label="Ring Length" display={Math.round(config.ringLength)} value={config.ringLength} min={120} max={1400} step={20} onChange={ringLength => update({ ringLength })} />
        </div>
        <Slider label="Pane Gap" display={`${Math.round(config.paneGap * 100)}%`} value={config.paneGap} min={0} max={0.35} step={0.01} onChange={paneGap => update({ paneGap })} />
      </section>

      <section className="space-y-3 border-b border-gray-800 p-3">
        <SectionTitle icon={Route}>Path & Travel</SectionTitle>
        <Slider label="Travel Speed" display={`${Math.round(config.speed)} u/s`} value={config.speed} min={-2400} max={2400} step={20} onChange={speed => update({ speed })} />
        <div className="grid grid-cols-2 gap-3">
          <Slider size="sm" label="Horizontal Bend" display={Math.round(config.bendX)} value={config.bendX} min={0} max={2600} step={20} onChange={bendX => update({ bendX })} />
          <Slider size="sm" label="Vertical Bend" display={Math.round(config.bendY)} value={config.bendY} min={0} max={2600} step={20} onChange={bendY => update({ bendY })} />
        </div>
        <Slider label="Bend Wavelength" display={Math.round(config.bendWavelength)} value={config.bendWavelength} min={2000} max={30000} step={200} onChange={bendWavelength => update({ bendWavelength })} />
        <Slider label="Twist per Ring" display={`${config.twistPerRing.toFixed(1)}°`} value={config.twistPerRing} min={-30} max={30} step={0.5} onChange={twistPerRing => update({ twistPerRing })} />
        <div className="pt-1">
          <MotionControl label="Velocity Pulse" config={config.motionSpeed} onChange={motionSpeed => update({ motionSpeed })} maxAmplitude={1400} stepAmplitude={20} />
          <MotionControl label="Horizontal Writhe" config={config.motionBendX} onChange={motionBendX => update({ motionBendX })} maxAmplitude={1200} stepAmplitude={20} />
          <MotionControl label="Vertical Writhe" config={config.motionBendY} onChange={motionBendY => update({ motionBendY })} maxAmplitude={1200} stepAmplitude={20} />
          <MotionControl label="Twist Pulse" config={config.motionTwist} onChange={motionTwist => update({ motionTwist })} maxAmplitude={30} stepAmplitude={0.5} />
        </div>
      </section>

      <section className="space-y-3 border-b border-gray-800 p-3">
        <SectionTitle icon={Camera}>Camera</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Slider size="sm" label="Field of View" display={`${Math.round(config.fov)}°`} value={config.fov} min={30} max={120} step={1} onChange={fov => update({ fov })} />
          <Slider size="sm" label="Look Ahead" display={Math.round(config.lookAhead)} value={config.lookAhead} min={200} max={4000} step={50} onChange={lookAhead => update({ lookAhead })} />
          <Slider size="sm" label="Offset X" display={Math.round(config.cameraOffsetX)} value={config.cameraOffsetX} min={-900} max={900} step={10} onChange={cameraOffsetX => update({ cameraOffsetX })} />
          <Slider size="sm" label="Offset Y" display={Math.round(config.cameraOffsetY)} value={config.cameraOffsetY} min={-900} max={900} step={10} onChange={cameraOffsetY => update({ cameraOffsetY })} />
        </div>
        <Slider label="Camera Roll" display={`${Math.round(config.cameraRoll)}°`} value={config.cameraRoll} min={-180} max={180} step={1} onChange={cameraRoll => update({ cameraRoll })} />
        <MotionControl label="Roll Drift" config={config.motionCameraRoll} onChange={motionCameraRoll => update({ motionCameraRoll })} maxAmplitude={180} stepAmplitude={1} />
      </section>

      <section className="space-y-3 border-b border-gray-800 p-3">
        <SectionTitle icon={ImageIcon}>Wallpaper Pattern</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Slider size="sm" label="GIF Every" display={`${Math.round(config.gifEvery)} pane${Math.round(config.gifEvery) === 1 ? '' : 's'}`} value={config.gifEvery} min={1} max={Math.max(1, config.sides)} step={1} onChange={gifEvery => update({ gifEvery })} />
          <Slider size="sm" label="Ring Offset" display={Math.round(config.ringPatternOffset)} value={config.ringPatternOffset} min={0} max={Math.max(0, config.sides - 1)} step={1} onChange={ringPatternOffset => update({ ringPatternOffset })} />
        </div>
        <Slider label="Ring Phase" display={`${Math.round(config.ringPhase * 100)}%`} value={config.ringPhase} min={0} max={1} step={0.01} onChange={ringPhase => update({ ringPhase })} />
        <Slider label="UV Scale" display={`${config.textureScale.toFixed(2)}×`} value={config.textureScale} min={1} max={4} step={0.05} onChange={textureScale => update({ textureScale })} />
        <div className="grid grid-cols-2 gap-3">
          <Slider size="sm" label="UV Offset X" display={config.textureOffsetX.toFixed(2)} value={config.textureOffsetX} min={-0.5} max={0.5} step={0.01} onChange={textureOffsetX => update({ textureOffsetX })} />
          <Slider size="sm" label="UV Offset Y" display={config.textureOffsetY.toFixed(2)} value={config.textureOffsetY} min={-0.5} max={0.5} step={0.01} onChange={textureOffsetY => update({ textureOffsetY })} />
        </div>
        <Select label="Unfilled Panes" value={config.nonGifFill} options={FILL_OPTIONS} onChange={nonGifFill => update({ nonGifFill })} />
        <div className="flex items-center justify-between rounded border border-gray-800 bg-gray-800/30 p-2">
          <div className="flex items-center gap-2">
            <Shuffle className="size-3.5 text-teal-400" />
            <div>
              <div className="text-[11px] font-semibold text-gray-300">Seeded Shuffle</div>
              <div className="text-[9px] text-gray-600">Ordered ring cycling when off</div>
            </div>
          </div>
          <Toggle checked={config.shuffle} onChange={shuffle => update({ shuffle })} title="Toggle seeded asset shuffle" />
        </div>
      </section>

      <section className="space-y-3 border-b border-gray-800 p-3">
        <SectionTitle icon={Palette}>Pane Palette</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {PALETTE_PRESETS.map(preset => (
            <button
              key={preset.name}
              type="button"
              onClick={() => update({ palette: [...preset.colors] })}
              className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-[9px] font-semibold text-gray-400 transition-colors hover:border-teal-700 hover:text-teal-200"
            >
              {preset.name}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {config.palette.map((color, index) => (
            <div key={`${index}-${color}`} className="flex items-center gap-2 rounded border border-gray-800 bg-gray-950/50 p-1.5">
              <input type="color" value={color} onChange={event => updatePalette(index, event.target.value)} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0" aria-label={`Palette color ${index + 1}`} />
              <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-gray-500">{color}</span>
              {config.palette.length > 2 && (
                <button type="button" onClick={() => update({ palette: config.palette.filter((_, itemIndex) => itemIndex !== index) })} className="text-gray-700 hover:text-red-300" aria-label={`Remove palette color ${index + 1}`}>
                  <X className="size-3" />
                </button>
              )}
            </div>
          ))}
        </div>
        {config.palette.length < 8 && (
          <button type="button" onClick={() => update({ palette: [...config.palette, '#ffffff'] })} className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-gray-700 py-1.5 text-[10px] text-gray-500 transition-colors hover:border-teal-800 hover:text-teal-300">
            <Plus className="size-3" /> Add color
          </button>
        )}
      </section>

      <section className="space-y-3 border-b border-gray-800 p-3">
        <div className="flex items-center justify-between">
          <SectionTitle icon={CloudFog}>Void & Fog</SectionTitle>
          <Toggle checked={config.fogEnabled} onChange={fogEnabled => update({ fogEnabled })} title="Toggle depth fog" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[10px] text-gray-400">
            <span className="mb-1 block">Void Color</span>
            <input type="color" value={config.voidColor} onChange={event => update({ voidColor: event.target.value })} className="h-7 w-full cursor-pointer rounded border border-gray-700 bg-gray-950 p-0.5" />
          </label>
          <label className="text-[10px] text-gray-400">
            <span className="mb-1 block">Fog Color</span>
            <input type="color" value={config.fogColor} onChange={event => update({ fogColor: event.target.value })} className="h-7 w-full cursor-pointer rounded border border-gray-700 bg-gray-950 p-0.5" />
          </label>
        </div>
        {config.fogEnabled && (
          <Slider label="Fog Density" display={config.fogDensity.toFixed(5)} value={config.fogDensity} min={0} max={0.0006} step={0.00001} onChange={fogDensity => update({ fogDensity })} />
        )}
      </section>

      <div className="px-3 pt-3 text-[9px] uppercase tracking-[0.18em] text-teal-800">
        Infinite surface · deterministic time
      </div>
      <MasterFxPanel />
    </div>
  );
}
