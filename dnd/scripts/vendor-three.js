'use strict';
// Copies the parts of three.js the game uses from node_modules into public/vendor/three/,
// so the game runs without any internet connection. Run after `npm install`.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const from = path.join(root, 'node_modules', 'three');
const to = path.join(root, 'public', 'vendor', 'three');
const FILES = [
  'build/three.module.js', 'build/three.core.js', 'LICENSE',
  'examples/jsm/loaders/GLTFLoader.js', 'examples/jsm/utils/BufferGeometryUtils.js',
  'examples/jsm/utils/SkeletonUtils.js', 'examples/jsm/controls/OrbitControls.js',
  // post-processing: glow (bloom) and color grading
  'examples/jsm/postprocessing/EffectComposer.js', 'examples/jsm/postprocessing/RenderPass.js', 'examples/jsm/postprocessing/UnrealBloomPass.js',
  'examples/jsm/postprocessing/OutputPass.js', 'examples/jsm/postprocessing/ShaderPass.js', 'examples/jsm/postprocessing/Pass.js',
  'examples/jsm/postprocessing/MaskPass.js', 'examples/jsm/shaders/CopyShader.js', 'examples/jsm/shaders/LuminosityHighPassShader.js',
  'examples/jsm/shaders/OutputShader.js',
];
for (const f of FILES) {
  const dest = path.join(to, f.replace(/^build\//, '').replace(/^examples\/jsm\//, 'addons/'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(from, f), dest);
}
console.log(`Copied three.js ${require(path.join(from, 'package.json')).version} to public/vendor/three/`);
