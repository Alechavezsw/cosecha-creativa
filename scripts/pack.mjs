/**
 * Arma el paquete para alojamiento compartido (Hostinger y cualquier Apache
 * con PHP) en `dist/` y lo comprime en un zip listo para el gestor de archivos.
 *
 * El zip se escribe a mano con zlib en vez de tirar de una dependencia: el
 * proyecto entero no tiene ninguna y no merece la pena estrenar node_modules
 * para empaquetar cuatro carpetas.
 *
 *   node scripts/pack.mjs
 */
import { deflateRawSync } from 'node:zlib';
import {
  cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const NOMBRE = 'cosecha-creativa-hostinger.zip';

// Lo que se sube tal cual. `api/` y `.htaccess` salen de hosting/, que es la
// variante PHP: en Vercel esas rutas las atienden las funciones de api/.
const ESTATICOS = ['index.html', 'src', 'assets'];

/* ------------------------------------------------------------------ *
 *  Copia
 * ------------------------------------------------------------------ */

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

for (const entrada of ESTATICOS) {
  cpSync(join(ROOT, entrada), join(DIST, entrada), { recursive: true });
}
cpSync(join(ROOT, 'hosting', '.htaccess'), join(DIST, '.htaccess'));
cpSync(join(ROOT, 'hosting', 'api'), join(DIST, 'api'), { recursive: true });

/* ------------------------------------------------------------------ *
 *  Zip
 * ------------------------------------------------------------------ */

const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[i] = c >>> 0;
  }
  return tabla;
})();

function crc32(datos) {
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i++) c = TABLA_CRC[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Fecha y hora en el formato MS-DOS que exige el formato zip. */
function fechaDos(date) {
  const hora = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dia = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { hora, dia };
}

/** Recorre `carpeta` y devuelve rutas relativas con separador de zip. */
function listar(carpeta, base = carpeta) {
  const salida = [];
  for (const nombre of readdirSync(carpeta).sort()) {
    const completa = join(carpeta, nombre);
    const ruta = relative(base, completa).split(sep).join('/');
    if (statSync(completa).isDirectory()) {
      salida.push({ ruta: `${ruta}/`, carpeta: true });
      salida.push(...listar(completa, base));
    } else {
      salida.push({ ruta, carpeta: false, completa });
    }
  }
  return salida;
}

const locales = [];
const central = [];
let desplazamiento = 0;
let entradas = 0;

for (const entrada of listar(DIST)) {
  const nombre = Buffer.from(entrada.ruta, 'utf8');
  const crudo = entrada.carpeta ? Buffer.alloc(0) : readFileSync(entrada.completa);
  // Las carpetas van sin comprimir; en un fichero se usa el deflate sólo si de
  // verdad reduce (un PNG ya comprimido crecería).
  const comprimido = entrada.carpeta ? crudo : deflateRawSync(crudo, { level: 9 });
  const usaDeflate = !entrada.carpeta && comprimido.length < crudo.length;
  const datos = usaDeflate ? comprimido : crudo;
  const metodo = usaDeflate ? 8 : 0;
  const { hora, dia } = fechaDos(new Date());
  const suma = crc32(crudo);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
  local.writeUInt16LE(metodo, 8);
  local.writeUInt16LE(hora, 10);
  local.writeUInt16LE(dia, 12);
  local.writeUInt32LE(suma, 14);
  local.writeUInt32LE(datos.length, 18);
  local.writeUInt32LE(crudo.length, 22);
  local.writeUInt16LE(nombre.length, 26);
  locales.push(local, nombre, datos);

  const ficha = Buffer.alloc(46);
  ficha.writeUInt32LE(0x02014b50, 0);
  ficha.writeUInt16LE(20, 4);
  ficha.writeUInt16LE(20, 6);
  ficha.writeUInt16LE(0x0800, 8);
  ficha.writeUInt16LE(metodo, 10);
  ficha.writeUInt16LE(hora, 12);
  ficha.writeUInt16LE(dia, 14);
  ficha.writeUInt32LE(suma, 16);
  ficha.writeUInt32LE(datos.length, 20);
  ficha.writeUInt32LE(crudo.length, 24);
  ficha.writeUInt16LE(nombre.length, 28);
  ficha.writeUInt32LE(entrada.carpeta ? 0x10 : 0, 38); // atributo de directorio
  ficha.writeUInt32LE(desplazamiento, 42);
  central.push(ficha, nombre);

  desplazamiento += local.length + nombre.length + datos.length;
  entradas++;
}

const directorio = Buffer.concat(central);
const cierre = Buffer.alloc(22);
cierre.writeUInt32LE(0x06054b50, 0);
cierre.writeUInt16LE(entradas, 8);
cierre.writeUInt16LE(entradas, 10);
cierre.writeUInt32LE(directorio.length, 12);
cierre.writeUInt32LE(desplazamiento, 16);

const zip = Buffer.concat([...locales, directorio, cierre]);
writeFileSync(join(ROOT, NOMBRE), zip);

const mega = (zip.length / 1024 / 1024).toFixed(2);
console.log(`dist/ listo y ${NOMBRE} escrito (${mega} MB).`);
console.log('Subilo a public_html en Hostinger y extraelo alli.');

