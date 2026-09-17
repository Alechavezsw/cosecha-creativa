import * as THREE from 'three';

/**
 * Radio de válvulas sobre el escritorio: mueble de madera barnizada con arco,
 * tela de rejilla, dial iluminado con su cristal, ojo mágico y dos mandos.
 *
 * El mueble no es una caja con un medio cilindro encima sino una silueta
 * extruida con bisel: los cantos redondeados son la mitad de por qué una radio
 * de los años cuarenta se ve cara, y salen gratis con ExtrudeGeometry.
 *
 * La madera, la tela y el dial son texturas de canvas. Dibujar la veta, el
 * trenzado y los números cuesta unas líneas y evita modelar cientos de piezas
 * diminutas que además brillarían mal a esta escala. El mismo mapa de veta se
 * usa como rugosidad, así el barniz no brilla parejo y la madera respira.
 *
 * Se mueven dos cosas, y las dos son vúmetros: la aguja, con ataque rápido y
 * caída lenta como una de verdad, y el ojo mágico, que es el indicador verde
 * que abría y cerraba con la señal en las radios de válvulas.
 *
 * Los materiales son PBR y necesitan `scene.environment` (ver environment.js).
 */

const W = 3.4;          // ancho del mueble
const D = 1.75;         // fondo
const SHOULDER = 1.78;  // altura a la que arranca el arco
const FRONT = D / 2;
// Cara exterior del frente de chapa: todo lo que va montado encima parte de
// aquí, o se queda enterrado dentro de la madera.
const FACE = D / 2 + 0.11;
const TOP = SHOULDER + W / 2;

/** Veta de madera: rayas horizontales onduladas, densas y de grosor variable. */
function woodTexture(base, grain) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 256);

  // Poco contraste a propósito. La veta va también de mapa de rugosidad, y con
  // rayas marcadas el barniz alterna mate y brillo hasta parecer cartón ondulado.
  for (let i = 0; i < 150; i++) {
    const y = Math.random() * 264 - 4;
    const amplitude = 2 + Math.random() * 8;
    const frequency = 1 + Math.random() * 2;
    const phase = Math.random() * Math.PI * 2;
    ctx.strokeStyle = grain;
    ctx.globalAlpha = 0.03 + Math.random() * 0.11;
    ctx.lineWidth = 0.4 + Math.random() * 1.7;
    ctx.beginPath();
    for (let x = 0; x <= 512; x += 8) {
      const wave = Math.sin((x / 512) * Math.PI * 2 * frequency + phase) * amplitude;
      if (x === 0) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Rectángulo con las esquinas redondeadas, para extruir con bisel. */
function roundedShape(width, height, radius) {
  const shape = new THREE.Shape();
  const x = width / 2;
  const y = height / 2;
  shape.moveTo(-x + radius, -y);
  shape.lineTo(x - radius, -y);
  shape.quadraticCurveTo(x, -y, x, -y + radius);
  shape.lineTo(x, y - radius);
  shape.quadraticCurveTo(x, y, x - radius, y);
  shape.lineTo(-x + radius, y);
  shape.quadraticCurveTo(-x, y, -x, y - radius);
  shape.lineTo(-x, -y + radius);
  shape.quadraticCurveTo(-x, -y, -x + radius, -y);
  return shape;
}

/** Extrusión centrada en Z y con los cantos matados. */
function slab(shape, depth, bevel = 0.03) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 20,
  });
  geometry.translate(0, 0, -depth / 2 + bevel);
  return geometry;
}

const roundedSlab = (width, height, depth, radius, bevel) =>
  slab(roundedShape(width, height, radius), depth, bevel);

/** Silueta del mueble: laterales rectos y un arco de medio punto arriba. */
function cabinetShape(inset = 0) {
  const half = W / 2 - inset;
  const shape = new THREE.Shape();
  shape.moveTo(-half, inset);
  shape.lineTo(-half, SHOULDER);
  // En sentido horario: de PI a 0 pasando por arriba. Al revés three toma el
  // camino largo y traza el medio punto por debajo, cruzando la silueta.
  shape.absarc(0, SHOULDER, half, Math.PI, 0, true);
  shape.lineTo(half, inset);
  shape.closePath();
  return shape;
}

export class VintageRadio {
  constructor() {
    this.group = new THREE.Group();

    const grain = woodTexture('#452310', '#180a03');
    const grainPale = woodTexture('#5f3517', '#251005');

    // Nogal barnizado: la laca es lo que separa un mueble de época de un
    // bloque de color. El mismo mapa de veta hace de rugosidad, así el brillo
    // se rompe siguiendo la madera en vez de quedar como un plástico.
    const wood = new THREE.MeshPhysicalMaterial({
      map: grain, roughnessMap: grain, roughness: 0.62, metalness: 0,
      clearcoat: 0.85, clearcoatRoughness: 0.14, envMapIntensity: 0.85,
    });
    const woodPale = new THREE.MeshPhysicalMaterial({
      map: grainPale, roughnessMap: grainPale, roughness: 0.55, metalness: 0,
      clearcoat: 0.9, clearcoatRoughness: 0.12, envMapIntensity: 0.9,
    });
    const brass = new THREE.MeshStandardMaterial({
      color: 0xc9a253, metalness: 1, roughness: 0.26, envMapIntensity: 1.15,
    });
    const bakelite = new THREE.MeshPhysicalMaterial({
      color: 0x1a120d, metalness: 0.1, roughness: 0.35,
      clearcoat: 0.9, clearcoatRoughness: 0.16, envMapIntensity: 0.8,
    });
    const cavity = new THREE.MeshStandardMaterial({
      color: 0x0a0705, metalness: 0, roughness: 1, envMapIntensity: 0.1,
    });

    const add = (geometry, material, x, y, z, parent = this.group) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };

    /* ---------- Mueble ---------- */

    add(slab(cabinetShape(), D, 0.05), wood, 0, 0, 0);

    // Zócalo y patas.
    add(roundedSlab(W + 0.16, 0.3, D + 0.14, 0.06, 0.035), wood, 0, 0.02, 0);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        add(new THREE.CylinderGeometry(0.1, 0.075, 0.16, 14), bakelite,
          sx * (W / 2 - 0.3), -0.09, sz * (D / 2 - 0.28));
      }
    }

    /* ---------- Rejilla ---------- */

    const CLOTH_W = 2.34;
    const CLOTH_H = 1.34;
    const CLOTH_Y = 2.44;

    // Frente en una chapa más clara: el contraste de dos maderas es lo que da
    // el aire de ebanistería y no de caja pintada.
    add(slab(cabinetShape(0.16), 0.14, 0.04), woodPale, 0, 0, FRONT + 0.04);

    // La tela va apoyada en esa chapa. Lo que la hunde no es un hueco sino la
    // moldura que la rodea: cuatro listones en relieve, como el marco del
    // altavoz de una radio de verdad.
    const cloth = new THREE.MeshStandardMaterial({
      map: this._makeClothTexture(), roughness: 0.95, metalness: 0,
      envMapIntensity: 0.2,
    });
    add(new THREE.PlaneGeometry(CLOTH_W, CLOTH_H), cloth, 0, CLOTH_Y, FACE + 0.004);

    const JAMB = 0.17;
    const frame = (width, height, x, y) =>
      add(roundedSlab(width, height, 0.15, 0.05, 0.03), woodPale, x, y, FACE + 0.045);
    frame(CLOTH_W + JAMB * 2, JAMB, 0, CLOTH_Y + CLOTH_H / 2 + JAMB / 2);
    frame(CLOTH_W + JAMB * 2, JAMB, 0, CLOTH_Y - CLOTH_H / 2 - JAMB / 2);
    frame(JAMB, CLOTH_H, -CLOTH_W / 2 - JAMB / 2, CLOTH_Y);
    frame(JAMB, CLOTH_H, CLOTH_W / 2 + JAMB / 2, CLOTH_Y);

    // Travesaños: dos listones con el canto matado, como los de los años 40.
    for (const y of [CLOTH_Y - 0.36, CLOTH_Y + 0.36]) {
      add(roundedSlab(CLOTH_W + 0.1, 0.13, 0.13, 0.045, 0.028), woodPale, 0, y, FACE + 0.035);
    }

    /* ---------- Ojo mágico ---------- */

    // El indicador verde que abría y cerraba con la señal. Es el vúmetro más
    // bonito que se ha hecho nunca y encaja con lo que hace esta pantalla.
    const eye = new THREE.Group();
    eye.position.set(0, 1.5, FACE + 0.02);
    this.group.add(eye);
    add(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 24).rotateX(Math.PI / 2), cavity, 0, 0, 0, eye);
    add(new THREE.TorusGeometry(0.2, 0.035, 10, 28), brass, 0, 0, 0.02, eye);
    this.eyeMaterial = new THREE.MeshBasicMaterial({
      map: this._makeEyeTexture(), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.eye = add(new THREE.PlaneGeometry(0.36, 0.36), this.eyeMaterial, 0, 0, 0.045, eye);
    this.eyeLight = new THREE.PointLight(0x54ff9a, 0, 2.2, 0);
    this.eyeLight.position.set(0, 0, 0.35);
    eye.add(this.eyeLight);

    /* ---------- Dial ---------- */

    const dial = new THREE.Group();
    dial.position.set(0, 0.86, FACE + 0.01);
    this.group.add(dial);

    add(roundedSlab(2.36, 0.78, 0.14, 0.08, 0.03), brass, 0, 0, 0, dial);
    add(new THREE.BoxGeometry(2.06, 0.52, 0.06), cavity, 0, 0, 0.05, dial);
    this.dialMaterial = new THREE.MeshBasicMaterial({
      map: this._makeDialTexture(), toneMapped: false,
    });
    add(new THREE.PlaneGeometry(2.0, 0.48), this.dialMaterial, 0, 0, 0.085, dial);

    this.needle = add(new THREE.BoxGeometry(0.028, 0.46, 0.02),
      new THREE.MeshBasicMaterial({ color: 0xff4a28, toneMapped: false }), 0, 0, 0.1, dial);

    // Cristal: un reflejo diagonal en aditivo. Es lo que convierte el dial en
    // una ventana y no en una pegatina, y cuesta un plano.
    add(new THREE.PlaneGeometry(2.0, 0.48), new THREE.MeshBasicMaterial({
      map: this._makeGlassTexture(), transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }), 0, 0, 0.115, dial);

    this.dialLight = new THREE.PointLight(0xffa64d, 0, 7, 0);
    this.dialLight.position.set(0, 0.86, FACE + 0.6);
    this.group.add(this.dialLight);

    /* ---------- Mandos ---------- */

    const knurl = this._makeKnurlTexture();
    const knobMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x18110c, metalness: 0.1, roughness: 0.34,
      clearcoat: 0.9, clearcoatRoughness: 0.15, envMapIntensity: 0.8,
      bumpMap: knurl, bumpScale: 0.7,
    });

    for (const x of [-1.44, 1.44]) {
      const knob = new THREE.Group();
      knob.position.set(x, 0.86, FACE - 0.01);
      this.group.add(knob);
      add(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 28).rotateX(Math.PI / 2), brass, 0, 0, 0, knob);
      add(new THREE.CylinderGeometry(0.24, 0.27, 0.22, 32).rotateX(Math.PI / 2), knobMaterial, 0, 0, 0.12, knob);
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 20).rotateX(Math.PI / 2), brass, 0, 0, 0.24, knob);
      // Índice del mando, apuntando a las diez.
      add(new THREE.BoxGeometry(0.032, 0.17, 0.03), brass, 0, 0.09, 0.24, knob).rotation.z = -0.5;
    }

    /* ---------- Chapa y sombra de contacto ---------- */

    add(new THREE.PlaneGeometry(0.86, 0.2), new THREE.MeshStandardMaterial({
      map: this._makeBadgeTexture(), metalness: 0.9, roughness: 0.3,
      envMapIntensity: 1, transparent: true,
    }), 0, 0.34, FACE + 0.015);

    const shadow = add(new THREE.PlaneGeometry(6, 4), new THREE.MeshBasicMaterial({
      color: 0x000000, alphaMap: this._makeShadowTexture(),
      transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false,
    }), 0, -0.16, 0.1);
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = -1;

    this._needle = 0;
    this._eye = 0;
  }

  /** Trenzado de la tela: dos rejillas cruzadas con ruido, en tonos tostados. */
  _makeClothTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#6b4a24';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(40, 26, 12, 0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 128; i += 5) {
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i, 128);
      ctx.moveTo(0, i); ctx.lineTo(128, i);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255, 220, 160, 0.10)';
    for (let i = 0; i < 700; i++) {
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 1.6, 1.6);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(5, 3);
    return texture;
  }

  /** Escala del dial: marcas y frecuencias, como las de una radio de válvulas. */
  _makeDialTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const draw = () => {
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, 0, 256);
      gradient.addColorStop(0, '#fbe9bd');
      gradient.addColorStop(0.55, '#eccb86');
      gradient.addColorStop(1, '#cf9f52');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1024, 256);

      ctx.strokeStyle = '#4a2c11';
      ctx.fillStyle = '#4a2c11';
      ctx.textAlign = 'center';

      const span = 1024 - 160;
      const marks = ['55', '65', '75', '90', '110', '130', '160'];
      ctx.font = '600 40px "Space Grotesk", system-ui, sans-serif';
      marks.forEach((label, i) => {
        const x = 80 + i * (span / (marks.length - 1));
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x, 150); ctx.lineTo(x, 196);
        ctx.stroke();
        ctx.fillText(label, x, 124);
      });
      ctx.lineWidth = 2;
      for (let i = 0; i < 79; i++) {
        const x = 80 + i * (span / 78);
        ctx.beginPath();
        ctx.moveTo(x, 172); ctx.lineTo(x, 196);
        ctx.stroke();
      }

      // Las emisoras rotuladas son lo que hace que un dial parezca de verdad.
      ctx.fillStyle = '#7a4a1c';
      ctx.font = '500 26px "Space Grotesk", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('ONDA MEDIA', 70, 60);
      ctx.textAlign = 'right';
      ctx.fillText('kHz', 954, 60);
      ctx.textAlign = 'center';
      ctx.font = '500 24px "Space Grotesk", system-ui, sans-serif';
      ctx.fillText('COSECHA', 512, 60);
      if (this.dialTexture) this.dialTexture.needsUpdate = true;
    };

    draw();
    document.fonts?.ready.then(draw).catch(() => { /* se queda la de sistema */ });

    this.dialTexture = new THREE.CanvasTexture(canvas);
    this.dialTexture.colorSpace = THREE.SRGBColorSpace;
    this.dialTexture.anisotropy = 8;
    return this.dialTexture;
  }

  /** Reflejo del cristal del dial: dos franjas diagonales muy suaves. */
  _makeGlassTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 256, 64);
    const gradient = ctx.createLinearGradient(0, 64, 180, 0);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.42, 'rgba(255,255,255,0.30)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.06)');
    gradient.addColorStop(0.58, 'rgba(255,255,255,0.22)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 64);
    return new THREE.CanvasTexture(canvas);
  }

  /** Halo verde del ojo mágico, con su cuña oscura de fósforo. */
  _makeEyeTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
    gradient.addColorStop(0, 'rgba(190, 255, 214, 0.95)');
    gradient.addColorStop(0.45, 'rgba(70, 240, 140, 0.75)');
    gradient.addColorStop(0.82, 'rgba(24, 150, 80, 0.28)');
    gradient.addColorStop(1, 'rgba(0, 40, 20, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(64, 64, 62, 0, Math.PI * 2);
    ctx.fill();
    // Cuña oscura: el hueco que dejaba el haz cuando la señal era débil.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(64, 64);
    ctx.arc(64, 64, 64, -Math.PI / 2 - 0.34, -Math.PI / 2 + 0.34);
    ctx.closePath();
    ctx.fill();
    return new THREE.CanvasTexture(canvas);
  }

  /** Moleteado del canto de los mandos. */
  _makeKnurlTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 128, 16);
    ctx.lineWidth = 2;
    for (let i = 0; i < 128; i += 4) {
      ctx.strokeStyle = i % 8 === 0 ? '#ffffff' : '#1a1a1a';
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i, 16);
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(6, 1);
    return texture;
  }

  /** Chapita de latón del fabricante, bajo el dial. */
  _makeBadgeTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const draw = () => {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 512, 128);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 58px "Space Grotesk", system-ui, sans-serif';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '14px';
      ctx.fillStyle = '#3a2a12';
      ctx.fillText('COSECHA', 258, 68);
      ctx.fillStyle = '#e2c184';
      ctx.fillText('COSECHA', 256, 64);
      if (this.badgeTexture) this.badgeTexture.needsUpdate = true;
    };

    draw();
    document.fonts?.ready.then(draw).catch(() => { /* se queda la de sistema */ });

    this.badgeTexture = new THREE.CanvasTexture(canvas);
    this.badgeTexture.colorSpace = THREE.SRGBColorSpace;
    this.badgeTexture.anisotropy = 8;
    return this.badgeTexture;
  }

  /** Sombra de contacto pintada, igual que la del micrófono. */
  _makeShadowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.3, '#9a9a9a');
    gradient.addColorStop(0.62, '#2a2a2a');
    gradient.addColorStop(1, '#000000');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
  }

  place(position, rotationY, scale) {
    this.group.position.copy(position);
    this.group.rotation.y = rotationY;
    this.group.scale.setScalar(scale);
  }

  update(dt, audio, live) {
    // Ataque rápido y caída lenta: el gesto de una aguja de vúmetro.
    const target = Math.min(1, audio.level * 1.3);
    this._needle += (target - this._needle) * (target > this._needle ? 0.35 : 0.05);
    this.needle.position.x = (this._needle - 0.5) * 1.62;

    const glow = live ? 0.85 + this._needle * 0.35 : 0.22;
    this.dialMaterial.color.setScalar(glow);
    this.dialLight.intensity = live ? 0.45 + this._needle * 0.35 : 0.06;

    // El ojo mágico cierra su cuña con la señal: se abre el haz y crece.
    const eyeTarget = live ? 0.42 + this._needle * 0.58 : 0.16;
    this._eye += (eyeTarget - this._eye) * Math.min(1, dt * 9);
    this.eye.scale.setScalar(0.45 + this._eye * 0.55);
    this.eyeMaterial.opacity = 0.25 + this._eye * 0.75;
    this.eyeLight.intensity = this._eye * 0.7;
  }
}
