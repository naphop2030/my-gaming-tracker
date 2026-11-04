// Loads the 3D features and hands them to the rest of the page (which is plain, non-module JS).
// If WebGL isn't available, or the player turns 3D off, the game keeps its 2D look.
import { webglAvailable, Actor, View, lights, THREE } from './core.js';
import { Board } from './board.js';
import { Stage } from './stage.js';
import { roll } from './dice.js';

if (webglAvailable()) {
  let board = null;
  let stage = null;
  let preview = null;

  window.Board3D = {
    update(container, labels, A, ctx) {
      if (!board) board = new Board(container, labels);
      return board.update(A, ctx).catch((e) => console.warn('3D board:', e));
    },
  };

  window.Stage3D = {
    update(container, A, init, targetId, onTarget) {
      if (!stage) stage = new Stage(container);
      return stage.sync(A, init, targetId, onTarget).catch((e) => console.warn('3D stage:', e));
    },
    onFx(fx) { if (stage) stage.onFx(fx); },
  };

  window.Dice3D = { roll };

  // A slowly turning model of a class, for hero creation.
  window.Preview3D = {
    async show(container, cls) {
      if (!preview) {
        const view = new View(container, { shadows: false, alpha: true });
        view.scene.background = null;
        lights(view.scene, 'clear');
        view.camera.position.set(0, 1.25, 4.2);
        view.camera.lookAt(0, 0.95, 0);
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1, 0.12, 40), new THREE.MeshStandardMaterial({ color: 0x5a4430, roughness: 0.8 }));
        disc.position.y = -0.06;
        view.scene.add(disc);
        preview = { view, actor: null, cls: null };
        view.tickers.add((dt) => { if (preview.actor) { preview.actor.update(dt); preview.actor.group.rotation.y += dt * 0.6; } });
      }
      if (preview.view.container !== container) {
        container.append(preview.view.canvas);
        preview.view.container = container;
        preview.view.resize();
      }
      if (preview.cls !== cls) {
        preview.cls = cls;
        const a = await Actor.create(cls);
        if (preview.cls !== cls) return;
        if (preview.actor) preview.view.scene.remove(preview.actor.group);
        preview.actor = a;
        a.group.rotation.y = 0.4;
        preview.view.scene.add(a.group);
        a.play('cheer');
      }
      preview.view.start();
    },
  };

  window.FX3D = { onFx: (fx) => window.Stage3D.onFx(fx) };
  window.dispatchEvent(new Event('three-ready'));
}
