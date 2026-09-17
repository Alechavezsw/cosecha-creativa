import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { AudioEngine, BAR_COUNT } from './audio.js';
import { PALETTES } from './palettes.js';
import { WaveDisplay } from './waveDisplay.js';
import { VoxelAvatar } from './avatar.js';
import { Studio } from './studio.js';
import { PodcastMic } from './mic3d.js';
import { VintageRadio } from './radio.js';
import { Recorder } from './recorder.js';
import { Captions } from './captions.js';
import { createStudioEnvironment } from './environment.js';

/* ------------------------------------------------------------------ *
 *  Escena
 * ------------------------------------------------------------------ */

const METER_WIDTH = 15;   // ancho del vúmetro sobre la mesa
const METER_Y = 1.72;     // altura de la tapa del escritorio
const METER_Z = 5.6;

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0908);
// Reflejos para los metales del micrófono. El resto del plató es Lambert y los
// ignora; sin esto el cromo saldría negro por muchos focos que tuviera encima.
scene.environment = createStudioEnvironment(renderer);
scene.fog = new THREE.Fog(0x141110, 30, 96); // profundidad de sala, no de espacio

const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 400);
camera.position.set(1.6, 6.4, 17.5);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 10;
controls.maxDistance = 60;
controls.maxPolarAngle = Math.PI * 0.52;
controls.minPolarAngle = Math.PI * 0.2;
controls.maxDistance = 34;
controls.autoRotate = false;
controls.autoRotateSpeed = 0.28;
controls.target.set(0, 5.4, -4);

const palette = {
  a: new THREE.Color(),
  b: new THREE.Color(),
  c: new THREE.Color(),
  index: -1,
};

/* ---------- Barras del ecualizador (circulares, con reflejo y picos) ---------- */

const barGeometry = new THREE.BoxGeometry(0.088, 1, 0.34);
barGeometry.translate(0, 0.5, 0); // pivote en la base: escalar en Y hace crecer la barra

/**
 * Degradado vertical horneado en la geometría. Se multiplica con el color por
 * instancia, así cada barra tiene volumen sin coste extra por frame.
 */
function bakeGradient(geometry, atBase, atTip) {
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp(position.getY(i), 0, 1);
    const v = atBase + (atTip - atBase) * t;
    colors[i * 3] = v;
    colors[i * 3 + 1] = v;
    colors[i * 3 + 2] = v;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

bakeGradient(barGeometry, 0.3, 1.0);
const mirrorGeometry = bakeGradient(barGeometry.clone(), 0.85, 0.0);

const barsMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const bars = new THREE.InstancedMesh(barGeometry, barsMaterial, BAR_COUNT);
bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

const mirrorMaterial = new THREE.MeshBasicMaterial({
  vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false,
  side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
});
const mirror = new THREE.InstancedMesh(mirrorGeometry, mirrorMaterial, BAR_COUNT);
mirror.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

const capGeometry = new THREE.BoxGeometry(0.11, 0.045, 0.38);
const capMaterial = new THREE.MeshBasicMaterial({ toneMapped: false });
const caps = new THREE.InstancedMesh(capGeometry, capMaterial, BAR_COUNT);
caps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

scene.add(bars, mirror, caps);

const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();
const capColor = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);
const WIDE_OFFSET = new THREE.Vector3(1.8, 1.6, 6.5);
const tmpVector = new THREE.Vector3();

/* ---------- Núcleo orgánico reactivo ---------- */

const CORE_VERT = /* glsl */ `
  uniform float uTime, uBass, uMid, uTreble;
  varying float vDisp;
  varying vec3 vNormalW;
  varying vec3 vViewDir;

  // Simplex noise 3D — Ashima Arts / Stefan Gustavson (MIT)
  vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  void main() {
    vec3 n = normalize(normal);
    float low  = snoise(n * 1.5 + vec3(0.0, uTime * 0.22, 0.0));
    float band = snoise(n * 3.6 - vec3(uTime * 0.35));
    float fine = snoise(n * 8.5 + vec3(uTime * 0.7));

    float disp = low  * (0.22 + uBass * 1.55)
               + band * (0.10 + uMid  * 0.85)
               + fine * (0.03 + uTreble * 0.45);

    vDisp = disp;
    vec3 displaced = position + n * disp;

    vec4 world = modelMatrix * vec4(displaced, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * n);
    vViewDir = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const CORE_FRAG = /* glsl */ `
  uniform vec3 uColorA, uColorB, uColorC;
  uniform float uLevel, uBeat;
  varying float vDisp;
  varying vec3 vNormalW;
  varying vec3 vViewDir;

  void main() {
    float facing = clamp(abs(dot(normalize(vViewDir), normalize(vNormalW))), 0.0, 1.0);
    float fres = pow(1.0 - facing, 3.0);
    vec3 col = mix(uColorA, uColorB, smoothstep(-0.5, 0.7, vDisp));
    col = mix(col, uColorC, fres * 0.7);
    col *= 0.18 + uLevel * 0.55 + fres * 1.15 + uBeat * 0.25;
    gl_FragColor = vec4(min(col, vec3(1.7)), 1.0);
  }
`;

const coreUniforms = {
  uTime: { value: 0 },
  uBass: { value: 0 },
  uMid: { value: 0 },
  uTreble: { value: 0 },
  uLevel: { value: 0 },
  uBeat: { value: 0 },
  uColorA: { value: new THREE.Color() },
  uColorB: { value: new THREE.Color() },
  uColorC: { value: new THREE.Color() },
};

const core = new THREE.Mesh(
  new THREE.IcosahedronGeometry(2.9, 24),
  new THREE.ShaderMaterial({ uniforms: coreUniforms, vertexShader: CORE_VERT, fragmentShader: CORE_FRAG }),
);
core.position.y = 3.6;
scene.add(core);

const coreShell = new THREE.Mesh(
  new THREE.IcosahedronGeometry(3.3, 3),
  new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.13, toneMapped: false }),
);
coreShell.position.copy(core.position);
scene.add(coreShell);

/* ---------- Estudio, avatar y micrófono ---------- */

const studio = new Studio();
scene.add(studio.group);

// La boca se puede calibrar sin tocar código: ?boca=0.37&bocaX=0.57&bocaR=0.06
// (alto, centro horizontal y ancho, en fracción de la foto).
const params = new URLSearchParams(location.search);
const number = (name, fallback) => {
  const value = Number(params.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const avatar = new VoxelAvatar({
  columns: number('detalle', 200),
  mouth: number('boca', 0.375),
  mouthX: number('bocaX', 0.565),
  mouthRadius: number('bocaR', 0.055),
  relief: Number(params.get('relieve')) || 0,
});
scene.add(avatar.group);

const avatarB = new VoxelAvatar({
  columns: number('detalle', 200),
  mouth: number('boca', 0.375),
  mouthX: number('bocaX', 0.565),
  mouthRadius: number('bocaR', 0.055),
});
scene.add(avatarB.group);

const mic = new PodcastMic();
scene.add(mic.group);

const micB = new PodcastMic();
micB.group.visible = false;
scene.add(micB.group);

// Radio de válvulas en un extremo de la mesa: su aguja hace de vúmetro.
const radio = new VintageRadio();
radio.place(new THREE.Vector3(7.4, 1.55, 0.4), -0.6, 0.92);
scene.add(radio.group);

const voice = new WaveDisplay({ bars: 54, width: 9.4, height: 3.6 });
scene.add(voice.group);

/* ---------- Post-proceso ---------- */

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// strength / radius / threshold: sólo brillan los picos, no toda la escena.
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.38, 0.72);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ------------------------------------------------------------------ *
 *  Paleta
 * ------------------------------------------------------------------ */

function applyPalette(index) {
  if (index === palette.index) return;
  palette.index = index;
  const p = PALETTES[index];
  palette.a.set(p.colors[0]);
  palette.b.set(p.colors[1]);
  palette.c.set(p.colors[2]);
  coreUniforms.uColorA.value.copy(palette.a);
  coreUniforms.uColorB.value.copy(palette.b);
  coreUniforms.uColorC.value.copy(palette.c);
  coreShell.material.color.copy(palette.c);
  voice.setColors(palette.b, palette.a);
  mic.setColor(palette.b);
  micB.setColor(palette.b);

  document.documentElement.style.setProperty('--accent', p.accent);
  document.documentElement.style.setProperty('--accent-2', p.colors[2]);
  document.querySelectorAll('.swatch').forEach((el, i) => {
    el.setAttribute('aria-pressed', String(i === index));
  });
}

/** Color de una barra: interpola grave -> medio -> agudo y sube el brillo con la energía. */
function barColor(t, energy, target) {
  if (t < 0.5) target.copy(palette.a).lerp(palette.b, t * 2);
  else target.copy(palette.b).lerp(palette.c, (t - 0.5) * 2);
  return target.multiplyScalar(0.32 + Math.min(1, energy) * 0.95);
}

/* ------------------------------------------------------------------ *
 *  Bucle de render
 * ------------------------------------------------------------------ */

const audio = new AudioEngine();
const recorder = new Recorder(canvas, audio);
const clock = new THREE.Clock();
let bloomBase = 0.32;
let beatFlash = 0;
let baseFov = 52;

/** En pantallas estrechas se abre el campo de visión para que quepa el anillo. */
function resize() {
  const aspect = innerWidth / innerHeight;
  baseFov = THREE.MathUtils.clamp(42 * (1.6 / Math.max(aspect, 0.5)), 38, 64);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
}

/* ---------- Modos: voz (podcast) y ritmo (música) ---------- */

const MODES = {
  voice: {
    show: [voice.group],
    hide: [bars, mirror, caps],
    core: { position: new THREE.Vector3(-4.6, 8.6, -13.4), scale: 0.9 },
    camera: { position: new THREE.Vector3(-1.8, 6.2, 15), target: new THREE.Vector3(-1.8, 4.4, -5) },
  },
  rhythm: {
    show: [bars, mirror, caps],
    hide: [voice.group],
    core: { position: new THREE.Vector3(-4.6, 8.6, -13.4), scale: 0.9 },
    camera: { position: new THREE.Vector3(0.9, 5.9, 14.5), target: new THREE.Vector3(-0.8, 4.2, -5) },
  },
};

/**
 * Reparte el plató según haya un locutor o dos.
 *
 * Con invitado, los dos monitores se van a los lados, el visualizador sube al
 * centro y la radio pasa a ocupar el hueco del escritorio entre ambos.
 */
function applyLayout() {
  const duo = avatarB.loaded;
  wideShot = duo;
  const height = duo ? 8 : 9.4;
  const y = duo ? 5.2 : 5.8;
  const hostX = duo ? -7.6 : -5;
  const aspect = (a) => height * (a.cols / a.rows);

  avatar.place(new THREE.Vector3(hostX, y, -13.6), height);
  mic.place(new THREE.Vector3(hostX + 1.3, 1.62, duo ? 1.2 : 1.6), 1.02);

  micB.group.visible = duo;
  avatarB.group.visible = duo;
  studio.panelB.group.visible = duo;
  if (duo) {
    avatarB.place(new THREE.Vector3(-hostX, y, -13.6), height);
    micB.place(new THREE.Vector3(-hostX - 1.3, 1.62, 1.2), 1.02);
    studio.fitFrame(studio.panelB, aspect(avatarB), height, avatarB.group.position);
    voice.group.position.set(0, 11.6, -12.6);
    studio.placeSign(0, 16.6);
    radio.place(new THREE.Vector3(0, 1.55, 1.8), 0, 0.85);
  } else {
    voice.group.position.set(5.4, 6.6, -11.6);
    studio.placeSign(-5, 14.4);
    radio.place(new THREE.Vector3(7.4, 1.55, 0.4), -0.6, 0.92);
  }

  studio.fitFrame(studio.display, 10.4, 5.2, voice.group.position, 0.9);
  if (avatar.loaded && showAvatar) {
    studio.fitFrame(studio.panel, aspect(avatar), height, avatar.group.position);
  }
  applyAvatarVisibility();
}
let mode = 'voice';
let coreScaleBase = 1;
let camTween = 0; // segundos restantes de transición de cámara
let wideShot = false; // con invitado hace falta abrir el plano
let showAvatar = true;

/** El avatar y el núcleo ocupan el mismo sitio: sólo uno de los dos se ve. */
function applyAvatarVisibility() {
  const useAvatar = avatar.loaded && showAvatar;
  avatar.group.visible = useAvatar;
  studio.panel.group.visible = useAvatar;
  core.visible = !useAvatar;
  coreShell.visible = !useAvatar;
}

function setMode(next) {
  if (!MODES[next]) return;
  mode = next;
  const config = MODES[next];
  config.show.forEach((o) => { o.visible = true; });
  config.hide.forEach((o) => { o.visible = false; });
  core.position.copy(config.core.position);
  coreShell.position.copy(config.core.position);
  coreScaleBase = config.core.scale;
  applyLayout();
  camTween = 1.6;

  document.querySelectorAll('.seg').forEach((el) => {
    el.setAttribute('aria-pressed', String(el.dataset.mode === next));
  });
}

/** Acerca la cámara al encuadre del modo activo; el usuario puede interrumpirla. */
function tweenCamera(dt) {
  if (camTween <= 0) return;
  camTween -= dt;
  const k = 1 - Math.pow(0.004, dt);
  const shot = MODES[mode].camera;
  camera.position.lerp(
    wideShot ? tmpVector.copy(shot.position).add(WIDE_OFFSET) : shot.position, k);
  controls.target.lerp(shot.target, k);
}
controls.addEventListener('start', () => { camTween = 0; });

/**
 * Medidor de barras apoyado en la mesa: recto, frontal y contenido, como el
 * vúmetro de una consola. Nada de anillos girando.
 */
function updateBars() {
  for (let i = 0; i < BAR_COUNT; i++) {
    const v = audio.spectrum[i];
    // Curva suave: los picos no se disparan fuera de cuadro.
    const height = 0.12 + Math.pow(v, 0.82) * 3.4;
    const x = (i / (BAR_COUNT - 1) - 0.5) * METER_WIDTH;
    const z = METER_Z;

    dummy.rotation.set(0, 0, 0);
    dummy.position.set(x, METER_Y, z);
    dummy.scale.set(1, height, 1);
    dummy.updateMatrix();
    bars.setMatrixAt(i, dummy.matrix);

    dummy.scale.set(1, -height * 0.4, 1);
    dummy.updateMatrix();
    mirror.setMatrixAt(i, dummy.matrix);

    dummy.position.set(x, METER_Y + 0.14 + Math.pow(audio.peaks[i], 0.82) * 3.4, z);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    caps.setMatrixAt(i, dummy.matrix);

    barColor(i / (BAR_COUNT - 1), v, tmpColor);
    bars.setColorAt(i, tmpColor);
    mirror.setColorAt(i, tmpColor);
    caps.setColorAt(i, capColor.copy(tmpColor).lerp(WHITE, 0.35));
  }
  bars.instanceMatrix.needsUpdate = true;
  mirror.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;
  bars.instanceColor.needsUpdate = true;
  mirror.instanceColor.needsUpdate = true;
  caps.instanceColor.needsUpdate = true;
}

function render() {
  requestAnimationFrame(render);
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  audio.update(dt);

  beatFlash = Math.max(beatFlash * Math.pow(0.02, dt), audio.beat);

  if (mode === 'rhythm') updateBars();
  else voice.update(dt, audio);

  studio.update(dt, audio.active, audio.level);
  mic.update(dt, audio, beatFlash);
  micB.update(dt, audio, beatFlash);
  radio.update(dt, audio, audio.active);
  tweenCamera(dt);
  // Con invitado, cada uno mueve la boca con el nivel de su canal; en mono
  // los dos canales traen lo mismo y hablan los dos.
  const duo = avatarB.loaded;
  if (avatar.group.visible) avatar.update(dt, audio, duo ? audio.levelLeft : audio.level);
  if (avatarB.group.visible) avatarB.update(dt, audio, audio.levelRight);

  coreUniforms.uTime.value = time;
  coreUniforms.uBass.value += (audio.bass - coreUniforms.uBass.value) * 0.25;
  coreUniforms.uMid.value += (audio.mid - coreUniforms.uMid.value) * 0.2;
  coreUniforms.uTreble.value += (audio.treble - coreUniforms.uTreble.value) * 0.3;
  coreUniforms.uLevel.value += (audio.level - coreUniforms.uLevel.value) * 0.2;
  coreUniforms.uBeat.value = beatFlash;

  const coreScale = coreScaleBase * (1 + audio.level * 0.16 + beatFlash * 0.12);
  core.scale.setScalar(coreScale);
  core.rotation.y = time * 0.14;
  coreShell.rotation.y = -time * 0.09;
  coreShell.rotation.x = time * 0.05;
  coreShell.scale.setScalar(coreScale * (1.02 + beatFlash * 0.08));
  coreShell.material.opacity = 0.08 + audio.treble * 0.3;

  bloom.strength = bloomBase + audio.level * 0.12;

  // Sin golpes de zoom: el encuadre se mantiene quieto, como una cámara de plató.
  camera.fov += (baseFov - camera.fov) * 0.12;
  camera.updateProjectionMatrix();

  controls.update();
  composer.render();
  updateHud();
  updateRecPill();
}

/* ------------------------------------------------------------------ *
 *  Interfaz
 * ------------------------------------------------------------------ */

const ui = {
  meterFill: document.getElementById('meterFill'),
  sourceLabel: document.getElementById('sourceLabel'),
  bands: {
    bass: document.getElementById('bandBass'),
    mid: document.getElementById('bandMid'),
    treble: document.getElementById('bandTreble'),
  },
  btnMic: document.getElementById('btnMic'),
  btnFile: document.getElementById('btnFile'),
  btnDemo: document.getElementById('btnDemo'),
  btnMonitor: document.getElementById('btnMonitor'),
  btnTab: document.getElementById('btnTab'),
  btnAvatar: document.getElementById('btnAvatar'),
  btnGuest: document.getElementById('btnGuest'),
  guestInput: document.getElementById('guestInput'),
  btnRec: document.getElementById('btnRec'),
  btnCaptions: document.getElementById('btnCaptions'),
  recPill: document.getElementById('recPill'),
  recTime: document.getElementById('recTime'),
  captions: document.getElementById('captions'),
  livePhoto: document.getElementById('livePhoto'),
  avatarInput: document.getElementById('avatarInput'),
  btnPlay: document.getElementById('btnPlay'),
  btnStop: document.getElementById('btnStop'),
  btnRotate: document.getElementById('btnRotate'),
  btnFull: document.getElementById('btnFull'),
  iconPlay: document.getElementById('iconPlay'),
  iconPause: document.getElementById('iconPause'),
  fileInput: document.getElementById('fileInput'),
  player: document.getElementById('player'),
  toast: document.getElementById('toast'),
  dropOverlay: document.getElementById('dropOverlay'),
  swatches: document.getElementById('swatches'),
  progressRow: document.getElementById('progressRow'),
  seek: document.getElementById('seek'),
  seekFill: document.getElementById('seekFill'),
  timeNow: document.getElementById('timeNow'),
  timeTotal: document.getElementById('timeTotal'),
  urlForm: document.getElementById('urlForm'),
  urlInput: document.getElementById('urlInput'),
  btnUrl: document.getElementById('btnUrl'),
  modeSwitch: document.getElementById('modeSwitch'),
  btnPanel: document.getElementById('btnPanel'),
  panelToggleLabel: document.getElementById('panelToggleLabel'),
};

const captions = new Captions(ui.captions, {
  lang: navigator.language || 'es-AR',
  onState: (on, message) => {
    ui.btnCaptions.classList.toggle('active', on);
    if (message) toast(message, 4200);
    else if (on) toast('Subtítulos en vivo · la traducción aparece debajo');
  },
});

function syncCaptionsOffset() {
  if (document.body.classList.contains('ui-hidden')) {
    document.documentElement.style.setProperty('--captions-bottom', '64px');
    return;
  }
  const footer = document.querySelector('.hud-bottom');
  if (!footer) return;
  const fromBottom = Math.max(72, Math.round(innerHeight - footer.getBoundingClientRect().top + 16));
  document.documentElement.style.setProperty('--captions-bottom', `${fromBottom}px`);
}

let toastTimer = 0;
function toast(message, ms = 2600) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), ms);
}

function setPanelCollapsed(collapsed) {
  document.body.classList.toggle('panel-collapsed', collapsed);
  ui.btnPanel.setAttribute('aria-expanded', String(!collapsed));
  ui.btnPanel.title = collapsed ? 'Desplegar menú (U)' : 'Plegar menú (U)';
  ui.panelToggleLabel.textContent = collapsed ? 'Mostrar menú' : 'Ocultar menú';
  try { localStorage.setItem('prisma-panel-collapsed', collapsed ? '1' : '0'); } catch { /* ignore */ }
  requestAnimationFrame(syncCaptionsOffset);
}

ui.btnPanel.addEventListener('click', () => {
  setPanelCollapsed(!document.body.classList.contains('panel-collapsed'));
});
try {
  if (localStorage.getItem('prisma-panel-collapsed') === '1') setPanelCollapsed(true);
} catch { /* ignore */ }

function updateHud() {
  ui.meterFill.style.width = `${Math.min(100, audio.level * 100)}%`;
  const paint = (el, value) => {
    const on = Math.min(1, value);
    el.style.color = `rgba(255,255,255,${(0.35 + on * 0.65).toFixed(2)})`;
    el.style.background = `color-mix(in srgb, var(--accent) ${Math.round(on * 55)}%, rgba(255,255,255,.05))`;
  };
  paint(ui.bands.bass, audio.bass);
  paint(ui.bands.mid, audio.mid);
  paint(ui.bands.treble, audio.treble);
}

PALETTES.forEach((p, i) => {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.type = 'button';
  b.title = p.name;
  b.setAttribute('aria-pressed', 'false');
  b.setAttribute('aria-label', `Paleta ${p.name}`);
  b.style.background = `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]}, ${p.colors[2]})`;
  b.style.color = p.accent;
  b.addEventListener('click', () => applyPalette(i));
  ui.swatches.appendChild(b);
});
applyPalette(0);

async function startMic() {
  try {
    await audio.useMicrophone();
    ui.player.pause();
    ui.progressRow.hidden = true;
    ui.btnTab.classList.remove('recording');
    ui.btnDemo.classList.remove('active');
    ui.btnMic.classList.add('recording');
    ui.btnPlay.disabled = true;
    ui.btnStop.disabled = false;
    ui.sourceLabel.textContent = 'Micrófono en vivo';
    toast(audio.monitorWanted
      ? 'Micrófono al aire · OBS tiene que capturar el audio de Chrome, no el mic del sistema'
      : 'Micrófono activo · para OBS pulsá «OBS» y usá auriculares');
  } catch (err) {
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    const busy = err && err.name === 'NotReadableError';
    toast(denied
      ? 'Permiso de micrófono denegado. Actívalo desde el candado de la barra de direcciones.'
      : busy
        ? 'El micrófono está ocupado, casi siempre por OBS. En OBS sacá o silenciá la fuente Mic/Aux y volvé a pulsar Micrófono.'
        : `No se pudo abrir el micrófono: ${(err && err.message) || err}`, 5600);
  }
}

/* ---------- Avatar ---------- */

/** La misma foto alimenta el rótulo de directo, en píxeles. */
function setLivePhoto(source) {
  const previous = ui.livePhoto.dataset.objectUrl;
  if (previous) URL.revokeObjectURL(previous);
  if (source instanceof Blob) {
    const url = URL.createObjectURL(source);
    ui.livePhoto.dataset.objectUrl = url;
    ui.livePhoto.style.backgroundImage = `url("${url}")`;
  } else {
    delete ui.livePhoto.dataset.objectUrl;
    ui.livePhoto.style.backgroundImage = `url("${source}")`;
  }
}

async function setAvatar(file) {
  if (!file) return;
  try {
    await avatar.loadFromBlob(file);
    setLivePhoto(file);
    showAvatar = true;
    applyLayout();
    ui.btnAvatar.classList.add('active');
    toast(`Avatar listo · ${avatar.count.toLocaleString('es')} cubos`);
  } catch {
    toast('No se pudo leer esa imagen.');
  }
}

/* ---------- Invitado ---------- */

async function setGuest(file) {
  if (!file) return;
  try {
    await avatarB.loadFromBlob(file);
    applyLayout();
    ui.btnGuest.classList.add('active');
    toast('Invitado en plató · en estéreo, habla el del canal con más nivel');
  } catch {
    toast('No se pudo leer esa imagen.');
  }
}

function toggleGuest() {
  if (!avatarB.loaded) {
    ui.guestInput.click();
    return;
  }
  avatarB.dispose();
  ui.btnGuest.classList.remove('active');
  applyLayout();
  toast('Invitado fuera');
}

/* ---------- Grabación de vídeo ---------- */

async function toggleRecording() {
  if (!Recorder.supported) {
    toast('Este navegador no puede grabar el lienzo. Usa Chrome o Edge.', 4500);
    return;
  }

  if (recorder.recording) {
    const blob = await recorder.stop();
    ui.btnRec.classList.remove('active');
    ui.recPill.hidden = true;
    if (blob && blob.size) {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      Recorder.download(blob, `prisma-${stamp}`);
      toast('Vídeo descargado');
    } else {
      toast('La grabación salió vacía.');
    }
    return;
  }

  if (!audio.active) {
    toast('Pon una fuente de audio antes de grabar.');
    return;
  }
  recorder.start();
  ui.btnRec.classList.add('active');
  ui.recPill.hidden = false;
  toast('Grabando · vuelve a pulsar para guardar el vídeo');
}

function updateRecPill() {
  if (!recorder.recording) return;
  const total = Math.floor(recorder.seconds);
  ui.recTime.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function toggleAvatar() {
  if (!avatar.loaded) {
    ui.avatarInput.click();
    return;
  }
  showAvatar = !showAvatar;
  applyAvatarVisibility();
  ui.btnAvatar.classList.toggle('active', showAvatar);
  toast(showAvatar ? 'Avatar' : 'Núcleo');
}

function loadFile(file) {
  if (!file) return;
  if (file.type.startsWith('image/')) {
    setAvatar(file);
    return;
  }
  if (!file.type.startsWith('audio/')) {
    toast('Ese archivo no es de audio ni una imagen.');
    return;
  }
  if (ui.player.dataset.objectUrl) URL.revokeObjectURL(ui.player.dataset.objectUrl);
  const url = URL.createObjectURL(file);
  ui.player.dataset.objectUrl = url;
  ui.player.src = url;
  audio.useMediaElement(ui.player);
  ui.btnMic.classList.remove('recording');
  ui.btnPlay.disabled = false;
  ui.btnStop.disabled = false;
  ui.player.play();
  ui.sourceLabel.textContent = file.name.replace(/\.[^.]+$/, '').slice(0, 26);
  toast(`Reproduciendo · ${file.name}`);
}

/** Carga una fuente en el reproductor y espera a que sea reproducible. */
function attachSource(src) {
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('No se pudo cargar el audio')); };
    const cleanup = () => {
      ui.player.removeEventListener('canplay', done);
      ui.player.removeEventListener('error', fail);
    };
    ui.player.addEventListener('canplay', done, { once: true });
    ui.player.addEventListener('error', fail, { once: true });
    ui.player.crossOrigin = 'anonymous';
    ui.player.src = src;
    ui.player.load();
  });
}

const YOUTUBE_URL = /(?:^|\.)(youtube\.com|youtu\.be)$/i;

/** Prepara la interfaz para una fuente reproducible (archivo, URL o YouTube). */
function activatePlayerSource(label) {
  ui.btnMic.classList.remove('recording');
  ui.btnTab.classList.remove('recording');
  ui.btnDemo.classList.remove('active');
  ui.btnPlay.disabled = false;
  ui.btnStop.disabled = false;
  ui.sourceLabel.textContent = label;
}

/**
 * YouTube no se puede analizar desde un iframe (audio de otro origen), así que
 * el servidor pide a yt-dlp la pista de audio y ésta se sirve por el proxy.
 */
async function loadYoutube(url) {
  toast('Resolviendo el audio de YouTube…', 30000);
  const response = await fetch(`/youtube?url=${encodeURIComponent(url)}`);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    toast(data.hint
      ? `${data.error}. Instálalo con «${data.hint}» y reinicia el servidor, o usa «Pestaña».`
      : `${data.error || 'No se pudo resolver el vídeo'}. Prueba con «Pestaña».`, 7000);
    return;
  }

  await attachSource(`/proxy?url=${encodeURIComponent(data.url)}`);
  audio.useMediaElement(ui.player);
  activatePlayerSource(data.title.slice(0, 32));
  await ui.player.play();
  toast(`Reproduciendo · ${data.title}`);
}

async function loadUrl(rawUrl) {
  const url = rawUrl.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    toast('La URL debe empezar por http:// o https://');
    return;
  }

  if (YOUTUBE_URL.test(new URL(url).hostname)) {
    ui.btnUrl.disabled = true;
    try {
      await loadYoutube(url);
    } catch {
      toast('No se pudo reproducir ese vídeo. Prueba con «Pestaña».', 5200);
    } finally {
      ui.btnUrl.disabled = false;
    }
    return;
  }

  ui.btnUrl.disabled = true;
  toast('Cargando audio…', 8000);
  try {
    try {
      await attachSource(url);
    } catch {
      // Casi ningún hosting de podcast envía cabeceras CORS y sin ellas el
      // analizador sólo recibe silencio: se reintenta por el proxy local.
      await attachSource(`/proxy?url=${encodeURIComponent(url)}`);
    }
    audio.useMediaElement(ui.player);
    activatePlayerSource(new URL(url).hostname.replace(/^www\./, ''));
    await ui.player.play();
    toast('Episodio en reproducción');
  } catch {
    toast('No se pudo cargar esa URL. Comprueba el enlace o descarga el MP3 y arrástralo aquí.', 5200);
  } finally {
    ui.btnUrl.disabled = false;
  }
}

function stopAll() {
  audio.stop();
  ui.player.pause();
  ui.progressRow.hidden = true;
  ui.btnMic.classList.remove('recording');
  ui.btnTab.classList.remove('recording');
  ui.btnDemo.classList.remove('active');
  ui.btnPlay.disabled = true;
  ui.btnStop.disabled = true;
  ui.sourceLabel.textContent = 'En reposo';
}

async function startTabCapture() {
  if (audio.kind === 'tab') {
    stopAll();
    return;
  }
  try {
    await audio.useDisplayCapture(() => {
      if (audio.kind === 'tab') stopAll();
    });
    ui.player.pause();
    ui.progressRow.hidden = true;
    ui.btnMic.classList.remove('recording');
    ui.btnDemo.classList.remove('active');
    ui.btnTab.classList.add('recording');
    ui.btnPlay.disabled = true;
    ui.btnStop.disabled = false;
    ui.sourceLabel.textContent = 'Audio de la pestaña';
    toast('Capturando · el vídeo suena en su pestaña y aquí se visualiza');
  } catch (err) {
    if (err && err.name === 'NotAllowedError') return; // el usuario canceló
    toast(err && err.code === 'NO_AUDIO'
      ? 'No marcaste «Compartir audio de la pestaña». Vuelve a intentarlo y activa esa casilla.'
      : `No se pudo capturar el audio: ${(err && err.message) || err}`, 5600);
  }
}

function toggleDemo() {
  if (audio.kind === 'demo') {
    stopAll();
    return;
  }
  audio.startDemo();
  ui.player.pause();
  ui.progressRow.hidden = true;
  ui.btnMic.classList.remove('recording');
  ui.btnDemo.classList.add('active');
  ui.btnPlay.disabled = true;
  ui.btnStop.disabled = false;
  ui.sourceLabel.textContent = 'Pista de demostración';
  toast('Modo demo · pista generativa integrada');
}

function setMonitor(on, { silent = false } = {}) {
  audio.setMonitor(on);
  ui.btnMonitor.classList.toggle('active', on);
  ui.btnMonitor.setAttribute('aria-pressed', String(on));
  if (silent) return;
  if (on) {
    toast('Salida OBS activa. En OBS: capturá Chrome con «Captura de audio de aplicación» y silenciá Mic/Aux. Usá auriculares.', 7000);
  } else {
    toast('Salida OBS apagada · el micrófono ya no sale por los altavoces');
  }
}

ui.btnMic.addEventListener('click', startMic);
ui.btnDemo.addEventListener('click', toggleDemo);
ui.btnMonitor.addEventListener('click', () => setMonitor(!audio.monitorWanted));
ui.btnTab.addEventListener('click', startTabCapture);
ui.btnAvatar.addEventListener('click', toggleAvatar);
ui.btnGuest.addEventListener('click', toggleGuest);
ui.guestInput.addEventListener('change', (e) => setGuest(e.target.files[0]));
ui.btnRec.addEventListener('click', toggleRecording);
ui.btnCaptions.addEventListener('click', () => {
  if (!captions.supported) {
    toast('Los subtítulos en vivo necesitan Chrome o Edge.', 4200);
    return;
  }
  captions.toggle();
});
ui.avatarInput.addEventListener('change', (e) => setAvatar(e.target.files[0]));

ui.urlForm.addEventListener('submit', (e) => {
  e.preventDefault();
  loadUrl(ui.urlInput.value);
});

ui.modeSwitch.addEventListener('click', (e) => {
  const button = e.target.closest('.seg');
  if (button) setMode(button.dataset.mode);
});
ui.btnFile.addEventListener('click', () => ui.fileInput.click());
ui.fileInput.addEventListener('change', (e) => loadFile(e.target.files[0]));
ui.btnStop.addEventListener('click', stopAll);
ui.btnPlay.addEventListener('click', () => {
  if (ui.player.paused) ui.player.play();
  else ui.player.pause();
});
ui.player.addEventListener('play', () => {
  ui.iconPlay.hidden = true;
  ui.iconPause.hidden = false;
});
ui.player.addEventListener('pause', () => {
  ui.iconPlay.hidden = false;
  ui.iconPause.hidden = true;
});

/* ---------- Progreso y búsqueda ---------- */

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function updateProgress() {
  const { duration, currentTime } = ui.player;
  const ratio = Number.isFinite(duration) && duration > 0 ? currentTime / duration : 0;
  ui.seekFill.style.width = `${ratio * 100}%`;
  ui.seek.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  ui.timeNow.textContent = formatTime(currentTime);
  ui.timeTotal.textContent = formatTime(duration);
}

function seekToRatio(ratio) {
  if (!Number.isFinite(ui.player.duration)) return;
  ui.player.currentTime = THREE.MathUtils.clamp(ratio, 0, 1) * ui.player.duration;
  updateProgress();
}

ui.player.addEventListener('timeupdate', updateProgress);
ui.player.addEventListener('loadedmetadata', () => {
  ui.progressRow.hidden = false;
  updateProgress();
});
ui.player.addEventListener('ended', () => {
  ui.iconPlay.hidden = false;
  ui.iconPause.hidden = true;
});
ui.seek.addEventListener('pointerdown', (e) => {
  const rect = ui.seek.getBoundingClientRect();
  seekToRatio((e.clientX - rect.left) / rect.width);
});
ui.seek.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 60 : 15;
  if (e.key === 'ArrowRight') seekToRatio((ui.player.currentTime + step) / ui.player.duration);
  else if (e.key === 'ArrowLeft') seekToRatio((ui.player.currentTime - step) / ui.player.duration);
  else return;
  e.preventDefault();
});

ui.btnRotate.classList.add('active');
ui.btnRotate.addEventListener('click', () => {
  controls.autoRotate = !controls.autoRotate;
});

ui.btnFull.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
});

document.getElementById('gain').addEventListener('input', (e) => { audio.gain = +e.target.value; });
document.getElementById('smooth').addEventListener('input', (e) => { audio.smoothing = +e.target.value; });
document.getElementById('bloom').addEventListener('input', (e) => { bloomBase = +e.target.value; });

/* ---------- Arrastrar y soltar ---------- */

let dragDepth = 0;
addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (++dragDepth === 1) ui.dropOverlay.classList.add('show');
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) ui.dropOverlay.classList.remove('show');
});
addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  ui.dropOverlay.classList.remove('show');
  loadFile(e.dataTransfer.files[0]);
});

/* ---------- Atajos ---------- */

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLElement && e.target.matches('input, textarea')) return;
  switch (e.key.toLowerCase()) {
    case ' ':
      e.preventDefault();
      if (!ui.btnPlay.disabled) ui.btnPlay.click();
      break;
    case 'm': startMic(); break;
    case 'n': setMonitor(!audio.monitorWanted); break;
    case 'd': toggleDemo(); break;
    case 't': startTabCapture(); break;
    case 'a': toggleAvatar(); break;
    case 'v': setMode(mode === 'voice' ? 'rhythm' : 'voice'); break;
    case 'u':
      setPanelCollapsed(!document.body.classList.contains('panel-collapsed'));
      break;
    case 'h':
      document.body.classList.toggle('ui-hidden');
      syncCaptionsOffset();
      break;
    case 'f': ui.btnFull.click(); break;
    case 'r': toggleRecording(); break;
    case 'o': ui.btnRotate.click(); break;
    case 'g': toggleGuest(); break;
    case 'c': ui.btnCaptions.click(); break;
    case 'p': applyPalette((palette.index + 1) % PALETTES.length); break;
    default: break;
  }
});

addEventListener('resize', () => {
  resize();
  syncCaptionsOffset();
});
resize();
syncCaptionsOffset();
new ResizeObserver(syncCaptionsOffset).observe(document.querySelector('.hud-bottom'));

// Si hay una foto en assets/avatar.png se usa como avatar al arrancar.
// Igual que el locutor: si existe assets/invitado.png, entra al plató.
avatarB.loadFromUrl('./assets/invitado.png')
  .then(() => { ui.btnGuest.classList.add('active'); applyLayout(); })
  .catch(() => { /* sin invitado: un solo locutor */ });

avatar.loadFromUrl('./assets/avatar.png')
  .then(() => {
    ui.btnAvatar.classList.add('active');
    setLivePhoto('./assets/avatar.png');
    setMode(mode);
  })
  .catch(() => { /* sin avatar: se queda el núcleo */ });

setMode('voice');
camera.position.copy(MODES.voice.camera.position);
controls.target.copy(MODES.voice.camera.target);

render();
if (window.obsstudio || new URLSearchParams(location.search).has('obs')) {
  setMonitor(true, { silent: true });
}
toast('Pega la URL del episodio, pulsa «Micrófono» o suelta un archivo', 4200);

