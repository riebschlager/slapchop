import ControlSection from '../../components/controls/ControlSection';
import Select from '../../components/controls/Select';
import Slider from '../../components/controls/Slider';
import Toggle from '../../components/controls/Toggle';
import MasterFxPanel from '../../components/panels/MasterFxPanel';
import { useStore } from '../../store';
import { getPlaybackTime } from '../../renderer/loop';
import type { PaintSettings } from './model';

export default function PaintInspector() {
  const paint = useStore(s => s.paint);
  const selected = useStore(s => s.selectedPaintStrokeId);
  const tool = useStore(s => s.paintTool);
  const assetId = useStore(s => s.paintAssetId);
  const background = useStore(s => s.canvasBg);
  const stroke = paint.strokes.find(s => s.id === selected);
  const settings = stroke ?? tool;
  const update = (patch: Partial<PaintSettings>) => {
    const store = useStore.getState();
    if (stroke) store.updatePaintStroke(stroke.id, patch);
    else store.updatePaintTool(patch);
    if (stroke && patch.replay === true && !paint.strokes.some(s => s.replay)) store.restartPaint(getPlaybackTime());
  };
  const slider = (key: { [K in keyof PaintSettings]: PaintSettings[K] extends number ? K : never }[keyof PaintSettings], label: string, min: number, max: number, step: number, log = false) =>
    <Slider size="sm" label={label} value={settings[key]} min={min} max={max} step={step}
      scale={log ? 'log' : 'linear'} onChange={value => update({ [key]: value })} />;
  const toggle = (key: 'replay' | 'constantSpeed', label: string) =>
    <div className="flex items-center justify-between text-[11px] text-ui-text-muted">{label}
      <Toggle title={label} checked={settings[key]} onChange={value => update({ [key]: value })} />
    </div>;
  const currentSource = stroke?.assetId ?? assetId ?? '';
  return <div className="pb-3">
    <div className="border-b border-ui-border px-3 py-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-ui-accent">{stroke ? 'Edit saved stroke' : 'Next stroke'}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ui-text">{stroke?.name ?? 'GIF paintbrush'}</p>
      <p className="mt-1 text-[10px] leading-relaxed text-ui-text-subtle">{stroke ? 'Edits rebuild this painting. Select New stroke to paint again.' : 'Drag on the stage. Each stamp captures and freezes a GIF frame.'}</p>
    </div>
    <ControlSection sectionKey="paint-brush" title="Brush & source">
      <Select label="GIF source" value={currentSource} options={[
        ...(!currentSource ? [{ value: '', label: 'Load or choose a GIF' }] : []),
        ...paint.assets.filter(a => !a.retired || a.id === currentSource).map(a => ({ value: a.id, label: a.name }))
      ]} onChange={id => stroke ? useStore.getState().updatePaintStroke(stroke.id, { assetId: id }) : useStore.getState().selectPaintAsset(id)} />
      <Select label="Brush pattern" value={settings.pattern} options={[
        { value: 'round', label: 'Round' }, { value: 'flat', label: 'Flat nib' }, { value: 'bristle', label: 'Bristles' },
        { value: 'dots', label: 'Stipple dots' }, { value: 'stripes', label: 'Stripes' }
      ]} onChange={pattern => update({ pattern })} />
      {slider('size', 'Brush size · px', 24, 600, 1)}
      {slider('spacing', 'Stamp spacing · brush widths', 0.1, 1, 0.01)}
      {slider('opacity', 'Stamp opacity', 0, 1, 0.01)}
      {slider('rotation', 'Brush rotation · °', -180, 180, 1)}
      {slider('scatter', 'Scatter', 0, 1, 0.01)}
    </ControlSection>
    <ControlSection sectionKey="paint-image" title="GIF inside the brush">
      {slider('imageZoom', 'Image zoom', 0.25, 4, 0.01)}
      {slider('imageRotation', 'Image rotation · °', -180, 180, 1)}
      {slider('gifSpeed', 'GIF playback speed', 0, 4, 0.001, true)}
      <p className="text-[10px] leading-relaxed text-ui-text-subtle">The whole GIF fits inside the stamp before masking. Zoom in to fill more of the brush. GIF speed is independent of brush travel.</p>
    </ControlSection>
    {stroke && <ControlSection sectionKey="paint-replay" title="Active brush">
      {toggle('replay', 'Continuously repaint this path')}
      <p className="text-[10px] leading-relaxed text-ui-text-subtle">Saved paths are static until activated. Deactivating restores the original hand-painted stamps. The first brush starts replay at zero; additional brushes join the current timeline. Restart clears accumulated replay.</p>
      {toggle('constantSpeed', 'Constant travel speed')}
      <Select label="Direction" value={settings.direction} options={[
        { value: 'forward', label: 'Forward' }, { value: 'reverse', label: 'Reverse' }, { value: 'ping-pong', label: 'Ping-pong' }
      ]} onChange={direction => update({ direction })} />
      {slider('speed', 'Brush travel speed', 0.1, 4, 0.001, true)}
      {slider('phase', 'Path phase', 0, 1, 0.01)}
      {slider('delay', 'Delay between passes · s', 0, 10, 0.1)}
      {slider('lifetime', 'Paint lifetime · s', 0, 60, 0.1)}
      <p className="text-[10px] leading-relaxed text-ui-text-subtle">Lifetime 0 accumulates paint forever. Higher values fade each stamp over that many seconds. Forward and reverse lift the brush between passes; ping-pong retraces it.</p>
      <button type="button" className="w-full rounded border border-ui-border px-2 py-2 text-xs text-ui-text-muted hover:text-ui-text focus-visible:ring-2 focus-visible:ring-ui-accent" onClick={() => useStore.getState().restartPaint(getPlaybackTime())}>Restart all paint replay</button>
      <p className="text-[10px] leading-relaxed text-ui-text-subtle">Animation exports start from replay time zero. Original hand-painted strokes are already present.</p>
    </ControlSection>}
    <ControlSection sectionKey="paint-canvas" title="Canvas">
      <label className="flex items-center justify-between text-[11px] text-ui-text-muted">Background
        <input type="color" value={background} onChange={e => useStore.getState().setCanvasBg(e.target.value)} className="h-7 w-12 rounded border border-ui-border bg-ui-canvas" />
      </label>
    </ControlSection>
    <MasterFxPanel />
  </div>;
}
