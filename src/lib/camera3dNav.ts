import { Camera3dConfig } from '../types';
import { Screen3dProjector } from './project3d';

// Pure viewport-navigation math for 3D Mesh Mode: turns pointer deltas into
// camera3d updates. Kept out of CanvasWorkspace so the gesture behavior
// (sensitivity, clamping, which way "drag right" turns the scene) is testable
// without a DOM, and so the inspector's camera sliders and these gestures
// stay in the same value ranges.

/** Degrees of orbit per canvas pixel dragged. */
export const ORBIT_DEGREES_PER_PIXEL = 0.25;
/** Dolly is multiplicative, so zooming feels the same at any distance. */
export const DOLLY_PER_WHEEL_UNIT = 0.0015;
export const DOLLY_PER_DRAG_PIXEL = 0.004;

export const MIN_CAMERA_DISTANCE = 100;
export const MAX_CAMERA_DISTANCE = 6000;
/**
 * Orbiting is clamped just short of straight up/down. mat4LookAt survives the
 * pole (it swaps its up reference), but dragging through it snaps the view's
 * roll, so the gesture stops before it instead. The inspector's Pitch slider
 * still reaches +/-90 for anyone who wants the exact top-down pose.
 */
export const MAX_ORBIT_PITCH = 89;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Keeps yaw inside the inspector slider's (-180, 180] range as it wraps. */
export function wrapDegrees(deg: number): number {
  const wrapped = ((deg + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/**
 * Turntable orbit around the camera target. Both axes follow the "grab the
 * scene" model: dragging right swings the eye to the right (the scene appears
 * to turn left), and dragging down lifts the eye above the scene. Positive
 * pitch raises the eye because this app's +Y points down (see
 * resolveCameraPose).
 */
export function orbitCamera(
  camera: Camera3dConfig,
  dxPixels: number,
  dyPixels: number
): Pick<Camera3dConfig, 'pitch' | 'yaw'> {
  return {
    yaw: wrapDegrees(camera.yaw + dxPixels * ORBIT_DEGREES_PER_PIXEL),
    pitch: clamp(camera.pitch + dyPixels * ORBIT_DEGREES_PER_PIXEL, -MAX_ORBIT_PITCH, MAX_ORBIT_PITCH)
  };
}

/**
 * Dolly the eye toward or away from the target. `amount` is a unitless
 * exponent — positive pulls back — so callers scale wheel notches and drag
 * pixels by the constants above into the same curve.
 */
export function dollyCamera(camera: Camera3dConfig, amount: number): Pick<Camera3dConfig, 'distance'> {
  return {
    distance: clamp(camera.distance * Math.exp(amount), MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE)
  };
}

/**
 * Pans the camera target in the plane facing the viewer, so the scene tracks
 * the cursor 1:1 at the target's depth. Deltas are in canvas pixels; the
 * projector supplies the camera basis and the world-per-pixel scale, which is
 * why pan stays correct under roll, orbit, and orthographic projection.
 */
export function panCameraTarget(
  camera: Camera3dConfig,
  dxPixels: number,
  dyPixels: number,
  projector: Screen3dProjector
): Pick<Camera3dConfig, 'targetX' | 'targetY' | 'targetZ'> {
  // The target sits at the center of view, one camera distance from the eye.
  const scale = projector.worldPerPixel(-projector.pose.distance);
  const { right, screenDown } = projector;
  const dx = dxPixels * scale;
  const dy = dyPixels * scale;
  return {
    targetX: camera.targetX - (right[0] * dx + screenDown[0] * dy),
    targetY: camera.targetY - (right[1] * dx + screenDown[1] * dy),
    targetZ: camera.targetZ - (right[2] * dx + screenDown[2] * dy)
  };
}
