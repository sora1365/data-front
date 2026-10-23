import { describe, expect, it } from "vitest";

import {
  CANALES,
  CANAL_SISTEMA,
  nombreDeCanal,
  paraCampoLocal,
} from "./interacciones";

describe("canales", () => {
  it("no deja teclear el canal del sistema", () => {
    expect(CANALES.map((c) => c.codigo)).not.toContain(CANAL_SISTEMA);
  });

  it("sabe nombrar el canal del sistema aunque no se pueda teclear", () => {
    expect(nombreDeCanal(CANAL_SISTEMA)).toBe("Sistema");
  });

  it("devuelve el código tal cual cuando el canal es desconocido", () => {
    expect(nombreDeCanal("telepatia")).toBe("telepatia");
  });
});

describe("paraCampoLocal", () => {
  /**
   * La hora que se enseña es la del reloj de quien anota.
   *
   * Con `toISOString()` el campo saldría en UTC: en Ecuador, una llamada de
   * las nueve de la mañana aparecería anotada a las dos de la tarde, y nadie
   * sospecharía nada hasta intentar reconstruir una conversación.
   */
  it("usa la hora local y no UTC", () => {
    const fecha = new Date(2026, 9, 22, 9, 5);
    expect(paraCampoLocal(fecha)).toBe("2026-10-22T09:05");
  });

  it("rellena con ceros lo que el campo exige de dos cifras", () => {
    expect(paraCampoLocal(new Date(2026, 0, 2, 3, 4))).toBe("2026-01-02T03:04");
  });
});
