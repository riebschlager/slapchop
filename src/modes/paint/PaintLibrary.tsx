import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Brush, Eye, EyeOff, FolderOpen, Plus, Trash2, X } from 'lucide-react';
import ControlSection from '../../components/controls/ControlSection';
import { isNative, pickGifFiles, pickGifFolder } from '../../lib/native';
import { cn } from '../../lib/utils';
import { useStore } from '../../store';

const button = 'rounded border border-ui-border px-2 py-2 text-xs text-ui-text-muted hover:border-ui-accent hover:text-ui-text focus-visible:ring-2 focus-visible:ring-ui-accent disabled:opacity-40';
const iconButton = 'rounded p-1 text-ui-text-subtle hover:text-ui-text focus-visible:ring-2 focus-visible:ring-ui-accent disabled:opacity-25';
export default function PaintLibrary() {
  const paint = useStore(s => s.paint);
  const assetId = useStore(s => s.paintAssetId);
  const selected = useStore(s => s.paint.strokes.some(stroke => stroke.id === s.selectedPaintStrokeId) ? s.selectedPaintStrokeId : null);
  const folder = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async (items: File[], replace: boolean) => {
    if (!items.length) return;
    setBusy(true); setError(null);
    try { await useStore.getState().loadPaintAssets(items, replace); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load GIF Paint sources.'); }
    finally { setBusy(false); }
  };
  const choose = async (directory: boolean) => {
    if (!isNative()) {
      const input = directory ? folder.current : files.current;
      if (directory) input?.setAttribute('webkitdirectory', '');
      input?.click(); return;
    }
    try {
      const items = await (directory ? pickGifFolder() : pickGifFiles());
      if (items) await load(items, directory);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open the GIF picker.'); }
  };
  return <div className="min-h-0 overflow-y-auto pb-3">
    <ControlSection sectionKey="paint-library" title="GIF paint sources">
      <button type="button" disabled={busy} className={`${button} flex w-full items-center gap-2`} onClick={() => void choose(true)}><FolderOpen className="size-4 text-ui-accent" />{busy ? 'Decoding GIFs…' : 'Choose GIF folder'}</button>
      <button type="button" disabled={busy} className={`${button} flex w-full items-center gap-2`} onClick={() => void choose(false)}><Plus className="size-4" />Add GIF files</button>
      <input ref={folder} type="file" multiple accept="image/gif,.gif" className="hidden" onChange={e => { void load(Array.from(e.target.files ?? []), true); e.target.value = ''; }} />
      <input ref={files} type="file" multiple accept="image/gif,.gif" className="hidden" onChange={e => { void load(Array.from(e.target.files ?? []), false); e.target.value = ''; }} />
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <p className="text-[10px] leading-relaxed text-ui-text-subtle">Choose a source, then paint on the stage. Replacing the folder preserves GIFs used by saved strokes.</p>
      {paint.assets.filter(a => !a.retired).map(asset => <div key={asset.id} className={cn('flex items-center gap-2 rounded border p-1.5', assetId === asset.id ? 'border-ui-accent bg-ui-accent/10' : 'border-ui-border bg-ui-surface')}>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:ring-2 focus-visible:ring-ui-accent" aria-pressed={assetId === asset.id} onClick={() => useStore.getState().selectPaintAsset(asset.id)}>
          <img src={asset.src} alt="" className="size-9 rounded object-cover" />
          <span className="truncate text-[11px] text-ui-text-muted" title={asset.name}>{asset.name}</span>
        </button>
        <button type="button" disabled={busy} aria-label={`Remove ${asset.name}`} className={iconButton} onClick={() => useStore.getState().removePaintAsset(asset.id)}><X className="size-3" /></button>
      </div>)}
    </ControlSection>
    <ControlSection sectionKey="paint-strokes" title={`Saved strokes · ${paint.strokes.length}`}>
      <button type="button" aria-pressed={!selected} className={cn(button, 'flex w-full items-center justify-center gap-2', !selected && 'border-ui-accent text-ui-accent')} onClick={() => useStore.getState().selectPaintStroke(null)}><Brush className="size-3.5" />New stroke</button>
      <button type="button" disabled={!paint.strokes.length} aria-label="Clear all saved strokes" className={`${button} flex w-full items-center justify-center gap-2 hover:text-red-400`} onClick={() => useStore.getState().clearPaintStrokes()}><Trash2 className="size-3.5" />Clear all</button>
      {!paint.strokes.length && <p className="py-3 text-center text-[10px] leading-relaxed text-ui-text-subtle">Paint a gesture.<br />Select its saved path to activate repainting.</p>}
      {[...paint.strokes].reverse().map(stroke => {
        const index = paint.strokes.indexOf(stroke);
        return <div key={stroke.id} className={cn('rounded border p-2', selected === stroke.id ? 'border-ui-accent bg-ui-accent/10' : 'border-ui-border bg-ui-surface')}>
          <button type="button" className="block w-full truncate rounded text-left text-xs text-ui-text focus-visible:ring-2 focus-visible:ring-ui-accent" aria-pressed={selected === stroke.id} onClick={() => useStore.getState().selectPaintStroke(stroke.id)}>{stroke.name}</button>
          <div className="mt-1 flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-[9px] text-ui-text-subtle">{stroke.pattern} · {stroke.replay ? 'active brush' : 'static'}</span>
            <button type="button" className={iconButton} aria-label={`${stroke.hidden ? 'Show' : 'Hide'} ${stroke.name}`} onClick={() => useStore.getState().updatePaintStroke(stroke.id, { hidden: !stroke.hidden })}>{stroke.hidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}</button>
            <button type="button" className={iconButton} disabled={index === paint.strokes.length - 1} aria-label={`Raise ${stroke.name}`} onClick={() => useStore.getState().reorderPaintStroke(stroke.id, paint.strokes[index + 1].id)}><ArrowUp className="size-3" /></button>
            <button type="button" className={iconButton} disabled={index === 0} aria-label={`Lower ${stroke.name}`} onClick={() => useStore.getState().reorderPaintStroke(stroke.id, paint.strokes[index - 1].id)}><ArrowDown className="size-3" /></button>
            <button type="button" className={`${iconButton} hover:text-red-400`} aria-label={`Delete ${stroke.name}`} onClick={() => useStore.getState().deletePaintStroke(stroke.id)}><Trash2 className="size-3" /></button>
          </div>
        </div>;
      })}
    </ControlSection>
  </div>;
}
