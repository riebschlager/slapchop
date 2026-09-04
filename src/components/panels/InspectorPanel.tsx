import { useState } from 'react';
import { Download, Video, Loader2, Radio, PanelRightOpen, Github } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useStore } from '../../store';
import Segmented, { SegmentedOption } from '../controls/Segmented';
import ResizeHandle from '../controls/ResizeHandle';
import { usePanelState } from '../../hooks/usePanelState';
import ExportModal from '../modals/ExportModal';
import LiveOutputModal from '../modals/LiveOutputModal';
import { ExportApi } from '../../hooks/useExport';
import { LiveOutputApi } from '../../hooks/useLiveOutput';
import SceneTab from './inspector/SceneTab';
import SubjectHeader from './inspector/SubjectHeader';
import SymmetryModeInspector from './inspector/symmetry/SymmetryModeInspector';
import PolygonModeInspector from './inspector/polygon/PolygonModeInspector';
import Transform3dTab from './inspector/Transform3dTab';
import Geometry3dTab from './inspector/Geometry3dTab';
import Texture3dTab from './inspector/Texture3dTab';
import Deform3dTab from './inspector/Deform3dTab';
import Symmetry3dTab from './inspector/Symmetry3dTab';
import FlythroughInspector from './inspector/FlythroughInspector';
import TunnelInspector from './inspector/TunnelInspector';
import GifVoronoiInspector from './inspector/GifVoronoiInspector';
import LandscapeInspector from './inspector/LandscapeInspector';

const INSPECTOR_PANEL_DEFAULTS = { storageKey: 'slapchop:panel:inspector', defaultWidth: 336, minWidth: 260, maxWidth: 480, side: 'right' as const };

// 3D retains its established dedicated tab set. The two 2D modes now own
// their inspector composition in separate components below this shell.
type Mesh3dTab = 'transform' | 'geometry' | 'texture' | 'deform' | 'symmetry';

export default function InspectorPanel({ exportApi, liveOutputApi }: { exportApi: ExportApi; liveOutputApi: LiveOutputApi }) {
  const appMode = useStore(s => s.appMode);
  const mesh3dLayers = useStore(s => s.mesh3dLayers);
  const selectedMesh3dId = useStore(s => s.selectedMesh3dId);
  const onUpdateMesh3d = useStore(s => s.updateMesh3d);
  const onDeleteMesh3d = useStore(s => s.deleteMesh3d);
  const onDuplicateMesh3d = useStore(s => s.duplicateMesh3d);
  const onMoveMesh3dUp = useStore(s => s.moveMesh3dUp);
  const onMoveMesh3dDown = useStore(s => s.moveMesh3dDown);
  const onUploadMesh3dTexture = useStore(s => s.uploadMesh3dTexture);

  const [mesh3dTab, setMesh3dTab] = useState<Mesh3dTab>('transform');

  const selectedMesh = mesh3dLayers.find(m => m.id === selectedMesh3dId);

  const { liveOutputStreaming, liveOutputConnected, liveOutputBusy, showLiveOutputModal, setShowLiveOutputModal } = liveOutputApi;

  const mesh3dTabOptions: SegmentedOption<Mesh3dTab>[] = [
    { value: 'transform', label: 'Transform' },
    { value: 'geometry', label: 'Geometry' },
    { value: 'texture', label: 'Texture' },
    { value: 'deform', label: 'Deform' },
    { value: 'symmetry', label: 'Symmetry' }
  ];

  const { width, collapsed, toggleCollapsed, startResize } = usePanelState(INSPECTOR_PANEL_DEFAULTS);

  if (collapsed) {
    return (
      <div className="w-11 bg-ui-panel border-l border-ui-border flex flex-col items-center h-screen shrink-0 pt-4">
        <button
          onClick={toggleCollapsed}
          className="p-1.5 hover:bg-ui-surface rounded text-ui-text-muted hover:text-ui-text transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
          title="Expand Inspector panel"
        >
          <PanelRightOpen className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative bg-ui-panel border-l border-ui-border flex flex-col h-screen text-ui-text shrink-0" style={{ width }}>
      <ResizeHandle side="right" panelLabel="Inspector panel" onResizeStart={startResize} onCollapse={toggleCollapsed} />
      <div className="flex-1 overflow-y-auto min-h-0">
        {appMode === 'symmetry' ? (
          <SymmetryModeInspector />
        ) : appMode === 'polygon' ? (
          <PolygonModeInspector />
        ) : appMode === 'flythrough' ? (
          <FlythroughInspector />
        ) : appMode === 'tunnel' ? (
          <TunnelInspector />
        ) : appMode === 'gif-voronoi' ? (
          <GifVoronoiInspector />
        ) : appMode === 'landscape' ? (
          <LandscapeInspector />
        ) : (
          selectedMesh ? (
            <div className="p-3 flex flex-col">
              <SubjectHeader
                name={selectedMesh.name}
                hidden={selectedMesh.hidden}
                onRename={(name) => onUpdateMesh3d(selectedMesh.id, { name })}
                onToggleHidden={() => onUpdateMesh3d(selectedMesh.id, { hidden: !selectedMesh.hidden })}
                onDuplicate={() => onDuplicateMesh3d(selectedMesh.id)}
                onMoveUp={() => onMoveMesh3dUp(selectedMesh.id)}
                onMoveDown={() => onMoveMesh3dDown(selectedMesh.id)}
                onDelete={() => onDeleteMesh3d(selectedMesh.id)}
              />

              <Segmented
                label="Mesh properties"
                className="mb-3 border-b border-ui-border pb-2"
                value={mesh3dTab}
                onChange={setMesh3dTab}
                options={mesh3dTabOptions}
              />

              <div>
                {mesh3dTab === 'transform' && <Transform3dTab mesh={selectedMesh} onChange={(u) => onUpdateMesh3d(selectedMesh.id, u)} />}
                {mesh3dTab === 'geometry' && <Geometry3dTab mesh={selectedMesh} onChange={(u) => onUpdateMesh3d(selectedMesh.id, u)} />}
                {mesh3dTab === 'texture' && <Texture3dTab mesh={selectedMesh} onChange={(u) => onUpdateMesh3d(selectedMesh.id, u)} onUploadTexture={onUploadMesh3dTexture} />}
                {mesh3dTab === 'deform' && <Deform3dTab mesh={selectedMesh} onChange={(u) => onUpdateMesh3d(selectedMesh.id, u)} />}
                {mesh3dTab === 'symmetry' && <Symmetry3dTab mesh={selectedMesh} onChange={(u) => onUpdateMesh3d(selectedMesh.id, u)} />}
              </div>
            </div>
          ) : (
            <SceneTab />
          )
        )}
      </div>

      {/* Output dock: export and live-output triggers, always reachable regardless of selection. */}
      <div className="p-3 border-t border-ui-border space-y-2 shrink-0">
        <label className="text-[10px] font-semibold text-ui-text-muted uppercase tracking-wider block mb-1">Output</label>
        <button
          onClick={() => setShowLiveOutputModal(true)}
          className={cn(
            "w-full flex items-center justify-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-medium transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent focus-visible:ring-offset-1 focus-visible:ring-offset-ui-panel",
            liveOutputStreaming
              ? "bg-ui-accent/15 hover:bg-ui-accent/25 text-ui-accent border-ui-accent"
              : liveOutputConnected
                ? "bg-amber-950/90 hover:bg-amber-900 text-amber-200 border-amber-700/80"
                : "bg-ui-surface hover:bg-ui-surface-raised text-ui-text border-ui-border"
          )}
        >
          {liveOutputBusy
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Radio className="w-3.5 h-3.5" />}
          {liveOutputStreaming ? 'Live' : 'Live Output'}
        </button>
        <button
          onClick={exportApi.handleExportHighRes}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-ui-surface hover:bg-ui-surface-raised text-ui-text border border-ui-border rounded-lg text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent focus-visible:ring-offset-1 focus-visible:ring-offset-ui-panel"
        >
          <Download className="w-3.5 h-3.5" />
          Export Image
        </button>
        <button
          onClick={exportApi.openExportModal}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-ui-accent hover:bg-ui-accent-hover text-ui-accent-contrast rounded-lg text-xs font-semibold shadow-lg shadow-ui-accent/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ui-panel"
        >
          <Video className="w-3.5 h-3.5" />
          Export Animation
        </button>
        <a
          href="https://github.com/riebschlager/slapchop"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-ui-text-subtle hover:text-ui-text border border-ui-border rounded-lg text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent focus-visible:ring-offset-1 focus-visible:ring-offset-ui-panel"
        >
          <Github className="w-3.5 h-3.5" />
          View Source
        </a>
      </div>

      {showLiveOutputModal && <LiveOutputModal api={liveOutputApi} />}
      {exportApi.showExportModal && <ExportModal api={exportApi} />}
    </div>
  );
}
