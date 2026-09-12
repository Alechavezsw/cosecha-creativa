/**
 * Graba lo que se ve y lo que suena en un único archivo de vídeo.
 *
 * El vídeo sale del propio lienzo WebGL (`captureStream`) y el audio de un
 * destino colgado del analizador, así que sirve igual para micrófono, archivo,
 * URL o captura de pestaña sin tratar cada caso por separado.
 */
export class Recorder {
  constructor(canvas, audio) {
    this.canvas = canvas;
    this.audio = audio;
    this.recorder = null;
    this.chunks = [];
    this.startedAt = 0;
  }

  static get supported() {
    return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  get recording() {
    return Boolean(this.recorder) && this.recorder.state === 'recording';
  }

  get seconds() {
    return this.recording ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  /** Primer formato que soporte el navegador, de mejor a peor. */
  static _pickType() {
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  start(fps = 30) {
    if (this.recording) return;

    const tracks = [...this.canvas.captureStream(fps).getVideoTracks()];
    const destination = this.audio.recordDestination;
    if (destination) tracks.push(...destination.stream.getAudioTracks());

    const mimeType = Recorder._pickType();
    this.chunks = [];
    this.recorder = new MediaRecorder(new MediaStream(tracks), {
      mimeType,
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 192_000,
    });
    this.recorder.addEventListener('dataavailable', (e) => {
      if (e.data.size) this.chunks.push(e.data);
    });
    this.recorder.start(1000);
    this.startedAt = performance.now();
  }

  /** Cierra la grabación y devuelve el archivo listo para descargar. */
  stop() {
    return new Promise((resolve) => {
      if (!this.recorder) {
        resolve(null);
        return;
      }
      this.recorder.addEventListener('stop', () => {
        const type = this.recorder.mimeType || 'video/webm';
        const blob = new Blob(this.chunks, { type });
        this.chunks = [];
        this.recorder = null;
        resolve(blob);
      }, { once: true });
      this.recorder.stop();
    });
  }

  static download(blob, name) {
    const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Se revoca con holgura: revocar en el acto aborta la descarga en Chrome.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
