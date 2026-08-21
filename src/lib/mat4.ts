// Minimal column-major 4x4 matrix / vec3 math for the Canvas 2D software
// projection fallback (render2d.ts's 3D path). Kept dependency-free (no
// three.js) since the whole point of this path is to work without a GPU
// renderer; threeRenderer.ts uses Three's own Object3D/Camera math instead
// and never imports this file.
//
// Layout matches the standard WebGL/OpenGL convention: a Mat4 is a
// length-16 array where element [col*4+row] is the matrix entry at that
// row/column, so mat4TransformPoint(m, v) computes m * v with v as a column
// vector.

export type Vec3 = [number, number, number];
export type Mat4 = number[];

export function vecSub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vecAdd(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vecCross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

export function vecDot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vecLength(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function vecNormalize(a: Vec3): Vec3 {
  const len = vecLength(a) || 1;
  return [a[0] / len, a[1] / len, a[2] / len];
}

/** Rodrigues' rotation formula: rotates `v` around unit `axis` by `angleRad`. */
export function rotateVectorAroundAxis(v: Vec3, axis: Vec3, angleRad: number): Vec3 {
  if (angleRad === 0) return v;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const k = axis;
  const kCrossV = vecCross(k, v);
  const kDotV = vecDot(k, v);
  return [
    v[0] * cos + kCrossV[0] * sin + k[0] * kDotV * (1 - cos),
    v[1] * cos + kCrossV[1] * sin + k[1] * kDotV * (1 - cos),
    v[2] * cos + kCrossV[2] * sin + k[2] * kDotV * (1 - cos)
  ];
}

export function mat4Identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** a * b (b's transform applied first). */
export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out: Mat4 = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function mat4Translation(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

export function mat4Scale(x: number, y: number, z: number): Mat4 {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

export function mat4RotationX(rad: number): Mat4 {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

export function mat4RotationY(rad: number): Mat4 {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

export function mat4RotationZ(rad: number): Mat4 {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** m * [v.x, v.y, v.z, 1], returning the resulting xyz (w is always 1 for the affine matrices this module builds). */
export function mat4TransformPoint(m: Mat4, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]
  ];
}

/** Transforms a direction (e.g. a normal) by m's upper 3x3 only, ignoring translation. */
export function mat4TransformDirection(m: Mat4, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2]
  ];
}

/**
 * World-to-camera view matrix via the standard gluLookAt construction, with
 * `rollRad` applied by rotating the up reference around the view (forward)
 * axis before deriving the camera's right/up basis — see resolveCameraPose
 * in motion3d.ts for why eye/target are computed the way they are, and
 * render2d.ts's 3D path for why plain up=(0,1,0) (not a Y-flipped up) is
 * correct here despite this app's Y-down world convention.
 */
export function mat4LookAt(eye: Vec3, target: Vec3, rollRad: number): Mat4 {
  let zAxis = vecSub(eye, target);
  if (vecLength(zAxis) < 1e-6) zAxis = [0, 0, 1];
  zAxis = vecNormalize(zAxis);

  const baseUp: Vec3 = [0, 1, 0];
  // Near-degenerate when looking straight up/down (pitch ~ +/-90deg): fall
  // back to a different reference axis so the cross product below doesn't
  // collapse to zero.
  const up = Math.abs(vecDot(baseUp, zAxis)) > 0.999 ? ([0, 0, 1] as Vec3) : baseUp;
  const rolledUp = rollRad ? rotateVectorAroundAxis(up, zAxis, rollRad) : up;

  const xAxis = vecNormalize(vecCross(rolledUp, zAxis));
  const yAxis = vecCross(zAxis, xAxis);

  return [
    xAxis[0], yAxis[0], zAxis[0], 0,
    xAxis[1], yAxis[1], zAxis[1], 0,
    xAxis[2], yAxis[2], zAxis[2], 0,
    -vecDot(xAxis, eye), -vecDot(yAxis, eye), -vecDot(zAxis, eye), 1
  ];
}

/**
 * A mesh instance's local-to-world matrix. Rotation order is
 * Z-then-Y-then-X applied to a vector (i.e. world = T * Rz * Ry * Rx * S * v),
 * matching Three.js's default Euler order so threeRenderer.ts and this
 * fallback rotate meshes identically for the same authored rotationX/Y/Z.
 *
 * `pivot` is the point (in the mesh's own local space) that rotation/scale
 * pivot around; `position` places that point in world space, independent of
 * rotation/scale (see the pivot derivation in motion3d.ts's module comment
 * — the mesh's own origin only coincides with `position` when pivot is 0).
 *
 * render2d.ts derives face normals directly from transformed vertex
 * positions (cross product of the transformed edges) rather than
 * transforming the geometry's own normals through this matrix, which sidesteps
 * needing a separate inverse-transpose normal matrix for non-uniform scale.
 */
export function buildMeshWorldMatrix(
  position: Vec3,
  pivot: Vec3,
  rotationXRad: number,
  rotationYRad: number,
  rotationZRad: number,
  scale: Vec3
): { world: Mat4 } {
  const rotation = mat4Multiply(mat4Multiply(mat4RotationZ(rotationZRad), mat4RotationY(rotationYRad)), mat4RotationX(rotationXRad));
  const scaleM = mat4Scale(scale[0], scale[1], scale[2]);
  const toPivot = mat4Translation(position[0] + pivot[0], position[1] + pivot[1], position[2] + pivot[2]);
  const fromPivot = mat4Translation(-pivot[0], -pivot[1], -pivot[2]);
  const world = mat4Multiply(mat4Multiply(mat4Multiply(toPivot, rotation), scaleM), fromPivot);
  return { world };
}
