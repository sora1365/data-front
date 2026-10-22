/// <reference types="vite/client" />

// `ra-language-spanish` no publica tipos. Se declara aquí en vez de instalar
// un @types que no existe: el catálogo se consume como un objeto de mensajes y
// no hay nada que tipar más allá de eso.
declare module "ra-language-spanish" {
  const spanishMessages: Record<string, unknown>;
  export default spanishMessages;
}
