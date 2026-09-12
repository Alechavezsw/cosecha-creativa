import * as THREE from 'three';

/**
 * Onda de barras que se desplaza, dentro del monitor del estudio.
 *
 * Sustituye al enredo de líneas finas anterior: a tamaño de pantalla, decenas
 * de contornos de un píxel se cruzan y no se lee nada. Barras sólidas y
 * simétricas —lo que muestra cualquier editor de audio— se leen de un vistazo.
 *
 * La amplitud se normaliza contra el pico reciente, así una voz suave dibuja
 * lo mismo que una fuerte y el monitor nunca queda plano ni saturado.
 */
export class WaveDisplay {
  constructor({ bars = 54, width = 9.4, height = 3.6, interval = 0.055 } = {}) {
    this.group = new THREE.Group();
    this.bars = bars;
    this.width = width;
    this.height = height;
    this.interval = interval;

    this.values = new Float32Array(bars);
    this.head = 0;
    this._accumulator = 0;


    // Barras anchas y con hueco claro: con 100 barras finas se fundían en un
    // bloque sólido y no se leía la forma de la voz.
    const gap = 0.4;
    const barWidth = (width / bars) * (1 - gap);
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(barWidth, 1, 0.16),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      bars,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    // Línea de cero: el monitor nunca se queda vacío del todo.
    this.axis = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.035, 0.1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, toneMapped: false }),
    );
    this.group.add(this.axis);

    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
  }

  setColors(near, far) {
    this._near = near;
    this._far = far;
    this.axis.material.color.copy(far).multiplyScalar(0.5);
  }

  /**
   * Guarda la energía de este instante.
   *
   * Se usa el nivel que ya calcula el motor —suavizado y con la ganancia del
   * usuario aplicada— en vez de normalizar contra el pico aquí dentro: con la
   * normalización local, un golpe fuerte dejaba el resto de la onda a cero y el
   * monitor se veía como una línea con espigas sueltas.
   */
  _push(audio) {
    const wave = audio.wave;
    let sum = 0;
    for (let i = 0; i < wave.length; i++) sum += wave[i] * wave[i];
    const rms = Math.sqrt(sum / wave.length);

    // Mezcla: el nivel da el cuerpo y la media cuadrática el detalle del habla.
    const instant = Math.min(1, audio.level * 0.85 + rms * 2.2);

    // Caída con cola: sin ella, entre sílaba y sílaba las barras se iban a cero
    // y el monitor quedaba como bloques sueltos en vez de una envolvente.
    this._last = Math.max(instant, (this._last || 0) * 0.88);
    this.values[this.head] = this._last;
    this.head = (this.head + 1) % this.bars;
  }

  update(dt, audio) {
    if (!this._near) return;

    this._accumulator += dt;
    let pushes = 0;
    while (this._accumulator >= this.interval && pushes < 4) {
      this._accumulator -= this.interval;
      this._push(audio);
      pushes++;
    }

    const { bars, width, height, values, _dummy: dummy, _color: color } = this;
    for (let slot = 0; slot < bars; slot++) {
      // slot 0 es la barra más antigua (izquierda) y bars-1 la más nueva.
      const value = values[(this.head + slot) % bars];
      const h = Math.max(0.07, Math.pow(value, 0.7) * height);

      dummy.position.set((slot / (bars - 1) - 0.5) * width, 0, 0);
      dummy.scale.set(1, h, 1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(slot, dummy.matrix);

      color.copy(this._far).lerp(this._near, Math.min(1, value * 0.9));
      // Las más viejas se apagan un poco: da sensación de avance.
      this.mesh.setColorAt(slot, color.multiplyScalar(0.45 + (slot / bars) * 0.55));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
