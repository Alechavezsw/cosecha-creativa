const PRIVATE_HOST = /^(localhost|0\.0\.0\.0|\[?::1\]?|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i;

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const target = new URL(request.url).searchParams.get('url') || '';
  let remote;
  try {
    remote = new URL(target);
  } catch {
    return new Response('URL inválida', { status: 400, headers: CORS });
  }

  if (!/^https?:$/.test(remote.protocol) || PRIVATE_HOST.test(remote.hostname)) {
    return new Response('Origen no permitido', { status: 403, headers: CORS });
  }

  const range = request.headers.get('range');
  try {
    const upstream = await fetch(remote, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        ...(range ? { range } : {}),
      },
      redirect: 'follow',
    });

    const headers = new Headers(CORS);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
    for (const name of ['content-length', 'content-range']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    return new Response(`No se pudo descargar el audio: ${err.message}`, {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
