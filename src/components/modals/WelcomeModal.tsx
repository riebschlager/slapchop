import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { getWelcomeDismissed, setWelcomeDismissed } from '../../lib/welcomePref';

// ─── Per-mode descriptors ────────────────────────────────────────────────────

const MODES = [
  {
    name: 'Symmetry Canvas',
    description: 'Layer images & GIFs with mirror, radial, or wallpaper symmetry.',
    art: (
      <svg viewBox="0 0 48 48" fill="none" className="w-8 h-8" aria-hidden="true">
        <circle cx="24" cy="24" r="18" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 2" opacity="0.4" />
        <line x1="24" y1="6" x2="24" y2="42" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <line x1="6" y1="24" x2="42" y2="24" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <line x1="11" y1="11" x2="37" y2="37" stroke="currentColor" strokeWidth="1" opacity="0.3" />
        <line x1="37" y1="11" x2="11" y2="37" stroke="currentColor" strokeWidth="1" opacity="0.3" />
        <rect x="19" y="19" width="10" height="10" rx="2" fill="currentColor" opacity="0.7" />
        <rect x="8" y="19" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.35" transform="scale(-1,1) translate(-48,0)" />
        <rect x="8" y="19" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.35" transform="scale(1,-1) translate(0,-48)" />
        <rect x="8" y="19" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.35" transform="scale(-1,-1) translate(-48,-48)" />
      </svg>
    ),
  },
  {
    name: 'Polygon Tiler',
    description: 'Fill hand-drawn or preset polygons with repeating image textures.',
    art: (
      <svg viewBox="0 0 48 48" fill="none" className="w-8 h-8" aria-hidden="true">
        <polygon points="24,4 44,16 44,32 24,44 4,32 4,16" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.08" />
        <polygon points="24,10 38,18 38,30 24,38 10,30 10,18" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity="0.12" strokeDasharray="3 2" />
        <polygon points="24,16 32,21 32,27 24,32 16,27 16,21" fill="currentColor" opacity="0.6" />
      </svg>
    ),
  },
  {
    name: '3D Space',
    description: 'Place textured meshes in 3D with deformers, cameras, and spatial symmetry.',
    art: (
      <svg viewBox="0 0 48 48" fill="none" className="w-8 h-8" aria-hidden="true">
        <path d="M24 6 L42 16 L42 32 L24 42 L6 32 L6 16 Z" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.4" />
        <path d="M24 6 L24 42" stroke="currentColor" strokeWidth="1" opacity="0.4" />
        <path d="M6 16 L42 32" stroke="currentColor" strokeWidth="1" opacity="0.3" />
        <path d="M42 16 L6 32" stroke="currentColor" strokeWidth="1" opacity="0.3" />
        <rect x="17" y="17" width="14" height="14" rx="1" fill="currentColor" opacity="0.5" transform="rotate(15 24 24)" />
        <rect x="20" y="20" width="8" height="8" rx="1" fill="currentColor" opacity="0.8" transform="rotate(15 24 24)" />
      </svg>
    ),
  },
  {
    name: 'GIF Flythrough',
    description: 'A seeded particle field of GIFs rushing past the camera.',
    art: (
      <svg viewBox="0 0 48 48" fill="none" className="w-8 h-8" aria-hidden="true">
        <circle cx="24" cy="24" r="2.5" fill="currentColor" opacity="0.9" />
        {[
          [10, 12, 6, 8], [34, 8, 8, 10], [40, 26, 5, 7],
          [8, 34, 9, 11], [28, 38, 7, 9], [18, 40, 5, 6],
          [38, 38, 6, 8],
        ].map(([x, y, w, h], i) => (
          <rect key={i} x={x - w / 2} y={y - h / 2} width={w} height={h} rx="1"
            fill="currentColor" opacity={0.25 + i * 0.06}
          />
        ))}
        <line x1="24" y1="24" x2="10" y2="12" stroke="currentColor" strokeWidth="0.75" opacity="0.3" />
        <line x1="24" y1="24" x2="34" y2="8" stroke="currentColor" strokeWidth="0.75" opacity="0.3" />
        <line x1="24" y1="24" x2="40" y2="26" stroke="currentColor" strokeWidth="0.75" opacity="0.3" />
        <line x1="24" y1="24" x2="8" y2="34" stroke="currentColor" strokeWidth="0.75" opacity="0.3" />
      </svg>
    ),
  },
  {
    name: 'GIF Tunnel',
    description: 'Endlessly advancing tunnel wallpapered with ordered or seeded GIFs.',
    art: (
      <svg viewBox="0 0 48 48" fill="none" className="w-8 h-8" aria-hidden="true">
        <ellipse cx="24" cy="24" rx="20" ry="20" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.4" />
        <ellipse cx="24" cy="24" rx="14" ry="14" stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.5" />
        <ellipse cx="24" cy="24" rx="8" ry="8" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.6" />
        <ellipse cx="24" cy="24" rx="3" ry="3" fill="currentColor" opacity="0.8" />
        <line x1="4" y1="24" x2="44" y2="24" stroke="currentColor" strokeWidth="0.5" opacity="0.2" />
        <line x1="24" y1="4" x2="24" y2="44" stroke="currentColor" strokeWidth="0.5" opacity="0.2" />
      </svg>
    ),
  },
  {
    name: 'GIF Voronoi',
    description: 'Organic cell fields populated from your GIF library with animated drift.',
    art: (
      <svg viewBox="0 0 48 48" fill="none" className="w-8 h-8" aria-hidden="true">
        <path d="M24 4 L44 14 L38 36 L14 42 L4 22 Z" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity="0.08" />
        <path d="M24 4 L24 42" stroke="currentColor" strokeWidth="0.75" opacity="0.3" />
        <path d="M4 22 L44 14" stroke="currentColor" strokeWidth="0.75" opacity="0.3" />
        <path d="M38 36 L14 42" stroke="currentColor" strokeWidth="0.75" opacity="0.3" strokeDasharray="3 2" />
        <circle cx="24" cy="18" r="2.5" fill="currentColor" opacity="0.8" />
        <circle cx="14" cy="28" r="2" fill="currentColor" opacity="0.6" />
        <circle cx="34" cy="30" r="2" fill="currentColor" opacity="0.6" />
        <circle cx="32" cy="14" r="1.5" fill="currentColor" opacity="0.5" />
      </svg>
    ),
  },
  {
    name: 'GIF Landscape',
    description: 'Fly over noise-displaced terrain with animated GIF textures and sky.',
    art: (
      <svg viewBox="0 0 48 48" fill="none" className="w-8 h-8" aria-hidden="true">
        <path d="M4 32 Q12 20 20 26 Q28 32 36 18 Q40 12 44 22 L44 44 L4 44 Z" fill="currentColor" opacity="0.25" />
        <path d="M4 32 Q12 20 20 26 Q28 32 36 18 Q40 12 44 22" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.7" />
        <circle cx="34" cy="12" r="5" stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.6" />
        <circle cx="34" cy="12" r="2" fill="currentColor" opacity="0.5" />
        <path d="M14 10 Q18 7 22 10" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />
        <path d="M8 14 Q11 12 14 14" stroke="currentColor" strokeWidth="0.8" fill="none" opacity="0.3" />
      </svg>
    ),
  },
] as const;

// ─── Feature blocks ──────────────────────────────────────────────────────────

const FEATURES = [
  {
    title: 'Motion System',
    description:
      'Every parameter — position, rotation, scale, texture offset — can be driven by sine or noise modulators with independent speed, amplitude, and phase.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 shrink-0" aria-hidden="true">
        <path d="M2 12 Q5 6 8 12 Q11 18 14 12 Q17 6 20 12 Q21.5 15 22 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </svg>
    ),
  },
  {
    title: 'Master FX',
    description:
      'A shader stack applied to the full canvas: RGB split, duotone, film grain, scanlines, bloom, and color grading — all with their own motion hooks.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 shrink-0" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="8" cy="12" r="4" fill="currentColor" opacity="0.4" />
        <circle cx="16" cy="12" r="4" fill="currentColor" opacity="0.4" />
        <ellipse cx="12" cy="12" rx="2" ry="4" fill="currentColor" opacity="0.6" />
      </svg>
    ),
  },
  {
    title: 'Export Pipeline',
    description:
      'Frame-exact, deterministic export to MP4, WebM, ProRes 4444 (desktop), animated GIF, or PNG/JPEG sequences. Desktop exports are streamed and can run for hours.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 shrink-0" aria-hidden="true">
        <rect x="3" y="3" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 21 H16 M12 17 V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M9 10 L12 13 L15 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: 'Live Output',
    description:
      'Stream the canvas live to TouchDesigner over WebRTC — no capture card, no cloud service. Adjust FPS and bitrate on the fly.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 shrink-0" aria-hidden="true">
        <circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.8" />
        <path d="M8 8 Q5 10 5 12 Q5 14 8 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <path d="M16 8 Q19 10 19 12 Q19 14 16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <path d="M5.5 5.5 Q2 8 2 12 Q2 16 5.5 18.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.5" />
        <path d="M18.5 5.5 Q22 8 22 12 Q22 16 18.5 18.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.5" />
      </svg>
    ),
  },
];

// ─── Step components ─────────────────────────────────────────────────────────

function StepIntro() {
  return (
    <div className="flex flex-col items-center text-center gap-5 py-2">
      {/* Abstract wordmark / hero art */}
      <svg viewBox="0 0 200 80" fill="none" className="w-48 h-auto" aria-hidden="true">
        {/* Overlapping animated-frame shapes */}
        <rect x="10" y="20" width="40" height="40" rx="4" fill="#28c76f" opacity="0.15" />
        <rect x="20" y="14" width="40" height="40" rx="4" fill="#28c76f" opacity="0.15" />
        <rect x="30" y="8" width="40" height="40" rx="4" fill="#28c76f" opacity="0.3" />
        <rect x="15" y="16" width="40" height="40" rx="4" stroke="#28c76f" strokeWidth="1.5" fill="none" opacity="0.6" />
        {/* Right side symmetry rings */}
        <circle cx="155" cy="40" r="28" stroke="#c23c92" strokeWidth="1" fill="none" opacity="0.25" />
        <circle cx="155" cy="40" r="18" stroke="#c23c92" strokeWidth="1" fill="none" opacity="0.4" />
        <circle cx="155" cy="40" r="8" fill="#c23c92" opacity="0.5" />
        <line x1="127" y1="40" x2="183" y2="40" stroke="#c23c92" strokeWidth="0.75" opacity="0.35" />
        <line x1="155" y1="12" x2="155" y2="68" stroke="#c23c92" strokeWidth="0.75" opacity="0.35" />
      </svg>

      <div>
        <h2 className="text-2xl font-bold text-ui-text tracking-tight">Slapchop</h2>
        <p className="text-sm text-ui-text-muted mt-1 max-w-xs leading-relaxed">
          A local-first generative motion studio. No accounts. No cloud. Everything stays on your machine.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 w-full max-w-xs text-xs text-ui-text-subtle">
        {['7 creative modes', 'Motion on everything', 'Frame-exact export'].map((tag) => (
          <div key={tag} className="bg-ui-surface border border-ui-border rounded-lg px-2 py-2 text-center leading-tight">
            {tag}
          </div>
        ))}
      </div>
    </div>
  );
}

function StepModes() {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold text-ui-text">Seven modes, one studio</h2>
        <p className="text-xs text-ui-text-muted mt-0.5">
          Each mode is a fully independent creative surface. Mix and match by switching modes from the toolbar.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {MODES.map((mode) => (
          <div
            key={mode.name}
            className="flex items-start gap-2.5 bg-ui-surface border border-ui-border rounded-xl p-2.5 hover:border-ui-border-strong transition-colors"
          >
            <span className="text-ui-text-muted mt-0.5 shrink-0">{mode.art}</span>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-ui-text leading-tight">{mode.name}</div>
              <div className="text-[11px] text-ui-text-subtle leading-snug mt-0.5">{mode.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepFeatures() {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold text-ui-text">Built to move</h2>
        <p className="text-xs text-ui-text-muted mt-0.5">
          Every mode shares these cross-cutting capabilities.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {FEATURES.map((feat) => (
          <div
            key={feat.title}
            className="flex items-start gap-3 bg-ui-surface border border-ui-border rounded-xl p-3"
          >
            <span className="text-ui-accent mt-0.5">{feat.icon}</span>
            <div>
              <div className="text-xs font-semibold text-ui-text mb-0.5">{feat.title}</div>
              <div className="text-[11px] text-ui-text-subtle leading-snug">{feat.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepCta({
  dontShow,
  onChangeDontShow,
}: {
  dontShow: boolean;
  onChangeDontShow: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-5 py-2">
      <svg viewBox="0 0 120 80" fill="none" className="w-32 h-auto" aria-hidden="true">
        {/* Stacked play-frames motif */}
        <rect x="8" y="24" width="42" height="32" rx="3" fill="#28c76f" opacity="0.1" stroke="#28c76f" strokeWidth="1" />
        <rect x="16" y="18" width="42" height="32" rx="3" fill="#28c76f" opacity="0.1" stroke="#28c76f" strokeWidth="1" />
        <rect x="24" y="12" width="42" height="32" rx="3" fill="#28c76f" opacity="0.2" stroke="#28c76f" strokeWidth="1.5" />
        <path d="M38 20 L38 36 L52 28 Z" fill="#28c76f" opacity="0.7" />
        {/* Small sparkles */}
        <circle cx="88" cy="18" r="3" fill="#c23c92" opacity="0.6" />
        <circle cx="100" cy="32" r="2" fill="#c23c92" opacity="0.4" />
        <circle cx="94" cy="50" r="2.5" fill="#28c76f" opacity="0.5" />
        <circle cx="80" cy="58" r="1.5" fill="#28c76f" opacity="0.4" />
      </svg>

      <div>
        <h2 className="text-xl font-bold text-ui-text">Ready to create</h2>
        <p className="text-sm text-ui-text-muted mt-1 max-w-xs leading-relaxed">
          Drop in some images or GIFs, pick a mode, and let it go. Save your work as a{' '}
          <span className="font-mono text-ui-text-subtle">.slapchop</span> file to come back to it later.
        </p>
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={dontShow}
          onChange={(e) => onChangeDontShow(e.target.checked)}
          className="w-4 h-4 rounded accent-[var(--color-ui-accent)] cursor-pointer"
        />
        <span className="text-xs text-ui-text-muted">Don't show this again</span>
      </label>
    </div>
  );
}

// ─── WelcomeModal ────────────────────────────────────────────────────────────

const TOTAL_STEPS = 4;

export default function WelcomeModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [dontShow, setDontShow] = useState(false);

  useEffect(() => {
    if (!getWelcomeDismissed()) {
      setOpen(true);
    }
  }, []);

  const dismiss = useCallback(
    (writePref: boolean) => {
      if (writePref || dontShow) {
        setWelcomeDismissed(true);
      }
      setOpen(false);
    },
    [dontShow],
  );

  // Escape key handler
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, dismiss]);

  if (!open) return null;

  const isFirst = step === 0;
  const isLast = step === TOTAL_STEPS - 1;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to Slapchop"
        className="bg-ui-panel border border-ui-border rounded-2xl w-full max-w-lg max-h-[calc(100vh-2rem)] flex flex-col shadow-2xl relative overflow-hidden"
      >
        {/* Close button */}
        <button
          onClick={() => dismiss(false)}
          aria-label="Close welcome"
          className="absolute top-3 right-3 z-10 text-ui-text-muted hover:text-ui-text p-1.5 rounded-lg hover:bg-ui-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Scrollable step content */}
        <div className="flex-1 overflow-y-auto p-6 pb-4">
          {step === 0 && <StepIntro />}
          {step === 1 && <StepModes />}
          {step === 2 && <StepFeatures />}
          {step === 3 && (
            <StepCta dontShow={dontShow} onChangeDontShow={setDontShow} />
          )}
        </div>

        {/* Navigation footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-ui-border bg-ui-panel shrink-0">
          {/* Back button */}
          <button
            onClick={() => setStep((s) => s - 1)}
            disabled={isFirst}
            aria-label="Previous step"
            className={cn(
              'flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent',
              isFirst
                ? 'text-ui-text-subtle opacity-40 cursor-default'
                : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-surface',
            )}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Back
          </button>

          {/* Step dots */}
          <div className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${TOTAL_STEPS}`}>
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1}`}
                className={cn(
                  'rounded-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent',
                  i === step
                    ? 'w-4 h-2 bg-ui-accent'
                    : 'w-2 h-2 bg-ui-border-strong hover:bg-ui-text-subtle',
                )}
              />
            ))}
          </div>

          {/* Next / Start creating */}
          {isLast ? (
            <button
              onClick={() => dismiss(true)}
              className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-ui-accent text-ui-accent-contrast hover:bg-ui-accent-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
            >
              Start creating
            </button>
          ) : (
            <button
              onClick={() => setStep((s) => s + 1)}
              aria-label="Next step"
              className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-ui-text-muted hover:text-ui-text hover:bg-ui-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
