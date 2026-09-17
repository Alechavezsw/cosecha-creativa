<?php
/**
 * Proxy de audio con CORS, equivalente al de server.js y al de api/proxy.js.
 *
 * La Web Audio API sólo puede analizar un stream si el origen lo autoriza, y
 * casi ningún hosting de podcast manda Access-Control-Allow-Origin. Este script
 * se pone en medio y añade la cabecera. Conserva las peticiones por rango para
 * que la barra de tiempo siga funcionando.
 *
 * Va en PHP porque el alojamiento compartido de Hostinger sirve Apache y PHP,
 * no Node: subir server.js allí no arrancaría nada.
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Range, Content-Type');
header('Access-Control-Allow-Methods: GET, HEAD, OPTIONS');
header('Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/** Direcciones locales o privadas: el proxy no debe poder alcanzarlas. */
function es_privada($host)
{
    if ($host === '' || preg_match('/^(localhost|0\.0\.0\.0|\[?::1\]?)$/i', $host)) {
        return true;
    }
    // El nombre puede resolver a una IP interna aunque no lo parezca, así que
    // se comprueba la IP resuelta y no sólo el texto del host.
    $ip = filter_var($host, FILTER_VALIDATE_IP) ? $host : gethostbyname($host);
    if (!filter_var($ip, FILTER_VALIDATE_IP)) {
        return true;
    }
    return !filter_var(
        $ip,
        FILTER_VALIDATE_IP,
        FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
    );
}

function fallar($codigo, $mensaje)
{
    http_response_code($codigo);
    header('Content-Type: text/plain; charset=utf-8');
    echo $mensaje;
    exit;
}

$destino = isset($_GET['url']) ? $_GET['url'] : '';
$partes = parse_url($destino);

if (!$partes || !isset($partes['scheme'], $partes['host'])) {
    fallar(400, 'URL invalida');
}
if (!in_array(strtolower($partes['scheme']), ['http', 'https'], true) || es_privada($partes['host'])) {
    fallar(403, 'Origen no permitido');
}
if (!function_exists('curl_init')) {
    fallar(501, 'El alojamiento no tiene cURL activado');
}

$cabeceras = [
    // Algunos CDN rechazan clientes que no parecen un navegador.
    'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
];
if (!empty($_SERVER['HTTP_RANGE'])) {
    $cabeceras[] = 'Range: ' . $_SERVER['HTTP_RANGE'];
}

$reenviables = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
$estado = 200;

$curl = curl_init($destino);
curl_setopt_array($curl, [
    CURLOPT_HTTPHEADER => $cabeceras,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_TIMEOUT => 0,
    CURLOPT_HEADERFUNCTION => function ($handle, $linea) use (&$estado, $reenviables) {
        $longitud = strlen($linea);
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $linea, $m)) {
            // Tras una redirección llega una cabecera de estado nueva: vale la
            // última, que es la del recurso que se acaba sirviendo.
            $estado = (int) $m[1];
            return $longitud;
        }
        $dosPuntos = strpos($linea, ':');
        if ($dosPuntos !== false) {
            $nombre = strtolower(trim(substr($linea, 0, $dosPuntos)));
            if (in_array($nombre, $reenviables, true)) {
                header(trim($linea));
            }
        }
        return $longitud;
    },
    CURLOPT_WRITEFUNCTION => function ($handle, $trozo) use (&$estado) {
        static $enviado = false;
        if (!$enviado) {
            http_response_code($estado);
            $enviado = true;
        }
        echo $trozo;
        flush();
        return strlen($trozo);
    },
]);

if (curl_exec($curl) === false) {
    $error = curl_error($curl);
    curl_close($curl);
    fallar(502, 'No se pudo descargar el audio: ' . $error);
}
curl_close($curl);
