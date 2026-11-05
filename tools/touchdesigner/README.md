# Standalone TouchDesigner animations

`gif_rings.py` and `gif_tunnel.py` are the original folder-based scripts.
`gif_rings_v2.py` and `gif_tunnel_v2.py` add live TOP sources while retaining the
folder workflow. Each file is self-contained: paste the whole script into a Text
DAT or point the DAT's File parameter at it, then Run Script. No Slapchop process,
plugin, or additional Python package installation is required inside TouchDesigner.

V2 creates `gif_rings_v2` / `gif_tunnel_v2` next to the builder DAT (with `_comp`
appended if the DAT occupies that name). It never updates a v1 component. Running
a v2 builder again updates its v2 component, retains its parameter values, and
refreshes sources. The output is `out1` inside the component.

## Source controls

On the **Sources** page, choose **Source Mode**:

- **GIF Folder** (default): set GIF Folder on the Rings/Tunnel page. GIFs, PNGs,
  and JPEGs load through the original frame atlas and retain per-ring GIF timing.
- **TOP List**: assign one or more external TOP paths to **Source TOPs**, separated
  by spaces, in the desired order. Absolute paths work well, for example
  `/project1/textures/tex_001 /project1/textures/tex_002`. Typed TOP references
  resolve through `eval()` first, with `evalOPs()` as a fallback; expressions
  returning TOP references are also supported.
- **Texture COMP**: assign a BASE or another COMP to **Texture COMP**. Its immediate
  TOP children matching **TOP Pattern** (default `tex_*`, case-sensitive) are
  collected in natural numeric name order: `tex_1`, `tex_2`, `tex_10`.

Publish each texture through a Null TOP inside your collection:

```text
/project1/textures/
  noise_network/  -> tex_001
  video_network/  -> tex_002
  feedback_chain/ -> tex_003
```

The collection is shallow: internal processing nodes and TOPs inside nested
networks are not collected. Use a single wildcard pattern, such as `tex_*` or
`out?`. Non-TOP children are ignored. Source parameter changes refresh immediately;
pulse **Refresh Sources** after adding, removing, or renaming published outputs.
Empty collections, duplicate TOPs, and references inside the renderer produce a
Status error. A removed active source clears the live graph until you refresh.

One source is assigned to each ring using the existing order/shuffle rules, and
repeats around that ring. At most 256 live sources are supported. Use ordinary 2D
color TOPs; texture arrays, volumes, and depth textures are outside this workflow.
Keep sources external to the renderer and do not feed the renderer's output back
into an upstream source network.

**Source Alpha** defaults to **Premultiplied**. Choose **Straight** if all source
TOPs use straight alpha; v2 then premultiplies on the GPU before atlas filtering.
For mixed conventions, normalize individual sources upstream and publish all of
them with the same convention. Opaque sources work with either setting.

**Texture Antialiasing**, on the Sources page, controls sampling inside each
rendered pixel: **Off (1 sample)**, **Smooth (4 samples)** (default), or
**High (16 samples)**. It applies to both folder and live sources. Try High for
jagged or shimmering alpha edges on small/rotated textures; it costs more GPU
work. The shader averages premultiplied RGBA before alpha conversion and clamps
each tap to its tile. Tunnel wraps each tap before clamping, preserving repeat
and mirror seams. Atlas mipmaps remain unused because coarse levels can blend
unrelated tiles. Explicit linear filtering is used when packing and sampling.
Rings now also requests 4x render MSAA for geometry boundaries, as Tunnel does.

Source Alpha controls the color convention at transparent edges; it is separate
from texture antialiasing. Increasing Cell Size cannot restore detail missing
from the original source or replace pixel-coverage filtering. V2's default
sampling intentionally differs from v1; use Off for the closest sampling match.

**Atlas Cell Size**, on the Rings/Tunnel page, controls each source's square tile
resolution. Original source dimensions determine Rings card proportions and
Tunnel cropping; packing does not redefine the source aspect ratio. Resolution
changes update that metadata each frame. The atlas uses RGBA16F. Larger cells and
many sources increase GPU memory usage; start small. Live source pixels never
pass through NumPy. The generated `live_sources` network is rebuilt on refresh;
put custom processing in your external texture network. A parent-level
`atlas_select` Select TOP references either `atlas` or `live_sources/live_atlas`
and feeds `texture_atlas`; no TOP wire crosses the BASE boundary.

## Timing

Live TOPs show their current image. All rings using the same TOP see the same
image, regardless of GIF phase or playback speed. Upstream networks own their
animation; the renderer's **Time** still controls geometry and scene modulation.
To record reproducible frames, drive upstream animation from the same explicit
time as the renderer. Cameras, feedback, and wall-clock playback do not become
seekable merely by changing the renderer's Time parameter.

## Local regression checks

The Python tests require NumPy, which TouchDesigner bundles. With a suitable
Python, run from the repository root:

```sh
python3 -B -m unittest discover -s tools/touchdesigner
```

On macOS with TouchDesigner installed in `/Applications`, its bundled interpreter
can run the checks directly:

```sh
/Applications/TouchDesigner.app/Contents/Frameworks/Python.framework/Versions/3.11/bin/python3.11 -B -m unittest discover -s tools/touchdesigner
```

Tests cover source selection, atlas bookkeeping, source lifecycle, live timing,
and numerical folder-rendering compatibility with v1. They do not compile shaders
or verify TouchDesigner operator cooking and rendering.

An optional macOS offscreen GPU check compiles and links the actual shaders,
compares alpha coverage at 1/4/16 samples against a higher-resolution reference,
and tests isolation from adjacent tiles in clamp, repeat, and mirror modes:

```sh
python3 -B tools/touchdesigner/check_texture_aa.py
```

It requires NumPy and access to a macOS OpenGL context. It does not exercise the
TouchDesigner network or replace the smoke test below.

## TouchDesigner smoke test

Run these checks for both v2 scripts in the target TouchDesigner build:

1. Build v1 and v2 side by side. In folder mode, use a static image and animated
   GIF, match all parameters and Time, and compare `out1` results.
2. Use TOP List with one animated TOP, then multiple TOPs of different aspect
   ratios. Confirm animation updates without Refresh Sources, ordering remains
   stable, and Rings proportions / Tunnel cropping are correct.
3. Publish five distinct, numbered/color-coded TOPs in a BASE. Confirm the
   bottom-left atlas tile is the first source, rows fill left to right and then
   upward, and the last unused cell is transparent. Test natural numeric ordering
   with `tex_1`, `tex_2`, and `tex_10`.
4. Test translucent edges in Premultiplied and Straight modes. Compare Texture
   Antialiasing Off, Smooth, and High on rotated, moving, near and distant
   textures, checking both image quality and frame rate. Check for dark
   fringes, cell bleeding, shader errors, and transparent gaps in Tunnel.
5. Change a source's resolution; add/remove/rename sources and refresh. Confirm
   Status explains missing sources and that a refresh recovers.
6. Switch to TOPs while a GIF folder is still loading, then switch back. Re-run
   the builder, edit the engine DAT, and reopen a saved `.toe`; confirm sources
   rebuild without stale tiles or delayed GIF jobs replacing the active atlas.
7. Record a short animation, checking that upstream TOP animation advances as
   expected. Scrub explicitly time-driven sources together with renderer Time.
   Inspect cook times and GPU memory with representative source counts/cell sizes.

Implementation references: [Layout TOP](https://derivative.ca/UserGuide/Layout_TOP),
[custom parameter creation](https://derivative.ca/UserGuide/Page_Class),
[parameter evaluation](https://derivative.ca/UserGuide/Par_Class), and
[GLSL TOP](https://derivative.ca/UserGuide/GLSL_TOP).
