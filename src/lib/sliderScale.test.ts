import { describe, expect, it } from 'vitest';
import {
  formatRate,
  logSliderPositionToValue,
  SLIDER_POSITION_MAX,
  snapSliderValue,
  valueToLogSliderPosition
} from './sliderScale';

const RATE_OPTIONS = { min: 0, max: 10, minPositive: 0.001 };

describe('logarithmic slider mapping', () => {
  it('keeps zero as a distinct stop and maps the positive endpoints', () => {
    expect(valueToLogSliderPosition(0, RATE_OPTIONS)).toBe(0);
    expect(valueToLogSliderPosition(0.001, RATE_OPTIONS)).toBe(1);
    expect(valueToLogSliderPosition(10, RATE_OPTIONS)).toBeCloseTo(SLIDER_POSITION_MAX);
  });

  it('allocates equal track space to each decade', () => {
    const positions = [0.001, 0.01, 0.1, 1, 10]
      .map(value => valueToLogSliderPosition(value, RATE_OPTIONS));
    const gaps = positions.slice(1).map((position, index) => position - positions[index]);
    gaps.forEach(gap => expect(gap).toBeCloseTo(gaps[0], 8));
  });

  it('round-trips representative rates', () => {
    [0, 0.001, 0.025, 0.1, 1, 5, 10].forEach(value => {
      const position = valueToLogSliderPosition(value, RATE_OPTIONS);
      expect(logSliderPositionToValue(position, RATE_OPTIONS)).toBeCloseTo(value, 10);
    });
  });
});

describe('slider value helpers', () => {
  it('snaps and clamps direct or dragged values', () => {
    expect(snapSliderValue(0.00149, 0, 5, 0.001)).toBe(0.001);
    expect(snapSliderValue(0.00151, 0, 5, 0.001)).toBe(0.002);
    expect(snapSliderValue(-1, 0, 5, 0.001)).toBe(0);
    expect(snapSliderValue(6, 0, 5, 0.001)).toBe(5);
  });

  it('formats slow rates without hiding meaningful precision', () => {
    expect(formatRate(0)).toBe('0');
    expect(formatRate(0.001)).toBe('0.001');
    expect(formatRate(0.025)).toBe('0.025');
    expect(formatRate(1)).toBe('1');
  });
});
