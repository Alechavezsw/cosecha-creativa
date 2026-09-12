// Servidor estático mínimo (sin dependencias) para desarrollo local.
// El micrófono requiere contexto seguro: http://localhost lo es.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 5180;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Direcciones locales / privadas: el proxy no debe poder alcanzarlas.
const PRIVATE_HOST = /^(localhost|0\.0\.0\.0|\[?::1\]?|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i;

/**
 * Reenvía audio remoto añadiendo CORS: la Web Audio API sólo puede analizar
 * un stream si el origen lo autoriza, y casi ningún hosting de podcast lo hace.
 * Conserva las peticiones por rango para que la barra de tiempo siga funcionando.
 */
async function proxyAudio(req, res, target) {
  let remote;
  try {
    remote = new URL(target);
  } catch {
    res.writeHead(400).end('URL inválida');
    return;
  }
  if (!/^https?:$/.test(remote.protocol) || PRIVATE_HOST.test(remote.hostname)) {
    res.writeHead(403).end('Origen no permitido');
    return;
  }

  try {
    const upstream = await fetch(remote, {
      headers: {
        // Algunos CDN (googlevideo entre ellos) rechazan clientes sin navegador.
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        ...(req.headers.range ? { range: req.headers.range } : {}),
      },
      redirect: 'follow',
    });
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
    };
    for (const name of ['content-length', 'content-range']) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }
    res.writeHead(upstream.status, headers);
    if (!upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end(`No se pudo descargar el audio: ${err.message}`);
  }
}

const YOUTUBE_HOST = /^(www\.|m\.|music\.)?(youtube\.com|youtu\.be)$/i;

/**
 * Pide a yt-dlp la pista de audio de un vídeo de YouTube.
 * Se ejecuta sin shell y sólo con URL de YouTube ya validada.
 */
function resolveYoutube(target) {
  return new Promise((resolve, reject) => {
    execFile(
      'yt-dlp',
      [
        '--no-playlist',
        '--no-warnings',
        '-f', 'bestaudio/best',
        '--print', '%(title)s',
        '--print', '%(urls)s',
        target,
      ],
      { timeout: 40000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && error.code === 'ENOENT') {
          reject(Object.assign(new Error('yt-dlp no está instalado'), { status: 501 }));
          return;
        }
        const lines = String(stdout).split(/\r?\n/).filter(Boolean);
        const streamUrl = lines.find((l) => /^https?:\/\//i.test(l));
        if (!streamUrl) {
          reject(Object.assign(
            new Error(String(stderr).trim().split('\n').pop() || 'yt-dlp no devolvió ninguna pista'),
            { status: 502 },
          ));
          return;
        }
        resolve({ title: lines[0] === streamUrl ? 'YouTube' : lines[0], url: streamUrl });
      },
    );
  });
}

async function handleYoutube(res, target) {
  let remote;
  try {
    remote = new URL(target);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: 'URL inválida' }));
    return;
  }
  if (!YOUTUBE_HOST.test(remote.hostname)) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: 'Esa URL no es de YouTube' }));
    return;
  }

  try {
    const track = await resolveYoutube(remote.href);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      .end(JSON.stringify(track));
  } catch (err) {
    res.writeHead(err.status || 500, { 'Content-Type': 'application/json; charset=utf-8' })
      .end(JSON.stringify({
        error: err.message,
        hint: err.status === 501 ? 'winget install yt-dlp' : undefined,
      }));
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/youtube') {
    await handleYoutube(res, url.searchParams.get('url') || '');
    return;
  }

  if (url.pathname === '/proxy') {
    await proxyAudio(req, res, url.searchParams.get('url') || '');
    return;
  }

  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  const target = join(ROOT, rel === '' ? 'index.html' : rel);

  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
  }
}).listen(PORT, () => {
  console.log(`Cosecha Creativa lista en http://localhost:${PORT}`);
});
