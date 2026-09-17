import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Micrófono de condensador colgado boca abajo de un brazo de sobremesa, con
 * araña antivibración y antipop de cuello de cisne.
 *
 * Va invertido porque es como cuelga en un estudio: la cápsula baja hacia la
 * boca y el brazo entra por detrás, así nada se cruza entre la cara y la
 * cámara. El pie queda desplazado hacia atrás y el micro cae justo donde antes
 * estaba la cabeza, de modo que `place()` sigue recibiendo el mismo punto.
 *
 * Dos decisiones sostienen el modelado. La primera: el cuerpo está torneado
 * (LatheGeometry) en vez de apilado con cilindros, porque lo que delata a un
 * micro de attrezzo es la silueta, no el material. La segunda: la rejilla son
 * dos capas, unas barras gruesas que dan la forma y una malla fina por dentro,
 * sobre una cesta oscura. Con una sola capa no sale: o los alambres quedan tan
 * separados que parece una jaula de pájaros, o hay que poner tantos que se
 * convierten en un plano gris.
 *
 * Todo lo que es una sola pieza visual se fusiona en una geometría (la jaula,
 * las gomas, las anillas del cuello de cisne): son cientos de tubos y salen en
 * una única llamada de dibujo.
 *
 * Los metales son PBR y necesitan `scene.environment` (ver environment.js);
 * sin él saldrían negros.
 *
 * Queda inmóvil a propósito. Lo único que cambia es el rescoldo de la cápsula
 * y el piloto rojo: un micro que se balancea delata que es un adorno.
 */

/* ------------------------------------------------------------------ *
 *  Recursos compartidos por las dos instancias (locutor e invitado)
 * ------------------------------------------------------------------ */

const cache = new Map();
const shared = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

/** Moleteado en rombo para los collares de ajuste: va como relieve, no color. */
function knurlTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 128, 128);
  ctx.lineWidth = 3;
  for (const [direction, tone] of [[1, '#ffffff'], [-1, '#1a1a1a']]) {
    ctx.strokeStyle = tone;
    for (let i = -128; i < 256; i += 11) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + direction * 128, 128);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(14, 1);
  return texture;
}

/**
 * Trenzado, como máscara de opacidad: blanco es hilo y negro es agujero. De
 * cerca se ven los hilos; de lejos el mipmap los promedia en un velo, que es
 * justo lo que hace una malla real delante de una cámara. Lo usan la rejilla
 * del micro y el antipop, con repeticiones distintas.
 */
function weaveTexture(repeatX, repeatY) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#d8d8d8';
  ctx.lineWidth = 2.2;
  for (let i = 4; i < 256; i += 12) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 256);
    ctx.moveTo(0, i);
    ctx.lineTo(256, i);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 8;
  return texture;
}

/**
 * Chapa grabada del fabricante. Va girada media vuelta porque el micro cuelga
 * invertido: es la única pieza con arriba y abajo.
 */
function plateTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const draw = () => {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#20242b';
    ctx.fillRect(0, 0, 512, 128);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Un reflejo claro un píxel por debajo del texto oscuro: eso es lo que se
    // lee como grabado, y sale sin montar un mapa de relieve aparte.
    ctx.font = '700 44px "Space Grotesk", "Segoe UI", system-ui, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '7px';
    ctx.fillStyle = '#6d7683';
    ctx.fillText('COSECHA', 256, 51);
    ctx.fillStyle = '#0d0f13';
    ctx.fillText('COSECHA', 256, 49);
    ctx.font = '500 25px "Space Grotesk", "Segoe UI", system-ui, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '11px';
    ctx.fillStyle = '#c79a55';
    ctx.fillText('CREATIVA', 256, 88);
    const existing = cache.get('plate');
    if (existing) existing.needsUpdate = true;
  };

  draw();
  document.fonts?.ready.then(draw).catch(() => { /* se queda la de sistema */ });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  // Media vuelta, para compensar el giro del cabezal.
  texture.repeat.set(-1, -1);
  texture.offset.set(1, 1);
  return texture;
}

/**
 * Sombra de contacto pintada: apoya el pie en la mesa sin encender sombras.
 * Va como máscara de opacidad sobre un material negro, no como color: un
 * degradado a negro transparente multiplicado tiñe de negro todo el cuadrado.
 */
function shadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.34, '#8a8a8a');
  gradient.addColorStop(0.66, '#2a2a2a');
  gradient.addColorStop(1, '#000000');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/* ------------------------------------------------------------------ *
 *  Medidas y perfiles
 * ------------------------------------------------------------------ */

const STAND_Z = -1.06;  // el pie se retira hacia atrás; el micro cae delante
const HEAD_Y = 2.90;    // altura del cabezal colgado
const COLUMN_TOP = 2.78;

/** Perfil del cuerpo, en radio/altura relativos al centro del cabezal. */
const BODY = [
  [0.000, -0.72], [0.224, -0.72], [0.252, -0.694], [0.256, -0.630],
  [0.298, -0.588], [0.300, -0.470], [0.322, -0.428], [0.332, -0.360],
  [0.338, -0.040], [0.336, 0.190], [0.348, 0.240], [0.348, 0.318],
  [0.330, 0.360], [0.352, 0.392],
];

/** Perfil de la jaula: barril suave rematado en cúpula. */
const CAGE = [
  [0.352, 0.392], [0.368, 0.520], [0.370, 0.680], [0.356, 0.810],
  [0.310, 0.920], [0.222, 1.002], [0.114, 1.048],
];

/** Aros horizontales de la jaula, con el radio del perfil a esa altura. */
const CAGE_RINGS = [
  [0.358, 0.426], [0.368, 0.494], [0.372, 0.562], [0.372, 0.632],
  [0.368, 0.700], [0.360, 0.766], [0.346, 0.834], [0.318, 0.898],
  [0.262, 0.962], [0.176, 1.018],
];

/** La malla fina va justo por dentro de las barras, sin llegar a tocarlas. */
const CAGE_MESH = CAGE.map(([radius, y]) => [radius - 0.016, y]);

/** Cesta oscura del interior: es el fondo contra el que se recorta la rejilla. */
const BASKET = [
  [0.000, 0.400], [0.318, 0.412], [0.326, 0.460], [0.326, 0.800],
  [0.290, 0.910], [0.192, 0.990], [0.000, 1.012],
];

/** Perfil del pie: disco lastrado con bisel y cuello. */
const FOOT = [
  [0.000, 0.000], [0.700, 0.000], [0.726, 0.024], [0.728, 0.062],
  [0.684, 0.112], [0.572, 0.146], [0.518, 0.168], [0.506, 0.196],
  [0.120, 0.208], [0.096, 0.234], [0.000, 0.234],
];

/** Recorrido del cuello de cisne, de la pinza de la mesa al aro del antipop. */
const GOOSENECK = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.94, 0.26, -0.52),
  new THREE.Vector3(-1.14, 0.92, -0.24),
  new THREE.Vector3(-1.12, 1.66, 0.24),
  new THREE.Vector3(-0.88, 2.14, 0.62),
  new THREE.Vector3(-0.42, 2.20, 0.78),
]);

/** Brazo que sale de la columna y sujeta la araña por detrás. */
const BOOM = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, COLUMN_TOP - 0.06, STAND_Z),
  new THREE.Vector3(0, COLUMN_TOP + 0.28, STAND_Z + 0.10),
  new THREE.Vector3(0, COLUMN_TOP + 0.40, STAND_Z + 0.30),
  new THREE.Vector3(0, HEAD_Y + 0.14, -0.60),
]);

/** Cable XLR: sale del culo del micro, que ahora mira al techo. */
const CABLE = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, HEAD_Y + 0.72, -0.10),
  new THREE.Vector3(0.18, HEAD_Y + 0.30, -0.46),
  new THREE.Vector3(0.12, 1.90, -0.86),
  new THREE.Vector3(-0.08, 0.90, -1.18),
  new THREE.Vector3(-0.52, 0.18, -1.46),
  new THREE.Vector3(-1.16, 0.055, -1.82),
]);

/* ------------------------------------------------------------------ *
 *  Utilidades de geometría
 * ------------------------------------------------------------------ */

const lathe = (profile, segments = 56) => new THREE.LatheGeometry(
  profile.map(([x, y]) => new THREE.Vector2(x, y)), segments,
);

const curveOf = (profile) => new THREE.CatmullRomCurve3(
  profile.map(([x, y]) => new THREE.Vector3(x, y, 0)),
);

/** Aro tumbado en horizontal, que es como van casi todos los de este modelo. */
const ring = (radius, tube, segments = 44) =>
  new THREE.TorusGeometry(radius, tube, 8, segments).rotateX(Math.PI / 2);

/** Fusiona piezas ya transformadas en una sola geometría indexada. */
function fuse(parts) {
  const merged = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  return merged;
}

/** Copias de una geometría giradas alrededor del eje Y. */
function radialCopies(geometry, count) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    parts.push(geometry.clone().rotateY((i / count) * Math.PI * 2));
  }
  geometry.dispose();
  return parts;
}

/* ------------------------------------------------------------------ *
 *  Geometrías compartidas
 * ------------------------------------------------------------------ */

/** Armazón de la rejilla: 26 barras verticales y diez aros, en una pieza. */
const cageGeometry = () => shared('cage', () => {
  const bar = new THREE.TubeGeometry(curveOf(CAGE), 24, 0.0088, 5, false);
  const parts = radialCopies(bar, 26);
  for (const [radius, y] of CAGE_RINGS) {
    parts.push(ring(radius, 0.0082).translate(0, y, 0));
  }
  // Aro grueso de unión con el cuerpo y casquete que tapa el vértice, donde si
  // no se amontonarían las 26 barras.
  parts.push(ring(0.352, 0.028, 48).translate(0, 0.392, 0));
  parts.push(lathe([
    [0.000, 0.000], [0.116, 0.006], [0.118, 0.032], [0.084, 0.056], [0.000, 0.066],
  ], 32).translate(0, 1.030, 0));
  return fuse(parts);
});

/** Gomas de la araña: zigzag continuo entre el aro exterior y la cuna. */
const spiderGeometry = () => shared('spider', () => {
  const POINTS = 14;
  const OUTER = 0.615;
  const INNER = 0.395;
  const at = (i) => {
    const angle = (i / POINTS) * Math.PI * 2;
    const outer = i % 2 === 0;
    const radius = outer ? OUTER : INNER;
    return new THREE.Vector3(Math.cos(angle) * radius, outer ? 0 : -0.155, Math.sin(angle) * radius);
  };

  const parts = [];
  for (let i = 0; i < POINTS; i++) {
    const from = at(i);
    const to = at(i + 1);
    // La goma no va tensa en línea recta: cede hacia fuera y hacia abajo. Es el
    // detalle que la separa de una varilla rígida.
    const mid = from.clone().lerp(to, 0.5).multiplyScalar(1.06);
    mid.y -= 0.04;
    parts.push(new THREE.TubeGeometry(
      new THREE.QuadraticBezierCurve3(from, mid, to), 12, 0.019, 5, false,
    ));
  }
  return fuse(parts);
});

/** Cuello de cisne: tubo con anillas, como un macarrón flexible de verdad. */
const gooseneckGeometry = () => shared('gooseneck', () => {
  const parts = [new THREE.TubeGeometry(GOOSENECK, 52, 0.026, 7, false)];
  const up = new THREE.Vector3(0, 1, 0);
  const quaternion = new THREE.Quaternion();
  for (let i = 1; i < 30; i++) {
    const t = i / 30;
    const rib = ring(0.032, 0.0075, 12);
    quaternion.setFromUnitVectors(up, GOOSENECK.getTangentAt(t));
    rib.applyQuaternion(quaternion);
    const point = GOOSENECK.getPointAt(t);
    parts.push(rib.translate(point.x, point.y, point.z));
  }
  return fuse(parts);
});

/* ------------------------------------------------------------------ *
 *  El micrófono
 * ------------------------------------------------------------------ */

export class PodcastMic {
  constructor() {
    this.group = new THREE.Group();

    // Anodizado satinado: casi metal, con una capa de laca encima. Es el brillo
    // suave que tiene el cuerpo de un micro caro y no un plástico pintado.
    const body = new THREE.MeshPhysicalMaterial({
      color: 0x23272f, metalness: 0.82, roughness: 0.34,
      clearcoat: 0.6, clearcoatRoughness: 0.26, envMapIntensity: 1.3,
    });
    const chrome = new THREE.MeshStandardMaterial({
      color: 0xe4ebf5, metalness: 1, roughness: 0.11, envMapIntensity: 1.3,
    });
    const steel = new THREE.MeshStandardMaterial({
      color: 0x99a2b0, metalness: 1, roughness: 0.31, envMapIntensity: 1.1,
    });
    const cast = new THREE.MeshStandardMaterial({
      color: 0x2a2d33, metalness: 0.72, roughness: 0.52, envMapIntensity: 0.95,
    });
    const rubber = new THREE.MeshStandardMaterial({
      color: 0x121317, metalness: 0.05, roughness: 0.88, envMapIntensity: 0.45,
    });
    const knurled = new THREE.MeshStandardMaterial({
      color: 0xb9c2cf, metalness: 1, roughness: 0.34, envMapIntensity: 1.1,
      bumpMap: shared('knurl', knurlTexture), bumpScale: 0.9,
    });
    const gold = new THREE.MeshStandardMaterial({
      color: 0xa87c38, metalness: 1, roughness: 0.42, envMapIntensity: 0.85,
    });

    this.grilleMaterial = new THREE.MeshStandardMaterial({
      color: 0x9fa8b6, metalness: 1, roughness: 0.26, envMapIntensity: 1.25,
    });
    this.meshMaterial = new THREE.MeshStandardMaterial({
      color: 0x7f8895, metalness: 1, roughness: 0.38, envMapIntensity: 0.95,
      alphaMap: shared('weaveGrille', () => weaveTexture(6, 2)),
      transparent: true, depthWrite: false,
    });
    // La cesta interior es lo que se ve por los huecos de la rejilla, y su
    // emisión es el rescoldo que sube con el nivel de audio.
    this.coreMaterial = new THREE.MeshStandardMaterial({
      color: 0x07080a, metalness: 0.1, roughness: 0.95, envMapIntensity: 0.3,
    });
    this.ledMaterial = new THREE.MeshBasicMaterial({ color: 0xff2e4d, toneMapped: false });

    const add = (geometry, material, x = 0, y = 0, z = 0, parent = this.group) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };

    /* ---------- Pie, columna y brazo ---------- */

    add(lathe(FOOT), cast, 0, 0, STAND_Z);
    add(ring(0.678, 0.036, 48), rubber, 0, 0.030, STAND_Z);
    add(new THREE.CylinderGeometry(0.502, 0.502, 0.026, 48), chrome, 0, 0.198, STAND_Z);
    add(new THREE.CylinderGeometry(0.078, 0.092, COLUMN_TOP - 0.20, 24), chrome,
      0, (COLUMN_TOP + 0.20) / 2, STAND_Z);
    add(new THREE.CylinderGeometry(0.114, 0.114, 0.15, 40), knurled, 0, 1.16, STAND_Z);
    add(new THREE.SphereGeometry(0.108, 20, 14), steel, 0, COLUMN_TOP - 0.06, STAND_Z);

    add(new THREE.TubeGeometry(BOOM, 40, 0.044, 8, false), steel);
    // Pomo de apriete en el codo del brazo.
    add(new THREE.CylinderGeometry(0.068, 0.068, 0.12, 24), knurled,
      0.14, COLUMN_TOP - 0.06, STAND_Z).rotation.z = Math.PI / 2;
    // Horquilla que abraza el aro de la araña.
    add(new THREE.BoxGeometry(0.18, 0.14, 0.13), cast, 0, HEAD_Y + 0.14, -0.60);

    /* ---------- Cabezal colgado ---------- */

    // Todo el cabezal vive en coordenadas normales, con la rejilla hacia +Y, y
    // se le da media vuelta al final. Así el modelado se lee derecho y sólo hay
    // un sitio donde entender la inversión.
    const head = new THREE.Group();
    head.position.set(0, HEAD_Y, 0);
    head.rotation.z = Math.PI;
    head.rotation.x = -0.16; // la cápsula apunta un poco hacia la boca
    this.group.add(head);

    const mount = new THREE.Group();
    mount.position.y = -0.14;
    head.add(mount);

    add(ring(0.615, 0.048, 56), cast, 0, 0, 0, mount);
    add(ring(0.615, 0.014, 56), chrome, 0, 0.036, 0, mount);
    add(spiderGeometry(), rubber, 0, 0, 0, mount);
    // Cuna: el collar de goma que agarra el cuerpo, con sus dos abrazaderas.
    add(new THREE.CylinderGeometry(0.392, 0.392, 0.17, 40), rubber, 0, -0.155, 0, mount);
    add(ring(0.394, 0.018), cast, 0, -0.075, 0, mount);
    add(ring(0.394, 0.018), cast, 0, -0.235, 0, mount);

    add(lathe(BODY), body, 0, 0, 0, head);
    // Aros de trim. El torno deja el sombreado suave en los quiebros, y son
    // estos filos los que devuelven la lectura de pieza mecanizada.
    add(ring(0.340, 0.011, 48), chrome, 0, -0.360, 0, head);
    add(ring(0.350, 0.013, 48), chrome, 0, 0.240, 0, head);
    add(new THREE.CylinderGeometry(0.352, 0.352, 0.055, 48), chrome, 0, 0.348, 0, head);
    // Conector XLR, que colgado boca abajo queda mirando al techo.
    add(new THREE.CylinderGeometry(0.176, 0.196, 0.12, 24), cast, 0, -0.775, 0, head);

    add(lathe(BASKET, 40), this.coreMaterial, 0, 0, 0, head);
    this.grille = add(cageGeometry(), this.grilleMaterial, 0, 0, 0, head);
    add(lathe(CAGE_MESH, 44), this.meshMaterial, 0, 0, 0, head);

    // Cápsula dorada al fondo: no se ve de lejos, y de cerca es lo que
    // convierte la rejilla en un hueco con algo dentro.
    const diaphragm = new THREE.Group();
    diaphragm.position.set(0, 0.70, 0.328);
    head.add(diaphragm);
    add(new THREE.CylinderGeometry(0.142, 0.142, 0.02, 32).rotateX(Math.PI / 2), gold, 0, 0, 0, diaphragm);
    add(new THREE.TorusGeometry(0.146, 0.016, 8, 32), cast, 0, 0, 0.004, diaphragm);

    // Un plano recto sobre un cuerpo cilíndrico se despega por los bordes: la
    // chapa es un sector de cilindro del mismo radio y queda pegada al metal.
    add(
      new THREE.CylinderGeometry(0.343, 0.343, 0.135, 24, 1, true, -0.42, 0.84),
      new THREE.MeshStandardMaterial({
        map: shared('plate', plateTexture), metalness: 0.55, roughness: 0.44,
        envMapIntensity: 0.8, side: THREE.DoubleSide,
      }),
      0, -0.30, 0, head,
    );

    add(new THREE.TorusGeometry(0.036, 0.013, 8, 20), chrome, 0, 0.170, 0.320, head);
    this.led = add(new THREE.SphereGeometry(0.032, 14, 10), this.ledMaterial, 0, 0.170, 0.324, head);
    // Luz propia del piloto: derrama rojo sobre el cuerpo y la cuna de goma.
    this.ledLight = new THREE.PointLight(0xff2440, 0.5, 1.6, 0);
    this.ledLight.position.set(0, 0.170, 0.44);
    head.add(this.ledLight);

    /* ---------- Antipop ---------- */

    add(gooseneckGeometry(), steel);
    add(new THREE.CylinderGeometry(0.10, 0.13, 0.32, 20), cast, -0.94, 0.14, -0.52);

    const filter = new THREE.Group();
    filter.position.set(-0.04, 2.20, 0.80);
    filter.rotation.x = 0.12;
    this.group.add(filter);
    add(new THREE.TorusGeometry(0.545, 0.036, 10, 52), cast, 0, 0, 0, filter);
    add(new THREE.TorusGeometry(0.512, 0.017, 8, 48), chrome, 0, 0, 0.012, filter);

    // Dos mallas separadas y giradas entre sí, como un antipop de doble capa.
    // El muaré que forman cuesta una línea y es lo que lo hace creíble.
    const weave = new THREE.MeshStandardMaterial({
      color: 0x8e97a4, metalness: 0.9, roughness: 0.44, envMapIntensity: 0.6,
      alphaMap: shared('weavePop', () => weaveTexture(3, 3)),
      transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide,
    });
    add(new THREE.CircleGeometry(0.522, 44), weave, 0, 0, 0.026, filter);
    add(new THREE.CircleGeometry(0.522, 44), weave, 0, 0, -0.022, filter).rotation.z = 0.4;

    /* ---------- Cable y sombra de contacto ---------- */

    add(new THREE.TubeGeometry(CABLE, 56, 0.046, 8, false), new THREE.MeshStandardMaterial({
      color: 0x0d0e11, metalness: 0.2, roughness: 0.72,
    }));

    // Sin sombras reales en la escena el pie flotaría sobre la mesa. Una mancha
    // negra enmascarada por debajo cuesta un cuadrado y lo asienta.
    const shadow = add(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({
      color: 0x000000, alphaMap: shared('contact', shadowTexture),
      transparent: true, opacity: 0.62, depthWrite: false, toneMapped: false,
    }), 0, 0.006, STAND_Z + 0.02);
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = -1;

    this._level = 0;
    this._glow = new THREE.Color();
  }

  setColor(color) {
    this._color = color;
  }

  place(position, scale) {
    this.group.position.copy(position);
    this.group.scale.setScalar(scale);
  }

  update(dt, audio, beat) {
    this._level += (Math.min(1, audio.level) - this._level) * Math.min(1, dt * 12);

    if (this._color) {
      // La rejilla es acero y sólo toma un punto del color del programa en los
      // brillos: teñirla entera la convertiría en un bloque de plástico.
      this.grilleMaterial.color.setRGB(0.55, 0.59, 0.65).lerp(this._color, 0.10 + this._level * 0.16);
      this.meshMaterial.color.setRGB(0.36, 0.40, 0.45).lerp(this._color, 0.08 + this._level * 0.14);
      // El rescoldo de dentro sí es de color, y respira con el nivel.
      this.coreMaterial.emissive.copy(this._glow.copy(this._color))
        .multiplyScalar(0.035 + this._level * 0.55);
    }

    this.ledMaterial.color.setRGB(1, 0.16 + beat * 0.45, 0.28 + beat * 0.35);
    this.ledLight.intensity = 0.45 + beat * 0.9;
  }
}
