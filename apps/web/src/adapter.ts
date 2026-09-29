import { exampleSnapshot, type ExampleSnapshot } from "./example-data";

/**
 * Adaptador local por defecto.
 * La etiqueta visible es «datos de ejemplo».
 * No abre sockets. Un endpoint local futuro no está cableado.
 */
export function loadSnapshot(): ExampleSnapshot {
  return exampleSnapshot;
}
