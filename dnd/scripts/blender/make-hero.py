# Builds an original hero model (a hooded ranger with a bow) from scratch with Blender,
# rigs it, animates it and exports it as a .glb the game can load.
#
#   pip install bpy            (Blender as a Python module)
#   python3 scripts/blender/make-hero.py out/hero-ranger.glb
#
# Style: chunky toy proportions and flat colors, to sit beside the KayKit heroes.
# Every body part follows exactly one bone (rigid skinning), like the KayKit models.
import math
import sys

import bpy  # must come first: it makes bmesh and mathutils available
import bmesh
from mathutils import Euler, Matrix, Quaternion, Vector

OUT = sys.argv[-1] if sys.argv[-1].endswith('.glb') else 'hero-ranger.glb'

bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------- materials (flat colors) ----------
COLORS = {
    'skin': (0.87, 0.62, 0.45), 'hood': (0.10, 0.30, 0.16), 'tunic': (0.20, 0.45, 0.22), 'leather': (0.32, 0.19, 0.10),
    'boots': (0.16, 0.10, 0.07), 'wood': (0.50, 0.33, 0.16), 'dark': (0.04, 0.03, 0.03), 'metal': (0.72, 0.72, 0.76),
    'feather': (0.80, 0.20, 0.16), 'string': (0.90, 0.88, 0.80), 'trim': (0.85, 0.68, 0.25),
}
MATS = list(COLORS)
materials = []
for name, (r, g, b) in COLORS.items():
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    # The colors above are written as they should look on screen (sRGB); Blender wants linear light.
    bsdf.inputs['Base Color'].default_value = (*[(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4) for c in (r, g, b)], 1)
    bsdf.inputs['Roughness'].default_value = 0.4 if name == 'metal' else 0.85
    bsdf.inputs['Metallic'].default_value = 0.8 if name == 'metal' else 0.0
    materials.append(m)

BONES = ['hips', 'spine', 'head', 'arm.L', 'arm.R', 'leg.L', 'leg.R']

bm = bmesh.new()
deform = bm.verts.layers.deform.verify()


def finish(new_verts, mat, bone, smooth=True):
    faces = {f for v in new_verts for f in v.link_faces}
    for f in faces:
        f.material_index = MATS.index(mat)
        f.smooth = smooth
    for v in new_verts:
        v[deform][BONES.index(bone)] = 1.0


def xform(loc, scale=(1, 1, 1), rot=(0, 0, 0)):
    return Matrix.Translation(loc) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*scale, 1))


def box(mat, bone, loc, size, rot=(0, 0, 0), bevel=0.04):
    """A box with rounded edges."""
    r = bmesh.ops.create_cube(bm, size=1.0)
    verts = r['verts']
    if bevel:
        edges = list({e for v in verts for e in v.link_edges})
        smallest = min(size)
        res = bmesh.ops.bevel(bm, geom=edges, offset=min(bevel, smallest * 0.4) / smallest, segments=2, affect='EDGES', profile=0.5)
        verts = list({v for f in res['faces'] for v in f.verts} | {v for v in verts if v.is_valid})
    bmesh.ops.transform(bm, matrix=xform(loc, size, rot), verts=verts)
    finish(verts, mat, bone)


def ball(mat, bone, loc, radius, scale=(1, 1, 1), rot=(0, 0, 0), seg=14):
    r = bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(6, seg // 2 + 2), radius=radius, matrix=xform(loc, scale, rot))
    finish(r['verts'], mat, bone)


def cone(mat, bone, loc, r1, r2, depth, rot=(0, 0, 0), seg=12, scale=(1, 1, 1)):
    """A cylinder or cone along its own Z axis."""
    r = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=depth, matrix=xform(loc, scale, rot))
    finish(r['verts'], mat, bone)


# ---------- the ranger (faces -Y, stands on z = 0, about 1.8 tall) ----------
# legs and boots
for side, bone in ((1, 'leg.L'), (-1, 'leg.R')):
    x = side * 0.15
    box('leather', bone, (x, 0.0, 0.34), (0.2, 0.22, 0.3))
    box('boots', bone, (x, -0.03, 0.11), (0.23, 0.32, 0.22), bevel=0.06)
    box('trim', bone, (x, 0.0, 0.215), (0.24, 0.25, 0.04), bevel=0.01)

# body: tunic, belt, cloak, quiver
box('tunic', 'spine', (0, 0, 0.74), (0.5, 0.34, 0.56), bevel=0.1)
box('tunic', 'hips', (0, 0, 0.47), (0.54, 0.36, 0.14), bevel=0.05)  # tunic skirt
box('leather', 'spine', (0, 0, 0.58), (0.53, 0.37, 0.07), bevel=0.02)
box('trim', 'spine', (0, -0.185, 0.58), (0.09, 0.03, 0.09), bevel=0.01)  # buckle
box('leather', 'spine', (0.02, -0.165, 0.8), (0.07, 0.03, 0.62), rot=(0, 0.72, 0), bevel=0.01)  # quiver strap
# cloak: wide at the shoulders, flaring toward the hem
box('hood', 'spine', (0, 0.19, 0.7), (0.56, 0.07, 0.72), rot=(-0.14, 0, 0), bevel=0.03)
box('hood', 'spine', (0, 0.26, 0.42), (0.62, 0.07, 0.3), rot=(-0.32, 0, 0), bevel=0.03)
ball('hood', 'spine', (0, 0.02, 1.0), 0.3, scale=(1.05, 0.8, 0.42))  # cowl around the shoulders
# quiver on the back with three arrows
quiver_rot = (0.1, -0.5, 0)
cone('leather', 'spine', (-0.13, 0.29, 0.86), 0.08, 0.085, 0.5, rot=quiver_rot)
cone('trim', 'spine', (-0.245, 0.31, 1.07), 0.09, 0.09, 0.04, rot=quiver_rot)
for dx, dy in ((0, 0), (0.045, 0.02), (-0.03, 0.035)):
    cone('wood', 'spine', (-0.28 + dx, 0.315 + dy, 1.16), 0.012, 0.012, 0.2, rot=quiver_rot, seg=6)
    cone('feather', 'spine', (-0.315 + dx, 0.32 + dy, 1.225), 0.035, 0.012, 0.09, rot=quiver_rot, seg=4)

# head: face, hood with a point, a tuft of hair
ball('skin', 'head', (0, -0.02, 1.33), 0.3, scale=(1, 0.95, 0.95))
ball('hood', 'head', (0, 0.05, 1.38), 0.35, scale=(1.02, 1.0, 1.0))  # hood shell (behind the face)
cone('hood', 'head', (0, 0.3, 1.62), 0.2, 0.01, 0.42, rot=(-1.15, 0, 0), seg=10)  # the hood's point
box('hood', 'head', (0, -0.24, 1.55), (0.5, 0.12, 0.1), rot=(0.35, 0, 0), bevel=0.03)  # brim
for side in (1, -1):
    ball('dark', 'head', (side * 0.11, -0.285, 1.34), 0.042, scale=(1, 0.6, 1.25), seg=8)  # eyes
    ball('skin', 'head', (side * 0.2, -0.2, 1.25), 0.06, scale=(1, 0.7, 0.8), seg=8)  # cheeks
ball('leather', 'head', (0.0, -0.25, 1.49), 0.1, scale=(1.6, 0.6, 0.6), seg=8)  # fringe of hair
box('dark', 'head', (0, -0.292, 1.215), (0.09, 0.01, 0.018), bevel=0)  # mouth

# arms (hanging slightly out), bracers and hands
for side, bone in ((1, 'arm.L'), (-1, 'arm.R')):
    x = side * 0.335
    lean = side * 0.16
    box('tunic', bone, (x, 0, 0.82), (0.16, 0.18, 0.3), rot=(0, lean, 0), bevel=0.05)
    box('leather', bone, (x + side * 0.035, 0, 0.62), (0.15, 0.17, 0.16), rot=(0, lean, 0), bevel=0.04)
    ball('skin', bone, (x + side * 0.055, 0, 0.5), 0.085, seg=10)

# bow in the left hand: a curved stave, grip and string
hand = Vector((0.39, -0.02, 0.5))
steps = 9
for i in range(steps):
    a0 = -1.15 + 2.3 * i / steps
    a1 = -1.15 + 2.3 * (i + 1) / steps
    p0 = Vector((0, -0.42 * math.cos(a0) + 0.3, 0.5 * math.sin(a0)))
    p1 = Vector((0, -0.42 * math.cos(a1) + 0.3, 0.5 * math.sin(a1)))
    mid = (p0 + p1) / 2 + hand
    d = p1 - p0
    thick = 0.03 - 0.012 * abs(i - (steps - 1) / 2) / steps * 2
    cone('wood', 'arm.L', mid, thick, thick, d.length * 1.15, rot=(math.atan2(-d.y, d.z), 0, 0), seg=6)
cone('leather', 'arm.L', hand + Vector((0, -0.12, 0)), 0.036, 0.036, 0.14, seg=8)
tip = 0.5 * math.sin(1.15)
cone('string', 'arm.L', hand + Vector((0, -0.42 * math.cos(1.15) + 0.3, 0)), 0.005, 0.005, tip * 2, seg=4)

bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
mesh = bpy.data.meshes.new('Ranger')
bm.to_mesh(mesh)
bm.free()
for m in materials:
    mesh.materials.append(m)
body = bpy.data.objects.new('Ranger', mesh)
bpy.context.scene.collection.objects.link(body)
for name in BONES:
    body.vertex_groups.new(name=name)

# ---------- skeleton ----------
arm_data = bpy.data.armatures.new('RangerRig')
rig = bpy.data.objects.new('RangerRig', arm_data)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
LAYOUT = {  # bone: (head, tail, parent)
    'hips': ((0, 0, 0.42), (0, 0, 0.56), None),
    'spine': ((0, 0, 0.56), (0, 0, 1.02), 'hips'),
    'head': ((0, 0, 1.02), (0, 0, 1.6), 'spine'),
    'arm.L': ((0.31, 0, 0.96), (0.4, 0, 0.5), 'spine'),
    'arm.R': ((-0.31, 0, 0.96), (-0.4, 0, 0.5), 'spine'),
    'leg.L': ((0.15, 0, 0.45), (0.15, 0, 0.0), 'hips'),
    'leg.R': ((-0.15, 0, 0.45), (-0.15, 0, 0.0), 'hips'),
}
for name, (head, tail, parent) in LAYOUT.items():
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = head, tail
    if parent:
        b.parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
body.parent = rig
body.modifiers.new('Armature', 'ARMATURE').object = rig

# ---------- animations ----------
# Poses are given as world-space rotations (axis, degrees) so they read naturally:
# +X axis = bend forward/back, Y = lean sideways, Z = twist.
REST = {name: rig.data.bones[name].matrix_local.to_quaternion() for name in BONES}
for pb in rig.pose.bones:
    pb.rotation_mode = 'QUATERNION'


def world_rot(bone, *rots):
    """Rotation for a pose bone that turns it by the given world-space (axis, degrees) steps."""
    q = Quaternion()
    for axis, deg in rots:
        q = Quaternion({'X': (1, 0, 0), 'Y': (0, 1, 0), 'Z': (0, 0, 1)}[axis], math.radians(deg)) @ q
    rest = REST[bone]
    return rest.inverted() @ q @ rest


def make_action(name, frames, keys, loc=None):
    """keys: {frame: {bone: [(axis, deg), ...]}}; bones not listed at a frame return to rest."""
    rig.animation_data_create()
    action = bpy.data.actions.new(name)
    rig.animation_data.action = action
    for frame, pose in sorted(keys.items()):
        for bone in BONES:
            pb = rig.pose.bones[bone]
            pb.rotation_quaternion = world_rot(bone, *pose.get(bone, []))
            pb.keyframe_insert('rotation_quaternion', frame=frame)
        hips = rig.pose.bones['hips']
        hips.location = Vector((loc or {}).get(frame, (0, 0, 0)))
        hips.keyframe_insert('location', frame=frame)
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 1, action).name = name
    track.mute = True
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = (0, 0, 0)


breathe = {'spine': [('X', 2)], 'head': [('X', -3)], 'arm.L': [('Y', -4)], 'arm.R': [('Y', 4)]}
make_action('Idle', 48, {1: {}, 24: breathe, 48: {}})

aim = {  # raise the bow arm forward, pull the string hand back to the cheek
    'spine': [('Z', 35)], 'head': [('Z', -30)],
    'arm.L': [('X', 88), ('Z', 35)], 'arm.R': [('X', 80), ('Y', -55), ('Z', 20)],
    'leg.L': [('X', 12)], 'leg.R': [('X', -12)],
}
loose = {**aim, 'arm.R': [('X', 60), ('Y', -20)], 'spine': [('Z', 28), ('X', -4)]}
make_action('Attack', 26, {1: {}, 8: aim, 14: aim, 16: loose, 26: {}})

flinch = {'spine': [('X', -22)], 'head': [('X', -18)], 'arm.L': [('Y', -30)], 'arm.R': [('Y', 30)]}
make_action('Hit', 14, {1: {}, 4: flinch, 14: {}})

# Fall onto the back. The hips bone points up, so its local Y is world Z and local Z is world -Y.
fall = {'hips': [('X', -88)], 'arm.L': [('Y', -60)], 'arm.R': [('Y', 60)], 'head': [('X', -10)]}
make_action('Death', 24, {1: {}, 8: {'hips': [('X', 14)], 'spine': [('X', 10)]}, 20: fall, 24: fall},
            loc={1: (0, 0, 0), 8: (0, 0, 0), 20: (0, -0.32, 0), 24: (0, -0.32, 0)})

cheer = {'arm.R': [('Y', 150)], 'arm.L': [('Y', -150)], 'head': [('X', -12)], 'spine': [('X', -6)]}
make_action('Cheer', 24, {1: {}, 8: cheer, 12: {**cheer, 'spine': [('X', -2)]}, 16: cheer, 24: {}},
            loc={1: (0, 0, 0), 8: (0, 0.12, 0), 12: (0, 0, 0), 16: (0, 0.12, 0), 24: (0, 0, 0)})

bpy.context.scene.render.fps = 24
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animation_mode='NLA_TRACKS', export_yup=True, export_apply=False)
print('Wrote', OUT)
