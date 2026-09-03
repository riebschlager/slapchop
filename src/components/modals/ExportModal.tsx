import { Clapperboard, Download, Film, Loader2, Repeat, Video, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { isNative } from '../../lib/native';
import { ExportSpeed } from '../../lib/ffmpegExport';
import { EXPORT_RESOLUTIONS, ExportApi, ExportType } from '../../hooks/useExport';

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export default function ExportModal({ api }: { api: ExportApi }) {
  const {
    exportType, setExportType,
    exportResolution, setExportResolution,
    exportFormat, setExportFormat,
    exportStartTime, setExportStartTime,
    exportDuration, setExportDuration,
    exportFps, setExportFps,
    resumeSequence, setResumeSequence,
    exportSpeed, setExportSpeed,
    exportNotice,
    browserVideoPlan, browserVideoError,
    pausePreviewDuringExport, setPausePreviewDuringExport,
    liveOutputStreaming,
    exportJob,
    exportError,
    cancelExport,
    startExport
  } = api;
  const native = isNative();
  const durationMax = native && exportType !== 'gif' ? 21_600 : 10;
  const totalFrames = Math.round(exportDuration * exportFps);
  const [exportWidth, exportHeight] = EXPORT_RESOLUTIONS[exportResolution];
  const uncompressedSequenceBytes = exportWidth * exportHeight * 4 * totalFrames;
  // Encoder speeds only exist for the ffmpeg-backed desktop video formats.
  const isNativeVideo = native
    && (exportType === 'mp4' || exportType === 'webm' || exportType === 'prores');
  const isBrowserVideo = !native && (exportType === 'mp4' || exportType === 'webm');

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-ui-panel border border-ui-border rounded-2xl w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto p-6 text-ui-text shadow-2xl relative">
        <button
          onClick={cancelExport}
          aria-label="Close export settings"
          className="absolute top-4 right-4 text-ui-text-muted hover:text-ui-text p-1 rounded-lg hover:bg-ui-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-lg font-bold text-ui-text mb-1">Export Animation</h3>
        <p className="text-xs text-ui-text-muted mb-5">Export sequence frames or video file for social media</p>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-ui-text-muted uppercase tracking-wider block mb-2">Export Format</label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-ui-canvas rounded-lg border border-ui-border">
              {([
                { id: 'mp4', label: 'MP4 (H.264)', Icon: Film },
                { id: 'webm', label: 'WebM (VP9)', Icon: Video },
                ...(native ? [{ id: 'prores', label: 'ProRes 4444', Icon: Clapperboard }] : []),
                { id: 'gif', label: 'Animated GIF', Icon: Repeat },
                ...(native
                  ? [{ id: 'sequence', label: 'Frames (Folder)', Icon: Download }]
                  : [{ id: 'zip', label: 'Frames (ZIP)', Icon: Download }])
              ] as { id: ExportType; label: string; Icon: typeof Film }[]).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => {
                    setExportType(id);
                    if (id === 'gif' || !native) setExportDuration(Math.min(10, exportDuration));
                  }}
                  className={cn(
                    "py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-2",
                    // The selected item is a bright accent fill; its focus ring
                    // needs a 1px gap of the group background to read at all.
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent focus-visible:ring-offset-1 focus-visible:ring-offset-ui-canvas",
                    exportType === id
                      ? "bg-ui-accent text-ui-accent-contrast shadow"
                      : "text-ui-text-muted hover:text-ui-text hover:bg-ui-surface"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
            {isBrowserVideo && browserVideoError && (
              <p className="text-[10px] text-red-400 mt-1.5">{browserVideoError}</p>
            )}
            {isBrowserVideo && !browserVideoError && browserVideoPlan && (
              <p className={cn(
                'text-[10px] mt-1.5',
                browserVideoPlan.degraded ? 'text-amber-400/90' : 'text-ui-text-subtle'
              )}>
                {browserVideoPlan.summary}
              </p>
            )}
          </div>

          {isNativeVideo && (
            <div>
              <label className="text-xs font-semibold text-ui-text-muted uppercase tracking-wider block mb-2">
                Encoder Speed
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'fast', label: 'Fast', sub: 'Lowest CPU' },
                  { id: 'balanced', label: 'Balanced', sub: 'Faster, smaller' },
                  { id: 'quality', label: 'Quality', sub: 'Reference' }
                ].map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setExportSpeed(option.id as ExportSpeed)}
                    className={cn(
                      "p-2 rounded-lg border text-left transition-colors",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent focus-visible:ring-offset-1 focus-visible:ring-offset-ui-panel",
                      exportSpeed === option.id
                        ? "bg-ui-accent/10 border-ui-accent text-ui-text"
                        : "bg-ui-canvas/50 border-ui-border text-ui-text-muted hover:border-ui-border-strong hover:text-ui-text"
                    )}
                  >
                    <div className="text-xs font-semibold">{option.label}</div>
                    <div className="text-[10px] text-ui-text-subtle">{option.sub}</div>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-ui-text-subtle mt-1.5">
                Changes encoder settings only. Resolution, frame rate, effects, and
                frame-exact timing are identical at every speed.
              </p>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-ui-text-muted uppercase tracking-wider block mb-2">Resolution</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'full', label: '1080x1920', sub: 'Full 1080p' },
                { id: 'hd', label: '720x1280', sub: 'HD Ready' },
                { id: 'compact', label: '540x960', sub: 'Compact' }
              ].map((res) => (
                <button
                  key={res.id}
                  onClick={() => setExportResolution(res.id as 'full' | 'hd' | 'compact')}
                  className={cn(
                    "p-2 rounded-lg border text-left transition-colors",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent focus-visible:ring-offset-1 focus-visible:ring-offset-ui-panel",
                    exportResolution === res.id
                      ? "bg-ui-accent/10 border-ui-accent text-ui-text"
                      : "bg-ui-canvas/50 border-ui-border text-ui-text-muted hover:border-ui-border-strong hover:text-ui-text"
                  )}
                >
                  <div className="text-xs font-semibold">{res.label}</div>
                  <div className="text-[10px] text-ui-text-subtle">{res.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {native && (
            <div>
              <label className="text-xs font-semibold text-ui-text-muted uppercase tracking-wider block mb-1">Start Time (Sec)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={exportStartTime}
                onChange={(e) => setExportStartTime(Math.max(0, parseFloat(e.target.value) || 0))}
                disabled={exportJob !== null}
                className="w-full bg-ui-canvas border border-ui-border-strong rounded-lg px-3 py-1.5 text-xs text-ui-text outline-none focus:ring-2 focus:ring-ui-accent disabled:opacity-60"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-ui-text-muted uppercase tracking-wider block mb-1">Duration (Sec)</label>
              <input
                type="number"
                min="1"
                max={durationMax}
                step="1"
                value={exportDuration}
                onChange={(e) => setExportDuration(Math.max(1, Math.min(durationMax, parseFloat(e.target.value) || 1)))}
                disabled={exportJob !== null}
                className="w-full bg-ui-canvas border border-ui-border-strong rounded-lg px-3 py-1.5 text-xs text-ui-text outline-none focus:ring-2 focus:ring-ui-accent disabled:opacity-60"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-ui-text-muted uppercase tracking-wider block mb-1">FPS</label>
              <select
                value={exportFps}
                onChange={(e) => setExportFps(parseInt(e.target.value))}
                disabled={exportJob !== null}
                className="w-full bg-ui-canvas border border-ui-border-strong rounded-lg px-3 py-1.5 text-xs text-ui-text outline-none focus:ring-2 focus:ring-ui-accent disabled:opacity-60"
              >
                <option value={15}>15 FPS</option>
                <option value={30}>30 FPS</option>
                <option value={60}>60 FPS</option>
              </select>
            </div>
          </div>

          <p className="text-[10px] text-ui-text-subtle">
            {totalFrames.toLocaleString()} frames · {native
              ? 'desktop exports write incrementally without retaining the complete output in memory.'
              : 'browser exports are assembled entirely in memory and capped at 10 seconds, so a long or full-resolution job can exhaust the tab.'}
          </p>

          {native && (
            <div>
              <label className={cn(
                'flex items-center gap-2 text-xs',
                liveOutputStreaming ? 'text-ui-text-subtle cursor-not-allowed' : 'text-ui-text-muted cursor-pointer'
              )}>
                <input
                  type="checkbox"
                  checked={pausePreviewDuringExport}
                  onChange={(e) => setPausePreviewDuringExport(e.target.checked)}
                  disabled={exportJob !== null || liveOutputStreaming}
                  className="accent-ui-accent"
                />
                Pause preview during export
              </label>
              <p className="text-[10px] text-ui-text-subtle mt-1.5">
                {liveOutputStreaming
                  ? 'Preview stays active while TouchDesigner Live Output is streaming.'
                  : 'Frees rendering resources for faster frame generation; playback resumes from the same frame.'}
              </p>
            </div>
          )}

          {(exportType === 'zip' || exportType === 'sequence') && (
            <div>
              <label className="text-xs font-semibold text-ui-text-muted uppercase tracking-wider block mb-2">Image File Format</label>
              <div className="flex items-center gap-4 text-xs">
                <label className="flex items-center gap-2 text-ui-text-muted cursor-pointer">
                  <input
                    type="radio"
                    name="format"
                    value="png"
                    checked={exportFormat === 'png'}
                    onChange={() => setExportFormat('png')}
                    className="accent-ui-accent"
                  />
                  PNG (Lossless)
                </label>
                <label className="flex items-center gap-2 text-ui-text-muted cursor-pointer">
                  <input
                    type="radio"
                    name="format"
                    value="jpeg"
                    checked={exportFormat === 'jpeg'}
                    onChange={() => setExportFormat('jpeg')}
                    className="accent-ui-accent"
                  />
                  JPEG ({exportType === 'zip' ? 'Smaller ZIP' : 'Smaller files'})
                </label>
              </div>
              {exportType === 'sequence' && (
                <label className="flex items-center gap-2 text-xs text-ui-text-muted cursor-pointer mt-3">
                  <input
                    type="checkbox"
                    checked={resumeSequence}
                    onChange={(e) => setResumeSequence(e.target.checked)}
                    disabled={exportJob !== null}
                    className="accent-ui-accent"
                  />
                  Resume existing sequence (skip frame files already present)
                </label>
              )}
              {exportType === 'sequence' && (
                <p className="text-[10px] text-ui-text-subtle mt-1.5">
                  Select an empty destination folder, or select the original folder with Resume enabled. Uncompressed frame data is {formatBytes(uncompressedSequenceBytes)}; actual PNG/JPEG storage depends on the artwork.
                </p>
              )}
            </div>
          )}

          {exportError && (
            <div className="p-3 bg-red-950/40 rounded-lg border border-red-900/70 text-xs text-red-200">
              {exportError}
            </div>
          )}

          {exportNotice && (
            <div className="p-3 bg-amber-950/40 rounded-lg border border-amber-900/70 text-xs text-amber-200">
              {exportNotice}
            </div>
          )}

          {/* Exporting Progress bar */}
          {exportJob && (
            <div className="p-3 bg-ui-canvas rounded-lg border border-ui-border space-y-2">
              <div className="flex justify-between text-xs text-ui-text-muted">
                <span>{exportJob.label}</span>
                <span>{Math.round(exportJob.percent)}%</span>
              </div>
              <div className="w-full h-2 bg-ui-surface-raised rounded-full overflow-hidden">
                <div
                  className="h-full bg-ui-accent transition-all duration-150"
                  style={{ width: `${exportJob.percent}%` }}
                />
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-ui-border flex justify-end gap-2">
            <button
              onClick={cancelExport}
              className="px-4 py-2 bg-ui-surface hover:bg-ui-surface-raised text-ui-text-muted hover:text-ui-text rounded-lg text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
            >
              Cancel
            </button>
            <button
              onClick={startExport}
              disabled={exportJob !== null}
              className="flex items-center gap-2 px-5 py-2 bg-ui-accent hover:bg-ui-accent-hover disabled:opacity-50 text-ui-accent-contrast font-semibold rounded-lg text-xs shadow-lg shadow-ui-accent/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ui-panel"
            >
              {exportJob !== null && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Start Export
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
