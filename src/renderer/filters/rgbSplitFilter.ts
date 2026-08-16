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

struct RgbSplitUniforms {
  uOffset: vec2<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> rgbSplitUniforms: RgbSplitUniforms;

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
  var offset = rgbSplitUniforms.uOffset;
  var orig = textureSample(uTexture, uSampler, uv);
  if (offset.x == 0.0 && offset.y == 0.0) {
    return orig;
  }
  var r = textureSample(uTexture, uSampler, uv + offset).r;
  var g = orig.g;
  var b = textureSample(uTexture, uSampler, uv - offset).b;
  return vec4<f32>(r, g, b, orig.a);
}
`;

const glslFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec2 uOffset;

void main(void) {
  vec4 orig = texture(uTexture, vTextureCoord);
  if (uOffset.x == 0.0 && uOffset.y == 0.0) {
    finalColor = orig;
    return;
  }
  float r = texture(uTexture, vTextureCoord + uOffset).r;
  float g = orig.g;
  float b = texture(uTexture, vTextureCoord - uOffset).b;
  finalColor = vec4(r, g, b, orig.a);
}
`;

export interface RgbSplitFilterOptions {
  offsetX?: number;
  offsetY?: number;
}

export class RgbSplitFilter extends Filter {
  constructor(options: RgbSplitFilterOptions = {}) {
    const gpuProgram = GpuProgram.from({
      vertex: { source: wgslSource, entryPoint: 'mainVertex' },
      fragment: { source: wgslSource, entryPoint: 'mainFragment' }
    });

    const glProgram = GlProgram.from({
      vertex: defaultFilterVert,
      fragment: glslFragment,
      name: 'rgb-split-filter'
    });

    const uniforms = new UniformGroup({
      uOffset: { value: new Float32Array([options.offsetX ?? 0, options.offsetY ?? 0]), type: 'vec2<f32>' }
    });

    super({
      gpuProgram,
      glProgram,
      resources: {
        rgbSplitUniforms: uniforms
      }
    });
  }

  setOffset(dx: number, dy: number) {
    const offset = this.resources.rgbSplitUniforms.uniforms.uOffset as Float32Array;
    offset[0] = dx;
    offset[1] = dy;
  }
}
