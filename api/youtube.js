/**
 * En Vercel no hay yt-dlp. El cliente ya ofrece «Pestaña» como alternativa.
 * En local, server.js sigue resolviendo YouTube con yt-dlp.
 */
export default function handler(req, res) {
  res.status(501).json({
    error: 'YouTube por URL no está disponible en este hosting',
    hint: 'Usá el botón Pestaña (T) y marcá «Compartir audio de la pestaña»',
  });
}
