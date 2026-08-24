export const SLIDER_POSITION_MAX = 1000;

export interface LogSliderOptions {
  min: number;
  max: number;
  minPositive: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Maps a document value onto the normalized track used by logarithmic sliders. */
export function valueToLogSliderPosition(value: number, options: LogSliderOptions): number {
  const { min, max, minPositive } = options;
  if (min === 0 && value <= 0) return 0;

  const trackStart = min === 0 ? 1 : 0;
  const positiveValue = clamp(value, minPositive, max);
  const logRange = Math.log(max) - Math.log(minPositive);
  if (logRange <= 0) return trackStart;

  const progress = (Math.log(positiveValue) - Math.log(minPositive)) / logRange;
  return trackStart + progress * (SLIDER_POSITION_MAX - trackStart);
}

/** Maps a normalized logarithmic track position back into document space. */
export function logSliderPositionToValue(position: number, options: LogSliderOptions): number {
  const { min, max, minPositive } = options;
  const clampedPosition = clamp(position, 0, SLIDER_POSITION_MAX);
  if (min === 0 && clampedPosition < 1) return 0;

  const trackStart = min === 0 ? 1 : 0;
  const progress = (clampedPosition - trackStart) / (SLIDER_POSITION_MAX - trackStart);
  return Math.exp(Math.log(minPositive) + progress * (Math.log(max) - Math.log(minPositive)));
}

/** Snaps values without leaving floating-point tails in persisted project data. */
export function snapSliderValue(value: number, min: number, max: number, step: number): number {
  const clamped = clamp(value, min, max);
  if (step <= 0) return clamped;

  const snapped = min + Math.round((clamped - min) / step) * step;
  return Number(clamp(snapped, min, max).toPrecision(12));
}

/** Compact readout for rates that still exposes thousandth-scale movement. */
export function formatRate(value: number): string {
  const rounded = Number(value.toFixed(3));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}
