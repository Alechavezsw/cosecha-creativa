import * as THREE from 'three';

/**
 * Mapa de entorno para los materiales metálicos del plató.
 *
 * El cromo no se ve como cromo por la luz que recibe sino por lo que refleja:
 * un material con metalness 1 y sin entorno sale negro, por muchos focos que
 * tenga encima. En vez de descargar un HDRI de medio mega se monta una caja
 * con paneles emisivos que imitan este mismo estudio —cálido arriba a la
 * izquierda, frío por detrás y el rojo del cartel de AL AIRE— y se convoluciona
 * con PMREM. Así los reflejos cuentan la misma historia que la escena.
 *
 * Sólo afecta a los materiales Standard/Physical; el resto del plató usa
 * Lambert y los ignora, así que se puede añadir sin tocar nada más.
 */
export function createStudioEnvironment(renderer) {
  const scene = new THREE.Scene();
  const box = new THREE.BoxGeometry();

  /** Panel de luz: color por encima de 1 para que sea emisivo de verdad. */
  const lamp = (color, intensity) => {
    const material = new THREE.MeshBasicMaterial({ color });
    material.color.multiplyScalar(intensity);
    return material;
  };

  const add = (material, size, position, rotation = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(box, material);
    mesh.scale.set(...size);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    scene.add(mesh);
    return mesh;
  };

  // La sala. Tiene que ser oscura: un metal sólo se lee como metal si hay
  // negros que reflejar entre los brillos. Un entorno uniforme lo deja gris.
  const room = new THREE.Mesh(box, new THREE.MeshBasicMaterial({
    color: 0x1a1310, side: THREE.BackSide,
  }));
  room.scale.set(22, 15, 22);
  room.position.y = 4;
  scene.add(room);

  add(lamp(0xffd2a0, 9), [8, 0.2, 7], [-5, 10.2, 3], [0, 0, 0.22]);   // foco principal
  add(lamp(0xffe8cc, 1.6), [16, 0.1, 16], [0, 11.2, 0]);              // techo suave
  add(lamp(0x9dc2ff, 5), [0.2, 6, 8], [8.5, 6, -3]);                  // contraluz frío
  add(lamp(0xff2a1e, 3.4), [6, 1.6, 0.2], [-1, 8, -9.5]);             // cartel AL AIRE
  add(lamp(0xffc98a, 2.2), [10, 5, 0.2], [0, 5, 9.5]);                // relleno frontal
  add(lamp(0x2a1c12, 1), [18, 0.1, 18], [0, -2.4, 0]);                // rebote del suelo

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.03);
  pmrem.dispose();
  box.dispose();
  scene.traverse((object) => object.material?.dispose());

  return target.texture;
}
