<?php
/**
 * En un alojamiento compartido no hay yt-dlp, así que YouTube por URL no se
 * puede resolver.
 *
 * Se responde sin `hint` a propósito: el cliente reserva ese campo para el caso
 * de «yt-dlp no está instalado» y lo redacta como una orden de instalación. Aquí
 * no hay nada que instalar, y sin él el aviso ya termina en «prueba con
 * Pestaña», que es justo lo que hay que hacer.
 */
header('Content-Type: application/json; charset=utf-8');
http_response_code(501);
echo json_encode(
    ['error' => 'YouTube por URL no está disponible en este alojamiento'],
    JSON_UNESCAPED_UNICODE
);
