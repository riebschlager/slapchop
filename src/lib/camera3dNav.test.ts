import { describe, expect, it } from 'vitest';
import {
  DOLLY_PER_WHEEL_UNIT,
  MAX_CAMERA_DISTANCE,
  MAX_ORBIT_PITCH,
  MIN_CAMERA_DISTANCE,
  dollyCamera,
  orbitCamera,
  panCameraTarget,
  wrapDegrees
} from './camera3dNav';
import { createScreen3dProjector } from './project3d';
import { Camera3dConfig, DEFAULT_CAMERA3D } from '../types';

const WIDTH = 1080;
const HEIGHT = 1920;

const camera = (overrides: Partial<Camera3dConfig> = {}): Camera3dConfig =>
  ({ ...DEFAULT_CAMERA3D, ...overrides });

const projectorFor = (c: Camera3dConfig) => createScreen3dProjector(c, 0, WIDTH, HEIGHT);

describe('wrapDegrees', () => {
  it('keeps angles inside the inspector slider range as they wrap', () => {
    expect(wrapDegrees(0)).toBe(0);
    expect(wrapDegrees(190)).toBeCloseTo(-170, 6);
    expect(wrapDegrees(-190)).toBeCloseTo(170, 6);
    expect(wrapDegrees(540)).toBeCloseTo(180, 6);
    expect(wrapDegrees(-180)).toBeCloseTo(180, 6);
  });
});

describe('orbitCamera', () => {
  it('swings the eye with the drag: right increases yaw, down raises the eye', () => {
    const { yaw, pitch } = orbitCamera(camera(), 100, 40);
    expect(yaw).toBeGreaterThan(0);
    // Positive pitch lifts the eye because this app's +Y points down.
    expect(pitch).toBeGreaterThan(0);
  });

  it('clamps pitch short of the poles but lets yaw wrap freely', () => {
    expect(orbitCamera(camera({ pitch: 80 }), 0, 10_000).pitch).toBe(MAX_ORBIT_PITCH);
    expect(orbitCamera(camera({ pitch: -80 }), 0, -10_000).pitch).toBe(-MAX_ORBIT_PITCH);
    expect(orbitCamera(camera({ yaw: 170 }), 10_000, 0).yaw).toBeGreaterThanOrEqual(-180);
    expect(orbitCamera(camera({ yaw: 170 }), 10_000, 0).yaw).toBeLessThanOrEqual(180);
  });

  it('is reversible, so an orbit and its opposite land back where they started', () => {
    const start = camera({ pitch: 12, yaw: -40 });
    const out = orbitCamera(start, 120, 30);
    const back = orbitCamera({ ...start, ...out }, -120, -30);
    expect(back.yaw).toBeCloseTo(start.yaw, 6);
    expect(back.pitch).toBeCloseTo(start.pitch, 6);
  });
});

describe('dollyCamera', () => {
  it('pulls back on positive amounts and closes in on negative ones', () => {
    const start = camera();
    expect(dollyCamera(start, 0.2).distance).toBeGreaterThan(start.distance);
    expect(dollyCamera(start, -0.2).distance).toBeLessThan(start.distance);
  });

  it('is multiplicative, so equal-and-opposite zooming round-trips at any distance', () => {
    for (const distance of [200, 1000, 4000]) {
      const out = dollyCamera(camera({ distance }), 0.3);
      const back = dollyCamera(camera({ distance: out.distance }), -0.3);
      expect(back.distance).toBeCloseTo(distance, 6);
    }
  });

  it('clamps to the same range the inspector Distance slider exposes', () => {
    expect(dollyCamera(camera({ distance: 150 }), -100).distance).toBe(MIN_CAMERA_DISTANCE);
    expect(dollyCamera(camera({ distance: 5000 }), 100).distance).toBe(MAX_CAMERA_DISTANCE);
  });

  it('moves a sensible amount for one wheel notch', () => {
    // A 100px notch should be a noticeable but not jarring step — roughly 16%.
    const start = camera();
    const stepped = dollyCamera(start, 100 * DOLLY_PER_WHEEL_UNIT).distance;
    const ratio = stepped / start.distance;
    expect(ratio).toBeGreaterThan(1.05);
    expect(ratio).toBeLessThan(1.3);
  });
});

describe('panCameraTarget', () => {
  it('tracks the cursor 1:1 at the target plane, moving the scene with the drag', () => {
    const c = camera();
    const out = panCameraTarget(c, 100, 60, projectorFor(c));
    // The target moves opposite the drag so the scene appears to follow it, and
    // the default camera is built so one canvas pixel is one world unit there.
    expect(out.targetX).toBeCloseTo(-100, 6);
    expect(out.targetY).toBeCloseTo(-60, 6);
    expect(out.targetZ).toBeCloseTo(0, 6);
  });

  it('pans along the camera basis rather than world axes', () => {
    const c = camera({ yaw: 90 });
    const out = panCameraTarget(c, 100, 0, projectorFor(c));
    // Yawed a quarter turn, screen-right runs along -Z, so a horizontal drag
    // has to move the target in Z, not X.
    expect(out.targetX).toBeCloseTo(0, 6);
    expect(out.targetZ).toBeCloseTo(100, 6);
  });

  it('keeps 1:1 tracking under orthographic projection', () => {
    const c = camera({ projection: 'orthographic' });
    const out = panCameraTarget(c, 100, 0, projectorFor(c));
    expect(out.targetX).toBeCloseTo(-100, 6);
  });

  it('scales with camera distance, so panning feels the same at any zoom', () => {
    const near = camera({ distance: 1000 });
    const far = camera({ distance: 4000 });
    const nearPan = panCameraTarget(near, 100, 0, projectorFor(near));
    const farPan = panCameraTarget(far, 100, 0, projectorFor(far));
    // Four times the distance covers four times the world for the same drag.
    expect(farPan.targetX / nearPan.targetX).toBeCloseTo(4, 4);
  });

  it('is reversible', () => {
    const c = camera({ pitch: 20, yaw: 35, roll: 10 });
    const out = panCameraTarget(c, 80, -40, projectorFor(c));
    const back = panCameraTarget({ ...c, ...out }, -80, 40, projectorFor(c));
    expect(back.targetX).toBeCloseTo(c.targetX, 6);
    expect(back.targetY).toBeCloseTo(c.targetY, 6);
    expect(back.targetZ).toBeCloseTo(c.targetZ, 6);
  });
});
