/* Shared loader for the Humble & Blessed cherub model.
   Renders a GLB into a transparent canvas so it can sit on any page background.
   Usage: const api = mountCherub(canvas, options); then set api.y / api.yaw / api.pitch from scroll. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export function mountCherub(canvas, o = {}) {
  const opt = {
    url: '../assets/models/cherub-smooth.glb',
    rot: [0.4, Math.PI * 1.25, 0.1],  // orientation tuned for this export; retune for a new GLB
    tint: 0xf4f1ea, metalness: 0, roughness: .55,
    size: 3.4, camZ: 7.5, fov: 32, fit: 1, x: 0, y: 0,
    tilt: .25, bob: .1, drag: true,
    lights: [['hemi', 0xffffff, 0x8fa6c0, 2.0], ['dir', 0xfff1d6, 2.2, [4, 6, 5]]],
    onLoad: null,
    ...o
  };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  if (opt.studio) {
    renderer.toneMapping = opt.tone === 'agx' ? THREE.AgXToneMapping : opt.tone === 'linear' ? THREE.LinearToneMapping : THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = opt.exposure ?? 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  const scene = new THREE.Scene();
  if (opt.env) { scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = opt.env; }
  const cam = new THREE.PerspectiveCamera(opt.fov, 1, .1, 100);
  cam.position.set(0, 0, opt.camZ);
  for (const l of opt.lights) {
    if (l[0] === 'hemi') scene.add(new THREE.HemisphereLight(l[1], l[2], l[3]));
    else {
      const d = new THREE.DirectionalLight(l[1], l[2]); d.position.set(...l[3]); scene.add(d);
      if (opt.studio && !scene.userData.key) {
        scene.userData.key = d; d.castShadow = true;
        d.shadow.mapSize.set(2048, 2048); d.shadow.bias = -0.0004; d.shadow.normalBias = 0.02; d.shadow.radius = opt.shadowRadius ?? 4;
        const c = d.shadow.camera; c.left = c.bottom = -3; c.right = c.top = 3; c.near = .5; c.far = 30;
      }
    }
  }
  const rig = new THREE.Group(); scene.add(rig);   // page-driven motion (scroll, hover)
  const spin = new THREE.Group(); rig.add(spin);   // drag orbit
  const api = { y: 0, yaw: 0, pitch: 0, loaded: false, rig, spin, renderer };

  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(opt.url, g => {
    const m = g.scene;
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
    m.position.sub(ctr);
    m.scale.setScalar(opt.size / Math.max(size.x, size.y, size.z));
    m.traverse(n => { if (n.isMesh) {
      if (opt.noMap) { const g = n.geometry; g.deleteAttribute('uv'); g.deleteAttribute('normal'); n.geometry = mergeVertices(g, 1e-4); }
      if (opt.noMap || !n.geometry.attributes.normal) n.geometry.computeVertexNormals();
      if (opt.studio) {
        const old = n.material;
        const keep = !opt.noMap;
        n.material = new THREE.MeshPhysicalMaterial({ color: opt.tint, roughness: keep && old.roughnessMap ? 1 : opt.roughness, metalness: 0,
          map: keep ? old.map : null, normalMap: keep ? old.normalMap : null, roughnessMap: keep ? old.roughnessMap : null,
          clearcoat: opt.clearcoat ?? .18, clearcoatRoughness: .45, sheen: opt.sheen ?? .25, sheenRoughness: .8, sheenColor: 0xfff4e6,
          emissive: opt.glow ?? 0x000000, envMapIntensity: opt.envMap ?? 1 });
        if (keep && old.normalMap) n.material.normalScale.copy(old.normalScale);
        n.castShadow = true; n.receiveShadow = true;
      } else {
        n.material.metalness = opt.metalness; n.material.roughness = opt.roughness;
        n.material.color.set(opt.tint);
      }
      if (opt.noMap) { n.material.map = null; n.material.needsUpdate = true; }
    } });
    const hold = new THREE.Group(); hold.add(m); hold.rotation.set(...opt.rot);
    spin.add(hold); api.loaded = true; canvas.classList.add('is-loaded');
    if (opt.studio) {
      const b = new THREE.Box3().setFromObject(hold);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: opt.groundShadow ?? .55 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = b.min.y + .005; ground.receiveShadow = true; rig.add(ground);
    }
    if (opt.onLoad) opt.onLoad(api);
  }, undefined, e => console.warn('cherub.glb missing', e));

  let tx = 0, ty = 0, cx = 0, cy = 0, dragging = false, lx = 0, ly = 0, dy = 0, dp = 0, vy = 0, vp = 0;
  addEventListener('pointermove', e => {
    tx = (e.clientX / innerWidth - .5) * 2; ty = (e.clientY / innerHeight - .5) * 2;
    if (dragging) { vy = (e.clientX - lx) * .01; vp = (e.clientY - ly) * .01; dy += vy; dp = THREE.MathUtils.clamp(dp + vp, -.9, .9); lx = e.clientX; ly = e.clientY; }
  }, { passive: true });
  if (opt.drag) {
    canvas.addEventListener('pointerdown', e => { dragging = true; lx = e.clientX; ly = e.clientY; canvas.dispatchEvent(new CustomEvent('cherubdrag')); });
    addEventListener('pointerup', () => dragging = false);
  }

  function size() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    spin.scale.setScalar(Math.min(1, Math.max(.5, (w / h) * .75)) * opt.fit);
  }
  addEventListener('resize', size); size();

  const t0 = performance.now();
  (function frame() {
    const t = (performance.now() - t0) / 1000;
    if (!reduce) {
      cx += (tx - cx) * .05; cy += (ty - cy) * .05;
      if (!dragging) { vy *= .92; vp *= .92; dy += vy; dp = THREE.MathUtils.clamp(dp + vp, -.9, .9); }
      rig.position.set(opt.x, opt.y + api.y + Math.sin(t * .9) * opt.bob, 0);
      rig.rotation.set(cy * .12 + api.pitch, cx * opt.tilt + api.yaw, -.08 + cx * .08 + Math.sin(t * .7) * .03);
      spin.rotation.set(dp, dy, 0);
    } else { rig.position.set(opt.x, opt.y + api.y, 0); rig.rotation.set(api.pitch, api.yaw, 0); }
    renderer.render(scene, cam);
    requestAnimationFrame(frame);
  })();
  return api;
}
