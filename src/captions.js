/**
 * Subtítulos en vivo con la API de reconocimiento de voz del navegador.
 *
 * Abre su propia captura de micrófono, en paralelo a la del visualizador: son
 * dos consumidores independientes del mismo dispositivo. Chrome corta la
 * sesión sola tras un silencio, así que se reinicia mientras siga activada.
 *
 * Si el navegador trae Translator / LanguageDetector, traduce al español lo
 * que no esté ya en ese idioma y lo muestra debajo de la transcripción.
 *
 * Sólo funciona en Chrome y Edge; en el resto la clase avisa y no hace nada.
 */
export class Captions {
  constructor(element, { lang = 'es-AR', onState } = {}) {
    this.element = element;
    this.sourceEl = element.querySelector('.captions-source');
    this.translationEl = element.querySelector('.captions-translation');
    this.lang = lang;
    this.onState = onState;
    this.active = false;
    this._final = '';
    this._hideTimer = 0;
    this._translateSeq = 0;
    this._translator = null;
    this._translatorKey = '';
    this._detector = null;

    const Engine = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = Boolean(Engine);
    if (!this.supported) return;

    this.engine = new Engine();
    this.engine.lang = lang;
    this.engine.continuous = true;
    this.engine.interimResults = true;

    this.engine.addEventListener('result', (event) => this._onResult(event));
    this.engine.addEventListener('end', () => {
      // Reinicio inmediato: si no, los subtítulos mueren al primer silencio.
      if (this.active) {
        try { this.engine.start(); } catch { /* aún cerrando; el próximo end reintenta */ }
      }
    });
    this.engine.addEventListener('error', (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.stop();
        this.onState?.(false, 'Permiso de micrófono denegado para los subtítulos.');
      }
    });
  }

  _show(source, translation = '') {
    this.sourceEl.textContent = source;
    this.translationEl.textContent = translation;
    this.translationEl.hidden = !translation;
    this.element.classList.toggle('has-translation', Boolean(translation));
    this.element.classList.add('show');
  }

  _onResult(event) {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) this._final = result[0].transcript.trim();
      else interim += result[0].transcript;
    }

    const text = (interim || this._final).trim();
    if (!text) return;

    // Sólo las últimas palabras: un rótulo de programa no es una transcripción.
    const words = text.split(/\s+/).slice(-14).join(' ');
    this.element.classList.remove('listening');
    this._show(words, this.translationEl.textContent);

    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      if (this.active) this._idle();
      else this.element.classList.remove('show');
    }, 5000);

    this._translate(words);
  }

  _idle() {
    this.element.classList.add('listening');
    this._show('Escuchando…');
  }

  async _translate(text) {
    const seq = ++this._translateSeq;
    if (!('LanguageDetector' in window) || !('Translator' in window)) return;

    try {
      if (!this._detector) this._detector = await LanguageDetector.create();
      const detected = await this._detector.detect(text);
      if (seq !== this._translateSeq) return;

      const source = detected?.[0]?.detectedLanguage;
      if (!source || source === 'und' || source.startsWith('es')) {
        if (seq === this._translateSeq) this._show(text);
        return;
      }

      const key = `${source}:es`;
      if (!this._translator || this._translatorKey !== key) {
        this._translator = await Translator.create({
          sourceLanguage: source,
          targetLanguage: 'es',
        });
        this._translatorKey = key;
      }

      const translated = (await this._translator.translate(text)).trim();
      if (seq !== this._translateSeq || !translated || translated === text) return;
      this._show(text, translated);
    } catch {
      /* Sin modelo de traducción o sin red: se queda la transcripción. */
    }
  }

  start() {
    if (!this.supported || this.active) return;
    this.active = true;
    this._idle();
    try {
      this.engine.start();
      this.onState?.(true);
    } catch {
      this.active = false;
      this.element.classList.remove('show', 'listening');
      this.onState?.(false, 'No se pudieron iniciar los subtítulos.');
    }
  }

  stop() {
    this.active = false;
    this._final = '';
    this._translateSeq += 1;
    clearTimeout(this._hideTimer);
    this.element.classList.remove('show', 'listening', 'has-translation');
    this.sourceEl.textContent = '';
    this.translationEl.textContent = '';
    this.translationEl.hidden = true;
    if (this.supported) {
      try { this.engine.stop(); } catch { /* ya estaba parado */ }
    }
    this.onState?.(false);
  }

  toggle() {
    if (this.active) this.stop();
    else this.start();
  }
}
