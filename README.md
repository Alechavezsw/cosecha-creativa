# Cosecha Creativa — visualizador de audio 3D

Estudio de radio en WebGL que reacciona al **micrófono**, a un **archivo de audio**,
a la **URL de un episodio** o al **audio de otra pestaña**. La escena imita un
programa: paredes con listones, escritorio, micrófono de locución, cartel de aire
y dos monitores —el del locutor y el del visualizador—. Los movimientos son
deliberadamente sobrios: nada gira ni parpadea.

## Arrancar

```bash
node server.js
```

Y abrir <http://localhost:5180>.

> El micrófono exige contexto seguro. `http://localhost` lo es; abrir el `index.html`
> con doble clic (`file://`) no funciona, además de que los módulos ES no cargarían.

## Despliegue en Vercel

Importá el repo en [Vercel](https://vercel.com/new): framework **Other**, sin build.
Quedan el micrófono, archivos locales, pestaña, demo y el proxy de URLs.

YouTube por URL necesita `yt-dlp` (sólo en local). En Vercel usá **Pestaña** (T).

## Fuentes de audio

| Fuente | Cómo |
| --- | --- |
| Micrófono | Botón **Micrófono** (tecla `M`). No se envía a los altavoces, así no hay acople. |
| Archivo local | Botón **Audio**, o arrastrar el archivo sobre la ventana. |
| URL / podcast | Pegar el enlace del `.mp3` y pulsar **Cargar**. |
| Pestaña o sistema | Botón **Pestaña** (tecla `T`): captura lo que suene en otra pestaña. |
| YouTube | Pegar la URL del vídeo y pulsar **Cargar** (requiere `yt-dlp`, ver abajo). |
| Demo | Pista generativa integrada (tecla `D`) para probar sin permisos ni archivos. |

### Sobre las URL y el CORS

La Web Audio API sólo puede **analizar** un audio remoto si el servidor de origen
autoriza el acceso por CORS, y casi ningún hosting de podcast lo hace: sin esa
cabecera el audio suena pero el analizador recibe silencio.

Por eso `server.js` incluye `/proxy?url=…`, que reenvía el audio añadiendo
`Access-Control-Allow-Origin` y conservando las peticiones por rango (para que la
barra de progreso siga siendo navegable). La app intenta primero la URL directa y
sólo cae al proxy si falla. El proxy bloquea esquemas que no sean http/https y
cualquier destino local o de red privada.

### YouTube

El audio de un `<iframe>` de YouTube pertenece a otro origen y la Web Audio API no
puede analizarlo: incrustar el reproductor daría sonido pero dejaría el visualizador
plano. Por eso hay dos caminos, y ambos están implementados.

**1. Captura de pestaña (sin instalar nada, recomendado).** Botón **Pestaña**:
el navegador pide qué compartir, se elige la pestaña de YouTube y —esto es lo
importante— hay que marcar **«Compartir audio de la pestaña»**. El vídeo sigue
sonando en su pestaña y aquí se visualiza. Sirve igual para Spotify Web, Ivoox o
cualquier reproductor. Necesita Chrome o Edge; Firefox no captura audio.

**2. URL directa con `yt-dlp`.** Pegando la URL del vídeo, el servidor pide a
`yt-dlp` la pista de audio y la sirve por el proxy, con lo que se recupera la barra
de progreso y la posibilidad de buscar dentro del episodio. Requiere instalarlo:

```bash
winget install yt-dlp
```

Después hay que reiniciar `node server.js`. Sin `yt-dlp` la app lo detecta y sugiere
la captura de pestaña. Ten en cuenta que descargar contenido de YouTube sólo es
razonable con material propio o con permiso; para lo demás, usa la captura de pestaña.

## Modos

- **Voz** (por defecto): en el monitor del estudio, una onda de barras simétricas
  que se desplaza, como la de cualquier editor de audio. Antes era un enredo de
  contornos finos y a tamaño de pantalla no se leía nada. Las barras caen con cola,
  si no entre sílaba y sílaba quedaban bloques sueltos.
- **Ritmo**: vúmetro recto de 128 barras apoyado en el escritorio, con picos y
  reflejo. Más pensado para música.

Si no hay foto cargada, en el sitio del locutor queda un núcleo con desplazamiento
por ruido simplex que responde a graves, medios y agudos.

## El locutor

El locutor es **una foto convertida en cubos**: un cubo por píxel, con los colores
reales de la imagen, dentro del marco de un monitor de estudio. El escritorio le
tapa la parte de abajo, que es justo la mesa que ya traía la foto.

Dos maneras de ponerla:

- Arrastrar la imagen sobre la ventana, o pulsar el botón de la foto (tecla `A`).
- Guardarla como `assets/avatar.png`: se carga sola al arrancar.

Cómo se anima:

- **Sólo se mueve la boca.** El desplazamiento cae con una campana suave en alto y
  en ancho; con un corte duro la foto se partía en dos.
- El **relieve** por luminancia es mínimo: subirlo hundía los ojos y afeaba la cara.
- El bloque respira muy despacio. Nada más se mueve.

### Calibrar la boca

La boca está donde diga la configuración, no se detecta sola. Se ajusta desde la
propia URL, sin tocar código y viendo el resultado en vivo:

    http://localhost:5180/?boca=0.375&bocaX=0.565&bocaR=0.055&detalle=200

`boca` es la altura (0 arriba, 1 abajo), `bocaX` el centro horizontal, `bocaR` el
ancho que se mueve, y `detalle` el número de columnas de cubos —200 por defecto;
subirlo afina la cara y baja los fotogramas—. Los valores que funcionen se pueden
fijar como predeterminados en la llamada a `VoxelAvatar` de `src/app.js`.

Si quieres al personaje sin el fondo de su foto, recórtala y guárdala como PNG con
transparencia: los píxeles transparentes no generan cubo. Con la foto cargada, el
botón del avatar alterna entre el locutor y el núcleo.

## Grabar el episodio en vídeo

El botón rojo (tecla R) graba lo que se ve y lo que suena en un solo archivo, y
al parar lo descarga. El vídeo sale del propio lienzo con captureStream y el
audio de un destino colgado del analizador, así que funciona igual con micrófono,
archivo, URL, YouTube o captura de pestaña, sin tratar cada caso aparte.

Sale en WebM (VP9 + Opus) o MP4, según lo que soporte el navegador. Conviene
ocultar la interfaz con H antes de grabar: el rótulo de directo y los subtítulos
se quedan, los controles no.

## Subtítulos en vivo

El botón CC (tecla C) enciende el reconocimiento de voz del navegador y va
escribiendo lo que se dice como rótulo inferior, con las últimas catorce palabras.
Abre su propia captura de micrófono, en paralelo a la del visualizador.

Sólo Chrome y Edge; en el resto el botón avisa y no hace nada. Como Chrome corta
la sesión tras cada silencio, se reinicia sola mientras siga activada.

## Invitado

El botón de las dos siluetas (tecla `G`) carga una segunda foto, o se guarda como
`assets/invitado.png` para que entre al arrancar. Con invitado, los dos monitores
se van a los lados, el visualizador sube al centro, aparece un segundo micrófono
y la cámara abre el plano.

**Quién habla:** con audio estéreo, cada locutor mueve la boca con el nivel de su
canal —izquierda el locutor, derecha el invitado—. Si la fuente es mono los dos
canales traen lo mismo y hablan los dos a la vez.

## Rótulo de directo

Arriba a la derecha hay un rótulo con la foto en píxeles, un punto rojo palpitante
y el nombre. **No se oculta con `H`**: al pasar a vista limpia para grabar,
desaparecen los controles y el rótulo se queda. El nombre está en `index.html`
(`id="liveName"`) y la foto es la misma del avatar.

## Controles

| Tecla | Acción |
| --- | --- |
| `Espacio` | Play / pausa |
| `V` | Cambiar de modo |
| `M` / `T` / `D` | Micrófono / pestaña / demo |
| `R` | Grabar vídeo |
| `C` | Subtítulos en vivo |
| `A` / `G` | Foto del locutor / del invitado |
| `P` | Siguiente paleta |
| `O` | Órbita automática |
| `H` | Ocultar la interfaz |
| `F` | Pantalla completa |

Ratón: arrastrar para orbitar, rueda para acercar.

Los deslizadores ajustan **ganancia** (sensibilidad de entrada), **brillo** (bloom) y
**suavizado** (inercia del espectro).

## Estructura

```
index.html          Interfaz y mapa de importaciones de three.js
server.js           Servidor estático + proxy de audio, sin dependencias
src/app.js          Escena, modos, post-proceso y cableado de la interfaz
src/audio.js        AnalyserNode, espectro logarítmico, bandas, golpes, demo
src/studio.js       Sala: listones, escritorio, luces, cartel de aire y marcos
src/mic3d.js        Micrófono de locución (fijo)
src/waveDisplay.js  Onda de barras del monitor
src/radio.js        Radio de válvulas con dial y aguja de vúmetro
src/recorder.js     Grabación de lienzo + audio a vídeo
src/captions.js     Subtítulos en vivo
src/avatar.js       Avatar vóxel: foto -> cubos reactivos
src/palettes.js     Paletas de color
src/styles.css      Interfaz
```

three.js se carga desde jsDelivr mediante un import map, así que hace falta conexión
la primera vez (después queda en caché del navegador).
