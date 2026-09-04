import { useRef } from 'react';
import StackPanel from './panels/StackPanel';
import InspectorPanel from './panels/InspectorPanel';
import CanvasWorkspace from './CanvasWorkspace';
import { useExport } from '../hooks/useExport';
import { useLiveOutput } from '../hooks/useLiveOutput';
import WelcomeModal from './modals/WelcomeModal';

// Three columns: Stack (list) | Stage (canvas) | Inspector (selection detail
// + docked Output). The canvas element is created here, not inside
// CanvasWorkspace, because Live Output needs to capture the same <canvas>
// the Stage renders into while its trigger lives in the Inspector column —
// a sibling, not a descendant, of the Stage.
export default function AppShell() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveOutputApi = useLiveOutput(canvasRef);
  const exportApi = useExport({ liveOutputStreaming: liveOutputApi.liveOutputStreaming });

  return (
    <>
      <StackPanel />
      <CanvasWorkspace canvasRef={canvasRef} />
      <InspectorPanel exportApi={exportApi} liveOutputApi={liveOutputApi} />
      <WelcomeModal />
    </>
  );
}
