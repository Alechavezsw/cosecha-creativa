import * as THREE from 'three';

/**
 * Micrófono de locución con pie de mesa, araña antivibración y antipop.
 *
 * Está hecho con cilindros y toros en vez de cajas: el resto del plató puede ser
 * recto, pero un micro cúbico se lee como una caja y no como un micrófono.
 * Queda inmóvil a propósito; lo único que cambia es el brillo de la rejilla y el
 * piloto rojo. Uno que se balancea delata que es un adorno.
 */
export class PodcastMic {
  constructor() {
    this.group = new THREE.Group();

    const dark = new THREE.MeshLambertMaterial({ color: 0x24272e });
    const metal = new THREE.MeshLambertMaterial({ color: 0x5b6270 });
    const chrome = new THREE.MeshLambertMaterial({ color: 0x9aa3b2 });
    this.grilleMaterial = new THREE.MeshLambertMaterial({ color: 0x3a4049 });
    this.ledMaterial = new THREE.MeshBasicMaterial({ color: 0xff2e4d, toneMapped: false });

    const add = (geometry, material, x, y, z, parent = this.group) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };

    // Pie: base pesada y columna.
    add(new THREE.CylinderGeometry(0.62, 0.72, 0.14, 28), dark, 0, 0.07, 0);
    add(new THREE.CylinderGeometry(0.5, 0.56, 0.06, 28), chrome, 0, 0.16, 0);
    add(new THREE.CylinderGeometry(0.075, 0.075, 1.15, 16), metal, 0, 0.75, 0);
    add(new THREE.SphereGeometry(0.13, 16, 12), chrome, 0, 1.33, 0);

    // Araña antivibración: aro y tirantes hasta el cuerpo.
    const mount = new THREE.Group();
    mount.position.set(0, 2.1, 0);
    this.group.add(mount);
    add(new THREE.TorusGeometry(0.52, 0.045, 10, 32), dark, 0, 0, 0, mount);
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const strap = add(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 6), chrome,
        Math.cos(angle) * 0.36, 0, Math.sin(angle) * 0.36, mount);
      strap.rotation.z = Math.cos(angle) * 0.5;
      strap.rotation.x = -Math.sin(angle) * 0.5;
    }
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 10), metal, 0, -0.4, 0, mount).rotation.z = 0;

    // Cuerpo y rejilla.
    const capsule = new THREE.Group();
    capsule.position.set(0, 2.1, 0);
    this.group.add(capsule);
    add(new THREE.CylinderGeometry(0.3, 0.33, 1.05, 24), dark, 0, -0.15, 0, capsule);
    add(new THREE.CylinderGeometry(0.32, 0.32, 0.07, 24), chrome, 0, 0.4, 0, capsule);
    this.grille = add(new THREE.CylinderGeometry(0.34, 0.34, 0.62, 24), this.grilleMaterial, 0, 0.75, 0, capsule);
    add(new THREE.SphereGeometry(0.34, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.grilleMaterial, 0, 1.06, 0, capsule);

    // Aros finos sobre la rejilla: es lo que la hace leerse como malla metálica
    // y no como un cilindro liso.
    for (let i = 0; i < 5; i++) {
      add(new THREE.TorusGeometry(0.345, 0.012, 6, 28), chrome, 0, 0.5 + i * 0.13, 0, capsule)
        .rotation.x = Math.PI / 2;
    }
    add(new THREE.TorusGeometry(0.33, 0.02, 8, 28), chrome, 0, 1.03, 0, capsule).rotation.x = Math.PI / 2;

    // Placa con la marca y el piloto.
    add(new THREE.BoxGeometry(0.22, 0.1, 0.02), chrome, 0, -0.2, 0.33, capsule);
    this.led = add(new THREE.SphereGeometry(0.055, 10, 8), this.ledMaterial, 0.16, -0.42, 0.28, capsule);

    // Antipop: aro, malla translúcida y varilla de sujeción.
    const filter = new THREE.Group();
    filter.position.set(0, 2.85, 0.78);
    this.group.add(filter);
    add(new THREE.TorusGeometry(0.52, 0.035, 10, 36), dark, 0, 0, 0, filter);
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.52, 32),
      new THREE.MeshBasicMaterial({
        color: 0x778294, transparent: true, opacity: 0.1,
        side: THREE.DoubleSide, toneMapped: false,
      }),
    );
    filter.add(mesh);
    const stem = add(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8), dark, -0.34, -0.2, -0.32);
    stem.position.set(-0.3, 2.7, 0.4);
    stem.rotation.z = 0.7;
    stem.rotation.y = -0.5;

    // Cable XLR: cae del cuerpo y se pierde por detrás de la base.
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 1.62, -0.28),
      new THREE.Vector3(0.12, 1.1, -0.62),
      new THREE.Vector3(0.05, 0.5, -0.85),
      new THREE.Vector3(-0.25, 0.09, -1.15),
      new THREE.Vector3(-0.95, 0.06, -1.5),
    ]);
    this.group.add(new THREE.Mesh(
      new THREE.TubeGeometry(curve, 32, 0.045, 8, false),
      new THREE.MeshLambertMaterial({ color: 0x131519 }),
    ));

    this.group.rotation.x = -0.12; // ligeramente hacia la cara
    this._level = 0;
  }

  setColor(color) {
    this._color = color;
  }

  place(position, scale) {
    this.group.position.copy(position);
    this.group.scale.setScalar(scale);
  }

  update(dt, audio, beat) {
    this._level += (Math.min(1, audio.level) - this._level) * 0.2;
    if (this._color) {
      // Metal oscuro con un punto del color del programa, nada de bloque plano.
      this.grilleMaterial.color.setRGB(0.16, 0.18, 0.21).lerp(this._color, 0.12 + this._level * 0.2);
    }
    this.ledMaterial.color.setRGB(1, 0.16 + beat * 0.45, 0.28 + beat * 0.35);
  }
}
