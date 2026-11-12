"""
KLOEPPEL - Roblox-ready stylized 3D model, built procedurally with Blender (bpy).

Run:  python build_kloeppel.py [--stage geo|full]
Outputs (next to this script):
  kloeppel_roblox.blend, kloeppel_roblox.fbx, kloeppel_roblox.glb,
  kloeppel_texture.png, preview renders.

Conventions: meters, Blender Z-up, character faces -Y.
Concept coords are written as C(x, up, fwd) and mapped to Blender (x, -fwd, up).
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix, Quaternion

OUT = os.path.dirname(os.path.abspath(__file__))
STAGE = sys.argv[sys.argv.index("--stage") + 1] if "--stage" in sys.argv else "full"
TEX_RES = 1024


def C(x, up, fwd):
    return Vector((x, -fwd, up))


# ------------------------------------------------------------------ scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


# ------------------------------------------------------------------ metaball helpers
SURF = 0.672  # surface radius factor for a stiffness-2 ball at threshold 0.6


class Blob:
    def __init__(self, name, res=0.035):
        self.mb = bpy.data.metaballs.new(name)
        self.mb.resolution = res
        self.mb.render_resolution = res
        self.mb.threshold = 0.6
        self.obj = link(bpy.data.objects.new(name, self.mb))

    def ball(self, c, r, stiff=2.0):
        e = self.mb.elements.new(type='BALL')
        e.co = c
        e.radius = r / SURF
        e.stiffness = stiff
        return e

    def ell(self, c, rx, ry, rz, rot=None, stiff=2.0):
        e = self.mb.elements.new(type='ELLIPSOID')
        e.co = c
        e.radius = 1.0 / SURF
        e.size_x, e.size_y, e.size_z = rx, ry, rz
        e.stiffness = stiff
        if rot is not None:
            e.rotation = rot
        return e

    def cap(self, a, b, r, stiff=2.0):
        d = b - a
        e = self.mb.elements.new(type='CAPSULE')
        e.co = (a + b) / 2
        e.radius = r / SURF
        e.size_x = d.length / 2
        e.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized())
        e.stiffness = stiff
        return e

    def taper(self, a, b, r1, r2, n=4):
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            r = r1 + (r2 - r1) * (i + 0.5) / n
            self.cap(a.lerp(b, t0), a.lerp(b, t1), r)

    def to_mesh(self, voxel=0.022, tris=None):
        activate(self.obj)
        bpy.ops.object.convert(target='MESH')
        obj = bpy.context.active_object
        if voxel:
            m = obj.modifiers.new("remesh", 'REMESH')
            m.mode = 'VOXEL'
            m.voxel_size = voxel
            m.use_smooth_shade = True
            bpy.ops.object.modifier_apply(modifier=m.name)
        if tris:
            decimate_to(obj, tris)
        return obj


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def decimate_to(obj, tris):
    cur = tri_count(obj)
    if cur > tris:
        activate(obj)
        m = obj.modifiers.new("dec", 'DECIMATE')
        m.ratio = tris / cur
        bpy.ops.object.modifier_apply(modifier=m.name)


def shade_smooth(obj, angle=50):
    activate(obj)
    bpy.ops.object.shade_smooth()
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle))
    except Exception:
        pass


def cone(name, base, tip, r, verts=8, r_tip=0.0):
    d = tip - base
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r_tip, depth=d.length)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    obj.matrix_world = Matrix.Translation((base + tip) / 2) @ q.to_matrix().to_4x4()
    return obj


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    activate(o)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o


# ------------------------------------------------------------------ materials
def node_mat(name, build):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    build(nt, bsdf)
    return m


def hexc(h, a=1.0):
    h = h.lstrip('#')
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, a)


def ramp(nt, fac_socket, stops):
    r = nt.nodes.new('ShaderNodeValToRGB')
    cr = r.color_ramp
    cr.interpolation = 'LINEAR'
    while len(cr.elements) > len(stops):
        cr.elements.remove(cr.elements[-1])
    while len(cr.elements) < len(stops):
        cr.elements.new(0.5)
    for el, (pos, col) in zip(cr.elements, stops):
        el.position = pos
        el.color = hexc(col)
    nt.links.new(fac_socket, r.inputs[0])
    return r


def noise(nt, scale, detail=3.0, coord='Object', stretch=None):
    tc = nt.nodes.new('ShaderNodeTexCoord')
    src = tc.outputs[coord]
    if stretch:
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = stretch
        nt.links.new(src, mp.inputs[0])
        src = mp.outputs[0]
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    nt.links.new(src, n.inputs['Vector'])
    return n


def mix(nt, fac, a, b, blend='MIX'):
    m = nt.nodes.new('ShaderNodeMix')
    m.data_type = 'RGBA'
    m.blend_type = blend
    nt.links.new(fac, m.inputs['Factor'])
    for sock, v in ((m.inputs[6], a), (m.inputs[7], b)):
        if isinstance(v, tuple):
            sock.default_value = v
        else:
            nt.links.new(v, sock)
    return m.outputs[2]


def mop(nt, op, a, b=None):
    m = nt.nodes.new('ShaderNodeMath'); m.operation = op
    for sock, v in ((m.inputs[0], a), (m.inputs[1], b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            sock.default_value = v
        else:
            nt.links.new(v, sock)
    return m.outputs[0]


def bump(nt, bsdf, height, strength, distance=0.02):
    b = nt.nodes.new('ShaderNodeBump')
    b.inputs['Strength'].default_value = strength
    b.inputs['Distance'].default_value = distance
    nt.links.new(height, b.inputs['Height'])
    nt.links.new(b.outputs['Normal'], bsdf.inputs['Normal'])


def mat_skin(nt, bsdf):
    # stylized: two-tone grey-violet skin, bruise blotches, raw muscle patches, blood trails
    n1 = noise(nt, 3.0, 2.0)
    base = ramp(nt, n1.outputs['Fac'], [(0.35, '#55554a'), (0.65, '#77745f')])
    n2 = noise(nt, 1.6, 2.0)
    br = ramp(nt, n2.outputs['Fac'], [(0.58, '#000000'), (0.68, '#ffffff')])
    c = mix(nt, br.outputs[0], base.outputs[0], hexc('#4d3440'))
    n3 = noise(nt, 2.0, 4.0)
    mus_mask = ramp(nt, n3.outputs['Fac'], [(0.585, '#000000'), (0.60, '#ffffff')])
    n4 = noise(nt, 14.0, 1.0, stretch=(1, 1, 0.25))
    mus = ramp(nt, n4.outputs['Fac'], [(0.4, '#4a0f10'), (0.6, '#7a2220')])
    c = mix(nt, mus_mask.outputs[0], c, mus.outputs[0])
    # blood trails (vertical streaks, chest/front area)
    n5 = noise(nt, 9.0, 1.0, stretch=(1, 1, 0.08))
    bl = ramp(nt, n5.outputs['Fac'], [(0.62, '#000000'), (0.66, '#ffffff')])
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs[0])
    zr = nt.nodes.new('ShaderNodeMapRange')
    zr.inputs[1].default_value, zr.inputs[2].default_value = 0.9, 1.6
    nt.links.new(sep.outputs['Z'], zr.inputs[0])
    yr = nt.nodes.new('ShaderNodeMapRange')
    yr.inputs[1].default_value, yr.inputs[2].default_value = 0.0, -0.4
    nt.links.new(sep.outputs['Y'], yr.inputs[0])
    m1 = nt.nodes.new('ShaderNodeMath'); m1.operation = 'MULTIPLY'
    nt.links.new(bl.outputs[0], m1.inputs[0]); nt.links.new(zr.outputs[0], m1.inputs[1])
    m2 = nt.nodes.new('ShaderNodeMath'); m2.operation = 'MULTIPLY'
    nt.links.new(m1.outputs[0], m2.inputs[0]); nt.links.new(yr.outputs[0], m2.inputs[1])
    c = mix(nt, m2.outputs[0], c, hexc('#3a0b0c'))
    # dirty, darker extremities (hands & feet in the dirt)
    lo = nt.nodes.new('ShaderNodeMapRange')
    lo.inputs[1].default_value, lo.inputs[2].default_value = 0.55, 0.05
    nt.links.new(sep.outputs['Z'], lo.inputs[0])
    c = mix(nt, lo.outputs[0], c, hexc('#2c2622'))
    # thin dark veins
    nv = noise(nt, 3.5, 5.0)
    vr = ramp(nt, nv.outputs['Fac'], [(0.485, '#000000'), (0.5, '#ffffff'), (0.515, '#000000')])
    vm = nt.nodes.new('ShaderNodeMath'); vm.operation = 'MULTIPLY'; vm.inputs[1].default_value = 0.55
    nt.links.new(vr.outputs[0], vm.inputs[0])
    c = mix(nt, vm.outputs[0], c, hexc('#3b2d3a'))
    # fine mottling / pores in the colour
    npo = noise(nt, 60.0, 4.0)
    pr = ramp(nt, npo.outputs['Fac'], [(0.3, '#000000'), (0.7, '#ffffff')])
    c = mix(nt, mop(nt, 'MULTIPLY', pr.outputs[0], 0.18), c, hexc('#2f2b25'))
    nt.links.new(c, bsdf.inputs['Base Color'])
    # height: wrinkles + pores + raised veins + muscle fibres in the flayed patches
    nw = noise(nt, 9.0, 6.0, stretch=(1, 1, 3.0))
    h = mop(nt, 'MULTIPLY', nw.outputs['Fac'], 0.6)
    h = mop(nt, 'ADD', h, mop(nt, 'MULTIPLY', npo.outputs['Fac'], 0.25))
    h = mop(nt, 'ADD', h, mop(nt, 'MULTIPLY', vr.outputs[0], 0.5))
    h = mop(nt, 'ADD', h, mop(nt, 'MULTIPLY', mop(nt, 'MULTIPLY', n4.outputs['Fac'], mus_mask.outputs[0]), 1.2))
    h = mop(nt, 'SUBTRACT', h, mop(nt, 'MULTIPLY', mus_mask.outputs[0], 0.6))   # flayed areas sit lower
    bump(nt, bsdf, h, 1.0, 0.06)
    # roughness: dry skin, wet muscle and blood
    r = mop(nt, 'SUBTRACT', 0.72, mop(nt, 'MULTIPLY', mus_mask.outputs[0], 0.40))
    r = mop(nt, 'SUBTRACT', r, mop(nt, 'MULTIPLY', m2.outputs[0], 0.45))
    nt.links.new(mop(nt, 'MAXIMUM', r, 0.18), bsdf.inputs['Roughness'])


def mat_bone(nt, bsdf):
    n1 = noise(nt, 6.0, 3.0)
    base = ramp(nt, n1.outputs['Fac'], [(0.35, '#b3a281'), (0.7, '#ddd0ad')])
    # painted dark sockets / pits
    vor = nt.nodes.new('ShaderNodeTexVoronoi')
    vor.inputs['Scale'].default_value = 3.2
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(tc.outputs['Object'], vor.inputs['Vector'])
    pits = ramp(nt, vor.outputs['Distance'], [(0.20, '#ffffff'), (0.26, '#000000')])
    c = mix(nt, pits.outputs[0], base.outputs[0], hexc('#2b2119'))
    # cracks / sutures
    n2 = noise(nt, 5.0, 4.0)
    cr = ramp(nt, n2.outputs['Fac'], [(0.48, '#000000'), (0.5, '#ffffff'), (0.52, '#000000')])
    c = mix(nt, cr.outputs[0], c, hexc('#6e5c44'))
    nt.links.new(c, bsdf.inputs['Base Color'])
    nb = noise(nt, 25.0, 5.0)
    h = mop(nt, 'MULTIPLY', nb.outputs['Fac'], 0.3)
    h = mop(nt, 'SUBTRACT', h, mop(nt, 'MULTIPLY', pits.outputs[0], 1.0))
    h = mop(nt, 'SUBTRACT', h, mop(nt, 'MULTIPLY', cr.outputs[0], 0.5))
    bump(nt, bsdf, h, 1.0, 0.07)
    nt.links.new(mop(nt, 'ADD', 0.5, mop(nt, 'MULTIPLY', nb.outputs['Fac'], 0.25)), bsdf.inputs['Roughness'])


def mat_bell(nt, bsdf):
    mat_bone(nt, bsdf)
    # blood soaking the lower rim (bell local -Z is mouth direction after rotation; use object Z)
    link_in = bsdf.inputs['Base Color'].links[0].from_socket
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    n = noise(nt, 6.0, 2.0)
    add = nt.nodes.new('ShaderNodeMath'); add.operation = 'ADD'
    nt.links.new(sep.outputs['Z'], add.inputs[0])
    sc = nt.nodes.new('ShaderNodeMath'); sc.operation = 'MULTIPLY'; sc.inputs[1].default_value = 0.25
    nt.links.new(n.outputs['Fac'], sc.inputs[0]); nt.links.new(sc.outputs[0], add.inputs[1])
    r = ramp(nt, add.outputs[0], [(0.30, '#ffffff'), (0.42, '#000000')])
    c = mix(nt, r.outputs[0], link_in, hexc('#4a0f0e'))
    nt.links.new(c, bsdf.inputs['Base Color'])
    rough_in = bsdf.inputs['Roughness'].links[0].from_socket
    nt.links.new(mop(nt, 'SUBTRACT', rough_in, mop(nt, 'MULTIPLY', r.outputs[0], 0.35)), bsdf.inputs['Roughness'])


def mat_flesh(nt, bsdf):
    n1 = noise(nt, 8.0, 3.0)
    base = ramp(nt, n1.outputs['Fac'], [(0.3, '#5c0f12'), (0.7, '#a8302c')])
    nt.links.new(base.outputs[0], bsdf.inputs['Base Color'])
    nr = noise(nt, 30.0, 3.0, stretch=(3.0, 3.0, 0.4))
    bump(nt, bsdf, mop(nt, 'ADD', nr.outputs['Fac'], mop(nt, 'MULTIPLY', n1.outputs['Fac'], 0.5)), 1.0, 0.05)
    nt.links.new(mop(nt, 'ADD', 0.15, mop(nt, 'MULTIPLY', n1.outputs['Fac'], 0.15)), bsdf.inputs['Roughness'])


def mat_teeth(nt, bsdf):
    tc = nt.nodes.new('ShaderNodeTexCoord')
    n1 = noise(nt, 20.0, 2.0)
    base = ramp(nt, n1.outputs['Fac'], [(0.3, '#b8a77c'), (0.7, '#efe6cc')])
    nt.links.new(base.outputs[0], bsdf.inputs['Base Color'])
    bump(nt, bsdf, n1.outputs['Fac'], 0.6, 0.02)
    bsdf.inputs['Roughness'].default_value = 0.35


def mat_claw(nt, bsdf):
    bsdf.inputs['Base Color'].default_value = hexc('#231c1f')
    bsdf.inputs['Roughness'].default_value = 0.35


# ------------------------------------------------------------------ build
A = C(0.0, 2.20, 0.58)                         # bell apex
D = C(0.0, -0.88, 0.47).normalized()           # bell axis (down/forward)
BELL_L = 0.80
BELL_R = lambda hn: 0.22 - 0.035 * math.sin(hn * math.pi) + 0.30 * hn ** 3


def build_body():
    b = Blob("BodyBlob")
    # torso
    b.ell(C(0, 1.05, -0.18), 0.40, 0.32, 0.30)
    b.ell(C(0, 1.42, -0.02), 0.52, 0.40, 0.42)
    b.ell(C(0, 1.72, 0.18), 0.66, 0.46, 0.40)
    b.ell(C(0, 1.86, -0.10), 0.54, 0.42, 0.42)
    for s in (-1, 1):
        b.ball(C(0.66 * s, 1.84, 0.22), 0.27)
        # legs (digitigrade)
        b.taper(C(0.30 * s, 1.02, -0.24), C(0.42 * s, 0.62, 0.12), 0.22, 0.14, 3)
        b.taper(C(0.42 * s, 0.62, 0.12), C(0.40 * s, 0.22, -0.30), 0.13, 0.08, 3)
        b.taper(C(0.40 * s, 0.22, -0.30), C(0.40 * s, 0.06, 0.02), 0.08, 0.06, 2)
        for i in (-1, 0, 1):
            b.cap(C((0.40 + i * 0.06) * s, 0.05, 0.0), C((0.40 + i * 0.09) * s, 0.045, 0.16), 0.045)
        # arms planted on knuckles
        b.taper(C(0.70 * s, 1.84, 0.22), C(0.92 * s, 1.22, 0.36), 0.21, 0.16, 3)
        b.taper(C(0.92 * s, 1.22, 0.36), C(0.86 * s, 0.36, 0.62), 0.21, 0.12, 4)
        b.ell(C(0.86 * s, 0.14, 0.70), 0.16, 0.17, 0.11)
        for i in range(4):
            fi = i - 1.5
            b.cap(C((0.86 + fi * 0.065) * s, 0.11, 0.78), C((0.86 + fi * 0.09) * s, 0.06, 0.96), 0.045)
    # neck: thick, thrust forward into the bell
    b.taper(C(0, 1.90, 0.12), A + D * 0.05, 0.26, 0.14, 4)
    return b.to_mesh(voxel=0.02, tris=7000)


def bell_profile():
    """(radius, depth-along-axis) pairs from crown to lip: dome, waist, flared lip."""
    prof = []
    R0 = 0.22
    for i in range(5):                      # rounded crown
        t = i / 5 * (math.pi / 2)
        prof.append((max(R0 * math.sin(t), 0.0), -0.16 * math.cos(t)))
    for i in range(9):                      # waist -> flared lip
        hn = i / 8
        r = R0 - 0.035 * math.sin(hn * math.pi) + 0.30 * hn ** 3
        prof.append((r, hn * BELL_L))
    return prof


def build_bell():
    bm = bmesh.new()
    seg = 30
    verts = []
    prof = bell_profile()
    for k, (r, h) in enumerate(prof):
        ring = []
        for j in range(seg):
            a = j / seg * math.tau
            rr = r * (1.0 + 0.035 * math.sin(a * 5 + k * 0.5))
            ring.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, -h)))
        verts.append(ring)
    for i in range(len(prof) - 1):
        for j in range(seg):
            bm.faces.new((verts[i][j], verts[i][(j + 1) % seg], verts[i + 1][(j + 1) % seg], verts[i + 1][j]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("Bell")
    bm.to_mesh(me)
    bm.free()
    bell = link(bpy.data.objects.new("Bell", me))
    sol = bell.modifiers.new("solid", 'SOLIDIFY')
    sol.thickness = 0.07
    sol.offset = -1
    sol.use_rim = True
    activate(bell)
    bpy.ops.object.modifier_apply(modifier=sol.name)
    q = Vector((0, 0, -1)).rotation_difference(D)
    bell.matrix_world = Matrix.Translation(A) @ q.to_matrix().to_4x4()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # mark inner faces (normals pointing toward the axis) for the flesh material
    inner = []
    for p in bell.data.polygons:
        c = p.center
        hpos = (c - A).dot(D)
        radial = (c - A) - D * hpos
        if radial.length > 1e-4 and p.normal.dot(radial.normalized()) < -0.3:
            inner.append(p.index)
    return bell, inner


def build_rim_teeth():
    q = Vector((0, 0, -1)).rotation_difference(D)
    X = q @ Vector((1, 0, 0))
    Y = q @ Vector((0, 1, 0))
    teeth = []
    n = 16
    for i in range(n):
        a = i / n * math.tau + 0.2
        rad = X * math.cos(a) + Y * math.sin(a)
        ln = 0.13 + 0.07 * ((math.sin(i * 12.9) * 437.5) % 1.0)
        base = A + D * (BELL_L - 0.04) + rad * (BELL_R(1.0) - 0.05)
        tip = base + D * ln - rad * 0.05
        teeth.append(cone(f"Tooth{i}", base, tip, 0.04, verts=7))
    return teeth


def build_tongue():
    t0 = A + D * 0.10
    t1 = A + D * 0.55 + C(0.04, 0, 0)
    t2 = A + D * 0.90 + C(0.07, -0.20, -0.02)
    t3 = t2 + C(0.02, -0.28, -0.06)
    b = Blob("TongueBlob", res=0.02)
    b.taper(t0, t1, 0.075, 0.065, 3)
    b.taper(t1, t2, 0.065, 0.055, 3)
    b.taper(t2, t3, 0.055, 0.05, 3)
    tongue = b.to_mesh(voxel=0.012, tris=900)
    knot_c = t3 + C(0.0, -0.08, -0.02)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.11)
    me = bpy.data.meshes.new("Knot")
    bm.to_mesh(me)
    bm.free()
    knot = link(bpy.data.objects.new("Knot", me))
    knot.location = knot_c
    kteeth = []
    for i in range(10):
        fi = float(i)
        d = Vector((math.sin(fi * 2.39), math.cos(fi * 1.7) * 0.8, math.cos(fi * 2.39))).normalized()
        kteeth.append(cone(f"KnotTooth{i}", knot_c + d * 0.08, knot_c + d * 0.19, 0.03, verts=6))
    return tongue, knot, kteeth, (t0, t1, t2, t3, knot_c)


def build_spikes():
    out = []
    centre = C(0.0, 1.76, -0.08)
    for i in range(9):
        t = i / 8
        an = -1.75 + t * 2.2
        dirv = C(0, math.sin(an), -math.cos(an))
        base = centre + dirv * 0.40
        ln = 0.14 + 0.08 * math.sin(t * 3.1)
        out.append(cone(f"Spike{i}", base, base + dirv * ln, 0.055 - 0.015 * abs(t - 0.5), verts=7))
    for s in (-1, 1):
        out.append(cone("ElbowSpur", C(0.95 * s, 1.24, 0.30), C(1.10 * s, 1.32, 0.10), 0.06, verts=7))
        out.append(cone("HeelSpur", C(0.40 * s, 0.24, -0.33), C(0.42 * s, 0.32, -0.50), 0.05, verts=6))
    return out


def build_claws():
    out = []
    for s in (-1, 1):
        for i in range(4):
            fi = i - 1.5
            base = C((0.86 + fi * 0.09) * s, 0.06, 0.95)
            out.append(cone("Claw", base, base + C(0.01 * fi * s, -0.045, 0.12), 0.03, verts=6))
        for i in (-1, 0, 1):
            base = C((0.40 + i * 0.09) * s, 0.04, 0.17)
            out.append(cone("ToeClaw", base, base + C(0, -0.03, 0.08), 0.025, verts=6))
    return out


def assign(obj, mat, faces=None):
    if mat.name not in [m.name for m in obj.data.materials if m]:
        obj.data.materials.append(mat)
    idx = [m.name for m in obj.data.materials].index(mat.name)
    for p in obj.data.polygons:
        if faces is None or p.index in faces:
            p.material_index = idx


def build_all():
    mats = {
        'skin': node_mat("Skin", mat_skin),
        'bell': node_mat("BellBone", mat_bell),
        'bone': node_mat("Bone", mat_bone),
        'flesh': node_mat("Flesh", mat_flesh),
        'teeth': node_mat("Teeth", mat_teeth),
        'claw': node_mat("Claw", mat_claw),
    }
    body = build_body(); body.name = "Body"
    shade_smooth(body)
    assign(body, mats['skin'])
    bell, inner = build_bell()
    shade_smooth(bell, 60)
    assign(bell, mats['bell'])
    bell.data.materials.append(mats['flesh'])
    for p in bell.data.polygons:
        if p.index in set(inner):
            p.material_index = 1
    teeth = join(build_rim_teeth(), "RimTeeth"); assign(teeth, mats['teeth'])
    tongue, knot, kteeth, tpts = build_tongue()
    shade_smooth(tongue); assign(tongue, mats['flesh'])
    knot = join([knot] + kteeth, "Knot"); assign(knot, mats['teeth'])
    shade_smooth(knot, 40)
    spikes = join(build_spikes(), "Spikes"); assign(spikes, mats['bone'])
    claws = join(build_claws(), "Claws"); assign(claws, mats['claw'])
    parts = dict(body=body, bell=bell, teeth=teeth, tongue=tongue, knot=knot, spikes=spikes, claws=claws)
    return parts, mats, tpts


# ------------------------------------------------------------------ render setup
def setup_render(res=(900, 1100), samples=48):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = True
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    w = bpy.data.worlds.new("World"); sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.045, 0.045, 0.05, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    # ground
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
    g = bpy.context.active_object; g.name = "Ground"
    gm = bpy.data.materials.new("Ground"); gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.06, 0.06, 0.065, 1)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    g.data.materials.append(gm)
    g.is_shadow_catcher = True

    def area(name, loc, energy, size, color):
        l = bpy.data.lights.new(name, 'AREA'); l.energy = energy; l.size = size; l.color = color
        o = link(bpy.data.objects.new(name, l)); o.location = loc
        d = Vector((0, 0, 1.2)) - Vector(loc)
        o.rotation_euler = Vector((0, 0, -1)).rotation_difference(d.normalized()).to_euler()
        return o
    area("Key", (-3.5, -4.0, 4.5), 500, 3.0, (1.0, 0.93, 0.85))
    area("Fill", (4.0, -3.0, 2.0), 110, 4.0, (0.75, 0.82, 1.0))
    area("Rim", (1.5, 4.5, 3.5), 650, 2.5, (0.85, 0.88, 1.0))
    cam = bpy.data.cameras.new("Cam"); cam.lens = 50
    co = link(bpy.data.objects.new("Cam", cam)); sc.camera = co
    return co


def aim(cam, loc, target=(0, -0.2, 1.15)):
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def render(path):
    """Render with transparent film over the shadow catcher, then place on a studio gradient."""
    tmp = path + ".rgba.png"
    bpy.context.scene.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    import numpy as np
    img = bpy.data.images.load(tmp)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.sqrt(((xx - w * 0.5) / w) ** 2 + ((yy - h * 0.55) / h) ** 2)
    bg = np.clip(0.36 - 0.42 * r, 0.08, 1.0)[..., None] * np.array([1.0, 0.99, 1.01])
    a = px[..., 3:4]
    out = px[..., :3] + bg * (1.0 - a)
    out = np.concatenate([np.clip(out, 0, 1), np.ones_like(a)], axis=2)
    res = bpy.data.images.new("comp", w, h)
    res.pixels[:] = out.ravel()
    res.filepath_raw = path
    res.file_format = 'PNG'
    res.save()
    os.remove(tmp)


# ------------------------------------------------------------------ rig
def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def build_rig(tpts):
    t0, t1, t2, t3, kc = tpts
    bones = {}  # name: (head, tail, parent)
    bones['Root'] = (C(0, 0, 0), C(0, 0.35, 0), None)
    bones['Hips'] = (C(0, 1.02, -0.18), C(0, 1.35, -0.05), 'Root')
    bones['Spine'] = (C(0, 1.35, -0.05), C(0, 1.68, 0.05), 'Hips')
    bones['Chest'] = (C(0, 1.68, 0.05), C(0, 1.92, 0.14), 'Spine')
    bones['Neck'] = (C(0, 1.92, 0.14), A.copy(), 'Chest')
    bones['Bell'] = (A.copy(), A + D * 0.70, 'Neck')
    bones['Tongue1'] = (t0, t1, 'Bell')
    bones['Tongue2'] = (t1, t2, 'Tongue1')
    bones['Tongue3'] = (t2, kc, 'Tongue2')
    for s, side in ((1, 'Left'), (-1, 'Right')):
        bones[side + 'UpperArm'] = (C(0.70 * s, 1.84, 0.22), C(0.92 * s, 1.22, 0.36), 'Chest')
        bones[side + 'LowerArm'] = (C(0.92 * s, 1.22, 0.36), C(0.86 * s, 0.34, 0.62), side + 'UpperArm')
        bones[side + 'Hand'] = (C(0.86 * s, 0.34, 0.62), C(0.86 * s, 0.06, 0.90), side + 'LowerArm')
        bones[side + 'UpperLeg'] = (C(0.30 * s, 1.02, -0.24), C(0.42 * s, 0.62, 0.12), 'Hips')
        bones[side + 'LowerLeg'] = (C(0.42 * s, 0.62, 0.12), C(0.40 * s, 0.22, -0.30), side + 'UpperLeg')
        bones[side + 'Foot'] = (C(0.40 * s, 0.22, -0.30), C(0.40 * s, 0.04, 0.16), side + 'LowerLeg')
    arm = bpy.data.armatures.new("KloeppelRig")
    ao = link(bpy.data.objects.new("KloeppelRig", arm))
    activate(ao)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, (h, t, par) in bones.items():
        eb = arm.edit_bones.new(name)
        eb.head, eb.tail = h, t
        eb.roll = 0
    for name, (h, t, par) in bones.items():
        if par:
            eb = arm.edit_bones[name]
            eb.parent = arm.edit_bones[par]
            eb.use_connect = (eb.head - arm.edit_bones[par].tail).length < 1e-4
    bpy.ops.object.mode_set(mode='OBJECT')
    return ao, bones


def rigid_weights(obj, bones, allowed, per_island=True, blend=False):
    """Weight each vertex (or each loose island) to the nearest allowed bone segment."""
    me = obj.data
    for b in allowed:
        if b not in obj.vertex_groups:
            obj.vertex_groups.new(name=b)
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    islands = []
    if per_island:
        seen = set()
        for v in bm.verts:
            if v.index in seen:
                continue
            stack, isl = [v], []
            seen.add(v.index)
            while stack:
                x = stack.pop(); isl.append(x.index)
                for e in x.link_edges:
                    o = e.other_vert(x)
                    if o.index not in seen:
                        seen.add(o.index); stack.append(o)
            islands.append(isl)
    else:
        islands = [[v.index] for v in bm.verts]
    co = [obj.matrix_world @ v.co for v in bm.verts]
    bm.free()
    for isl in islands:
        c = sum((co[i] for i in isl), Vector()) / len(isl)
        ds = sorted((seg_dist(c, bones[b][0], bones[b][1]), b) for b in allowed)
        if blend and len(ds) > 1:
            (d0, b0), (d1, b1) = ds[0], ds[1]
            w0 = d1 / (d0 + d1 + 1e-6)
            obj.vertex_groups[b0].add(isl, w0, 'REPLACE')
            obj.vertex_groups[b1].add(isl, 1 - w0, 'REPLACE')
        else:
            obj.vertex_groups[ds[0][1]].add(isl, 1.0, 'REPLACE')


def skin(parts, rig, bones):
    body = parts['body']
    activate(body)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    # bell / tongue / heads stay rigid: remove auto-weights on body from those bones
    for b in ('Bell', 'Tongue1', 'Tongue2', 'Tongue3', 'Root'):
        if b in body.vertex_groups:
            body.vertex_groups.remove(body.vertex_groups[b])
    rigid_weights(parts['bell'], bones, ['Bell'])
    rigid_weights(parts['teeth'], bones, ['Bell'])
    rigid_weights(parts['tongue'], bones, ['Tongue1', 'Tongue2', 'Tongue3'], per_island=False, blend=True)
    rigid_weights(parts['knot'], bones, ['Tongue3'])
    rigid_weights(parts['spikes'], bones, ['Hips', 'Spine', 'Chest', 'Neck', 'LeftLowerArm', 'RightLowerArm',
                                           'LeftLowerLeg', 'RightLowerLeg'])
    rigid_weights(parts['claws'], bones, ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot'])
    objs = [body] + [parts[k] for k in ('bell', 'teeth', 'tongue', 'knot', 'spikes', 'claws')]
    for o in objs[1:]:
        o.parent = None
    mesh = join(objs, "Kloeppel")
    for m in list(mesh.modifiers):
        mesh.modifiers.remove(m)
    activate(mesh)
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    mesh.parent = rig
    mod = mesh.modifiers.new("Armature", 'ARMATURE')
    mod.object = rig
    return mesh


# ------------------------------------------------------------------ uv + bake
def bake_texture(mesh):
    activate(mesh)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004)
    bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.render.bake.margin = 6
    results = {}
    for kind in ('DIFFUSE', 'AO', 'NORMAL', 'ROUGHNESS'):
        img = bpy.data.images.new("bake_" + kind, TEX_RES, TEX_RES, alpha=False, float_buffer=True)
        for m in mesh.data.materials:
            nt = m.node_tree
            n = nt.nodes.get("BakeTarget") or nt.nodes.new('ShaderNodeTexImage')
            n.name = "BakeTarget"; n.image = img
            nt.nodes.active = n
        if kind == 'DIFFUSE':
            sc.cycles.samples = 4
            bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'})
        elif kind == 'AO':
            sc.cycles.samples = 64
            bpy.ops.object.bake(type='AO')
        elif kind == 'NORMAL':
            sc.cycles.samples = 4
            bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT')
        else:
            sc.cycles.samples = 4
            bpy.ops.object.bake(type='ROUGHNESS')
        results[kind] = img
    import numpy as np
    col = np.array(results['DIFFUSE'].pixels[:], dtype=np.float32).reshape(-1, 4)
    ao = np.array(results['AO'].pixels[:], dtype=np.float32).reshape(-1, 4)[:, :1]
    out = col.copy()
    out[:, :3] = col[:, :3] * (0.40 + 0.60 * ao)       # painted ambient occlusion (stylized depth)
    # linear -> sRGB for the 8-bit PNG
    rgb = out[:, :3]
    out[:, :3] = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(np.clip(rgb, 0, None), 1 / 2.4) - 0.055)
    out[:, 3] = 1.0
    tex = bpy.data.images.new("kloeppel_texture", TEX_RES, TEX_RES, alpha=False)
    tex.pixels[:] = np.clip(out, 0, 1).ravel()
    tex.filepath_raw = os.path.join(OUT, "kloeppel_texture.png")
    tex.file_format = 'PNG'
    tex.save()
    tex.colorspace_settings.name = 'sRGB'

    def save_data(name, img, single=False):
        px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
        if single:
            px[:, 1] = px[:, 0]; px[:, 2] = px[:, 0]
        px[:, 3] = 1.0
        im = bpy.data.images.new(name, TEX_RES, TEX_RES, alpha=False)
        im.colorspace_settings.name = 'Non-Color'
        im.pixels[:] = np.clip(px, 0, 1).ravel()
        im.filepath_raw = os.path.join(OUT, name + ".png")
        im.file_format = 'PNG'
        im.save()
        return im
    nrm = save_data("kloeppel_normal", results['NORMAL'])
    rgh = save_data("kloeppel_roughness", results['ROUGHNESS'], single=True)
    # single game material
    gm = bpy.data.materials.new("Kloeppel_Mat")
    gm.use_nodes = True
    nt = gm.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = tex
    nt.links.new(tn.outputs[0], bsdf.inputs['Base Color'])
    tr = nt.nodes.new('ShaderNodeTexImage'); tr.image = rgh
    nt.links.new(tr.outputs[0], bsdf.inputs['Roughness'])
    tnm = nt.nodes.new('ShaderNodeTexImage'); tnm.image = nrm
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tnm.outputs[0], nm.inputs['Color'])
    nt.links.new(nm.outputs[0], bsdf.inputs['Normal'])
    mesh.data.materials.clear()
    mesh.data.materials.append(gm)
    for p in mesh.data.polygons:
        p.material_index = 0
    return gm


# ------------------------------------------------------------------ animation
FPS = 30


def key_rot(pb, frame, euler_deg):
    pb.rotation_mode = 'XYZ'
    pb.rotation_euler = [math.radians(v) for v in euler_deg]
    pb.keyframe_insert("rotation_euler", frame=frame)


def key_loc(pb, frame, loc):
    pb.location = loc
    pb.keyframe_insert("location", frame=frame)


def make_action(rig, name, length, fn):
    act = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = act
    for f in range(0, length + 1, 3):
        ph = f / length * math.tau
        fn(rig.pose.bones, f, ph)
    for pb in rig.pose.bones:
        pb.rotation_mode = 'XYZ'; pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0)
    act.use_fake_user = True
    trk = rig.animation_data.nla_tracks.new(); trk.name = name
    trk.strips.new(name, 1, act)
    rig.animation_data.action = None
    return act


def anim_idle(pb, f, ph):
    s = math.sin(ph)
    key_rot(pb['Chest'], f, (2.5 * s, 0, 0))
    key_rot(pb['Spine'], f, (1.5 * s, 0, 0))
    key_rot(pb['Neck'], f, (2.0 * math.sin(ph + 0.6), 0, 2.0 * math.sin(ph * 0.5)))
    key_rot(pb['Bell'], f, (4.0 * math.sin(ph + 1.0), 0, 3.0 * math.sin(ph * 0.5 + 0.3)))
    for i, b in enumerate(('Tongue1', 'Tongue2', 'Tongue3')):
        key_rot(pb[b], f, (6.0 * math.sin(ph + 1.6 + i * 0.6), 0, 5.0 * math.sin(ph + 0.4 + i * 0.7)))


def anim_walk(pb, f, ph):
    s, c = math.sin(ph), math.cos(ph)
    key_loc(pb['Hips'], f, (0, 0.04 * abs(math.sin(ph)) - 0.02, 0))
    key_rot(pb['Hips'], f, (0, 4.0 * s, 0))
    key_rot(pb['Chest'], f, (3.0 * math.cos(2 * ph), -5.0 * s, 0))
    key_rot(pb['LeftUpperArm'], f, (22.0 * s, 0, 0))
    key_rot(pb['RightUpperArm'], f, (-22.0 * s, 0, 0))
    key_rot(pb['LeftLowerArm'], f, (-10.0 * max(0, c), 0, 0))
    key_rot(pb['RightLowerArm'], f, (-10.0 * max(0, -c), 0, 0))
    key_rot(pb['LeftUpperLeg'], f, (-18.0 * s, 0, 0))
    key_rot(pb['RightUpperLeg'], f, (18.0 * s, 0, 0))
    key_rot(pb['LeftLowerLeg'], f, (14.0 * max(0, c), 0, 0))
    key_rot(pb['RightLowerLeg'], f, (14.0 * max(0, -c), 0, 0))
    key_rot(pb['Neck'], f, (3.0 * math.cos(2 * ph), 0, 4.0 * s))
    key_rot(pb['Bell'], f, (9.0 * math.sin(2 * ph + 1.0), 0, 6.0 * math.sin(ph + 0.8)))
    for i, b in enumerate(('Tongue1', 'Tongue2', 'Tongue3')):
        key_rot(pb[b], f, (14.0 * math.sin(2 * ph + 1.9 + i * 0.7), 0, 10.0 * math.sin(ph + 1.2 + i * 0.6)))


# ------------------------------------------------------------------ main
if __name__ == "__main__":
    reset()
    parts, mats, tpts = build_all()
    total = sum(tri_count(o) for o in parts.values())
    print("TRIS", {k: tri_count(o) for k, o in parts.items()}, "TOTAL", total)
    if STAGE == "geo":
        cam = setup_render(res=(700, 860), samples=24)
        aim(cam, (3.6, -6.2, 2.0))
        render(os.path.join(OUT, "_geo_preview.png"))
        sys.exit(0)

    rig, bones = build_rig(tpts)
    mesh = skin(parts, rig, bones)
    bake_texture(mesh)
    print("FINAL TRIS", tri_count(mesh), "BONES", len(rig.data.bones))

    bpy.context.scene.render.fps = FPS
    make_action(rig, "Idle", 60, anim_idle)
    make_action(rig, "Walk", 36, anim_walk)
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, 61

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "kloeppel_roblox.blend"))

    # ---- exports (mesh + rig + animations)
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True); mesh.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.fbx(filepath=os.path.join(OUT, "kloeppel_roblox.fbx"), use_selection=True,
                             object_types={'ARMATURE', 'MESH'}, add_leaf_bones=False,
                             bake_anim=True, bake_anim_use_all_actions=True, bake_anim_use_nla_strips=False,
                             path_mode='COPY', embed_textures=True, axis_forward='-Z', axis_up='Y',
                             apply_scale_options='FBX_SCALE_ALL', mesh_smooth_type='FACE')
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "kloeppel_roblox.glb"), export_format='GLB',
                              use_selection=True, export_animation_mode='ACTIONS', export_skins=True)

    # ---- preview renders of the game-ready model
    cam = setup_render(res=(800, 1000), samples=64)
    bpy.data.objects["KloeppelRig"].animation_data.action = None
    views = {"front": (3.4, -6.4, 2.0), "side": (7.0, -0.2, 1.7), "back": (-3.4, 6.4, 2.3)}
    for name, loc in views.items():
        aim(cam, loc)
        render(os.path.join(OUT, f"preview_{name}.png"))
    # walk pose snapshot
    act = bpy.data.actions["Walk"]
    rig.animation_data.action = act
    bpy.context.scene.frame_set(9)
    aim(cam, (3.4, -6.4, 2.0))
    render(os.path.join(OUT, "preview_walkpose.png"))
