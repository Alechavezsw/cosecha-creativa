/**
 * Motor de audio: expone un espectro logarítmico normalizado, la forma de onda
 * y la energía por bandas (graves / medios / agudos) a partir del micrófono
 * o de un archivo de audio.
 */

export const BAR_COUNT = 128;
const F_MIN = 32;
const F_MAX = 16000;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.stream = null;
    this.kind = 'idle'; // 'idle' | 'mic' | 'file' | 'tab' | 'demo'
    this.monitorWanted = false;

    this.spectrum = new Float32Array(BAR_COUNT); // 0..1 suavizado
    this.peaks = new Float32Array(BAR_COUNT);
    this.wave = new Float32Array(256); // -1..1
    this.bass = 0;
    this.mid = 0;
    this.treble = 0;
    this.level = 0;
    this.levelLeft = 0;
    this.levelRight = 0;
    this.beat = 0;

    this.gain = 1.35;
    this.smoothing = 0.78;

    this._freqData = null;
    this._timeData = null;
    this._binRanges = null;
    this._bassHistory = new Array(43).fill(0);
    this._historyIndex = 0;
    this._beatCooldown = 0;
    this._idlePhase = 0;
  }

  get active() {
    return this.kind !== 'idle';
  }

  _ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0.72;
      this.analyser.minDecibels = -92;
      this.analyser.maxDecibels = -12;
      this._freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this._timeData = new Uint8Array(this.analyser.fftSize);
      this._buildBinRanges();

      // Todas las fuentes pasan por el analizador, así que colgando de él la
      // salida de grabación se captura cualquiera de ellas sin casos especiales.
      this.recordDestination = this.ctx.createMediaStreamDestination();
      this.analyser.connect(this.recordDestination);

      // Salida a altavoces / OBS. Apagada en micrófono para no acoplar; el
      // botón OBS la enciende para que «Captura de audio de aplicación» oiga.
      this.monitor = this.ctx.createGain();
      this.monitor.gain.value = 0;
      this.analyser.connect(this.monitor);
      this.monitor.connect(this.ctx.destination);

      // Un analizador por canal: con dos locutores en estéreo, el nivel de cada
      // lado dice quién está hablando.
      const splitter = this.ctx.createChannelSplitter(2);
      this.analyser.connect(splitter);
      this._sideAnalysers = [0, 1].map((channel) => {
        const node = this.ctx.createAnalyser();
        node.fftSize = 1024;
        node.smoothingTimeConstant = 0.7;
        splitter.connect(node, channel);
        return node;
      });
      this._sideData = new Uint8Array(1024);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /** Reparte las bandas de la FFT entre las barras con espaciado logarítmico. */
  _buildBinRanges() {
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const ratio = F_MAX / F_MIN;
    const ranges = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      const f0 = F_MIN * Math.pow(ratio, i / BAR_COUNT);
      const f1 = F_MIN * Math.pow(ratio, (i + 1) / BAR_COUNT);
      const start = Math.floor(f0 / binHz);
      const end = Math.max(start + 1, Math.floor(f1 / binHz));
      ranges.push([start, Math.min(end, this.analyser.frequencyBinCount - 1)]);
    }
    this._binRanges = ranges;
    this._bandBins = {
      bass: [Math.floor(20 / binHz), Math.floor(180 / binHz)],
      mid: [Math.floor(180 / binHz), Math.floor(2200 / binHz)],
      treble: [Math.floor(2200 / binHz), Math.floor(11000 / binHz)],
    };
  }

  _disconnect() {
    this.stopDemo();
    if (this.source) {
      try { this.source.disconnect(); } catch { /* ya desconectado */ }
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  _syncMonitor() {
    if (!this.monitor) return;
    const on = this.kind === 'file' || this.kind === 'demo'
      || (this.monitorWanted && this.kind === 'mic');
    this.monitor.gain.value = on ? 1 : 0;
  }

  setMonitor(on) {
    this.monitorWanted = Boolean(on);
    this._ensureContext();
    this._syncMonitor();
  }

  async useMicrophone() {
    const ctx = this._ensureContext();
    const constraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    } catch (err) {
      // OBS u otra app a veces bloquean el dispositivo en exclusivo: reintento
      // con el perfil por defecto, que Windows suele compartir.
      if (err && (err.name === 'NotReadableError' || err.name === 'OverconstrainedError')) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        throw err;
      }
    }
    this._disconnect();
    this.stream = stream;
    this.source = ctx.createMediaStreamSource(stream);
    this.source.connect(this.analyser);
    this.kind = 'mic';
    this._syncMonitor();
  }

  /**
   * Captura el audio de una pestaña o de todo el sistema.
   *
   * Es la única forma de visualizar YouTube (o Spotify, o cualquier reproductor
   * web) sin descargar nada: el audio de un iframe ajeno no es accesible desde
   * la Web Audio API por ser de otro origen.
   */
  async useDisplayCapture(onEnded) {
    const ctx = this._ensureContext();
    // Chrome exige pedir vídeo para ofrecer la casilla de audio de la pestaña.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1 },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });

    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((t) => t.stop());
      const error = new Error('La captura no incluye audio');
      error.code = 'NO_AUDIO';
      throw error;
    }

    this._disconnect();
    this.stream = stream;
    this.source = ctx.createMediaStreamSource(stream);
    this.source.connect(this.analyser); // la pestaña ya suena por su cuenta
    if (onEnded) {
      stream.getTracks().forEach((t) => t.addEventListener('ended', onEnded, { once: true }));
    }
    this.kind = 'tab';
    this._syncMonitor();
  }

  useMediaElement(el) {
    const ctx = this._ensureContext();
    if (this._elementSource && this._elementFor === el) {
      this._disconnect();
      this.source = this._elementSource;
    } else {
      this._disconnect();
      this._elementSource = ctx.createMediaElementSource(el);
      this._elementFor = el;
      this.source = this._elementSource;
    }
    this.source.connect(this.analyser);
    this.kind = 'file';
    this._syncMonitor();
  }

  /**
   * Pista generativa integrada (bombo + hi-hat + arpegio) para poder ver el
   * visualizador reaccionando sin micrófono ni archivo.
   */
  startDemo() {
    const ctx = this._ensureContext();
    this._disconnect();
    this.stopDemo();

    const out = ctx.createGain();
    out.gain.value = 0.16;
    out.connect(this.analyser);

    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const scale = [0, 3, 5, 7, 10, 12, 15, 19];
    let step = 0;

    const env = (node, at, peak, decay) => {
      node.gain.setValueAtTime(0.0001, at);
      node.gain.exponentialRampToValueAtTime(peak, at + 0.008);
      node.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    };

    const tick = () => {
      const at = ctx.currentTime + 0.02;

      if (step % 4 === 0) { // bombo
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.frequency.setValueAtTime(140, at);
        osc.frequency.exponentialRampToValueAtTime(44, at + 0.22);
        env(g, at, 1.0, 0.34);
        osc.connect(g).connect(out);
        osc.start(at); osc.stop(at + 0.4);
      }
      if (step % 2 === 1) { // hi-hat
        const src = ctx.createBufferSource();
        const hp = ctx.createBiquadFilter();
        const g = ctx.createGain();
        src.buffer = noise;
        hp.type = 'highpass';
        hp.frequency.value = 7000;
        env(g, at, 0.28, 0.07);
        src.connect(hp).connect(g).connect(out);
        src.start(at); src.stop(at + 0.12);
      }
      { // arpegio
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        const semitone = scale[(step * 3) % scale.length] + (step % 8 < 4 ? 0 : 5);
        osc.type = step % 8 < 4 ? 'triangle' : 'sawtooth';
        osc.frequency.value = 220 * Math.pow(2, semitone / 12);
        env(g, at, 0.22, 0.28);
        osc.connect(g).connect(out);
        osc.start(at); osc.stop(at + 0.34);
      }

      step = (step + 1) % 64;
    };

    tick();
    this._demo = { out, timer: setInterval(tick, 160) };
    this.kind = 'demo';
    this._syncMonitor();
  }

  stopDemo() {
    if (!this._demo) return;
    clearInterval(this._demo.timer);
    try { this._demo.out.disconnect(); } catch { /* ya desconectado */ }
    this._demo = null;
  }

  stop() {
    this.stopDemo();
    this._disconnect();
    this.kind = 'idle';
    this._syncMonitor();
  }

  _avg(data, [start, end]) {
    let sum = 0;
    for (let i = start; i <= end; i++) sum += data[i];
    return sum / ((end - start + 1) * 255);
  }

  /** Espectro sintético para que la escena respire antes de recibir audio. */
  _idleFrame(dt) {
    this._idlePhase += dt;
    const t = this._idlePhase;
    for (let i = 0; i < BAR_COUNT; i++) {
      const x = i / BAR_COUNT;
      const v =
        0.16 * Math.sin(t * 1.1 + x * 9.0) +
        0.12 * Math.sin(t * 0.63 - x * 17.0) +
        0.08 * Math.sin(t * 2.3 + x * 4.0);
      const envelope = Math.pow(1 - x, 1.5) * 0.9 + 0.08;
      this.spectrum[i] = Math.max(0, (0.2 + v) * envelope);
    }
    for (let i = 0; i < this.wave.length; i++) {
      const x = i / this.wave.length;
      this.wave[i] = 0.22 * Math.sin(t * 2.0 + x * Math.PI * 6) * Math.sin(t * 0.4 + x * Math.PI * 2);
    }
    this.bass = 0.14 + 0.1 * Math.sin(t * 1.2);
    this.mid = 0.1 + 0.06 * Math.sin(t * 0.8 + 1);
    this.treble = 0.06 + 0.04 * Math.sin(t * 1.7 + 2);
    this.level = 0.12 + 0.06 * Math.sin(t * 1.4);
    this.levelLeft = this.level;
    this.levelRight = this.level;
    this.beat *= 0.9;
  }

  /** Actualiza todos los descriptores. Llamar una vez por frame. */
  update(dt) {
    if (this.analyser) this.analyser.smoothingTimeConstant = this.smoothing * 0.85;

    if (!this.active || !this.analyser) {
      this._idleFrame(dt);
      this._decayPeaks(dt);
      return;
    }

    this.analyser.getByteFrequencyData(this._freqData);
    this.analyser.getByteTimeDomainData(this._timeData);

    const fall = Math.pow(0.001, dt); // caída exponencial estable
    for (let i = 0; i < BAR_COUNT; i++) {
      const [start, end] = this._binRanges[i];
      let peak = 0;
      for (let b = start; b <= end; b++) if (this._freqData[b] > peak) peak = this._freqData[b];
      const x = i / BAR_COUNT;
      // Compensación de inclinación: los agudos tienen mucha menos energía.
      const tilt = 0.62 + 1.05 * Math.pow(x, 0.75);
      const target = Math.min(1.6, (peak / 255) * tilt * this.gain);
      this.spectrum[i] = target > this.spectrum[i]
        ? target
        : this.spectrum[i] * fall + target * (1 - fall);
    }

    const step = this._timeData.length / this.wave.length;
    for (let i = 0; i < this.wave.length; i++) {
      this.wave[i] = (this._timeData[Math.floor(i * step)] - 128) / 128;
    }

    const g = this.gain;
    this.bass = Math.min(1.4, this._avg(this._freqData, this._bandBins.bass) * g * 1.15);
    this.mid = Math.min(1.4, this._avg(this._freqData, this._bandBins.mid) * g * 1.5);
    this.treble = Math.min(1.4, this._avg(this._freqData, this._bandBins.treble) * g * 2.4);
    this.level = Math.min(1.3, (this.bass * 0.5 + this.mid * 0.35 + this.treble * 0.15) * 1.2);

    this._readSides();
    this._detectBeat(dt);
    this._decayPeaks(dt);
  }

  /** Nivel de cada canal, para repartir la palabra entre locutor e invitado. */
  _readSides() {
    if (!this._sideAnalysers) return;
    const data = this._sideData;
    const read = (node) => {
      node.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / data.length) * 3.2 * this.gain);
    };
    this.levelLeft = read(this._sideAnalysers[0]);
    this.levelRight = read(this._sideAnalysers[1]);
  }

  _decayPeaks(dt) {
    for (let i = 0; i < BAR_COUNT; i++) {
      this.peaks[i] = Math.max(this.spectrum[i], this.peaks[i] - dt * 0.55);
    }
  }

  /** Detección de golpe por energía de graves contra su media reciente. */
  _detectBeat(dt) {
    this._beatCooldown = Math.max(0, this._beatCooldown - dt);
    const hist = this._bassHistory;
    const avg = hist.reduce((a, b) => a + b, 0) / hist.length;
    if (this.bass > avg * 1.32 && this.bass > 0.14 && this._beatCooldown === 0) {
      this.beat = 1;
      this._beatCooldown = 0.16;
    } else {
      this.beat = Math.max(0, this.beat - dt * 3.2);
    }
    hist[this._historyIndex] = this.bass;
    this._historyIndex = (this._historyIndex + 1) % hist.length;
  }
}
