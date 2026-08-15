"use client";

import { useRef, useState } from "react";

export default function ProductoFoto({
  productoId,
  fotoUrl,
  nombre,
}: {
  productoId: string;
  fotoUrl: string | null;
  nombre: string;
}) {
  const [foto, setFoto] = useState<string | null>(fotoUrl);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState("");
  const [verFoto, setVerFoto] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function subir(file: File) {
    if (!file) return;
    setSubiendo(true);
    setError("");
    const fd = new FormData();
    fd.append("producto_id", productoId);
    fd.append("foto", file);
    try {
      const res = await fetch("/api/subir-foto", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo subir la foto");
      setFoto(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al subir la foto");
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function quitar() {
    setSubiendo(true);
    setError("");
    const fd = new FormData();
    fd.append("producto_id", productoId);
    fd.append("accion", "quitar");
    try {
      const res = await fetch("/api/subir-foto", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo quitar la foto");
      setFoto(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al quitar la foto");
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div className="prod-foto">
      <div className={`prod-foto-thumb ${foto ? "zoomable" : ""}`}>
        {foto ? (
          <img
            src={foto}
            alt={nombre}
            className="prod-foto-img"
            onClick={() => setVerFoto(true)}
          />
        ) : (
          <span className="prod-foto-empty">📷</span>
        )}
        {foto && (
          <button
            type="button"
            className="prod-foto-del"
            onClick={quitar}
            disabled={subiendo}
            title="Quitar foto"
          >
            ✕
          </button>
        )}
      </div>
      <button
        type="button"
        className="prod-foto-btn"
        disabled={subiendo}
        onClick={() => inputRef.current?.click()}
        title="Tomar o subir foto"
      >
        {subiendo ? "…" : foto ? "Cambiar" : "Foto"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="prod-foto-input"
        onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])}
      />
      {error && <div className="prod-foto-error">{error}</div>}
      {verFoto && (
        <div className="prod-foto-zoom" onClick={() => setVerFoto(false)}>
          <img src={foto ?? ""} alt={nombre} />
        </div>
      )}
    </div>
  );
}
