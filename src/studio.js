import * as THREE from 'three';

/**
 * Estudio de radio: paredes con paneles acústicos, escritorio, luces cálidas,
 * cartel de EN EL AIRE y polvo suspendido en el haz de luz.
 *
 * Todo son materiales con iluminación real (Lambert), no colores planos: es lo
 * que hace que la escena se lea como una habitación y no como un fondo neón.
 */
export class Studio {
  constructor() {
    this.group = new THREE.Group();

    const WALL_Z = -16;
    const WALL_W = 54;
    const WALL_H = 26;
    this.deskY = 0;
    this.wallZ = WALL_Z;

    const wall = new THREE.MeshLambertMaterial({ color: 0x35302a });
    const panelDark = new THREE.MeshLambertMaterial({ color: 0x241f1b });
    const panelWarm = new THREE.MeshLambertMaterial({ color: 0x2c2621 });
    const deskTop = new THREE.MeshLambertMaterial({ color: 0x7a6752 });
    const deskEdge = new THREE.MeshLambertMaterial({ color: 0x16120f });
    const floor = new THREE.MeshLambertMaterial({ color: 0x1b1715 });

    const box = (w, h, d, material, x, y, z, parent = this.group) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };

    // Habitación: pared del fondo, laterales, suelo y techo insinuado.
    box(WALL_W, WALL_H, 1, wall, 0, WALL_H / 2 - 3, WALL_Z - 0.5);
    box(1, WALL_H, 34, wall, -WALL_W / 2, WALL_H / 2 - 3, WALL_Z + 17);
    box(1, WALL_H, 34, wall, WALL_W / 2, WALL_H / 2 - 3, WALL_Z + 17);
    box(WALL_W, 1, 40, floor, 0, -3.2, WALL_Z + 20);

    // Listones verticales de madera: el revestimiento acústico de un estudio
    // moderno. Anchos y profundidades irregulares para que no parezca un patrón.
    const slats = new THREE.Group();
    const woods = [panelWarm, panelDark, new THREE.MeshLambertMaterial({ color: 0x4a3a2b })];
    let x = -WALL_W / 2 + 1.2;
    let n = 0;
    while (x < WALL_W / 2 - 1.2) {
      const width = 0.5 + ((n * 37) % 5) * 0.16;
      const depth = 0.3 + ((n * 53) % 4) * 0.16;
      box(width, 22, depth, woods[n % woods.length], x + width / 2, 8, WALL_Z + 0.3 + depth / 2, slats);
      x += width + 0.34;
      n++;
    }
    this.group.add(slats);

    // Escritorio.
    const desk = new THREE.Group();
    box(30, 0.7, 11, deskTop, 0, 1.2, 2, desk);
    box(30.4, 0.2, 11.3, deskEdge, 0, 1.62, 2, desk);
    box(28, 4.4, 0.7, deskEdge, 0, -1.1, 7.3, desk);
    this.group.add(desk);

    // Cartel de AL AIRE. Las letras son una textura de canvas: no hace falta
    // cargar tipografías 3D y el texto sale nítido a cualquier distancia.
    const sign = new THREE.Group();
    const housing = new THREE.MeshLambertMaterial({ color: 0x0e0c0b });
    box(8.6, 2.6, 0.6, housing, 0, 0, 0, sign);
    box(8.9, 0.16, 0.7, new THREE.MeshLambertMaterial({ color: 0x2a2622 }), 0, 1.36, 0.05, sign);
    box(8.9, 0.16, 0.7, new THREE.MeshLambertMaterial({ color: 0x2a2622 }), 0, -1.36, 0.05, sign);

    this.signTexture = this._makeSignTexture('AL AIRE');
    this.signMaterial = new THREE.MeshBasicMaterial({
      map: this.signTexture, transparent: true, toneMapped: false,
    });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(7.8, 1.95), this.signMaterial);
    face.position.z = 0.32;
    sign.add(face);

    // Luz propia del cartel: al encenderse tiñe los listones de rojo.
    this.signLight = new THREE.PointLight(0xff2a1e, 0, 22, 0);
    this.signLight.position.set(0, 0, 2.4);
    sign.add(this.signLight);

    sign.rotation.y = 0.05;
    this.sign = sign;
    this.signZ = WALL_Z + 1.4;
    this.placeSign(-5, 14.4);
    this.group.add(sign);

    // Marco del monitor del locutor. Se dimensiona luego, cuando se sabe la
    // proporción de la foto: la foto trae su propio fondo, y enmarcarla es lo
    // que hace que se lea como la pantalla del estudio y no como un recorte.
    const bezel = new THREE.MeshLambertMaterial({ color: 0x141110 });
    const backing = new THREE.MeshLambertMaterial({ color: 0x090909 });
    const makeFrame = () => {
      const frame = new THREE.Group();
      const back = box(1, 1, 0.4, backing, 0, 0, -0.3, frame);
      const bars = [
        box(1, 1, 0.55, bezel, 0, 0, 0, frame),
        box(1, 1, 0.55, bezel, 0, 0, 0, frame),
        box(1, 1, 0.55, bezel, 0, 0, 0, frame),
        box(1, 1, 0.55, bezel, 0, 0, 0, frame),
      ];
      frame.visible = false;
      this.group.add(frame);
      return { group: frame, back, bars };
    };

    this.panel = makeFrame();    // monitor del locutor
    this.panelB = makeFrame();   // monitor del invitado
    this.display = makeFrame();  // monitor del visualizador

    this._buildLights();
    this._buildDust();
  }

  /** El cartel se recoloca según haya uno o dos locutores. */
  placeSign(x, y) {
    this.sign.position.set(x, y, this.signZ);
  }

  /**
   * Dibuja el rótulo en un canvas: letras blancas sobre negro. El material lo
   * tiñe después, así el mismo mapa sirve para el cartel apagado y encendido.
   */
  _makeSignTexture(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const draw = () => {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 152px "Space Grotesk", "Segoe UI", system-ui, sans-serif';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '26px';
      ctx.fillText(text, canvas.width / 2 + 13, canvas.height / 2 + 6);
      if (this.signTexture) this.signTexture.needsUpdate = true;
    };

    draw();
    // La tipografía puede no estar lista todavía: se repinta cuando cargue.
    document.fonts?.ready.then(draw).catch(() => { /* se queda la de sistema */ });

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }

  _buildLights() {
    this.group.add(new THREE.AmbientLight(0xffd9b0, 0.85));
    this.group.add(new THREE.HemisphereLight(0xffd0a0, 0x140f0c, 0.7));

    // decay 0: la intensidad no cae con la distancia. Con el modelo físico que
    // three usa por defecto haría falta subir a miles y la sala saldría a
    // parches quemados; así se ilumina pareja, como un plató.
    this.key = new THREE.SpotLight(0xffc98a, 3.2, 90, 0.95, 0.6, 0);
    this.key.position.set(-8, 21, 14);
    this.key.target.position.set(-1, 6, -6);
    this.group.add(this.key, this.key.target);

    // Contraluz frío para despegar al personaje de la pared.
    const rim = new THREE.DirectionalLight(0x9ab8ff, 0.85);
    rim.position.set(11, 9, -6);
    this.group.add(rim);

    const front = new THREE.DirectionalLight(0xffd2a6, 0.75);
    front.position.set(0, 6, 20);
    this.group.add(front);

    const fill = new THREE.PointLight(0xffb877, 1.4, 40, 0);
    fill.position.set(1, 6, 10);
    this.group.add(fill);

    // Foco corto sobre la mesa: es lo que hace visible el micrófono.
    const deskLight = new THREE.SpotLight(0xfff0d6, 3.4, 30, 0.85, 0.6, 0);
    deskLight.position.set(1, 12, 10);
    deskLight.target.position.set(-2, 1.6, 1.5);
    this.group.add(deskLight, deskLight.target);

    // Segundo foco corto para el lado de la radio.
    const propLight = new THREE.SpotLight(0xffe0b0, 2.2, 26, 0.8, 0.7, 0);
    propLight.position.set(7, 11, 11);
    propLight.target.position.set(6, 1.8, 3.2);
    this.group.add(propLight, propLight.target);
  }

  /** Partículas de polvo: el único movimiento ambiental, muy lento. */
  _buildDust() {
    const COUNT = 200;
    const positions = new Float32Array(COUNT * 3);
    this._dustSeed = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 26;
      positions[i * 3 + 1] = Math.random() * 20 - 2;
      positions[i * 3 + 2] = -12 + Math.random() * 24;
      this._dustSeed[i] = 0.25 + Math.random() * 0.7;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dust = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0xffd9ac, size: 0.06, transparent: true, opacity: 0.35,
      depthWrite: false, sizeAttenuation: true,
    }));
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }

  /** Dimensiona uno de los marcos (`panel` o `display`) y lo coloca. */
  fitFrame(frame, width, height, position, backOffset = 0.45) {
    const t = 0.42; // grosor del bisel
    const [top, bottom, left, right] = frame.bars;

    frame.back.scale.set(width + t, height + t, 1);
    top.scale.set(width + t * 2.4, t, 1);
    top.position.set(0, height / 2 + t / 2, 0);
    bottom.scale.set(width + t * 2.4, t, 1);
    bottom.position.set(0, -height / 2 - t / 2, 0);
    left.scale.set(t, height + t * 2.4, 1);
    left.position.set(-width / 2 - t / 2, 0, 0);
    right.scale.set(t, height + t * 2.4, 1);
    right.position.set(width / 2 + t / 2, 0, 0);

    frame.group.position.copy(position);
    frame.group.position.z -= backOffset;
    frame.group.visible = true;
  }

  /** `live` enciende el cartel; `level` sólo mueve el brillo, sin parpadeos. */
  update(dt, live, level) {
    const position = this.dust.geometry.attributes.position;
    const array = position.array;
    for (let i = 0; i < this._dustSeed.length; i++) {
      const idx = i * 3;
      array[idx + 1] += dt * 0.14 * this._dustSeed[i];
      array[idx] += dt * 0.05 * (this._dustSeed[i] - 0.5);
      if (array[idx + 1] > 18) array[idx + 1] = -2;
    }
    position.needsUpdate = true;

    // El cartel se enciende y apaga con una rampa corta, como un tubo real.
    const target = live ? 1 : 0;
    this._sign = (this._sign ?? 0) + (target - (this._sign ?? 0)) * Math.min(1, dt * 3.5);
    const glow = 0.1 + this._sign * (1.5 + Math.min(1, level) * 0.5);
    this.signMaterial.color.setRGB(glow, glow * 0.1, glow * 0.07);
    this.signLight.intensity = this._sign * 1.6;
  }
}
