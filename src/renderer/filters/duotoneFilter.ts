import {
  defaultFilterVert,
  Filter,
  GlProgram,
  GpuProgram,
  UniformGroup
} from 'pixi.js';

const wgslSource = `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

struct DuotoneUniforms {
  uShadowColor: vec3<f32>,
  uIntensity: f32,
  uHighlightColor: vec3<f32>,
  uPadding: f32,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> duotoneUniforms: DuotoneUniforms;

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

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  var orig = textureSample(uTexture, uSampler, uv);
  if (duotoneUniforms.uIntensity <= 0.0) {
    return orig;
  }

  var alpha = orig.a;
  if (alpha <= 0.0) {
    return orig;
  }

  var rgb = orig.rgb / alpha;
  var lum = dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
  var mapped = mix(duotoneUniforms.uShadowColor, duotoneUniforms.uHighlightColor, lum);
  var outRgb = mix(rgb, mapped, duotoneUniforms.uIntensity) * alpha;

  return vec4<f32>(outRgb, alpha);
}
`;

const glslFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec3 uShadowColor;
uniform vec3 uHighlightColor;
uniform float uIntensity;

void main(void) {
  vec4 orig = texture(uTexture, vTextureCoord);
  if (uIntensity <= 0.0 || orig.a <= 0.0) {
    finalColor = orig;
    return;
  }

  vec3 rgb = orig.rgb / orig.a;
  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  vec3 mapped = mix(uShadowColor, uHighlightColor, lum);
  vec3 outRgb = mix(rgb, mapped, uIntensity) * orig.a;

  finalColor = vec4(outRgb, orig.a);
}
`;

export function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) / 255;
    const g = parseInt(clean[1] + clean[1], 16) / 255;
    const b = parseInt(clean[2] + clean[2], 16) / 255;
    return [r, g, b];
  }
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return [isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b];
}

export interface DuotoneFilterOptions {
  shadowColor?: string;
  highlightColor?: string;
  intensity?: number;
}

export class DuotoneFilter extends Filter {
  constructor(options: DuotoneFilterOptions = {}) {
    const gpuProgram = GpuProgram.from({
      vertex: { source: wgslSource, entryPoint: 'mainVertex' },
      fragment: { source: wgslSource, entryPoint: 'mainFragment' }
    });

    const glProgram = GlProgram.from({
      vertex: defaultFilterVert,
      fragment: glslFragment,
      name: 'duotone-filter'
    });

    const shadow = hexToRgb01(options.shadowColor || '#180033');
    const highlight = hexToRgb01(options.highlightColor || '#00ffcc');

    const uniforms = new UniformGroup({
      uShadowColor: { value: new Float32Array(shadow), type: 'vec3<f32>' },
      uIntensity: { value: options.intensity ?? 1.0, type: 'f32' },
      uHighlightColor: { value: new Float32Array(highlight), type: 'vec3<f32>' },
      uPadding: { value: 0.0, type: 'f32' }
    });

    super({
      gpuProgram,
      glProgram,
      resources: {
        duotoneUniforms: uniforms
      }
    });
  }

  setColors(shadowHex: string, highlightHex: string, intensity: number) {
    const shadow = hexToRgb01(shadowHex);
    const highlight = hexToRgb01(highlightHex);

    const shadowArr = this.resources.duotoneUniforms.uniforms.uShadowColor as Float32Array;
    shadowArr[0] = shadow[0];
    shadowArr[1] = shadow[1];
    shadowArr[2] = shadow[2];

    const highlightArr = this.resources.duotoneUniforms.uniforms.uHighlightColor as Float32Array;
    highlightArr[0] = highlight[0];
    highlightArr[1] = highlight[1];
    highlightArr[2] = highlight[2];

    this.resources.duotoneUniforms.uniforms.uIntensity = intensity;
  }
}
