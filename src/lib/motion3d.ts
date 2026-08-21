import { Camera3dConfig, Mesh3dLayer } from '../types';
import { applyMotion } from './motion';
import { getSymmetry3dTransforms } from './symmetry3d';

// 3D counterpart to motion.ts's getModulatedLayer/getInstances: applies each
// per-property motion modulator, then expands the result into one entry per
// symmetry instance. Kept in its own module (alongside geometry3d/deformation3d/
// symmetry3d) since it's 3D-specific, but reuses applyMotion so both renderers'
// notion of "modulated value at time t" stays identical to the 2D engine's.

export function getModulatedMesh3dLayer(layer: Mesh3dLayer, t: number): Mesh3dLayer {
  return {
    ...layer,
    x: applyMotion(layer.x, layer.motionX, t),
    y: applyMotion(layer.y, layer.motionY, t),
    z: applyMotion(layer.z, layer.motionZ, t),
    rotationX: applyMotion(layer.rotationX, layer.motionRotX, t),
    rotationY: applyMotion(layer.rotationY, layer.motionRotY, t),
    rotationZ: applyMotion(layer.rotationZ, layer.motionRotZ, t),
    scaleX: Math.sign(layer.scaleX || 1) * applyMotion(Math.abs(layer.scaleX), layer.motionScaleX, t),
    scaleY: Math.sign(layer.scaleY || 1) * applyMotion(Math.abs(layer.scaleY), layer.motionScaleY, t),
    scaleZ: Math.sign(layer.scaleZ || 1) * applyMotion(Math.abs(layer.scaleZ), layer.motionScaleZ, t)
  };
}

export function getModulatedCamera3d(camera: Camera3dConfig, t: number): Camera3dConfig {
  return {
    ...camera,
    distance: applyMotion(camera.distance, camera.motionDistance, t),
    pitch: applyMotion(camera.pitch, camera.motionPitch, t),
    yaw: applyMotion(camera.yaw, camera.motionYaw, t)
  };
}

/** One symmetrized copy of a mesh: the modulated layer plus its resolved placement. */
export interface Mesh3dInstance {
  layer: Mesh3dLayer;
  x: number;
  y: number;
  z: number;
  rotationXDeg: number;
  rotationYDeg: number;
  rotationZDeg: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  isPrimary: boolean;
}

/**
 * Motion -> 3D symmetry instancing, mirroring getInstances' two-stage
 * pipeline for 2D layers. Mirror instances are expressed as a negative scale
 * on the mirrored axis (same trick getInstances uses for mirrorX/mirrorY),
 * so both renderers can build a mesh instance from plain position/rotation/
 * scale without a separate "is this mirrored" branch.
 */
export function getMesh3dInstances(layer: Mesh3dLayer, t: number): Mesh3dInstance[] {
  const m = getModulatedMesh3dLayer(layer, t);
  const transforms = getSymmetry3dTransforms(
    m.symmetry3d ?? 'none',
    m.radialSegments3d ?? 6,
    m.symmetry3dParams,
    m.x, m.y, m.z
  );
  return transforms.map((tr) => ({
    layer: m,
    x: tr.x,
    y: tr.y,
    z: tr.z,
    rotationXDeg: m.rotationX + tr.rotationXDeg,
    rotationYDeg: m.rotationY + tr.rotationYDeg,
    rotationZDeg: m.rotationZ + tr.rotationZDeg,
    scaleX: m.scaleX * tr.scaleMult * (tr.mirrorX ? -1 : 1),
    scaleY: m.scaleY * tr.scaleMult * (tr.mirrorY ? -1 : 1),
    scaleZ: m.scaleZ * tr.scaleMult * (tr.mirrorZ ? -1 : 1),
    isPrimary: tr.isPrimary
  }));
}

export interface CameraPose {
  eyeX: number;
  eyeY: number;
  eyeZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  rollRad: number;
  fovDeg: number;
  distance: number;
  projection: Camera3dConfig['projection'];
}

const DEG = Math.PI / 180;

/**
 * Resolves the orbit camera's eye position from (pitch, yaw, distance,
 * target). Both renderers build their view matrix from this pose alone, so
 * "where the camera sits" can never drift between the GPU and CPU paths even
 * though they construct the rest of the projection differently.
 *
 * pitch/yaw orbit around `target`; at pitch=0, yaw=0 the eye sits on +Z
 * looking toward the origin, matching geometry3d.ts's "front faces point
 * toward +Z" convention. The scene itself stays in this app's native
 * center-origin, Y-down-is-down coordinate system throughout — the
 * renderers are responsible for presenting that consistently (see
 * threeRenderer.ts and render2d.ts's 3D path for how each does it without
 * touching this shared math).
 */
export function resolveCameraPose(cameraRaw: Camera3dConfig, t: number): CameraPose {
  const camera = getModulatedCamera3d(cameraRaw, t);
  const pitchRad = camera.pitch * DEG;
  const yawRad = camera.yaw * DEG;
  const ringRadius = camera.distance * Math.cos(pitchRad);
  const eyeX = camera.targetX + ringRadius * Math.sin(yawRad);
  const eyeY = camera.targetY - camera.distance * Math.sin(pitchRad);
  const eyeZ = camera.targetZ + ringRadius * Math.cos(yawRad);
  return {
    eyeX, eyeY, eyeZ,
    targetX: camera.targetX,
    targetY: camera.targetY,
    targetZ: camera.targetZ,
    rollRad: camera.roll * DEG,
    fovDeg: camera.fov,
    distance: camera.distance,
    projection: camera.projection
  };
}
