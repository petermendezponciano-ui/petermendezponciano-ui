"use client";

import { useState } from "react";

export default function EliminarProveedor({ proveedorId }: { proveedorId: string }) {
  const [confirmando, setConfirmando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [error, setError] = useState("");

  async function eliminar() {
    setEliminando(true);
    setError("");
    try {
      const res = await fetch("/api/eliminar-proveedor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proveedor_id: proveedorId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo eliminar el proveedor");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al eliminar el proveedor");
      setConfirmando(false);
      setEliminando(false);
    }
  }

  return (
    <div className="prod-del">
      {confirmando ? (
        <span className="prod-del-confirm">
          ¿Seguro?
          <button
            type="button"
            className="prod-foto-btn"
            disabled={eliminando}
            onClick={eliminar}
            title="Confirmar eliminación"
          >
            {eliminando ? "…" : "Sí"}
          </button>
          <button
            type="button"
            className="prod-foto-btn"
            disabled={eliminando}
            onClick={() => setConfirmando(false)}
            title="Cancelar"
          >
            No
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="prod-foto-del-btn"
          onClick={() => setConfirmando(true)}
          title="Eliminar proveedor"
        >
          Eliminar
        </button>
      )}
      {error && <div className="prod-foto-error">{error}</div>}
    </div>
  );
}
