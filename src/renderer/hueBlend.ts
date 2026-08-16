import { BlendModeFilter, ExtensionType, extensions, hslgl, hslgpu } from 'pixi.js';

// Pixi's advanced-blend-modes entry ships saturation/color/luminosity but not
// hue. W3C compositing spec: B(cb, cs) = setLum(setSat(cs, sat(cb)), lum(cb)).
class HueBlend extends BlendModeFilter {
  static extension = {
    name: 'hue',
    type: ExtensionType.BlendMode
  };

  constructor() {
    super({
      gl: {
        functions: `
          ${hslgl}

          vec3 blendHue(vec3 base, vec3 blend, float opacity)
          {
            vec3 blendHue = setLuminosity(setSaturation(blend, getSaturation(base)), getLuminosity(base));
            return (blendHue * opacity + base * (1.0 - opacity));
          }
        `,
        main: `
          finalColor = vec4(blendHue(back.rgb, front.rgb, front.a), blendedAlpha) * uBlend;
        `
      },
      gpu: {
        functions: `
          ${hslgpu}

          fn blendHue(base: vec3<f32>, blend: vec3<f32>, opacity: f32) -> vec3<f32>
          {
            let blendHue = setLuminosity(setSaturation(blend, getSaturation(base)), getLuminosity(base));
            return (blendHue * opacity + base * (1.0 - opacity));
          }
        `,
        main: `
          out = vec4<f32>(blendHue(back.rgb, front.rgb, front.a), blendedAlpha) * blendUniforms.uBlend;
        `
      }
    });
  }
}

extensions.add(HueBlend);
