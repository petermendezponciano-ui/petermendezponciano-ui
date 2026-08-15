import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { runAgent, resolverAccionPendiente, runAgentBackup, esErrorDeCuota, hayRespaldo, leerImagen } from "@/lib/ai";
import type { PendingAction } from "@/lib/ai";

const COOKIE_ID = "integ_ia_id";
const COOKIE_MODO = "integ_ia_modo";

// "La opción elegida es la función madre": el tag explícito al inicio de la
// envoltura hace que detectarIntencion devuelva SIEMPRE el modo elegido, y la
// cookie integ_ia_modo lo mantiene sticky entre turnos de aclaración hasta que
// el flujo termina (respuesta final o confirmar/cancelar).
const TAGS_INTENCION: Record<string, string> = {
  agregar: "INTENCIÓN: AGREGAR_PRODUCTO.",
  actualizar: "INTENCIÓN: ACTUALIZAR_PRODUCTO.",
  consultar: "INTENCIÓN: CONSULTAR_PRODUCTO.",
  buscar: "INTENCIÓN: BUSCAR_PROVEEDOR.",
};

type ChatMessage = { role: "user" | "assistant"; content: string };

// Prompt envolvente por intención (Opción A2): da contexto explícito a la IA sin
// alterar el texto que el usuario ve en el historial. "{texto}" se reemplaza por el
// mensaje crudo del usuario. Mantiene el texto incrustado para que los guards de
// similitud (producto/proveedor), de precio ambiguo y de completitud sigan operando.
const PROMPTS_INTENCION: Record<string, string> = {
  agregar:
    `El usuario quiere AGREGAR un nuevo producto. Mensaje del usuario: "{texto}".\n` +
    `1. Reutiliza el proveedor si ya existe (por similitud de nombre); si no, créalo con agregar_proveedor.\n` +
    `2. Si el producto ya existe, NO lo dupliques: agrega un modelo nuevo con agregar_modelo o actualízalo.\n` +
    `3. Reconoce en el mensaje: nombre del producto, proveedor, cantidad/unidades, precio de costo (unitario o total) y precio de venta (unitario o total).\n` +
    `4. Si un precio es ambiguo (no dice si es unitario o total), PREGÚNTALO antes de guardar; no lo adivines.\n` +
    `5. Si falta el precio de venta, indícalo o pregúntalo; no lo inventes.\n` +
    `6. En UN SOLO mensaje llama TODAS las herramientas de escritura necesarias (agregar_proveedor, agregar_producto, agregar_modelo).`,
  actualizar:
    `El usuario quiere ACTUALIZAR/MODIFICAR un producto existente. Mensaje del usuario: "{texto}".\n` +
    `1. Busca el producto existente por similitud de nombre con buscar_productos; si no lo encuentras, pregunta.\n` +
    `2. Usa actualizar_producto o actualizar_modelo. NUNCA uses agregar_* para algo que ya existe.\n` +
    `3. Si un precio es ambiguo (unitario/total), PREGÚNTALO antes de guardar; no lo adivines.\n` +
    `4. Identifica qué cambia: precio de venta, precio de costo o cantidad/stock.\n` +
    `5. En UN SOLO mensaje llama TODAS las herramientas de escritura necesarias.`,
  consultar:
    `El usuario quiere CONSULTAR información de un producto. Mensaje del usuario: "{texto}".\n` +
    `Usa las herramientas de lectura (buscar_productos) para obtener datos reales; NO inventes datos.`,
  buscar:
    `El usuario quiere BUSCAR un proveedor. Mensaje del usuario: "{texto}".\n` +
    `Usa la herramienta buscar_proveedores para obtener datos reales; NO inventes datos.`,
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      messages?: ChatMessage[];
      action?: PendingAction;
      confirm?: boolean;
      imagen?: string;
      intencion?: string;
    };

    const cookieStore = await cookies();
    let prevId = cookieStore.get(COOKIE_ID)?.value ?? null;

    // Modo 1: enviar un mensaje nuevo al agente
    if (body.messages && body.messages.length > 0) {
      // Limpieza de estado al cambiar de acción: si el usuario pulsa un botón de
      // acción distinta a la del flujo actual, se borra el hilo de la IA y el modo
      // sticky para que NO se filtren datos de un flujo anterior no relacionado.
      const modoAnterior = cookieStore.get(COOKIE_MODO)?.value ?? null;
      if (
        body.intencion &&
        PROMPTS_INTENCION[body.intencion] &&
        modoAnterior !== body.intencion
      ) {
        cookieStore.delete(COOKIE_ID);
        cookieStore.delete(COOKIE_MODO);
        prevId = null;
        console.error(`[intencion] cambio de acción a "${body.intencion}": conversación reiniciada`);
      }
      const ultimoUsuario = [...body.messages]
        .reverse()
        .find((m) => m.role === "user");
      if (!ultimoUsuario) {
        return NextResponse.json({ error: "Mensaje inválido" }, { status: 400 });
      }

      let textoUsuario = ultimoUsuario.content;
      let crudo: string | null = null;
      let modo: string | null = null;

      if (body.imagen) {
        if (!body.imagen.startsWith("data:image/")) {
          return NextResponse.json({ error: "Imagen inválida" }, { status: 400 });
        }
        console.error(`[foto] imagen recibida, tamaño base64: ${Math.round(body.imagen.length / 1024)} KB`);
        const extraido = await leerImagen(body.imagen);
        console.error(`[foto] extraido (${extraido.trim().length} chars): ${extraido.trim().slice(0, 1500)}`);
        const conDatos =
          extraido.trim().length >= 25 &&
          /ítem|item|producto|cantidad|costo|precio|total|boleta|factura|ferreter/i.test(extraido);
        const sinDatos =
          !extraido.trim() ||
          (!conDatos &&
            (/no se ve|no encontr|no pude|sin datos|borros/i.test(extraido) ||
              extraido.trim().length < 60));
        console.error(`[foto] conDatos=${conDatos} sinDatos=${sinDatos}`);
        if (sinDatos) {
          return NextResponse.json({
            reply:
              "📷 No pude leer bien la boleta o la foto salió borrosa. Tómalo con la cámara más cerca y con buena luz, y vuelve a subirlo.",
            pendingAction: null,
            lastId: null,
          });
        }
        textoUsuario =
          `El usuario adjuntó la foto de una boleta/nota de compra y quiere registrar esa compra. ` +
          (ultimoUsuario.content ? `Comentario del usuario: "${ultimoUsuario.content}". ` : "") +
          `Datos leídos de la imagen (no inventes otros):\n${extraido}\n\n` +
          `ORDEN A SEGUIR:\n` +
          `1. Verifica con buscar_productos y buscar_proveedores si los productos y el proveedor ya existen.\n` +
          `2. En UN SOLO mensaje, llama TODAS las herramientas de escritura necesarias para registrar TODA la compra: agregar_proveedor si el proveedor no existe, agregar_producto por cada producto nuevo, y agregar_modelo por cada producto con su cantidad (stock) y precio_costo_total (el monto de la línea de la boleta). No dejes nada para un siguiente mensaje.\n` +
          `3. El monto de cada línea es el COSTO TOTAL (precio_costo_total) y la cantidad es el stock; el sistema calculará el costo unitario automáticamente.\n` +
          `4. NO preguntes ni pidas confirmación en tu respuesta de texto: el sistema mostrará automáticamente una casilla de Confirmar/Cancelar con todos los cambios propuestos. Solo pregunta si te falta un dato imprescindible (como el nombre del proveedor) o si la boleta no trae ningún dato útil.`;
      }

      // Opción A2 + modo madre: envolver el texto del usuario en un prompt
      // específico según la intención elegida. El modo es sticky: si este turno no
      // trae botón, se reutiliza la cookie integ_ia_modo (para que las aclaraciones
      // sigan dentro del mismo modo). Solo cuando NO hay imagen (la boleta ya
      // construye su propio prompt completo).
      if (!body.imagen) {
        crudo = ultimoUsuario.content;
        modo =
          body.intencion && PROMPTS_INTENCION[body.intencion] ? body.intencion : null;
        if (!modo) {
          const c = cookieStore.get(COOKIE_MODO)?.value;
          if (c && PROMPTS_INTENCION[c]) modo = c;
        }
        if (modo) {
          textoUsuario =
            `${TAGS_INTENCION[modo]} ${PROMPTS_INTENCION[modo].replace("{texto}", crudo)}`;
          cookieStore.set(COOKIE_MODO, modo, {
            httpOnly: true,
            sameSite: "lax",
            path: "/",
          });
          console.error(`[intencion] envoltura "${modo}" sobre: "${crudo.slice(0, 120)}"`);
        }
      }

      let result;
      try {
        result = await runAgent(textoUsuario, prevId, crudo, modo ?? undefined);
      } catch (e) {
        if (esErrorDeCuota(e) && hayRespaldo()) {
          result = await runAgentBackup(textoUsuario, body.messages, crudo, modo ?? undefined);
        } else if (prevId) {
          cookieStore.delete(COOKIE_ID);
          result = await runAgent(textoUsuario, null, crudo, modo ?? undefined);
        } else {
          throw e;
        }
      }

      if (result.lastId) {
        cookieStore.set(COOKIE_ID, result.lastId, {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
        });
      }
      // Ciclo de vida del estado: se mantiene mientras el flujo sigue (hay acción
      // pendiente por confirmar, o la respuesta es una pregunta de aclaración) y se
      // borra TODO cuando la respuesta es final (sin "?" ni "¿"): así el siguiente
      // mensaje inicia una conversación limpia, sin datos de flujos anteriores.
      if (modo || prevId || result.lastId) {
        const esFinal = !result.pendingAction && !/[?¿]/.test(result.reply);
        if (esFinal) {
          cookieStore.delete(COOKIE_ID);
          cookieStore.delete(COOKIE_MODO);
        } else if (modo) {
          cookieStore.set(COOKIE_MODO, modo, {
            httpOnly: true,
            sameSite: "lax",
            path: "/",
          });
        }
      }
      console.error(`[chat] respuesta (${result.reply.length} chars): ${result.reply.slice(0, 300)}`);
      return NextResponse.json(result);
    }

    // Modo 2: confirmar o cancelar una acción pendiente
    if (body.action && typeof body.confirm === "boolean") {
      cookieStore.delete(COOKIE_MODO);
      const result = await resolverAccionPendiente(supabase, body.action, body.confirm, prevId);
      if (result.lastId) {
        cookieStore.set(COOKIE_ID, result.lastId, {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
        });
      }
      return NextResponse.json({ result: { ok: result.ok, message: result.message } });
    }

    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  } catch (e) {
    console.error("Error en /api/chat:", e);
    if (esErrorDeCuota(e)) {
      return NextResponse.json({
        reply: e instanceof Error ? e.message : "La IA está en su límite de uso diario. Intenta más tarde.",
        pendingAction: null,
        lastId: null,
      });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error interno" },
      { status: 500 }
    );
  }
}