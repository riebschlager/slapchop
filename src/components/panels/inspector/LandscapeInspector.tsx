import { Camera, Dices, Grid3X3, Image as ImageIcon, Mountain, Play, Sun, Waves } from 'lucide-react';
import { formatRate } from '../../../lib/sliderScale';
import { useStore } from '../../../store';
import MotionControl from '../../controls/MotionControl';
import Slider from '../../controls/Slider';
import Toggle from '../../controls/Toggle';
import MasterFxPanel from '../MasterFxPanel';

function SectionTitle({ icon: Icon, children }: { icon: typeof Mountain; children: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
      <Icon className="size-3 text-orange-400" />
      {children}
    </div>
  );
}

export default function LandscapeInspector() {
  const config = useStore(state => state.landscape);
  const terrainAssets = useStore(state => state.landscapeTerrainAssets);
  const skySources = useStore(state => state.landscapeSkySources);
  const selectedSkySourceId = useStore(state => state.selectedLandscapeSkySourceId);
  const update = useStore(state => state.updateLandscape);
  const updateSkySource = useStore(state => state.updateLandscapeSkySource);
  const reseed = useStore(state => state.reseedLandscape);
  const selectedSkySource = skySources.find(source => source.id === selectedSkySourceId);

  return (
    <div className="flex flex-col">
      <div className="border-b border-orange-950/80 bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.18),transparent_62%)] px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-orange-300">
              <Mountain className="size-3.5" />
              <h2 className="text-xs font-bold uppercase tracking-[0.16em]">Noise Horizon</h2>
            </div>
            <p className="mt-1 text-[10px] text-gray-500">{terrainAssets.length} terrain GIFs · {skySources.length} sky folders</p>
          </div>
          <button type="button" onClick={reseed} className="flex items-center gap-1 rounded border border-orange-800/60 bg-orange-950/50 px-2 py-1 text-[10px] font-semibold text-orange-200 transition-colors hover:border-orange-600 hover:bg-orange-900/50">
            <Dices className="size-3" /> Reseed
          </button>
        </div>
      </div>

      <section className="space-y-3 border-b border-gray-800 p-3">
        <SectionTitle icon={Grid3X3}>Terrain Mesh</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Slider size="sm" label="Columns" display={Math.round(config.meshColumns)} value={config.meshColumns} min={4} max={28} step={1} onChange={meshColumns => update({ meshColumns })} />
          <Slider size="sm" label="Depth Rows" display={Math.round(config.meshRows)} value={config.meshRows} min={8} max={56} step={1} onChange={meshRows => update({ meshRows })} />
          <Slider size="sm" label="Width" display={Math.round(config.terrainWidth)} value={config.terrainWidth} min={1800} max={10000} step={100} onChange={terrainWidth => update({ terrainWidth })} />
          <Slider size="sm" label="Depth" display={Math.round(config.terrainDepth)} value={config.terrainDepth} min={4000} max={24000} step={200} onChange={terrainDepth => update({ terrainDepth })} />
        </div>
        <Slider label="Relief" display={Math.round(config.heightScale)} value={config.heightScale} min={0} max={3200} step={25} onChange={heightScale => update({ heightScale })} />
        <Slider label="Noise Scale" display={config.noiseScale.toFixed(5)} value={config.noiseScale} min={0.0001} max={0.004} step={0.00005} onChange={noiseScale => update({ noiseScale })} />
        <div className="grid grid-cols-2 gap-3">
          <Slider size="sm" label="Octaves" display={Math.round(config.noiseOctaves)} value={config.noiseOctaves} min={1} max={6} step={1} onChange={noiseOctaves => update({ noiseOctaves })} />
          <Slider size="sm" label="Ridges" display={`${Math.round(config.ridgeAmount * 100)}%`} value={config.ridgeAmount} min={0} max={1} step={0.01} onChange={ridgeAmount => update({ ridgeAmount })} />
        </div>
        <Slider label="Plateaus" display={`${Math.round(config.plateauAmount * 100)}%`} value={config.plateauAmount} min={0} max={1} step={0.01} onChange={plateauAmount => update({ plateauAmount })} />
        <MotionControl label="Relief Pulse" config={config.motionHeightScale} onChange={motionHeightScale => update({ motionHeightScale })} maxAmplitude={1600} stepAmplitude={25} />
        <div className="flex items-center justify-between rounded border border-gray-800 bg-gray-800/30 p-2">
          <div>
            <div className="text-[11px] font-semibold text-gray-300">Wire Grid</div>
            <div className="text-[9px] text-gray-600">Trace the displaced topology</div>
          </div>
          <div className="flex items-center gap-2">
            <input type="color" value={config.wireframeColor} onChange={event => update({ wireframeColor: event.target.value })} className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent p-0" aria-label="Wire grid color" />
            <Toggle checked={config.wireframe} onChange={wireframe => update({ wireframe })} title="Toggle wire grid" />
          </div>
        </div>
      </section>

      <section className="space-y-3 border-b border-gray-800 p-3">
        <SectionTitle icon={ImageIcon}>Terrain Mapping</SectionTitle>
        <Slider label="Tile Crop" display={`${config.terrainTextureScale.toFixed(2)}×`} value={config.terrainTextureScale} min={0.5} max={3} step={0.01} onChange={terrainTextureScale => update({ terrainTextureScale })} />
        <div className="grid grid-cols-2 gap-3">
          <Slider size="sm" label="Offset X" display={config.terrainTextureOffsetX.toFixed(2)} value={config.terrainTextureOffsetX} min={-1} max={1} step={0.01} onChange={terrainTextureOffsetX => update({ terrainTextureOffsetX })} />
          <Slider size="sm" label="Offset Y" display={config.terrainTextureOffsetY.toFixed(2)} value={config.terrainTextureOffsetY} min={-1} max={1} step={0.01} onChange={terrainTextureOffsetY => update({ terrainTextureOffsetY })} />
        </div>
        <Slider label="GIF Speed" display={`${config.terrainGifSpeed.toFixed(2)}×`} value={config.terrainGifSpeed} min={0} max={3} step={0.01} scale="log" minPositive={0.05} onChange={terrainGifSpeed => update({ terrainGifSpeed })} />
        <div className="flex items-center justify-between rounded border border-gray-800 bg-gray-800/30 p-2">
          <div className="text-[11px] font-semibold text-gray-300">Seeded Shuffle</div>
          <Toggle checked={config.terrainShuffle} onChange={terrainShuffle => update({ terrainShuffle })} title="Toggle terrain source shuffle" />
        </div>
      </section>

      <section className="space-y-3 border-b border-gray-800 p-3">
        <SectionTitle icon={Camera}>Flight Camera</SectionTitle>
        <Slider label="Flight Speed" display={Math.round(config.flightSpeed)} value={config.flightSpeed} min={0} max={2600} step={10} scale="log" minPositive={1} onChange={flightSpeed => update({ flightSpeed })} />
        <div className="grid grid-cols-2 gap-3">
          <Slider size="sm" label="Height" display={Math.round(config.cameraHeight)} value={config.cameraHeight} min={120} max={3200} step={20} onChange={cameraHeight => update({ cameraHeight })} />
          <Slider size="sm" label="Field of View" display={`${Math.round(config.fov)}°`} value={config.fov} min={30} max={110} step={1} onChange={fov => update({ fov })} />
          <Slider size="sm" label="Track X" display={Math.round(config.cameraX)} value={config.cameraX} min={-1800} max={1800} step={20} onChange={cameraX => update({ cameraX })} />
          <Slider size="sm" label="Look Ahead" display={Math.round(config.lookAhead)} value={config.lookAhead} min={500} max={8000} step={50} onChange={lookAhead => update({ lookAhead })} />
        </div>
        <div className="pt-1">
          <MotionControl label="Velocity Pulse" config={config.motionFlightSpeed} onChange={motionFlightSpeed => update({ motionFlightSpeed })} maxAmplitude={1300} stepAmplitude={10} />
          <MotionControl label="Camera Sway" config={config.motionCameraX} onChange={motionCameraX => update({ motionCameraX })} maxAmplitude={1200} stepAmplitude={20} />
          <MotionControl label="Altitude Float" config={config.motionCameraHeight} onChange={motionCameraHeight => update({ motionCameraHeight })} maxAmplitude={1600} stepAmplitude={20} />
          <MotionControl label="Look-Ahead Drift" config={config.motionLookAhead} onChange={motionLookAhead => update({ motionLookAhead })} maxAmplitude={4000} stepAmplitude={50} />
          <MotionControl label="Lens Breathing" config={config.motionFov} onChange={motionFov => update({ motionFov })} maxAmplitude={40} stepAmplitude={1} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[10px] text-gray-400"><span className="mb-1 block">Fog</span><input type="color" value={config.fogColor} onChange={event => update({ fogColor: event.target.value })} className="h-7 w-full cursor-pointer rounded border border-gray-700 bg-gray-950 p-0.5" /></label>
          <Slider size="sm" label="Density" display={config.fogDensity.toFixed(5)} value={config.fogDensity} min={0} max={0.0006} step={0.00001} onChange={fogDensity => update({ fogDensity })} />
        </div>
      </section>

      <section className="space-y-3 border-b border-gray-800 p-3">
        <SectionTitle icon={Sun}>Concentric Sky</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Slider size="sm" label="Sun X" display={Math.round(config.skyCenterX)} value={config.skyCenterX} min={-540} max={540} step={5} onChange={skyCenterX => update({ skyCenterX })} />
          <Slider size="sm" label="Sun Y" display={Math.round(config.skyCenterY)} value={config.skyCenterY} min={-960} max={960} step={5} onChange={skyCenterY => update({ skyCenterY })} />
          <Slider size="sm" label="Circles" display={Math.round(config.skyCircleCount)} value={config.skyCircleCount} min={1} max={18} step={1} onChange={skyCircleCount => update({ skyCircleCount })} />
          <Slider size="sm" label="Ring Width" display={Math.round(config.skyRingWidth)} value={config.skyRingWidth} min={40} max={420} step={5} onChange={skyRingWidth => update({ skyRingWidth })} />
        </div>
        <Slider label="Ring Gap" display={Math.round(config.skyRingGap)} value={config.skyRingGap} min={0} max={80} step={1} onChange={skyRingGap => update({ skyRingGap })} />
        <div className="pt-1">
          <MotionControl label="Sun Drift X" config={config.motionSkyCenterX} onChange={motionSkyCenterX => update({ motionSkyCenterX })} maxAmplitude={540} stepAmplitude={5} />
          <MotionControl label="Sun Drift Y" config={config.motionSkyCenterY} onChange={motionSkyCenterY => update({ motionSkyCenterY })} maxAmplitude={960} stepAmplitude={5} />
          <MotionControl label="Ring Breathing" config={config.motionSkyRingWidth} onChange={motionSkyRingWidth => update({ motionSkyRingWidth })} maxAmplitude={210} stepAmplitude={5} />
        </div>
        <label className="text-[10px] text-gray-400"><span className="mb-1 block">Sky Ground</span><input type="color" value={config.skyBackgroundColor} onChange={event => update({ skyBackgroundColor: event.target.value })} className="h-7 w-full cursor-pointer rounded border border-gray-700 bg-gray-950 p-0.5" /></label>
      </section>

      {selectedSkySource && (
        <section className="space-y-3 border-b border-orange-950/70 bg-orange-950/10 p-3">
          <SectionTitle icon={Waves}>Selected Sky Folder</SectionTitle>
          <div className="text-[11px] font-semibold text-orange-200">{selectedSkySource.name}</div>
          <div className="text-[9px] uppercase tracking-wider text-orange-800">{selectedSkySource.assets.length} GIFs · ring assignment cycles in stack order</div>
          <Slider label="Tile Size" display={`${selectedSkySource.textureScale.toFixed(2)}×`} value={selectedSkySource.textureScale} min={0.35} max={3} step={0.01} onChange={textureScale => updateSkySource(selectedSkySource.id, { textureScale })} />
          <div className="grid grid-cols-2 gap-3">
            <Slider size="sm" label="Offset X" display={selectedSkySource.textureOffsetX.toFixed(2)} value={selectedSkySource.textureOffsetX} min={-2} max={2} step={0.01} onChange={textureOffsetX => updateSkySource(selectedSkySource.id, { textureOffsetX })} />
            <Slider size="sm" label="Offset Y" display={selectedSkySource.textureOffsetY.toFixed(2)} value={selectedSkySource.textureOffsetY} min={-2} max={2} step={0.01} onChange={textureOffsetY => updateSkySource(selectedSkySource.id, { textureOffsetY })} />
          </div>
          <Slider label="Rotation" display={`${Math.round(selectedSkySource.textureRotation)}°`} value={selectedSkySource.textureRotation} min={-180} max={180} step={1} onChange={textureRotation => updateSkySource(selectedSkySource.id, { textureRotation })} />
          <Slider label="GIF Speed" display={`${formatRate(selectedSkySource.gifSpeed)}×`} value={selectedSkySource.gifSpeed} min={0} max={3} step={0.001} scale="log" minPositive={0.05} onChange={gifSpeed => updateSkySource(selectedSkySource.id, { gifSpeed })} />
          <div className="pt-1">
            <MotionControl label="Tile Size Pulse" config={selectedSkySource.motionTextureScale} onChange={motionTextureScale => updateSkySource(selectedSkySource.id, { motionTextureScale })} maxAmplitude={1.5} stepAmplitude={0.05} />
            <MotionControl label="Tile Drift X" config={selectedSkySource.motionTextureOffsetX} onChange={motionTextureOffsetX => updateSkySource(selectedSkySource.id, { motionTextureOffsetX })} maxAmplitude={2} stepAmplitude={0.05} />
            <MotionControl label="Tile Drift Y" config={selectedSkySource.motionTextureOffsetY} onChange={motionTextureOffsetY => updateSkySource(selectedSkySource.id, { motionTextureOffsetY })} maxAmplitude={2} stepAmplitude={0.05} />
            <MotionControl label="Tile Spin" config={selectedSkySource.motionTextureRotation} onChange={motionTextureRotation => updateSkySource(selectedSkySource.id, { motionTextureRotation })} maxAmplitude={180} stepAmplitude={1} />
          </div>
        </section>
      )}

      <div className="px-3 pt-3 text-[9px] uppercase tracking-[0.18em] text-orange-900"><Play className="mr-1 inline size-2.5" />Frame-exact flyover · folder-mapped horizon</div>
      <MasterFxPanel />
    </div>
  );
}
