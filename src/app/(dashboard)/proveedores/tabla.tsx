"use client";

import { useEffect, useRef } from "react";
import EliminarProveedor from "./EliminarProveedor";

type ProveedorFila = {
  id: string;
  nombre: string;
  contacto: string | null;
  notas: string | null;
  productos: { nombre: string }[] | null;
};

export default function TablaProveedores({
  proveedores,
  destacado,
}: {
  proveedores: ProveedorFila[];
  destacado: string | null;
}) {
  const filasRef = useRef<Map<string, HTMLTableRowElement>>(new Map());

  useEffect(() => {
    if (!destacado) return;
    const fila = filasRef.current.get(destacado);
    if (!fila) return;
    fila.scrollIntoView({ behavior: "smooth", block: "center" });
    fila.classList.add("fila-destacada");
    const timer = setTimeout(() => fila.classList.remove("fila-destacada"), 3500);
    return () => clearTimeout(timer);
  }, [destacado]);

  return (
    <div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Contacto</th>
              <th>Notas</th>
              <th>Productos asociados</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {proveedores.length > 0 ? (
              proveedores.map((p) => (
                <tr
                  key={p.id}
                  id={`proveedor-${p.id}`}
                  ref={(el) => {
                    if (el) filasRef.current.set(p.nombre, el);
                  }}
                >
                  <td>{p.nombre}</td>
                  <td>{p.contacto ?? "—"}</td>
                  <td>{p.notas ?? "—"}</td>
                  <td>
                    {p.productos && p.productos.length > 0
                      ? p.productos.map((prod) => prod.nombre).join(", ")
                      : "—"}
                  </td>
                  <td>
                    <EliminarProveedor proveedorId={p.id} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="empty-cell">
                  Aún no hay proveedores.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}