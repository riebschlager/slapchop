import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useStore } from '../../store';
import { getPlaybackTime } from '../../renderer/loop';
import { MAX_PAINT_DISTANCE, MAX_PAINT_DURATION, MAX_PAINT_POINTS, type PaintStroke } from './model';

export default function PaintStage() {
  const autopaint = useStore(s => s.paint.autopaint?.enabled);
  const assets = useStore(s => s.paint.assets);
  const selectedStroke = useStore(s => s.paint.strokes.find(stroke => stroke.id === s.selectedPaintStrokeId));
  const strokeCount = useStore(s => s.paint.strokes.length);
  const surface = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ stroke: PaintStroke; started: number; x: number; y: number; distance: number; pointer: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [notice, setNotice] = useState('');
  const stopTimer = () => { if (timer.current !== null) clearInterval(timer.current); timer.current = null; };
  const finish = (commit: boolean) => {
    stopTimer();
    const active = gesture.current;
    gesture.current = null;
    if (active && surface.current?.hasPointerCapture(active.pointer)) surface.current.releasePointerCapture(active.pointer);
    if (active && commit) {
      const store = useStore.getState();
      store.commitPaintStroke(active.stroke);
    } else useStore.getState().setPaintDraft(null);
  };
  const append = () => {
    const active = gesture.current;
    if (!active) return;
    const time = Math.min(MAX_PAINT_DURATION, (performance.now() - active.started) / 1000);
    const last = active.stroke.points.at(-1)!;
    const distance = Math.hypot(active.x - last.x, active.y - last.y);
    if (active.stroke.points.length >= MAX_PAINT_POINTS || active.distance + distance > MAX_PAINT_DISTANCE || time >= MAX_PAINT_DURATION) {
      finish(true); setNotice('Stroke saved at the path limit. Start another stroke to continue.'); return;
    }
    if (time - last.time < 1 / 30 && distance < 2) return;
    active.distance += distance;
    active.stroke.points.push({ x: active.x, y: active.y, time });
  };
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(-540, Math.min(540, (event.clientX - rect.left) / rect.width * 1080 - 540)),
      y: Math.max(-960, Math.min(960, (event.clientY - rect.top) / rect.height * 1920 - 960)) };
  };
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z')) {
        if (timer.current !== null) clearInterval(timer.current);
        timer.current = null;
        gesture.current = null;
        useStore.getState().setPaintDraft(null);
      }
    };
    window.addEventListener('keydown', cancel, true);
    return () => {
      window.removeEventListener('keydown', cancel, true);
      if (timer.current !== null) clearInterval(timer.current);
      gesture.current = null;
      useStore.getState().setPaintDraft(null);
    };
  }, []);
  return <div ref={surface} className={`absolute inset-0 touch-none ${selectedStroke ? 'cursor-default' : 'cursor-crosshair'}`}
    onMouseDown={e => e.stopPropagation()}
    onPointerDown={e => {
      if (e.button !== 0 || gesture.current) return;
      e.preventDefault(); e.stopPropagation();
      const store = useStore.getState();
      if (selectedStroke) { setNotice('Choose New stroke in the Stack to paint again.'); return; }
      const asset = store.paint.assets.find(a => a.id === store.paintAssetId && !a.retired) ?? store.paint.assets.find(a => !a.retired);
      if (!asset) { setNotice('Choose a GIF folder or add GIF files in the Stack.'); return; }
      if (store.paint.strokes.length >= 256) { setNotice('The painting has 256 strokes. Delete a stroke to make room.'); return; }
      const p = point(e);
      const stroke: PaintStroke = { ...store.paintTool, replay: false, id: crypto.randomUUID(), name: `Stroke ${store.paint.strokes.length + 1}`,
        assetId: asset.id, points: [{ ...p, time: 0 }], sourceOffset: getPlaybackTime() * store.paintTool.gifSpeed, seed: Math.floor(Math.random() * 100000), hidden: false };
      gesture.current = { stroke, started: performance.now(), ...p, distance: 0, pointer: e.pointerId };
      store.setPaintDraft(stroke);
      e.currentTarget.setPointerCapture(e.pointerId);
      timer.current = setInterval(append, 33);
      setNotice('');
    }}
    onPointerMove={e => {
      const active = gesture.current;
      if (!active || active.pointer !== e.pointerId) return;
      const p = point(e); active.x = p.x; active.y = p.y; append();
    }}
    onPointerUp={e => { if (gesture.current?.pointer === e.pointerId) { const p = point(e); gesture.current.x = p.x; gesture.current.y = p.y; append(); finish(true); } }}
    onPointerCancel={() => finish(false)} onLostPointerCapture={() => { if (gesture.current) finish(false); }}
  >
    {selectedStroke && <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="-540 -960 1080 1920" aria-label="Selected saved brush path">
      <polyline points={selectedStroke.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#28c76f" strokeWidth="2" strokeDasharray="8 6" vectorEffect="non-scaling-stroke" />
      <circle cx={selectedStroke.points[0].x} cy={selectedStroke.points[0].y} r="12" fill="#28c76f" />
    </svg>}
    {(!assets.some(a => !a.retired) || (!strokeCount && !autopaint) || notice) && <div className="pointer-events-none absolute inset-x-3 bottom-4 flex justify-center">
      <p role="status" className="max-w-full rounded-lg border border-ui-border bg-ui-canvas/95 px-3 py-2 text-center text-[10px] leading-relaxed text-ui-text-muted">
        {notice || (assets.some(a => !a.retired) ? autopaint ? 'Autopaint running · Dial in gestures in the Inspector · Drag to add a saved stroke' : 'Drag to paint frozen GIF frames · Esc cancels a stroke' : 'Choose a GIF folder in the Stack to start painting')}
      </p>
    </div>}
  </div>;
}
