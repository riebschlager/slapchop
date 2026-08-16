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

struct ScanlinesUniforms {
  uCount: f32,
  uOpacity: f32,
  uTime: f32,
  uPadding: f32,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> scanlinesUniforms: ScanlinesUniforms;

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
  if (scanlinesUniforms.uOpacity <= 0.0) {
    return orig;
  }

  var line = sin((uv.y * scanlinesUniforms.uCount + scanlinesUniforms.uTime) * 6.2831853) * 0.5 + 0.5;
  var dim = 1.0 - (line * scanlinesUniforms.uOpacity);

  return vec4<f32>(orig.rgb * dim, orig.a);
}
`;

const glslFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uCount;
uniform float uOpacity;
uniform float uTime;

void main(void) {
  vec4 orig = texture(uTexture, vTextureCoord);
  if (uOpacity <= 0.0) {
    finalColor = orig;
    return;
  }

  float line = sin((vTextureCoord.y * uCount + uTime) * 6.2831853) * 0.5 + 0.5;
  float dim = 1.0 - (line * uOpacity);

  finalColor = vec4(orig.rgb * dim, orig.a);
}
`;

export interface ScanlinesFilterOptions {
  count?: number;
  opacity?: number;
  time?: number;
}

export class ScanlinesFilter extends Filter {
  constructor(options: ScanlinesFilterOptions = {}) {
    const gpuProgram = GpuProgram.from({
      vertex: { source: wgslSource, entryPoint: 'mainVertex' },
      fragment: { source: wgslSource, entryPoint: 'mainFragment' }
    });

    const glProgram = GlProgram.from({
      vertex: defaultFilterVert,
      fragment: glslFragment,
      name: 'scanlines-filter'
    });

    const uniforms = new UniformGroup({
      uCount: { value: options.count ?? 300, type: 'f32' },
      uOpacity: { value: options.opacity ?? 0.25, type: 'f32' },
      uTime: { value: options.time ?? 0, type: 'f32' },
      uPadding: { value: 0.0, type: 'f32' }
    });

    super({
      gpuProgram,
      glProgram,
      resources: {
        scanlinesUniforms: uniforms
      }
    });
  }

  setParams(count: number, opacity: number, time: number) {
    this.resources.scanlinesUniforms.uniforms.uCount = count;
    this.resources.scanlinesUniforms.uniforms.uOpacity = opacity;
    this.resources.scanlinesUniforms.uniforms.uTime = time;
  }
}
