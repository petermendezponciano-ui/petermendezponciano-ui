// Capa de intención / emparejamiento puro para la IA de Ferretería Méndez.
// Centraliza aquí toda la lógica de inferencia de intención y de similitud de textos
// para que haya un único lugar que mantener y probar, evitando que "arreglar una cosa rompa otra".

export type TipoIntencion = "agregar" | "actualizar" | "consultar";

export type Intencion = {
  tipo: TipoIntencion;
  mencionaPrecio: boolean;
};

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Palabras que claramente indican que el usuario QUIERE AGREGAR algo nuevo.
const PALABRAS_AGREGAR = [
  "agregar", "agregue", "agrego", "agreguen", "agregamos", "agrega", "agregas",
  "anadir", "anade", "añadir", "añade", "añadi", "añado", "añades",
  "registrar", "registra", "registro", "registró",
  "nuevo", "nueva", "nuevos", "nuevas",
  "compré", "compre", "compra", "compras", "comprar", "comprar", "compran",
  "otro", "otra", "otros", "otras",
  "nuevo producto", "nueva compra", "otro producto", "producto nuevo",
];
const RX_AGREGAR = new RegExp(PALABRAS_AGREGAR.map((w) => "(?:" + escapeRegExp(w) + ")").join("|"), "i");

// Palabras que indican que el usuario QUIERE CAMBIAR algo existente.
// NOTA: frases como "actualizar las unidades", "cambiar el stock" ya coinciden
// por los verbos (actualizar/cambia/etc.). No añadimos "unidades/stock/cantidad"
// sueltos para evitar clasificar como actualizar un mensaje de agregar que
// menciona cantidades ("quiero agregar 12 unidades").
const RX_ACTUALIZAR =
  /actualiza|actualizar|cambia|cambiar|modifica|modificar|sube el|subir el|baja el|bajar el|aumenta el|aumentar el|actualiza el stock|actualiza el precio|sube el precio|baja el precio|actualiza las unidades|actualizar las unidades|modifica el stock|modificar las unidades/i;

const RX_PRECIO = /\bprecio|costo|venta|soles|s\/|\$|ganancia|stock/i;

// Indicadores de que el usuario está consultando (no registrando/cambiando).
const RX_CONSULTA =
  /\b(cuánto cuesta|cuanto cuesta|precio|ganancia|stock|hay|cómo se llama|compré|costo|cuál es|que hay|existe|existe)\b/;

export function detectarIntencion(texto: string): Intencion {
  const t = texto || "";

  // Tag explícito de intención (usado por los botones predefinidos del chat).
  // Formato: "INTENCIÓN: AGREGAR_PRODUCTO. <texto restante>"
  const tagMatch = /^INTENCIÓN:\s*([A-Z_]+)/i.exec(t);
  if (tagMatch) {
    const tag = tagMatch[1].toUpperCase();
    if (tag === "AGREGAR_PRODUCTO") return { tipo: "agregar", mencionaPrecio: RX_PRECIO.test(t) };
    if (tag === "ACTUALIZAR_PRODUCTO") return { tipo: "actualizar", mencionaPrecio: RX_PRECIO.test(t) };
    if (tag === "CONSULTAR_PRODUCTO") return { tipo: "consultar", mencionaPrecio: RX_PRECIO.test(t) };
    if (tag === "BUSCAR_PROVEEDOR") return { tipo: "consultar", mencionaPrecio: RX_PRECIO.test(t) };
  }

  const agregar = RX_AGREGAR.test(t);
  const actualizar = RX_ACTUALIZAR.test(t);
  const mencionaPrecio = RX_PRECIO.test(t);

  // Prioridad: la opción elegida (tag) manda. Si no hay tag, un verbo de cambio
  // (actualizar/cambiar/subir...) gana sobre "agregar" cuando ambos aparecen, para
  // no malinterpretar mensajes como "quiero agregar proveedor" dentro de un flujo de
  // actualizar. Solo si hay palabras claras de agregar se elige agregar.
  let tipo: TipoIntencion;
  if (actualizar) tipo = "actualizar";
  else if (agregar) tipo = "agregar";
  else tipo = "consultar";

  return { tipo, mencionaPrecio };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Reutilizable públicamente: utilidad de normalización para debugging/tests.
export { normalizar };
