import * as THREE from 'three';

/**
 * Radio de válvulas sobre el escritorio: mueble de madera con arco, tela de
 * rejilla, dial iluminado con su escala de frecuencias y dos mandos.
 *
 * La tela y el dial son texturas de canvas. Dibujar el trenzado y los números
 * cuesta veinte líneas y evita tener que modelar cientos de piezas diminutas
 * que, además, brillarían mal a esta escala.
 *
 * La aguja es lo único que se mueve, y lo hace como un vúmetro real: ataque
 * rápido y caída lenta.
 */
export class VintageRadio {
  constructor() {
    this.group = new THREE.Group();

    const wood = new THREE.MeshLambertMaterial({ color: 0x6b3c1c });
    const woodDark = new THREE.MeshLambertMaterial({ color: 0x3d2110 });
    const woodTop = new THREE.MeshLambertMaterial({ color: 0x7d4a24 });
    const brass = new THREE.MeshLambertMaterial({ color: 0xb08c4a });
    const knobMat = new THREE.MeshLambertMaterial({ color: 0x241610 });

    const W = 3.4;
    const H = 2.0;
    const D = 1.7;
    const FRONT = D / 2;

    const add = (geometry, material, x, y, z, parent = this.group) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };

    // Mueble: caja y arco de medio cilindro.
    add(new THREE.BoxGeometry(W, H, D), wood, 0, H / 2, 0);
    const arch = add(new THREE.CylinderGeometry(W / 2, W / 2, D, 32, 1, false, 0, Math.PI), woodTop, 0, H, 0);
    arch.rotation.x = Math.PI / 2;
    arch.rotation.y = Math.PI / 2;

    // Frente hundido.
    add(new THREE.BoxGeometry(W - 0.34, H + 0.9, 0.1), woodDark, 0, H / 2 + 0.42, FRONT + 0.01);

    // Tela de rejilla con tres travesaños de madera, como los de los años 40.
    const cloth = new THREE.MeshLambertMaterial({ map: this._makeClothTexture() });
    add(new THREE.PlaneGeometry(W - 0.72, 1.6), cloth, 0, H / 2 + 0.62, FRONT + 0.07);
    for (let i = 0; i < 3; i++) {
      add(new THREE.BoxGeometry(W - 0.66, 0.1, 0.07), woodTop, 0, H / 2 + 0.16 + i * 0.46, FRONT + 0.1);
    }

    // Dial: escala impresa, cristal encendido y aguja.
    const dial = new THREE.Group();
    dial.position.set(0, 0.5, FRONT + 0.07);
    this.group.add(dial);
    add(new THREE.BoxGeometry(2.05, 0.58, 0.06), brass, 0, 0, -0.03, dial);
    this.dialMaterial = new THREE.MeshBasicMaterial({ map: this._makeDialTexture(), toneMapped: false });
    add(new THREE.PlaneGeometry(1.9, 0.46), this.dialMaterial, 0, 0, 0.02, dial);

    this.needle = add(new THREE.BoxGeometry(0.03, 0.42, 0.02),
      new THREE.MeshBasicMaterial({ color: 0xff4a28, toneMapped: false }), 0, 0, 0.05, dial);

    // Mandos con su embellecedor.
    const makeKnob = (x) => {
      add(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 20), brass, x, 0.5, FRONT + 0.06).rotation.x = Math.PI / 2;
      const k = add(new THREE.CylinderGeometry(0.19, 0.22, 0.2, 20), knobMat, x, 0.5, FRONT + 0.14);
      k.rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.03, 0.16, 0.04), brass, x, 0.5, FRONT + 0.25);
      return k;
    };
    makeKnob(-1.32);
    makeKnob(1.32);

    // Zócalo y patas.
    add(new THREE.BoxGeometry(W + 0.14, 0.16, D + 0.12), woodDark, 0, 0.08, 0);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        add(new THREE.CylinderGeometry(0.09, 0.07, 0.14, 10), knobMat, sx * (W / 2 - 0.28), -0.05, sz * (D / 2 - 0.25));
      }
    }

    this.dialLight = new THREE.PointLight(0xffa64d, 0, 7, 0);
    this.dialLight.position.set(0, 0.6, FRONT + 0.7);
    this.group.add(this.dialLight);

    this._needle = 0;
  }

  /** Trenzado de la tela: dos rejillas cruzadas con ruido, en tonos tostados. */
  _makeClothTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#7d5f34';
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
    canvas.width = 768;
    canvas.height = 192;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, 192);
    gradient.addColorStop(0, '#f6dfa8');
    gradient.addColorStop(1, '#d8ad63');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 768, 192);

    ctx.strokeStyle = '#4a2c11';
    ctx.fillStyle = '#4a2c11';
    ctx.font = '600 34px "Space Grotesk", system-ui, sans-serif';
    ctx.textAlign = 'center';

    const marks = ['55', '65', '75', '90', '110', '130', '160'];
    marks.forEach((label, i) => {
      const x = 60 + i * ((768 - 120) / (marks.length - 1));
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, 118); ctx.lineTo(x, 150);
      ctx.stroke();
      ctx.fillText(label, x, 104);
    });
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 60; i++) {
      const x = 60 + i * ((768 - 120) / 59);
      ctx.beginPath();
      ctx.moveTo(x, 134); ctx.lineTo(x, 150);
      ctx.stroke();
    }
    ctx.fillStyle = '#6b4118';
    ctx.font = '600 22px "Space Grotesk", system-ui, sans-serif';
    ctx.fillText('kHz', 700, 104);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
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
    this.needle.position.x = (this._needle - 0.5) * 1.55;

    const glow = live ? 0.85 + this._needle * 0.35 : 0.22;
    this.dialMaterial.color.setScalar(glow);
    this.dialLight.intensity = live ? 0.45 + this._needle * 0.35 : 0.06;
  }
}
