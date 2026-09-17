/**
 * En Vercel no hay yt-dlp. El cliente ya ofrece «Pestaña» como alternativa.
 * En local, server.js sigue resolviendo YouTube con yt-dlp.
 *
 * Va sin `hint`: el cliente reserva ese campo para el caso de «yt-dlp no está
 * instalado» y lo redacta como una orden de instalación. Aquí no hay nada que
 * instalar, y sin él el aviso ya termina en «prueba con Pestaña».
 */
export default function handler(req, res) {
  res.status(501).json({
    error: 'YouTube por URL no está disponible en este hosting',
  });
}
