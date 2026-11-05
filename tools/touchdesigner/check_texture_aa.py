"""Optional macOS GPU checks: compile real shaders, compare alpha coverage,
then check atlas isolation for clamp, repeat, and mirror texture modes.
Run with a Python containing NumPy; no TouchDesigner process is required.
"""
import ctypes as C
import importlib.util
from pathlib import Path
import sys

if sys.platform != 'darwin':
    raise SystemExit('This optional offscreen GPU check requires macOS OpenGL and NumPy.')

gl = C.CDLL('/System/Library/Frameworks/OpenGL.framework/OpenGL')
def fn(name, result, args):
    f = getattr(gl, name)
    f.restype, f.argtypes = result, args
    return f
choose = fn('CGLChoosePixelFormat', C.c_int, [C.POINTER(C.c_int), C.POINTER(C.c_void_p), C.POINTER(C.c_int)])
create = fn('CGLCreateContext', C.c_int, [C.c_void_p, C.c_void_p, C.POINTER(C.c_void_p)])
current = fn('CGLSetCurrentContext', C.c_int, [C.c_void_p])
attrs = (C.c_int * 3)(99, 0x4100, 0)
pixel, count, context = C.c_void_p(), C.c_int(), C.c_void_p()
error = choose(attrs, C.byref(pixel), C.byref(count))
if error or not pixel.value:
    raise SystemExit('OpenGL context unavailable: CGLChoosePixelFormat error {}'.format(error))
assert create(pixel, None, C.byref(context)) == 0
assert current(context) == 0
create_shader = fn('glCreateShader', C.c_uint, [C.c_uint])
shader_source = fn('glShaderSource', None, [C.c_uint, C.c_int, C.POINTER(C.c_char_p), C.POINTER(C.c_int)])
compile_shader = fn('glCompileShader', None, [C.c_uint])
shader_iv = fn('glGetShaderiv', None, [C.c_uint, C.c_uint, C.POINTER(C.c_int)])
shader_log = fn('glGetShaderInfoLog', None, [C.c_uint, C.c_int, C.POINTER(C.c_int), C.c_void_p])
create_program = fn('glCreateProgram', C.c_uint, [])
attach = fn('glAttachShader', None, [C.c_uint, C.c_uint])
link = fn('glLinkProgram', None, [C.c_uint])
program_iv = fn('glGetProgramiv', None, [C.c_uint, C.c_uint, C.POINTER(C.c_int)])
program_log = fn('glGetProgramInfoLog', None, [C.c_uint, C.c_int, C.POINTER(C.c_int), C.c_void_p])

def compile(kind, text):
    shader = create_shader(kind)
    data = C.c_char_p(text.encode())
    shader_source(shader, 1, C.byref(data), None)
    compile_shader(shader)
    ok = C.c_int()
    shader_iv(shader, 0x8B81, C.byref(ok))
    log = C.create_string_buffer(8192)
    shader_log(shader, len(log), None, log)
    assert ok.value, log.value.decode()
    return shader

modules = []
for mode in ('rings', 'tunnel'):
    path = Path(__file__).resolve().parent / ('gif_' + mode + '_v2.py')
    spec = importlib.util.spec_from_file_location(mode, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    vertex = compile(0x8B31, '#version 410 core\nin vec3 P;\nint TDInstanceID() { return gl_InstanceID; }\n' + module.VERTEX_SHADER)
    fragment = compile(0x8B30, '#version 410 core\nvec4 TDOutputSwizzle(vec4 c) { return c; }\n' + module.PIXEL_SHADER)
    program = create_program()
    attach(program, vertex)
    attach(program, fragment)
    link(program)
    ok = C.c_int()
    program_iv(program, 0x8B82, C.byref(ok))
    log = C.create_string_buffer(8192)
    program_log(program, len(log), None, log)
    assert ok.value, log.value.decode()
    print(mode + ': vertex and pixel shaders compile and link on OpenGL 4.1')
    modules.append(module)

import numpy as np
# Render the real fragment shaders with a full-screen test vertex shader.
gen_textures = fn('glGenTextures', None, [C.c_int, C.POINTER(C.c_uint)])
bind_texture = fn('glBindTexture', None, [C.c_uint, C.c_uint])
tex_image = fn('glTexImage2D', None, [C.c_uint, C.c_int, C.c_int, C.c_int, C.c_int, C.c_int, C.c_uint, C.c_uint, C.c_void_p])
tex_param = fn('glTexParameteri', None, [C.c_uint, C.c_uint, C.c_int])
gen_fbo = fn('glGenFramebuffers', None, [C.c_int, C.POINTER(C.c_uint)])
bind_fbo = fn('glBindFramebuffer', None, [C.c_uint, C.c_uint])
attach_tex = fn('glFramebufferTexture2D', None, [C.c_uint, C.c_uint, C.c_uint, C.c_uint, C.c_int])
use = fn('glUseProgram', None, [C.c_uint])
location = fn('glGetUniformLocation', C.c_int, [C.c_uint, C.c_char_p])
uni1i = fn('glUniform1i', None, [C.c_int, C.c_int])
uni1f = fn('glUniform1f', None, [C.c_int, C.c_float])
uni4f = fn('glUniform4f', None, [C.c_int, C.c_float, C.c_float, C.c_float, C.c_float])
viewport = fn('glViewport', None, [C.c_int, C.c_int, C.c_int, C.c_int])
clear_color = fn('glClearColor', None, [C.c_float] * 4)
clear = fn('glClear', None, [C.c_uint])
draw = fn('glDrawArrays', None, [C.c_uint, C.c_int, C.c_int])
read = fn('glReadPixels', None, [C.c_int, C.c_int, C.c_int, C.c_int, C.c_uint, C.c_uint, C.c_void_p])
gen_vao = fn('glGenVertexArrays', None, [C.c_int, C.POINTER(C.c_uint)])
bind_vao = fn('glBindVertexArray', None, [C.c_uint])
vao = C.c_uint()
gen_vao(1, C.byref(vao)); bind_vao(vao)
fbo = C.c_uint(); gen_fbo(1, C.byref(fbo)); bind_fbo(0x8D40, fbo)
output = C.c_uint(); gen_textures(1, C.byref(output))
source = C.c_uint(); gen_textures(1, C.byref(source))

def upload(data):
    data = np.ascontiguousarray(data, dtype=np.float32)
    bind_texture(0x0DE1, source)
    tex_image(0x0DE1, 0, 0x8814, data.shape[1], data.shape[0], 0, 0x1908, 0x1406, data.ctypes.data)
    for param in (0x2800, 0x2801):
        tex_param(0x0DE1, param, 0x2601)
    for param in (0x2802, 0x2803):
        tex_param(0x0DE1, param, 0x812F)

def render(program, size, side, tile=(0,0,1,1), scale=1, tiling=0):
    bind_texture(0x0DE1, output)
    tex_image(0x0DE1, 0, 0x8814, size, size, 0, 0x1908, 0x1406, None)
    attach_tex(0x8D40, 0x8CE0, 0x0DE1, output, 0)
    bind_texture(0x0DE1, source)
    use(program)
    uni1i(location(program, b'sAtlas'), 0)
    uni1f(location(program, b'uTextureAA'), side)
    uni1f(location(program, b'uScale'), scale)
    uni1f(location(program, b'uTiling'), tiling)
    uni4f(location(program, b'uTile'), *tile)
    viewport(0,0,size,size)
    clear_color(0,0,0,0); clear(0x4000)
    draw(0x0004,0,3)
    result = np.zeros((size,size,4), np.float32)
    read(0,0,size,size,0x1908,0x1406,result.ctypes.data)
    return result

for module in modules:
    is_rings = 'rings' in module.COMP_NAME
    varying = ('flat out float vAlpha;' if is_rings else
               'out float vFogDepth; flat out vec4 vColor; flat out vec4 vLook; flat out vec3 vFogColor;')
    assignment = ('vAlpha=1.0;' if is_rings else 'vFogDepth=1.0;vColor=vec4(0,0,0,2);vLook=vec4(0,uTiling,0,0);vFogColor=vec3(0);')
    vert = '''#version 410 core
out vec2 vUV; flat out vec4 vTile;
uniform vec4 uTile;
uniform float uScale, uTiling;
''' + varying + '''
void main() {
    vec2 p[3] = vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));
    gl_Position=vec4(p[gl_VertexID],0,1);
    vec2 uv = p[gl_VertexID]*0.5+0.5;
    vUV=mat2(0.83,0.31,-0.31,0.83)*(uv-0.5)*uScale+0.5;
    vTile=uTile;
''' + assignment + '}\n'
    vs = compile(0x8B31,vert)
    fs = compile(0x8B30,'#version 410 core\nvec4 TDOutputSwizzle(vec4 c){return c;}\n'+module.PIXEL_SHADER)
    program=create_program(); attach(program,vs); attach(program,fs); link(program)
    ok=C.c_int(); program_iv(program,0x8B82,C.byref(ok)); assert ok.value
    y,x=np.mgrid[:128,:128]
    alpha=((x*0.63-y+10)>0).astype(np.float32)
    pixels=np.stack([alpha,np.zeros_like(alpha),np.zeros_like(alpha),alpha],axis=-1)
    upload(pixels)
    reference=render(program,192,4)[...,3].reshape(24,8,24,8).mean(axis=(1,3))
    errors=[]
    for side in (1,2,4):
        alpha=render(program,24,side)[...,3]
        errors.append(float(np.mean((alpha-reference)**2)))
    assert errors[1]<errors[0] and errors[2]<errors[1], errors
    # An opaque green neighbor must never enter the red tile, even with footprint taps.
    pixels=np.zeros((64,128,4),np.float32)
    pixels[:,:64,0]=1; pixels[:,64:,1]=1; pixels[:,:,3]=1
    upload(pixels)
    for tiling in ((0,) if is_rings else range(5)):
        result=render(program,24,4,(0,0,0.5,1),scale=3,tiling=tiling)
        assert np.max(np.abs(result[...,1]))<1e-6
        assert np.min(result[...,0])>0.999
    print(module.COMP_NAME+': alpha MSE at 1/4/16 samples: '+str(errors)+'; no neighboring tile bleed')
