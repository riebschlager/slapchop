import { useState, ReactNode } from 'react';
import { Trash2, Copy, ChevronUp, ChevronDown, Eye, EyeOff, Download, Video, Loader2, Radio, PanelRightOpen } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useStore } from '../../store';
import Segmented, { SegmentedOption } from '../controls/Segmented';
import ResizeHandle from '../controls/ResizeHandle';
import { usePanelState } from '../../hooks/usePanelState';
import ExportModal from '../modals/ExportModal';
import LiveOutputModal from '../modals/LiveOutputModal';
import { ExportApi } from '../../hooks/useExport';
import { LiveOutputApi } from '../../hooks/useLiveOutput';
import { InspectorSubject } from './inspector/types';
import TransformTab from './inspector/TransformTab';
import TextureTab from './inspector/TextureTab';
import StyleTab from './inspector/StyleTab';
import SymmetryTab from './inspector/SymmetryTab';
import MotionTab from './inspector/MotionTab';
import SceneTab from './inspector/SceneTab';

const INSPECTOR_PANEL_DEFAULTS = { storageKey: 'slapchop:panel:inspector', defaultWidth: 336, minWidth: 260, maxWidth: 480, side: 'right' as const };

// The tab bar always has the same four positions for both selection kinds,
// so switching Symmetry/Tiled-GIF mode never moves what's under your
// cursor. 'primary' is Transform for a layer and Texture for a polygon —
// everything a polygon's own geometry needs is edited on canvas via its
// points, not sliders, so that slot holds its texture transform instead.
type InspectorTab = 'primary' | 'style' | 'symmetry' | 'motion';

export default function InspectorPanel({ exportApi, liveOutputApi }: { exportApi: ExportApi; liveOutputApi: LiveOutputApi }) {
  const appMode = useStore(s => s.appMode);
  const layers = useStore(s => s.layers);
  const selectedLayerId = useStore(s => s.selectedLayerId);
  const onUpdateLayer = useStore(s => s.updateLayer);
  const onDeleteLayer = useStore(s => s.deleteLayer);
  const onDuplicateLayer = useStore(s => s.duplicateLayer);
  const onMoveLayerUp = useStore(s => s.moveLayerUp);
  const onMoveLayerDown = useStore(s => s.moveLayerDown);
  const polygonLayers = useStore(s => s.polygonLayers);
  const selectedPolygonId = useStore(s => s.selectedPolygonId);
  const onUpdatePolygon = useStore(s => s.updatePolygon);
  const onDeletePolygon = useStore(s => s.deletePolygon);
  const onDuplicatePolygon = useStore(s => s.duplicatePolygon);
  const onMovePolygonUp = useStore(s => s.movePolygonUp);
  const onMovePolygonDown = useStore(s => s.movePolygonDown);

  const [tab, setTab] = useState<InspectorTab>('primary');

  const selectedLayer = layers.find(l => l.id === selectedLayerId);
  const selectedPolygon = polygonLayers.find(p => p.id === selectedPolygonId);

  const subject: InspectorSubject | null = appMode === 'symmetry'
    ? (selectedLayer ? { kind: 'layer', layer: selectedLayer, onChange: (updates) => onUpdateLayer(selectedLayer.id, updates) } : null)
    : (selectedPolygon ? { kind: 'polygon', polygon: selectedPolygon, onChange: (updates) => onUpdatePolygon(selectedPolygon.id, updates) } : null);

  const { liveOutputStreaming, liveOutputConnected, liveOutputBusy, showLiveOutputModal, setShowLiveOutputModal } = liveOutputApi;

  const tabOptions: SegmentedOption<InspectorTab>[] = [
    { value: 'primary', label: subject?.kind === 'polygon' ? 'Texture' : 'Transform' },
    { value: 'style', label: 'Style' },
    { value: 'symmetry', label: 'Symmetry' },
    { value: 'motion', label: 'Motion' }
  ];

  const { width, collapsed, toggleCollapsed, startResize } = usePanelState(INSPECTOR_PANEL_DEFAULTS);

  if (collapsed) {
    return (
      <div className="w-11 bg-gray-900 border-l border-gray-800 flex flex-col items-center h-screen shrink-0 pt-4">
        <button
          onClick={toggleCollapsed}
          className="p-1.5 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
          title="Expand Inspector panel"
        >
          <PanelRightOpen className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative bg-gray-900 border-l border-gray-800 flex flex-col h-screen text-gray-200 shrink-0" style={{ width }}>
      <ResizeHandle side="right" panelLabel="Inspector panel" onResizeStart={startResize} onCollapse={toggleCollapsed} />
      <div className="flex-1 overflow-y-auto min-h-0">
        {subject ? (
          <div className="p-3 flex flex-col">
            <SubjectHeader
              name={subject.kind === 'layer' ? subject.layer.name : subject.polygon.name}
              hidden={subject.kind === 'layer' ? subject.layer.hidden : subject.polygon.hidden}
              onRename={(name) => { if (subject.kind === 'layer') subject.onChange({ name }); else subject.onChange({ name }); }}
              onToggleHidden={() => {
                const hidden = !(subject.kind === 'layer' ? subject.layer.hidden : subject.polygon.hidden);
                if (subject.kind === 'layer') subject.onChange({ hidden }); else subject.onChange({ hidden });
              }}
              onDuplicate={() => subject.kind === 'layer' ? onDuplicateLayer(subject.layer.id) : onDuplicatePolygon(subject.polygon.id)}
              onMoveUp={() => subject.kind === 'layer' ? onMoveLayerUp(subject.layer.id) : onMovePolygonUp(subject.polygon.id)}
              onMoveDown={() => subject.kind === 'layer' ? onMoveLayerDown(subject.layer.id) : onMovePolygonDown(subject.polygon.id)}
              onDelete={() => subject.kind === 'layer' ? onDeleteLayer(subject.layer.id) : onDeletePolygon(subject.polygon.id)}
            />

            <Segmented
              label={subject.kind === 'layer' ? 'Layer properties' : 'Polygon properties'}
              className="mb-3 border-b border-gray-800 pb-2"
              value={tab}
              onChange={setTab}
              options={tabOptions}
            />

            <div>
              {tab === 'primary' && (
                subject.kind === 'layer'
                  ? <TransformTab layer={subject.layer} onChange={subject.onChange} />
                  : <TextureTab polygon={subject.polygon} onChange={subject.onChange} />
              )}
              {tab === 'style' && <StyleTab subject={subject} />}
              {tab === 'symmetry' && <SymmetryTab subject={subject} />}
              {tab === 'motion' && <MotionTab subject={subject} />}
            </div>
          </div>
        ) : (
          <SceneTab />
        )}
      </div>

      {/* Output dock: export and live-output triggers, always reachable regardless of selection. */}
      <div className="p-3 border-t border-gray-800 space-y-2 shrink-0">
        <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-1">Output</label>
        <button
          onClick={() => setShowLiveOutputModal(true)}
          className={cn(
            "w-full flex items-center justify-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-medium transition-colors",
            liveOutputStreaming
              ? "bg-emerald-950/90 hover:bg-emerald-900 text-emerald-200 border-emerald-600/80"
              : liveOutputConnected
                ? "bg-amber-950/90 hover:bg-amber-900 text-amber-200 border-amber-700/80"
                : "bg-gray-800 hover:bg-gray-700 text-gray-200 border-gray-700"
          )}
        >
          {liveOutputBusy
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Radio className="w-3.5 h-3.5" />}
          {liveOutputStreaming ? 'Live' : 'Live Output'}
        </button>
        <button
          onClick={exportApi.handleExportHighRes}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg text-xs font-medium transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Export Image
        </button>
        <button
          onClick={exportApi.openExportModal}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-indigo-600/20 transition-all"
        >
          <Video className="w-3.5 h-3.5" />
          Export Animation
        </button>
      </div>

      {showLiveOutputModal && <LiveOutputModal api={liveOutputApi} />}
      {exportApi.showExportModal && <ExportModal api={exportApi} />}
    </div>
  );
}

// Name field plus hide/duplicate/reorder/delete — identical markup for a
// layer or a polygon selection, so it's parameterized once here rather than
// duplicated per subject kind the way the tab content below it used to be.
function SubjectHeader({ name, hidden, onRename, onToggleHidden, onDuplicate, onMoveUp, onMoveDown, onDelete }: {
  name: string;
  hidden: boolean | undefined;
  onRename: (name: string) => void;
  onToggleHidden: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}): ReactNode {
  return (
    <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-800">
      <input
        type="text"
        value={name}
        onChange={(e) => onRename(e.target.value)}
        className="bg-transparent text-xs font-semibold text-gray-200 border-b border-transparent hover:border-gray-700 focus:border-indigo-500 focus:bg-gray-950 px-1 py-0.5 outline-none rounded truncate flex-1 mr-2"
        title="Click to rename layer"
      />
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={onToggleHidden}
          className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
          title={hidden ? "Show" : "Hide"}
        >
          {hidden ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={onDuplicate}
          className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
          title="Duplicate"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onMoveUp}
          className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
          title="Move Up in Order"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onMoveDown}
          className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
          title="Move Down in Order"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-red-400 transition-colors"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
