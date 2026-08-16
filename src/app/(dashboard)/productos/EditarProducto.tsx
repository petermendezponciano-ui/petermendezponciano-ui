"use client";

import { useState, useEffect } from "react";
import { usePrecios, type Precios, formatearMoneda } from "@/lib/precios";

type DatosIniciales = {
  productoId: string;
  modeloId: string | null;
  nombre: string;
  marca: string | null;
  tamano: string | null;
  unidad: string | null;
  proveedor: string | null;
  modelo: string;
  cantidad: number | null;
  costo_unitario: number | null;
  costo_total: number | null;
  precio_unitario: number | null;
  precio_total: number | null;
};

type Props = {
  datos: DatosIniciales;
  onClose: () => void;
};

export default function EditarProducto({ datos, onClose }: Props) {
  const [confirmando, setConfirmando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const inicialPrecios: Precios = {
    cantidad: datos.cantidad,
    costo_unitario: datos.costo_unitario,
    costo_total: datos.costo_total,
    precio_unitario: datos.precio_unitario,
    precio_total: datos.precio_total,
  };

  const { precios, actualizar, reset, ultimoEditado, esCandado } = usePrecios(inicialPrecios);

  const [nombre, setNombre] = useState(datos.nombre);
  const [marca, setMarca] = useState(datos.marca ?? "");
  const [tamano, setTamano] = useState(datos.tamano ?? "");

  const esValido = () => {
    if (!nombre.trim()) return "El nombre es obligatorio";
    const tieneCosto = precios.costo_unitario != null || precios.costo_total != null;
    const tienePrecio = precios.precio_unitario != null || precios.precio_total != null;
    if (!tieneCosto) return "Debe ingresar al menos costo unitario o costo total";
    if (!tienePrecio) return "Debe ingresar al menos precio unitario o precio total";
    return null;
  };

  const formatearInput = (n: number | null): string => {
    if (n === null) return "";
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
  };

  const handleChangeNumero = (campo: keyof Precios, e: React.ChangeEvent<HTMLInputElement>) => {
    const valor = e.target.value;
    if (valor === "") {
      actualizar(campo, null);
      return;
    }
    const num = parseFloat(valor);
    if (!isNaN(num) && num >= 0) {
      actualizar(campo, num);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = esValido();
    if (err) {
      setError(err);
      return;
    }
    setError("");
    setGuardando(true);

    try {
      const res = await fetch("/api/actualizar-producto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          producto_id: datos.productoId,
          modelo_id: datos.modeloId,
          nombre,
          marca: marca || null,
          tamano: tamano || null,
          cantidad: precios.cantidad,
          precio_costo: precios.costo_unitario,
          precio_venta: precios.precio_unitario,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="prod-del">
      {confirmando ? (
        <div className="editar-overlay" onClick={() => { if (!guardando) { setConfirmando(false); setError(""); } }}>
          <div className="editar-card" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSubmit} className="editar-form">
              <h3 style={{ margin: 0, fontSize: "16px" }}>✏️ Editar</h3>

            <div className="editar-campos">
              <label className="editar-field">
                <span>Nombre *</span>
                <input
                  type="text"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  className="editar-input"
                  disabled={guardando}
                />
              </label>

              <label className="editar-field">
                <span>Marca</span>
                <input
                  type="text"
                  value={marca}
                  onChange={(e) => setMarca(e.target.value)}
                  className="editar-input"
                  disabled={guardando}
                />
              </label>

              <label className="editar-field">
                <span>Tamaño</span>
                <input
                  type="text"
                  value={tamano}
                  onChange={(e) => setTamano(e.target.value)}
                  className="editar-input"
                  disabled={guardando}
                />
              </label>

              <hr style={{ margin: "8px 0", borderColor: "#eee" }} />

              <div className="editar-grid">
                <label className="editar-field">
                  <span>Cantidad</span>
                  <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formatearInput(precios.cantidad)}
                      onChange={(e) => handleChangeNumero("cantidad", e)}
                      className="editar-input editar-input-flex"
                      disabled={guardando}
                    />
                    <span style={{ fontSize: "12px", color: "#666" }}>unidad</span>
                    <span style={{ fontSize: "16px", cursor: "help", color: esCandado("cantidad") ? "#f0851b" : "#999" }} title={esCandado("cantidad") ? "Este campo manda (candado cerrado)" : "Se recalcula automáticamente"}>
                      {esCandado("cantidad") ? "🔒" : "🔓"}
                    </span>
                  </div>
                </label>

                <label className="editar-field">
                  <span>Unidad</span>
                  <input
                    type="text"
                    value={datos.unidad ?? ""}
                    readOnly
                    className="editar-input editar-input-ro"
                  />
                </label>
              </div>

              <div className="editar-grid">
                <label className="editar-field">
                  <span>Costo Unitario</span>
                  <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formatearInput(precios.costo_unitario)}
                      onChange={(e) => handleChangeNumero("costo_unitario", e)}
                      className="editar-input editar-input-flex"
                      disabled={guardando}
                    />
                    <span style={{ fontSize: "16px", cursor: "help", color: esCandado("costo_unitario") ? "#f0851b" : "#999" }} title={esCandado("costo_unitario") ? "Este campo manda (candado cerrado)" : "Se recalcula automáticamente"}>
                      {esCandado("costo_unitario") ? "🔒" : "🔓"}
                    </span>
                  </div>
                </label>

                <label className="editar-field">
                  <span>Costo Total</span>
                  <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formatearInput(precios.costo_total)}
                      onChange={(e) => handleChangeNumero("costo_total", e)}
                      className="editar-input editar-input-flex"
                      disabled={guardando}
                    />
                    <span style={{ fontSize: "16px", cursor: "help", color: esCandado("costo_total") ? "#f0851b" : "#999" }} title={esCandado("costo_total") ? "Este campo manda (candado cerrado)" : "Se recalcula automáticamente"}>
                      {esCandado("costo_total") ? "🔒" : "🔓"}
                    </span>
                  </div>
                </label>
              </div>

              <div className="editar-grid">
                <label className="editar-field">
                  <span>Precio Unitario</span>
                  <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formatearInput(precios.precio_unitario)}
                      onChange={(e) => handleChangeNumero("precio_unitario", e)}
                      className="editar-input editar-input-flex"
                      disabled={guardando}
                    />
                    <span style={{ fontSize: "16px", cursor: "help", color: esCandado("precio_unitario") ? "#f0851b" : "#999" }} title={esCandado("precio_unitario") ? "Este campo manda (candado cerrado)" : "Se recalcula automáticamente"}>
                      {esCandado("precio_unitario") ? "🔒" : "🔓"}
                    </span>
                  </div>
                </label>

                <label className="editar-field">
                  <span>Precio Total</span>
                  <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formatearInput(precios.precio_total)}
                      onChange={(e) => handleChangeNumero("precio_total", e)}
                      className="editar-input editar-input-flex"
                      disabled={guardando}
                    />
                    <span style={{ fontSize: "16px", cursor: "help", color: esCandado("precio_total") ? "#f0851b" : "#999" }} title={esCandado("precio_total") ? "Este campo manda (candado cerrado)" : "Se recalcula automáticamente"}>
                      {esCandado("precio_total") ? "🔒" : "🔓"}
                    </span>
                  </div>
                </label>
              </div>

              <hr style={{ margin: "8px 0", borderColor: "#eee" }} />

              <div className="editar-grid">
                <label className="editar-field">
                  <span style={{ color: "#666" }}>Proveedor (solo lectura)</span>
                  <span className="editar-input editar-input-ro" style={{ fontWeight: 500 }}>
                    {datos.proveedor ?? "—"}
                  </span>
                </label>

                <label className="editar-field">
                  <span style={{ color: "#666" }}>Ganancia Unitaria</span>
                  <span className="editar-input editar-input-ro" style={{ fontWeight: 600, color: "#1a9e4a" }}>
                    {precios.precio_unitario != null && precios.costo_unitario != null
                      ? formatearMoneda(precios.precio_unitario - precios.costo_unitario)
                      : "—"}
                  </span>
                </label>

                <label className="editar-field">
                  <span style={{ color: "#666" }}>Ganancia Total</span>
                  <span className="editar-input editar-input-ro" style={{ fontWeight: 600, color: "#1a9e4a" }}>
                    {precios.precio_unitario != null && precios.costo_unitario != null && precios.cantidad != null
                      ? formatearMoneda((precios.precio_unitario - precios.costo_unitario) * precios.cantidad)
                      : "—"}
                  </span>
                </label>
              </div>

              {error && <div style={{ color: "#dc2626", fontSize: "13px" }}>{error}</div>}

              <div className="editar-actions">
                <button
                  type="button"
                  className="prod-foto-btn"
                  onClick={() => { setConfirmando(false); setError(""); }}
                  disabled={guardando}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="prod-foto-btn"
                  style={{ background: "#f0851b", color: "white", border: "none" }}
                  disabled={guardando || !!esValido()}
                >
                  {guardando ? "…" : "Guardar"}
                </button>
              </div>
            </div>
            </form>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="prod-foto-del-btn"
          onClick={() => setConfirmando(true)}
          title="Editar producto"
          disabled={guardando}
        >
          Editar
        </button>
      )}
      {error && !confirmando && <div className="prod-foto-error" style={{ marginTop: "8px", color: "#dc2626", fontSize: "12px" }}>{error}</div>}
    </div>
  );
}