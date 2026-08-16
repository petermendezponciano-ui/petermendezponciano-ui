import { useState, useCallback } from "react";

export type Precios = {
  cantidad: number | null;
  costo_unitario: number | null;
  costo_total: number | null;
  precio_unitario: number | null;
  precio_total: number | null;
};

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

function recalcular(precios: Precios, editado: keyof Precios): Precios {
  const { cantidad, costo_unitario, costo_total, precio_unitario, precio_total } = precios;

  switch (editado) {
    case "cantidad":
      return {
        ...precios,
        costo_total: costo_unitario != null && cantidad != null ? redondear(costo_unitario * cantidad) : null,
        precio_total: precio_unitario != null && cantidad != null ? redondear(precio_unitario * cantidad) : null,
      };
    case "costo_unitario":
      return {
        ...precios,
        costo_total: costo_unitario != null && cantidad != null ? redondear(costo_unitario * cantidad) : null,
      };
    case "costo_total":
      return {
        ...precios,
        costo_unitario: costo_total != null && cantidad != null && cantidad !== 0 ? redondear(costo_total / cantidad) : null,
      };
    case "precio_unitario":
      return {
        ...precios,
        precio_total: precio_unitario != null && cantidad != null ? redondear(precio_unitario * cantidad) : null,
      };
    case "precio_total":
      return {
        ...precios,
        precio_unitario: precio_total != null && cantidad != null && cantidad !== 0 ? redondear(precio_total / cantidad) : null,
      };
    default:
      return precios;
  }
}

export function usePrecios(initial: Precios) {
  const [precios, setPrecios] = useState<Precios>(initial);
  const [ultimoEditado, setUltimoEditado] = useState<keyof Precios | null>(null);

  const actualizar = useCallback((campo: keyof Precios, valor: number | null) => {
    setPrecios((prev) => {
      const nuevo = { ...prev, [campo]: valor };
      return recalcular(nuevo, campo);
    });
    setUltimoEditado(campo);
  }, []);

  const reset = useCallback((nuevos: Precios) => {
    setPrecios(nuevos);
    setUltimoEditado(null);
  }, []);

  return {
    precios,
    actualizar,
    reset,
    ultimoEditado,
    esCandado: (campo: keyof Precios) => ultimoEditado === campo,
  };
}

export function formatearMoneda(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatearCantidad(n: number | null | undefined, unidad?: string | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const num = Number.isInteger(n) ? String(n) : n.toLocaleString("es-PE");
  return unidad ? `${num} ${unidad}` : num;
}