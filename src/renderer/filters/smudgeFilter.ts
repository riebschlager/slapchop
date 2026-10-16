import {
  defaultFilterVert,
  Filter,
  GlProgram,
  GpuProgram,
  UniformGroup
} from 'pixi.js';
import type { SmudgeParams } from '../../lib/smudge';

// GPU port of src/lib/smudge.ts. Keep the hash, lattice, quantize, and tap
// logic in lockstep with that file so Pixi and Canvas 2D smudge identically.
// Positions are output pixels relative to the canvas origin; samples snap to
// pixel centers so the linear sampler reads exactly one texel, like the 2D path.

const wgslSource = `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

struct SmudgeUniforms {
  uAmount: f32,
  uCell: f32,
  uSteps: f32,
  uSoftness: f32,
  uDirX: f32,
  uDirY: f32,
  uFlow: f32,
  uCoverage: f32,
  uTaps: f32,
  uStep: f32,
  uFrac: f32,
  uSeed: f32,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> smudgeUniforms: SmudgeUniforms;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

fn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32> {
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

fn filterTextureCoord(aPosition: vec2<f32>) -> vec2<f32> {
  return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  return VSOutput(filterVertexPosition(aPosition), filterTextureCoord(aPosition));
}

fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn hashCell(x: i32, y: i32, z: u32, w: u32) -> f32 {
  let h = pcg(u32(x) + pcg(u32(y) + pcg(z + pcg(w))));
  return f32(h >> 8u) / 16777216.0;
}

fn latticeAt(cx: i32, cy: i32, step: u32) -> vec2<f32> {
  let seed = u32(smudgeUniforms.uSeed) * 4u;
  if (hashCell(cx, cy, step, seed + 2u) >= smudgeUniforms.uCoverage) {
    return vec2<f32>(0.0);
  }
  let a = hashCell(cx, cy, step, seed) * 6.283185307179586;
  let mag = hashCell(cx, cy, step, seed + 1u);
  return vec2<f32>(cos(a), sin(a)) * mag * (1.0 - smudgeUniforms.uFlow) + vec2<f32>(smudgeUniforms.uDirX, smudgeUniforms.uDirY) * mag * smudgeUniforms.uFlow;
}

fn lattice(cx: i32, cy: i32) -> vec2<f32> {
  let s = u32(smudgeUniforms.uStep);
  let a = latticeAt(cx, cy, s);
  let b = latticeAt(cx, cy, s + 1u);
  return a + (b - a) * smudgeUniforms.uFrac;
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let pos = uv * gfu.uInputSize.xy + gfu.uOutputFrame.xy;
  var v = vec2<f32>(0.0);
  if (smudgeUniforms.uSoftness < 1.0) {
    let c = floor(pos / smudgeUniforms.uCell);
    v = lattice(i32(c.x), i32(c.y)) * (1.0 - smudgeUniforms.uSoftness);
  }
  if (smudgeUniforms.uSoftness > 0.0) {
    let g = pos / smudgeUniforms.uCell - 0.5;
    let i = floor(g);
    var f = g - i;
    f = f * f * (3.0 - 2.0 * f);
    let ix = i32(i.x);
    let iy = i32(i.y);
    let s = lattice(ix, iy) * (1.0 - f.x) * (1.0 - f.y)
      + lattice(ix + 1, iy) * f.x * (1.0 - f.y)
      + lattice(ix, iy + 1) * (1.0 - f.x) * f.y
      + lattice(ix + 1, iy + 1) * f.x * f.y;
    v += s * smudgeUniforms.uSoftness;
  }
  let d = floor(v * smudgeUniforms.uSteps + 0.5) / smudgeUniforms.uSteps * smudgeUniforms.uAmount;
  if (d.x == 0.0 && d.y == 0.0) {
    return textureSampleLevel(uTexture, uSampler, uv, 0.0);
  }
  var acc = vec4<f32>(0.0);
  for (var k = 0; k < 8; k++) {
    if (f32(k) >= smudgeUniforms.uTaps) {
      break;
    }
    let t = f32(k + 1) / smudgeUniforms.uTaps;
    let tgt = floor(pos + d * t) - gfu.uOutputFrame.xy + 0.5;
    let suv = clamp(tgt * gfu.uInputSize.zw, gfu.uInputClamp.xy, gfu.uInputClamp.zw);
    acc += textureSampleLevel(uTexture, uSampler, suv, 0.0);
  }
  return acc / smudgeUniforms.uTaps;
}
`;

// The version directive opts into GLSL ES 3.00 (WebGL2); Pixi otherwise
// compiles filter fragments as WebGL1, which has no uint for the hash.
const glslFragment = `#version 300 es
precision highp float;
precision highp int;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;

uniform float uAmount;
uniform float uCell;
uniform float uSteps;
uniform float uSoftness;
uniform float uDirX;
uniform float uDirY;
uniform float uFlow;
uniform float uCoverage;
uniform float uTaps;
uniform float uStep;
uniform float uFrac;
uniform float uSeed;

uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

float hashCell(int x, int y, uint z, uint w) {
  uint h = pcg(uint(x) + pcg(uint(y) + pcg(z + pcg(w))));
  return float(h >> 8u) / 16777216.0;
}

vec2 latticeAt(int cx, int cy, uint step) {
  uint seed = uint(uSeed) * 4u;
  if (hashCell(cx, cy, step, seed + 2u) >= uCoverage) {
    return vec2(0.0);
  }
  float a = hashCell(cx, cy, step, seed) * 6.283185307179586;
  float mag = hashCell(cx, cy, step, seed + 1u);
  return vec2(cos(a), sin(a)) * mag * (1.0 - uFlow) + vec2(uDirX, uDirY) * mag * uFlow;
}

vec2 lattice(int cx, int cy) {
  uint s = uint(uStep);
  vec2 a = latticeAt(cx, cy, s);
  vec2 b = latticeAt(cx, cy, s + 1u);
  return a + (b - a) * uFrac;
}

void main(void) {
  vec2 pos = vTextureCoord * uInputSize.xy + uOutputFrame.xy;
  vec2 v = vec2(0.0);
  if (uSoftness < 1.0) {
    vec2 c = floor(pos / uCell);
    v = lattice(int(c.x), int(c.y)) * (1.0 - uSoftness);
  }
  if (uSoftness > 0.0) {
    vec2 g = pos / uCell - 0.5;
    vec2 i = floor(g);
    vec2 f = g - i;
    f = f * f * (3.0 - 2.0 * f);
    int ix = int(i.x);
    int iy = int(i.y);
    vec2 s = lattice(ix, iy) * (1.0 - f.x) * (1.0 - f.y)
      + lattice(ix + 1, iy) * f.x * (1.0 - f.y)
      + lattice(ix, iy + 1) * (1.0 - f.x) * f.y
      + lattice(ix + 1, iy + 1) * f.x * f.y;
    v += s * uSoftness;
  }
  vec2 d = floor(v * uSteps + 0.5) / uSteps * uAmount;
  if (d.x == 0.0 && d.y == 0.0) {
    finalColor = texture(uTexture, vTextureCoord);
    return;
  }
  vec4 acc = vec4(0.0);
  for (int k = 0; k < 8; k++) {
    if (float(k) >= uTaps) break;
    float t = float(k + 1) / uTaps;
    vec2 tgt = floor(pos + d * t) - uOutputFrame.xy + 0.5;
    vec2 suv = clamp(tgt * uInputSize.zw, uInputClamp.xy, uInputClamp.zw);
    acc += texture(uTexture, suv);
  }
  finalColor = acc / uTaps;
}
`;

export class SmudgeFilter extends Filter {
  constructor() {
    const gpuProgram = GpuProgram.from({
      vertex: { source: wgslSource, entryPoint: 'mainVertex' },
      fragment: { source: wgslSource, entryPoint: 'mainFragment' }
    });

    const glProgram = GlProgram.from({
      vertex: defaultFilterVert,
      fragment: glslFragment,
      name: 'smudge-filter'
    });

    // Order must match the WGSL SmudgeUniforms struct (three 16-byte rows).
    const uniforms = new UniformGroup({
      uAmount: { value: 0, type: 'f32' },
      uCell: { value: 48, type: 'f32' },
      uSteps: { value: 4, type: 'f32' },
      uSoftness: { value: 0, type: 'f32' },
      uDirX: { value: 1, type: 'f32' },
      uDirY: { value: 0, type: 'f32' },
      uFlow: { value: 0, type: 'f32' },
      uCoverage: { value: 1, type: 'f32' },
      uTaps: { value: 1, type: 'f32' },
      uStep: { value: 0, type: 'f32' },
      uFrac: { value: 0, type: 'f32' },
      uSeed: { value: 0, type: 'f32' }
    });

    super({
      gpuProgram,
      glProgram,
      resources: {
        smudgeUniforms: uniforms
      }
    });
  }

  setParams(p: SmudgeParams) {
    const u = this.resources.smudgeUniforms.uniforms;
    u.uAmount = p.amountPx;
    u.uCell = p.cellPx;
    u.uSteps = p.steps;
    u.uSoftness = p.softness;
    u.uDirX = p.dirX;
    u.uDirY = p.dirY;
    u.uFlow = p.flow;
    u.uCoverage = p.coverage;
    u.uTaps = p.taps;
    u.uStep = p.step;
    u.uFrac = p.frac;
    u.uSeed = p.seed;
  }
}
