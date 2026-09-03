import { useStore } from '../../../store';
import { ProjectionMode } from '../../../types';
import Select, { SelectOption } from '../../controls/Select';
import Slider from '../../controls/Slider';
import MotionControl from '../../controls/MotionControl';
import MasterFxPanel from '../MasterFxPanel';

const PROJECTION_OPTIONS: SelectOption<ProjectionMode>[] = [
  { value: 'perspective', label: 'Perspective' },
  { value: 'orthographic', label: 'Orthographic' },
];

// Scene is a selection, not a section: the Inspector renders this in place
// of the tabbed per-subject view whenever nothing is selected (including a
// click on StackPanel's docked Scene row). Canvas Background and Master FX
// used to sit pinned above the layer list, permanently shrinking it; here
// they get the whole column, and Master FX's six modules finally have room
// to expand without fighting the list for height.
export default function SceneTab() {
  const appMode = useStore(s => s.appMode);
  const canvasBg = useStore(s => s.canvasBg);
  const onUpdateCanvasBg = useStore(s => s.setCanvasBg);
  const camera3d = useStore(s => s.camera3d);
  const onUpdateCamera3d = useStore(s => s.updateCamera3d);

  return (
    <div className="flex flex-col">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <label className="text-xs font-semibold text-ui-text-muted uppercase tracking-wider">Canvas Background</label>
        <input
          type="color"
          value={canvasBg}
          onChange={(e) => onUpdateCanvasBg(e.target.value)}
          className="w-8 h-6 rounded cursor-pointer border-0 bg-ui-surface p-0"
        />
      </div>

      {/* Camera3dConfig is document-wide (shared by every mesh), not a
          per-mesh field, so it lives here alongside Canvas Background and
          Master FX rather than in one of the per-mesh 3D inspector tabs —
          it stays reachable via the Scene row even with nothing selected. */}
      {appMode === '3d' && (
        <div className="px-3 pb-3 space-y-3 border-b border-ui-border">
          <label className="text-xs font-semibold text-ui-text-muted uppercase tracking-wider block">Camera</label>
          <Select
            label="Projection"
            value={camera3d.projection}
            options={PROJECTION_OPTIONS}
            onChange={(projection) => onUpdateCamera3d({ projection })}
          />
          {camera3d.projection === 'perspective' && (
            <Slider label="Field of View" display={`${Math.round(camera3d.fov)}°`} value={camera3d.fov} min={10} max={120} step={1} onChange={(fov) => onUpdateCamera3d({ fov })} />
          )}
          <Slider label="Distance" display={`${Math.round(camera3d.distance)}px`} value={camera3d.distance} min={100} max={6000} step={10} onChange={(distance) => onUpdateCamera3d({ distance })} />
          <div className="grid grid-cols-3 gap-2">
            <Slider size="sm" label="Pitch" display={`${Math.round(camera3d.pitch)}°`} value={camera3d.pitch} min={-90} max={90} step={1} onChange={(pitch) => onUpdateCamera3d({ pitch })} />
            <Slider size="sm" label="Yaw" display={`${Math.round(camera3d.yaw)}°`} value={camera3d.yaw} min={-180} max={180} step={1} onChange={(yaw) => onUpdateCamera3d({ yaw })} />
            <Slider size="sm" label="Roll" display={`${Math.round(camera3d.roll)}°`} value={camera3d.roll} min={-180} max={180} step={1} onChange={(roll) => onUpdateCamera3d({ roll })} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Slider size="sm" label="Target X" value={camera3d.targetX} min={-1000} max={1000} step={5} onChange={(targetX) => onUpdateCamera3d({ targetX })} />
            <Slider size="sm" label="Target Y" value={camera3d.targetY} min={-1000} max={1000} step={5} onChange={(targetY) => onUpdateCamera3d({ targetY })} />
            <Slider size="sm" label="Target Z" value={camera3d.targetZ} min={-1000} max={1000} step={5} onChange={(targetZ) => onUpdateCamera3d({ targetZ })} />
          </div>
          <div className="pt-1 space-y-2">
            <MotionControl label="Distance Wobble" config={camera3d.motionDistance} onChange={c => onUpdateCamera3d({ motionDistance: c })} maxAmplitude={1000} stepAmplitude={10} />
            <MotionControl label="Pitch Wobble" config={camera3d.motionPitch} onChange={c => onUpdateCamera3d({ motionPitch: c })} maxAmplitude={45} stepAmplitude={1} />
            <MotionControl label="Yaw Wobble" config={camera3d.motionYaw} onChange={c => onUpdateCamera3d({ motionYaw: c })} maxAmplitude={180} stepAmplitude={1} />
          </div>
        </div>
      )}

      <MasterFxPanel />
    </div>
  );
}
