import { useStore } from '../../../store';
import MasterFxPanel from '../MasterFxPanel';

// Scene is a selection, not a section: the Inspector renders this in place
// of the tabbed per-subject view whenever nothing is selected (including a
// click on StackPanel's docked Scene row). Canvas Background and Master FX
// used to sit pinned above the layer list, permanently shrinking it; here
// they get the whole column, and Master FX's six modules finally have room
// to expand without fighting the list for height.
export default function SceneTab() {
  const canvasBg = useStore(s => s.canvasBg);
  const onUpdateCanvasBg = useStore(s => s.setCanvasBg);

  return (
    <div className="flex flex-col">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Canvas Background</label>
        <input
          type="color"
          value={canvasBg}
          onChange={(e) => onUpdateCanvasBg(e.target.value)}
          className="w-8 h-6 rounded cursor-pointer border-0 bg-gray-800 p-0"
        />
      </div>
      <MasterFxPanel />
    </div>
  );
}
