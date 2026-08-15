"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";

type Mensaje = { role: "user" | "assistant"; content: string; imagen?: string };
type PendingStep = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  titulo: string;
  detalle: string[];
};
type PendingAction = { label: string; steps: PendingStep[] };

export default function ChatPage() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [input, setInput] = useState("");
  const [cargando, setCargando] = useState(false);
  const [accion, setAccion] = useState<PendingAction | null>(null);
  const [escuchando, setEscuchando] = useState(false);
  const [imagenAdjunta, setImagenAdjunta] = useState<string | null>(null);
  const [placeholderActivo, setPlaceholderActivo] = useState("");
  const [intencionSeleccionada, setIntencionSeleccionada] = useState("");
  const recognitionRef = useRef<any>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const camaraRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const enviandoAccionRef = useRef(false);
  const enviarRef = useRef<typeof enviar | null>(null);
  const cargandoRef = useRef(false);
  const stopManualRef = useRef(false);
  const textoFinalRef = useRef("");

  useEffect(() => {
    enviarRef.current = enviar;
  });
  useEffect(() => {
    cargandoRef.current = cargando;
  }, [cargando]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes, accion]);

  useEffect(() => {
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "es-PE";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e: any) => {
      let texto = "";
      let final = "";
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i] && e.results[i][0]) {
          texto += e.results[i][0].transcript;
          if (e.results[i].isFinal) final += e.results[i][0].transcript;
        }
      }
      textoFinalRef.current = final;
      setInput(texto);
    };
    rec.onend = () => {
      setEscuchando(false);
      const t = textoFinalRef.current.trim();
      textoFinalRef.current = "";
      const manual = stopManualRef.current;
      stopManualRef.current = false;
      // Envío automático al terminar de hablar (a menos que el usuario haya
      // tocado el micrófono para detenerlo a propósito).
      if (t && !manual && !cargandoRef.current) {
        enviarRef.current?.(t);
      }
    };
    rec.onerror = () => setEscuchando(false);
    recognitionRef.current = rec;
  }, []);

  function toggleVoz() {
    const rec = recognitionRef.current;
    if (!rec) {
      setMensajes((m) => [
        ...m,
        {
          role: "assistant",
          content:
            "🎤 Tu navegador no permite el dictado en esta página. Si estás en el celular, usa el micrófono del teclado (Gboard) para hablar en lugar de escribir.",
        },
      ]);
      return;
    }
    if (escuchando) {
      stopManualRef.current = true;
      rec.stop();
      setEscuchando(false);
    } else {
      stopManualRef.current = false;
      setInput("");
      try {
        rec.start();
        setEscuchando(true);
      } catch {
        setEscuchando(false);
      }
    }
  }

  function preguntaPredefinida(tipo: "agregar" | "actualizar" | "consultar" | "buscar") {
    if (cargando) return;
    const placeholder: Record<string, string> = {
      agregar: "Ej: Max Pro, tornillos, 20 unidades, costo total 25, venta 3",
      actualizar: "Ej: tornillo, nuevo precio de venta 5, stock 30",
      consultar: "Ej: precio del taladro Bosch",
      buscar: "Ej: proveedor Max Pro",
    };
    const confirmacion: Record<string, string> = {
      agregar: "¿Qué nuevo producto deseas agregar?",
      actualizar: "¿Qué deseas actualizar?",
      consultar: "¿Qué deseas consultar?",
      buscar: "¿Qué proveedor deseas buscar?",
    };
    setIntencionSeleccionada(tipo);
    setPlaceholderActivo(placeholder[tipo]);
    setMensajes((m) => [...m, { role: "assistant", content: confirmacion[tipo] }]);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function archivoAImagen(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const MAX = 1280;
          let width = img.width;
          let height = img.height;
          if (width > MAX || height > MAX) {
            if (width >= height) {
              height = Math.round((height * MAX) / width);
              width = MAX;
            } else {
              width = Math.round((width * MAX) / height);
              height = MAX;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("No se pudo procesar la imagen"));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        };
        img.onerror = () => reject(new Error("Imagen no válida"));
        img.src = reader.result as string;
      };
      reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
      reader.readAsDataURL(file);
    });
  }

  async function elegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await archivoAImagen(file);
      setImagenAdjunta(dataUrl);
    } catch (err) {
      setMensajes((m) => [
        ...m,
        {
          role: "assistant",
          content: `⚠️ ${err instanceof Error ? err.message : "No se pudo leer la imagen"}`,
        },
      ]);
    } finally {
      if (archivoRef.current) archivoRef.current.value = "";
    }
  }

  function renderContenido(texto: string) {
    const partes = texto.split(/📷\s*\[foto\]\((https?:\/\/[^)\s]+)\)/g);
    return partes.map((parte, i) =>
      i % 2 === 1 ? (
        <img key={i} src={parte} alt="Producto" className="chat-img" />
      ) : (
        <span key={i}>{parte}</span>
      )
    );
  }

  async function enviar(mensaje: string, imagen?: string, intencion?: string) {
    setCargando(true);
    setAccion(null);
    const nuevoHistorial: Mensaje[] = [...mensajes, { role: "user", content: mensaje, imagen }];
    setMensajes(nuevoHistorial);
    setInput("");
    setPlaceholderActivo("");
    setIntencionSeleccionada("");
    setImagenAdjunta(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nuevoHistorial, imagen, intencion }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Error de conexión");
      }

      const data = await res.json();

      if (data.pendingAction) {
        setAccion(data.pendingAction);
        setMensajes((m) => [...m, { role: "assistant", content: data.reply }]);
      } else {
        setMensajes((m) => [...m, { role: "assistant", content: data.reply }]);
      }
    } catch (e) {
      const esTimeout =
        e instanceof DOMException && e.name === "AbortError";
      const mensaje =
        e instanceof TypeError && /fetch/i.test(e.message)
          ? "⚠️ Hubo un problema de conexión con el servidor. Intenta enviar tu mensaje de nuevo."
          : e instanceof Error
            ? e.message
            : "Algo salió mal";
      setMensajes((m) => [
        ...m,
        {
          role: "assistant",
          content: esTimeout
            ? "⏳ La IA tardó demasiado (límite gratuito). Espera un momento y vuelve a enviar."
            : `⚠️ ${mensaje}`,
        },
      ]);
    } finally {
      clearTimeout(timeoutId);
      setCargando(false);
    }
  }

  async function confirmar(confirmar: boolean) {
    if (!accion || enviandoAccionRef.current) return;
    enviandoAccionRef.current = true;
    setCargando(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: accion, confirm: confirmar }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("Error al procesar la acción");
      const data = await res.json();
      const msg = confirmar
        ? data.result.ok
          ? `✅ ${data.result.message}`
          : `⚠️ No se pudo guardar: ${data.result.message}`
        : data.result.message;
      setMensajes((m) => [...m, { role: "assistant", content: msg }]);
    } catch (e) {
      setMensajes((m) => [
        ...m,
        { role: "assistant", content: `⚠️ Error: ${e instanceof Error ? e.message : "Algo salió mal"}` },
      ]);
    } finally {
      clearTimeout(timeoutId);
      enviandoAccionRef.current = false;
      setAccion(null);
      setCargando(false);
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if ((!input.trim() && !imagenAdjunta) || cargando) return;
    enviar(input.trim(), imagenAdjunta ?? undefined, intencionSeleccionada || undefined);
  }

  return (
    <div className="chat-page">
      <div className="chat-box">
        <div className="chat-quick-sticky">
          <div className="chat-quick-actions">
            <button
              type="button"
              className="chat-quick-btn"
              onClick={() => preguntaPredefinida("agregar")}
              disabled={cargando}
              aria-label="Agregar un nuevo producto"
              title="Agregar un nuevo producto"
            >
              <span className="chat-quick-emoji" aria-hidden="true">
                ➕
              </span>
              <span>Nuevo producto</span>
            </button>
            <button
              type="button"
              className="chat-quick-btn"
              onClick={() => preguntaPredefinida("actualizar")}
              disabled={cargando}
              aria-label="Actualizar precio o stock"
              title="Actualizar precio o stock"
            >
              <span className="chat-quick-emoji" aria-hidden="true">
                ✏️
              </span>
              <span>Actualizar</span>
            </button>
            <button
              type="button"
              className="chat-quick-btn"
              onClick={() => preguntaPredefinida("consultar")}
              disabled={cargando}
              aria-label="Consultar un producto"
              title="Consultar un producto"
            >
              <span className="chat-quick-emoji" aria-hidden="true">
                🔍
              </span>
              <span>Consultar</span>
            </button>
            <button
              type="button"
              className="chat-quick-btn"
              onClick={() => preguntaPredefinida("buscar")}
              disabled={cargando}
              aria-label="Buscar un proveedor"
              title="Buscar un proveedor"
            >
              <span className="chat-quick-emoji" aria-hidden="true">
                🏪
              </span>
              <span>Proveedor</span>
            </button>
          </div>
        </div>

        {mensajes.length === 0 && (
          <div className="chat-empty">
            <p>Usá los botones de arriba o escribí tu mensaje.</p>
          </div>
        )}

        {mensajes.map((m, i) => (
          <div key={i} className={`chat-msg chat-${m.role}`}>
            {m.imagen && <img src={m.imagen} alt="Adjunto" className="chat-img" />}
            {renderContenido(m.content)}
          </div>
        ))}

        {accion && (
          <div className="chat-confirm">
            <p className="chat-confirm-heading">La IA propone lo siguiente. ¿Confirmas?</p>
            <div className="chat-confirm-list">
              {accion.steps.map((s, i) => (
                <div key={i} className="chat-confirm-item">
                  <div className="chat-confirm-item-title">{s.titulo}</div>
                  {s.detalle.length > 0 && (
                    <ul className="chat-confirm-item-detail">
                      {s.detalle.map((d, j) => (
                        <li key={j}>{d}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            <div className="chat-confirm-buttons">
              <button type="button" onClick={() => confirmar(true)} disabled={cargando}>
                ✓ Confirmar
              </button>
              <button type="button" onClick={() => confirmar(false)} disabled={cargando}>
                ✗ Cancelar
              </button>
            </div>
          </div>
        )}

        {cargando && !accion && (
          <div className="chat-msg chat-assistant chat-loading">La IA está pensando...</div>
        )}
        <div ref={bottomRef} />
      </div>

      {imagenAdjunta && (
        <div className="chat-attach-preview">
          <img src={imagenAdjunta} alt="Imagen adjunta" className="chat-attach-preview-img" />
          <span>Imagen lista. Pulsa Enviar para que la IA la lea.</span>
          <button
            type="button"
            className="chat-attach-preview-del"
            onClick={() => setImagenAdjunta(null)}
            disabled={cargando}
            title="Quitar imagen"
          >
            ✕
          </button>
        </div>
      )}

      <form className="chat-form" onSubmit={handleSubmit}>
        <div className="chat-tools">
        <button
          type="button"
          className="chat-attach"
          onClick={() => archivoRef.current?.click()}
          disabled={cargando}
          aria-label="Adjuntar foto o boleta"
          title="Adjuntar foto o boleta"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input
          ref={archivoRef}
          type="file"
          accept="image/*"
          className="prod-foto-input"
          onChange={elegirArchivo}
        />
        <button
          type="button"
          className="chat-attach"
          onClick={() => camaraRef.current?.click()}
          disabled={cargando}
          aria-label="Tomar foto con la cámara"
          title="Tomar foto con la cámara"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
            <circle cx="12" cy="13" r="3" />
          </svg>
        </button>
        <input
          ref={camaraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="prod-foto-input"
          onChange={elegirArchivo}
        />
        <button
          type="button"
          className={`chat-mic ${escuchando ? "chat-mic-on" : ""}`}
          onClick={toggleVoz}
          disabled={cargando}
          aria-label="Dictado por voz"
          title="Hablar en lugar de escribir"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
            <path d="M17 11a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
          </svg>
        </button>
        </div>
        <div className="chat-input-row">
        <input
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            escuchando
              ? "Escuchando... habla ahora"
              : placeholderActivo || "Escribe tu mensaje..."
          }
          disabled={cargando}
        />
        <button className="chat-send" type="submit" disabled={cargando || (!input.trim() && !imagenAdjunta)}>
          Enviar
        </button>
        </div>
      </form>
    </div>
  );
}
