// A real 3D d20: an icosahedron with numbered faces that tumbles and lands on the rolled number.
import { THREE } from './core.js';

const FACES = 20;
let shared = null;

function numberAtlas() {
  // 5 x 4 grid of triangles, one per face, each with its number.
  const cols = 5;
  const rows = 4;
  const cw = 256;
  const ch = 222;
  const c = document.createElement('canvas');
  c.width = cols * cw;
  c.height = rows * ch;
  const g = c.getContext('2d');
  const cells = [];
  for (let i = 0; i < FACES; i++) {
    const cx = (i % cols) * cw;
    const cy = Math.floor(i / cols) * ch;
    const tri = [[cx + cw / 2, cy + 6], [cx + 6, cy + ch - 6], [cx + cw - 6, cy + ch - 6]];
    g.fillStyle = i === 19 ? '#b8862a' : i === 0 ? '#5a1612' : '#9c2d24';
    g.beginPath(); g.moveTo(...tri[0]); g.lineTo(...tri[1]); g.lineTo(...tri[2]); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,230,190,.55)'; g.lineWidth = 6; g.stroke();
    g.fillStyle = '#fff6e2';
    g.font = `bold ${i + 1 >= 10 ? 74 : 86}px Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(i + 1), cx + cw / 2, cy + ch * 0.62);
    if (i + 1 === 6 || i + 1 === 9) g.fillRect(cx + cw / 2 - 18, cy + ch * 0.62 + 40, 36, 6); // underline 6 and 9
    cells.push(tri.map(([x, y]) => [x / c.width, 1 - y / c.height]));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, cells };
}

function makeDie() {
  const base = new THREE.IcosahedronGeometry(1, 0); // already one vertex set per face
  const pos = base.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const { tex, cells } = numberAtlas();
  const normals = [];
  const apexes = [];
  for (let f = 0; f < FACES; f++) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, f * 3);
    const b = new THREE.Vector3().fromBufferAttribute(pos, f * 3 + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, f * 3 + 2);
    normals.push(a.clone().add(b).add(c).normalize());
    apexes.push({ apex: a.clone(), center: a.clone().add(b).add(c).divideScalar(3) }); // vertex 0 = top of the number
    const cell = cells[f];
    for (let k = 0; k < 3; k++) uv.set(cell[k], (f * 3 + k) * 2);
  }
  base.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  base.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.1, flatShading: true });
  return { mesh: new THREE.Mesh(base, mat), normals, apexes };
}

function setup() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(150, 150, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 0, 5.2);
  scene.add(new THREE.HemisphereLight(0xfff3dd, 0x332211, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 3, 4);
  scene.add(key);
  const die = makeDie();
  scene.add(die.mesh);
  return { renderer, scene, camera, die };
}

// Rolls inside `host` (an element) and lands showing `value`. Resolves when it lands.
export function roll(host, value, ms = 950) {
  if (!shared) shared = setup();
  const { renderer, scene, camera, die } = shared;
  host.replaceChildren(renderer.domElement);
  renderer.domElement.className = 'dice3d';
  const face = Math.max(1, Math.min(20, value)) - 1;
  // Final orientation: that face pointing at the camera.
  const target = new THREE.Quaternion().setFromUnitVectors(die.normals[face], new THREE.Vector3(0, 0, 1));
  // Turn around the view axis so the number reads upright.
  const { apex, center } = die.apexes[face];
  const up = apex.clone().sub(center).applyQuaternion(target);
  const angle = Math.atan2(up.y, up.x);
  target.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2 - angle + (Math.random() * 0.3 - 0.15)));
  const spinAxis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
  const start = performance.now();
  return new Promise((resolve) => {
    const frame = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const ease = 1 - Math.pow(1 - t, 3);
      // spin fast at first, then settle onto the target face
      const spin = new THREE.Quaternion().setFromAxisAngle(spinAxis, (1 - ease) * 14);
      die.mesh.quaternion.copy(target).premultiply(spin);
      die.mesh.position.y = Math.abs(Math.sin(t * Math.PI * 3)) * (1 - t) * 0.8;
      die.mesh.scale.setScalar(1 + (1 - ease) * 0.15);
      renderer.render(scene, camera);
      if (t < 1) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
}
