import * as THREE from 'three';

/**
 * Avatar vóxel: convierte una imagen en un bloque de cubos, uno por píxel.
 *
 * El relieve base sale de la luminancia (las zonas claras salen hacia delante),
 * La voz mueve la mandíbula —las filas bajo la boca bajan— y añade un temblor
 * mínimo de profundidad. Nada de glitches: tiene que leerse como un locutor.
 */
export class VoxelAvatar {
  constructor({
    columns = 200,
    size = 9,
    mouth = 0.375,      // altura de la boca (0 arriba, 1 abajo)
    mouthX = 0.565,     // centro horizontal de la boca
    mouthRadius = 0.055, // ancho de la campana horizontal
    relief = 0,          // saliente por luminancia (0 = imagen plana y nítida)
  } = {}) {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.columns = columns;
    this.size = size;
    this.mouth = mouth;
    this.mouthX = mouthX;
    this.mouthRadius = mouthRadius;
    this.relief = relief;
    this._jaw = 0;

    this.mesh = null;
    this.cols = 0;
    this.rows = 0;
    this._baseX = null;
    this._baseY = null;
    this._baseZ = null;
    this._rowShift = null;
    this._glitch = 0;
    this._bob = 0;
    this._offsetY = 0;
  }

  get loaded() {
    return Boolean(this.mesh);
  }

  async loadFromBlob(blob) {
    const bitmap = await createImageBitmap(blob);
    try {
      this._build(bitmap);
    } finally {
      bitmap.close?.();
    }
  }

  /** Carga una imagen servida por la app (por ejemplo assets/avatar.png). */
  async loadFromUrl(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`No se encontró ${url}`);
    await this.loadFromBlob(await response.blob());
  }

  _build(image) {
    const cols = this.columns;
    const rows = Math.max(1, Math.round(cols * (image.height / image.width)));

    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, cols, rows);
    const pixels = ctx.getImageData(0, 0, cols, rows).data;

    this.dispose();

    // Sólo los píxeles opacos se convierten en cubo: si la foto viene recortada
    // en PNG con transparencia, queda la silueta del personaje y nada más.
    const opaque = [];
    for (let i = 0; i < cols * rows; i++) {
      if (pixels[i * 4 + 3] >= 128) opaque.push(i);
    }
    if (!opaque.length) throw new Error('La imagen no tiene píxeles visibles');

    const count = opaque.length;
    const cell = this.size / cols;
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial(),
      count,
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;

    const baseX = new Float32Array(count);
    const baseY = new Float32Array(count);
    const baseZ = new Float32Array(count);
    const cellX = new Uint16Array(count);
    const cellY = new Uint16Array(count);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const pixel = opaque[i];
      const x = pixel % cols;
      const y = (pixel - x) / cols;
      const o = pixel * 4;
      const r = pixels[o] / 255;
      const g = pixels[o + 1] / 255;
      const b = pixels[o + 2] / 255;

      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const px = (x - (cols - 1) / 2) * cell;
      const py = ((rows - 1) / 2 - y) * cell;
      const pz = luma * cell * this.relief;

      baseX[i] = px;
      baseY[i] = py;
      baseZ[i] = pz;
      cellX[i] = x;
      cellY[i] = y;

      dummy.position.set(px, py, pz);
      dummy.scale.setScalar(cell * 1.02);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.setRGB(r, g, b).convertSRGBToLinear());
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;

    this.mesh = mesh;
    this.cols = cols;
    this.rows = rows;
    this.count = count;
    this._baseX = baseX;
    this._baseY = baseY;
    this._baseZ = baseZ;
    this._cellX = cellX;
    this._cellY = cellY;
    this._rowShift = new Float32Array(rows);
    this.group.add(mesh);
  }

  dispose() {
    if (!this.mesh) return;
    this.group.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
    this.mesh = null;
  }

  /** El parámetro `level` da a cada locutor el nivel de su propio canal. */
  update(dt, audio, level = audio.level) {
    if (!this.mesh) return;
    const loud = Math.min(1, level);

    const { cols, rows, _baseY: baseY } = this;
    const cell = this.size / cols;

    // Sólo se abre la boca. El desplazamiento cae con una campana suave en los
    // dos ejes: con un corte duro se veía la foto partida en dos.
    this._jaw += (loud - this._jaw) * (loud > this._jaw ? 0.5 : 0.2);
    const jaw = this._jaw * cell * 3.2;
    const mouthRow = this.mouth;
    const sigmaY = 0.028;
    const sigmaX = this.mouthRadius;
    const centerX = this.mouthX;

    const array = this.mesh.instanceMatrix.array;
    const lastRow = rows - 1;
    const lastCol = cols - 1;

    for (let i = 0; i < this.count; i++) {
      const offset = i * 16;
      const dy = (this._cellY[i] / lastRow - mouthRow) / sigmaY;
      let drop = 0;

      // Sólo por debajo de la línea de la boca: el labio superior no se mueve.
      if (jaw > 0.0005 && dy > -0.4 && dy < 3.2) {
        const dx = (this._cellX[i] / lastCol - centerX) / sigmaX;
        const falloff = Math.exp(-(dx * dx) - (dy - 1) * (dy - 1) * 0.55);
        drop = jaw * falloff;
      }

      array[offset + 13] = baseY[i] - drop;
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    // Respiración casi imperceptible; el brillo apenas se mueve en cámara.
    this._bob += dt;
    this.group.position.y = this._offsetY + Math.sin(this._bob * 0.5) * 0.045;
    this.mesh.material.color.setScalar(0.95 + loud * 0.08);
  }

  /**
   * Coloca el bloque ajustándolo a una altura dada, sea cual sea la proporción
   * de la foto: una imagen vertical no debe salirse de cuadro.
   * La animación de respiración oscila alrededor de esta posición.
   */
  place(position, targetHeight) {
    this._offsetY = position.y;
    this.group.position.set(position.x, position.y, position.z);
    if (!this.rows) return;
    const naturalHeight = this.size * (this.rows / this.cols);
    this.group.scale.setScalar(targetHeight / naturalHeight);
  }
}
