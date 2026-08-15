import { GoogleGenAI } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { detectarIntencion } from "@/lib/intencion";

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });

export class QuotaError extends Error {}

const backupApiKey = process.env.BACKUP_API_KEY;
const backupBaseUrl = (process.env.BACKUP_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
const backupModel = process.env.BACKUP_MODEL ?? "gpt-4o-mini";
const visionModel = process.env.VISION_MODEL ?? "qwen/qwen3.6-27b";

type Proveedor = { apiKey: string; baseUrl: string; model: string };

const proveedores: Proveedor[] = (() => {
  const lista: Proveedor[] = [];
  if (backupApiKey) {
    lista.push({ apiKey: backupApiKey, baseUrl: backupBaseUrl, model: backupModel });
  }
  const apiKey2 = process.env.BACKUP2_API_KEY ?? backupApiKey;
  if (apiKey2 && process.env.BACKUP2_MODEL) {
    lista.push({
      apiKey: apiKey2,
      baseUrl: (process.env.BACKUP2_BASE_URL ?? backupBaseUrl).replace(/\/+$/, ""),
      model: process.env.BACKUP2_MODEL,
    });
  }
  return lista;
})();

let proveedorActivo = 0;

export function hayRespaldo(): boolean {
  return proveedores.length > 0;
}

export function esErrorDeCuota(err: unknown): boolean {
  return err instanceof QuotaError;
}

export const GEMINI_MODEL = "gemini-3.6-flash";

export const SYSTEM_PROMPT = `Eres el asistente de base de datos de "Ferretería Méndez", un negocio familiar que vende herramientas a ferreterías.

Tu trabajo:
1. Ayudar al dueño a CONSULTAR productos, precios, stock y proveedores.
2. Ayudar a ACTUALIZAR la base de datos (productos, modelos, precios, stock, proveedores).

REGLAS IMPORTANTES:
- Cuando el usuario pida un CAMBIO (agregar, actualizar, modificar precios/stock), usa la herramienta correspondiente. El sistema pedirá confirmación antes de guardar.
- NUNCA preguntes en tu respuesta de texto "¿confirmas?", "¿deseas registrar?" ni pidas confirmación: para registrar o modificar, llama directamente las herramientas de escritura y el sistema mostrará automáticamente la casilla de Confirmar/Cancelar con todos los cambios propuestos.
 - LLAMA TODAS LAS HERRAMIENTAS EN UN SOLO MENSAJE: cuando el registro involucre un proveedor, un producto y su modelo (con cantidad y precios), llama agregar_proveedor, agregar_producto y agregar_modelo TODAS en la misma respuesta, en ese orden. No llames solo una parte ni las separes en mensajes distintos: el sistema espera recibir todas las llamadas juntas para mostrar una sola confirmación.

 - EN LAS PROPOSICIONES DE AGREGAR/REGISTRAR nunca incluyas calcular_ganancia: esa herramienta es solo para consultas de ganancia, no para registrar. La propuesta de un nuevo producto siempre debe incluir (si los datos están disponibles o fueron aclarados) proveedor+contacto, producto, nombre del modelo, cantidad y precio de costo (unitario o total) y precio de venta (unitario o total); si falta un precio, primero acláralo con preguntas, no lo adivines.
- RECONOCIMIENTO DE NOMBRES: cuando el usuario mencione un proveedor o producto que ya está en la base de datos (aunque el nombre tenga errores de escritura o no sea idéntico), NO lo crees de nuevo: el sistema reconoce los nombres parecidos y reutiliza el registro existente automáticamente. Si el sistema te devuelve una sugerencia del tipo "¿Te refieres a...?", pregunta al usuario cuál es antes de continuar.
- DIFERENCIA ENTRE AGREGAR Y ACTUALIZAR (MUY IMPORTANTE):
  - Usa las herramientas de AGREGAR (agregar_proveedor, agregar_producto, agregar_modelo) cuando el usuario está REGISTRANDO algo NUEVO: dice "agregar", "registrar", "compré", "comprar", "quiero otro producto", "nuevo producto", o menciona un producto con cantidad y precio que no existe aún.
  - Usa las herramientas de ACTUALIZAR (actualizar_producto, actualizar_modelo) SOLO cuando el usuario pide CAMBIAR datos que ya existen: "actualizar", "cambiar", "modificar", "actualiza el precio", "sube el precio", "baja el precio", "actualiza el stock".
  - Cuando el usuario dice que quiere AGREGAR o REGISTRAR un producto, NUNCA uses actualizar_producto ni actualizar_modelo, aunque el nombre se parezca a uno existente: crea el producto nuevo con agregar_producto y su modelo con agregar_modelo.
  - REGLA INVERSA (MUY IMPORTANTE): cuando el usuario pida CAMBIAR/MODIFICAR/ACTUALIZAR unidades, stock, cantidad, precio o costo de un producto, NUNCA uses agregar_producto ni agregar_modelo si el producto YA EXISTE en la base de datos: usa actualizar_modelo (y, si el nombre del modelo no coincide, busca primero con buscar_productos). Si el producto NO existe, entonces sí crea uno nuevo con agregar_*.
- Cuando el usuario haga una CONSULTA, usa las herramientas de lectura para obtener datos reales de la base de datos, NO inventes datos.
- REGLA DE ORO DE PRECIOS: cuando el usuario mencione un precio SIN aclarar si es COSTO UNITARIO, COSTO TOTAL o PRECIO DE VENTA, está PROHIBIDO adivinar. NO llames ninguna herramienta de escritura ni guardes el precio: pregúntale cuál es y espera su respuesta. Ejemplo: si dice "precio 65", responde: "¿El precio de 65 es el costo unitario, el costo total o el precio de venta?".
- CAMPOS DE PRECIO: usa precio_costo_unitario para el costo de CADA unidad, precio_costo_total para el costo TOTAL del lote, precio_venta para el precio de venta de CADA unidad, y precio_venta_total para el precio de venta TOTAL del lote. Cuando el usuario da un TOTAL (costo o venta) de un lote, incluye también la cantidad; el sistema calculará el precio por unidad automáticamente (total ÷ cantidad).
- El campo notas de un proveedor es SOLO para notas sobre el proveedor (crédito, forma de pago, dirección, referencias). NUNCA pongas en notas datos de productos, cantidades ni precios de la compra: deja notas vacío u omítelo si no hay notas reales del proveedor.
- La cantidad y el precio de una compra van SIEMPRE en agregar_modelo (campos cantidad y precio_*). NUNCA pongas la cantidad ni el precio en los campos tamaño, unidad o marca del producto.
- NUNCA inventes ni calcules precios: si el usuario da un precio, úsalo tal cual con el campo correcto; si no da precio, deja los campos de precio vacíos u omítelos.
- CÁLCULOS DE PRECIOS Y GANANCIA (úsalos para responder consultas):
  - Costo total = costo unitario × cantidad.
  - Precio de venta total = precio de venta unitario × cantidad.
  - Ganancia por unidad = precio de venta unitario − costo unitario.
  - Ganancia total = ganancia por unidad × cantidad.
  - Margen % = ganancia por unidad ÷ precio de venta × 100.
- Cuando el usuario pregunte cuánto gana o ganaría con un precio de venta propuesto (ej: "¿cuánto ganaré si lo vendo a 5?"), usa la herramienta calcular_ganancia con ese precio propuesto. Nunca inventes costos ni cantidades: tómalos de la base de datos.
- FORMATO DE RESPUESTA: cuando muestres información de un producto o modelo, preséntala ORDENADA, una línea por dato, con el nombre como encabezado y viñetas, sin párrafos largos. Ejemplo:
  Guantes Rojos (Rojo)
  • Cantidad: 14 unidades
  • Costo unitario: S/ 3.14
  • Costo total: S/ 44.00
  • Precio de venta: S/ 6.00
  • Ganancia por unidad: S/ 2.86
  • Ganancia total: S/ 40.04
  • Margen: 47.7%
  • Proveedor: El Ferretero (teléfono/contacto: 999 888 777)
  Si varios productos, sepáralos con línea en blanco. Si algo no se conoce, pon "—".
  Si el producto tiene foto (campo foto_url no vacío), agrega debajo de su bloque una línea exacta con la URL así: 📷 [foto](<foto_url>). Si no tiene foto, no pongas la línea.
- Al mostrar un producto, si tiene costo y precio de venta, indica también su ganancia por unidad y total.
- Habla siempre en español, de forma breve y clara.
- Los precios se manejan en soles (S/). Usa números con decimales cuando corresponda (ej: 0.50).
- Un producto tiene datos generales (nombre, marca, tamaño, unidad). Los precios y el stock se guardan en sus MODELOS: si el usuario menciona un costo, precio o cantidad, además del producto crea o usa un modelo para guardarlos.
- Si el usuario nombra un proveedor que aún no existe al agregar un producto, agrégalo también.
- Si el usuario nombra un producto que no existe en una consulta, dilo y sugiere agregarlo.
- BOLETAS Y FOTOS: cuando el usuario adjunte la foto de una boleta o nota de compra, el mensaje traerá los datos ya leídos de la imagen. NO vuelvas a pedirle los datos del producto ni la lista de campos: usa esos datos con tus herramientas para buscar y proponer registrar (crea productos/modelos/proveedor que falten). Muestra primero, en pocas líneas, lo que leíste de la boleta.
- Los modelos son variantes de un producto, cada uno con su propio precio y stock.`;

type ToolDef = {
  name: string;
  description: string;
  parameters: object;
  write?: boolean;
};

const TOOLS: ToolDef[] = [
  {
    name: "buscar_productos",
    description:
      "Busca productos en la base de datos por nombre o marca. Devuelve cada producto con sus modelos, precios y stock. Usar para consultas como 'que productos hay', 'precio del taladro'.",
    parameters: {
      type: "object",
      properties: {
        busqueda: {
          type: "string",
          description: "Texto a buscar en el nombre o marca del producto. Vacío para listar todos.",
        },
      },
      required: ["busqueda"],
    },
  },
  {
    name: "buscar_proveedores",
    description:
      "Busca proveedores en la base de datos por nombre. Devuelve nombre, contacto y notas.",
    parameters: {
      type: "object",
      properties: {
        busqueda: {
          type: "string",
          description: "Texto a buscar en el nombre del proveedor. Vacío para listar todos.",
        },
      },
      required: ["busqueda"],
    },
  },
  {
    name: "consultar_resumen",
    description:
      "Devuelve un resumen de la base de datos: cantidad de productos, modelos y proveedores.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "calcular_ganancia",
    description:
      "Calcula la ganancia (por unidad y total) de uno o todos los productos, opcionalmente simulando un precio de venta propuesto (ej: '¿cuánto ganaré si lo vendo a 5?'). También devuelve el margen en porcentaje y los totales de costo y venta.",
    parameters: {
      type: "object",
      properties: {
        producto: {
          type: "string",
          description: "Nombre o parte del nombre del producto. Vacío o 'todos' para calcular con todos los productos.",
        },
        precio_venta_propuesto: {
          type: "number",
          description: "Precio de venta unitario propuesto para simular la ganancia (opcional). Si no se da, usa el precio de venta guardado.",
        },
      },
      required: ["producto"],
    },
  },
  {
    name: "agregar_proveedor",
    description:
      "Agrega un nuevo proveedor a la base de datos. El proveedor es la empresa que vende los productos al negocio. IMPORTANTE: si el proveedor que indica el usuario ya existe en la base de datos (o su nombre es muy parecido), el sistema NO lo duplicará: lo reutilizará automáticamente y enlazará los productos con él.",
    write: true,
    parameters: {
      type: "object",
      properties: {
        nombre: { type: "string", description: "Nombre del proveedor" },
        contacto: { type: "string", description: "Teléfono o red social de contacto (opcional)" },
        notas: {
          type: "string",
          description: "Notas sobre el proveedor en sí: crédito, forma de pago, dirección, referencias. NUNCA pongas datos de productos, cantidades ni precios de la compra (opcional)",
        },
      },
      required: ["nombre"],
    },
  },
  {
    name: "agregar_producto",
    description:
      "AGREGA un producto NUEVO a la base de datos (nombre, marca, tamaño, unidad y opcionalmente proveedor). Úsala cuando el usuario está REGISTRANDO algo nuevo. Llama esta herramienta JUNTO con agregar_modelo en el mismo mensaje: primero el producto y luego su modelo con cantidad, precio de costo y precio de venta. NO la uses para modificar un producto existente (eso es actualizar_producto).",
    write: true,
    parameters: {
      type: "object",
      properties: {
        nombre: { type: "string", description: "Nombre del producto" },
        marca: { type: "string", description: "Marca (opcional)" },
        tamano: {
          type: "string",
          description: "Tamaño o medida física (ej: '3 pulgadas', 'N° 8', '1/2'). NUNCA pongas aquí cantidades, precios ni unidades (opcional)",
        },
        unidad: {
          type: "string",
          description: "Unidad de medida en que se vende: unidad, caja, docena, par, kilo... La CANTIDAD va en agregar_modelo, NO en este campo (opcional, por defecto 'unidad')",
        },
        proveedor: {
          type: "string",
          description:
            "Nombre del proveedor. Si ya existe en la base de datos (aunque el nombre no sea exacto) se enlazará automáticamente con él; si no existe, agrégalo con agregar_proveedor (opcional)",
        },
      },
      required: ["nombre"],
    },
  },
  {
    name: "agregar_modelo",
    description:
      "AGREGA un modelo NUEVO a un producto (con su precio de costo, precio de venta y cantidad/stock). Úsala cuando el usuario está REGISTRANDO una compra o agregando un producto/modelo nuevo, JUNTO con agregar_producto o agregar_proveedor en el mismo mensaje. NO la uses para modificar un modelo que ya existe (eso es actualizar_modelo). IMPORTANTE: si el usuario dio un precio sin especificar si es costo unitario, costo total o precio de venta, NO llames esta herramienta; primero pregúntale cuál es.",
    write: true,
    parameters: {
      type: "object",
      properties: {
        producto: { type: "string", description: "Nombre del producto al que pertenece el modelo" },
        nombre: {
          type: "string",
          description: "Nombre del modelo (ej: 'GSB 13', 'XL Pro'). Opcional: si no hay nombre, se usa el del producto.",
        },
        precio_costo_unitario: {
          type: "number",
          description: "Costo de UNA unidad (opcional). Usar solo si el usuario lo indica como costo por unidad.",
        },
        precio_costo_total: {
          type: "number",
          description: "Costo TOTAL del lote (opcional). Si lo usas, indica también la cantidad: el sistema calculará el costo unitario.",
        },
        precio_venta: {
          type: "number",
          description:
            "Precio al que se venderá UNA unidad (opcional). Usar solo si el usuario lo indica como precio de venta por unidad.",
        },
        precio_venta_total: {
          type: "number",
          description:
            "Precio de venta TOTAL del lote (opcional). Si lo usas, indica también la cantidad: el sistema calculará el precio de venta por unidad.",
        },
        cantidad: { type: "number", description: "Cantidad en stock" },
      },
      required: ["producto"],
    },
  },
  {
    name: "actualizar_modelo",
    description:
      "MODIFICA datos de un modelo que YA EXISTE (cambiar precio de costo, precio de venta o cantidad/stock). Úsala SOLO cuando el usuario pide CAMBIAR/MODIFICAR algo existente (ej: 'actualiza el precio', 'cambia el precio de venta', 'sube/baja el precio'). NO la uses para registrar o agregar un producto/modelo NUEVO (eso es agregar_modelo). IMPORTANTE: si el usuario dio un precio sin especificar si es costo unitario, costo total o precio de venta, NO llames esta herramienta; primero pregúntale cuál es.",
    write: true,
    parameters: {
      type: "object",
      properties: {
        producto: { type: "string", description: "Nombre del producto" },
        modelo: { type: "string", description: "Nombre del modelo a actualizar" },
        precio_costo_unitario: {
          type: "number",
          description: "Nuevo costo de UNA unidad (opcional)",
        },
        precio_costo_total: {
          type: "number",
          description: "Nuevo costo TOTAL del lote (opcional). Si lo usas, indica también la cantidad para calcular el costo unitario.",
        },
        precio_venta: {
          type: "number",
          description:
            "Nuevo precio de venta por unidad (opcional). Usar solo si el usuario lo indica como precio de venta por unidad.",
        },
        precio_venta_total: {
          type: "number",
          description:
            "Nuevo precio de venta TOTAL del lote (opcional). Si lo usas, indica también la cantidad: el sistema calculará el precio de venta por unidad.",
        },
        cantidad: { type: "number", description: "Nueva cantidad en stock (opcional)" },
      },
      required: ["producto", "modelo"],
    },
  },
  {
    name: "actualizar_producto",
    description:
      "MODIFICA datos generales de un producto QUE YA EXISTE (marca, tamaño, unidad o proveedor). Úsala SOLO cuando el usuario pide CAMBIAR/MODIFICAR algo existente. NO la uses para agregar un producto nuevo (eso es agregar_producto). Solo actualiza los campos que se indiquen.",
    write: true,
    parameters: {
      type: "object",
      properties: {
        producto: { type: "string", description: "Nombre del producto a actualizar" },
        marca: { type: "string", description: "Nueva marca (opcional)" },
        tamano: { type: "string", description: "Nuevo tamaño (opcional)" },
        unidad: { type: "string", description: "Nueva unidad de medida (opcional)" },
        proveedor: { type: "string", description: "Nuevo nombre de proveedor (opcional)" },
      },
      required: ["producto"],
    },
  },
];

const TOOL_DECLARATIONS = TOOLS.map((t) => ({
  type: "function" as const,
  name: t.name,
  description: t.description,
  parameters: t.parameters,
}));

type ToolDeclaracion = (typeof TOOL_DECLARATIONS)[number];
const WRITE_NAMES = new Set(TOOLS.filter((t) => t.write).map((t) => t.name));
const READ_NAMES = new Set(TOOLS.filter((t) => !t.write).map((t) => t.name));

// ─── Arquitectura por acción: cada acción (agregar/actualizar/consultar/buscar)
// tiene su propio system prompt, su subconjunto de tools y sus slots obligatorios.
// El modelo NUNCA ve herramientas de otras acciones, para que no mezcle contextos.

const TOOLS_POR_ACCION: Record<string, string[]> = {
  agregar: [
    "buscar_productos",
    "buscar_proveedores",
    "agregar_proveedor",
    "agregar_producto",
    "agregar_modelo",
  ],
  actualizar: [
    "buscar_productos",
    "buscar_proveedores",
    "agregar_proveedor",
    "actualizar_producto",
    "actualizar_modelo",
  ],
  consultar: ["buscar_productos", "buscar_proveedores", "consultar_resumen", "calcular_ganancia"],
  buscar: ["buscar_proveedores", "buscar_productos"],
};

const SYSTEM_PROMPTS_POR_ACCION: Record<string, string> = {
  actualizar: `Estás en modo ACTUALIZAR de "Ferretería Méndez": el usuario quiere MODIFICAR datos de un producto, modelo o proveedor que YA EXISTE en la base de datos.

REGLAS DE ORO:
1. TRABAJA SOLO CON EL MENSAJE ACTUAL del usuario. IGNORA por completo cualquier producto, precio, cantidad o proveedor mencionado en mensajes o flujos ANTERIORES: no los "recuerdes", no los mezcles ni los tomes como referencia.
2. Antes de proponer cualquier cambio, busca el producto real con buscar_productos usando el nombre que dio el usuario; usa SIEMPRE el nombre REAL que devuelve la búsqueda, nunca un nombre inventado o asumido.
3. Usa actualizar_producto para datos generales (marca, tamaño, unidad, proveedor) y actualizar_modelo para precio de venta, precio de costo o cantidad/stock.
4. ESTÁ PROHIBIDO CREAR: nunca uses agregar_producto ni agregar_modelo.
5. Lo único "agregar" permitido es agregar_proveedor, y solo si el proveedor que indica el usuario NO existe aún.
6. Indica SIEMPRE qué campo quieres cambiar y su nuevo valor. Si el usuario no dijo qué cambiar, pregúntale qué desea modificar.
7. Si un precio viene sin aclarar si es costo unitario, costo total o precio de venta, PREGUNTA antes de proponer el cambio; nunca lo adivines.
8. No pidas confirmación en tu texto: el sistema mostrará la casilla Confirmar/Cancelar. Llama todas las herramientas necesarias en un solo mensaje.`,

  agregar: `Estás en modo AGREGAR de "Ferretería Méndez": el usuario quiere REGISTRAR algo nuevo (un producto con su modelo y precios, o una compra completa).

REGLAS:
1. TRABAJA SOLO CON EL MENSAJE ACTUAL (y la boleta adjunta si la hay). Ignora flujos anteriores.
2. Si el producto o proveedor que menciona ya existe (nombre igual o muy parecido), REUTILÍZALO, no lo dupliques: el sistema enlaza automáticamente por similitud.
3. PROVEEDOR vs MARCA: si el usuario escribe el nombre de un proveedor al inicio del mensaje o separado por coma antes del producto (ej: "griferia anita, tornillo 1/2..."), ese nombre va en el campo PROVEEDOR, NUNCA en marca. El campo marca es solo para marcas de fábrica (ej: Stanley, Bosch, Volt).
4. Llama en UN SOLO mensaje todas las herramientas: agregar_proveedor (solo si el proveedor es nuevo), agregar_producto (producto nuevo) y agregar_modelo (con cantidad y precios de costo y venta, unitarios o totales).
5. Si el usuario quiere "agregar" un producto que ya existe, agrega un modelo nuevo con agregar_modelo en vez de duplicar el producto.
6. Si un precio no dice si es costo unitario, costo total o precio de venta, PREGUNTA primero; no lo adivines. Si falta el precio de venta, pregúntalo.
7. No pidas confirmación en tu texto: el sistema mostrará la casilla Confirmar/Cancelar.`,

  consultar: `Estás en modo CONSULTA de "Ferretería Méndez": el usuario solo quiere información de productos, precios, stock o proveedores.

REGLAS:
1. TRABAJA SOLO CON LA PREGUNTA ACTUAL. Ignora por completo los mensajes o flujos anteriores.
2. Usa SIEMPRE herramientas de lectura (buscar_productos, buscar_proveedores, consultar_resumen, calcular_ganancia) para obtener datos reales; NUNCA inventes datos.
3. ESTÁ PROHIBIDO modificar o crear datos: no llames ninguna herramienta de escritura.
4. Si el usuario pide registrar o modificar algo, dile que elija la opción correspondiente (Agregar o Actualizar).
5. Al responder sobre productos/modelos, **siempre incluye precio de costo Y precio de venta** (el dueño necesita ver ambos).
6. Responde breve, ordenado y con viñetas.`,

  buscar: `Estás en modo BUSCAR PROVEEDOR de "Ferretería Méndez": el usuario quiere localizar un proveedor en la base de datos.

REGLAS:
1. Trabaja SOLO con el mensaje actual.
2. Usa buscar_proveedores con el nombre o parte del nombre que dio el usuario. Si no hay resultados exactos, muestra las sugerencias parecidas que devuelve la herramienta y pregunta cuál es.
3. NUNCA inventes proveedores, teléfonos ni datos de contacto.
4. No modifiques ni crees datos.`,
};

export type PendingStep = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  titulo: string;
  detalle: string[];
};
export type PendingAction = { label: string; steps: PendingStep[] };

type ToolResultInput = {
  type: "function_result";
  call_id: string;
  name: string;
  result: Array<{ type: "text"; text: string }>;
};

const NOMBRES_ACCION: Record<string, string> = {
  agregar_proveedor: "Agregar proveedor",
  agregar_producto: "Agregar producto",
  agregar_modelo: "Agregar modelo",
  actualizar_modelo: "Actualizar modelo",
  actualizar_producto: "Actualizar producto",
};

const SOLES = (v: unknown) =>
  v === undefined || v === null || v === "" ? null : `S/ ${Number(v).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TEXTO = (v: unknown) =>
  v === undefined || v === null || v === "" ? null : String(v);

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function distanciaLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const fila: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = fila[0];
    fila[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return fila[n];
}

function raizPalabra(p: string): string {
  if (p.length > 3 && p.endsWith("es")) return p.slice(0, -2);
  if (p.length > 3 && p.endsWith("s")) return p.slice(0, -1);
  return p;
}

function palabrasCoinciden(a: string, b: string): boolean {
  const ra = raizPalabra(a);
  const rb = raizPalabra(b);
  if (ra === rb) return true;
  const min = Math.min(a.length, b.length);
  if (min >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (min >= 3 && (ra.startsWith(rb) || rb.startsWith(ra))) return true;
  return false;
}

function similitud(a: string, b: string): number {
  const na = normalizar(a);
  const nb = normalizar(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.95;
  const maxLen = Math.max(na.length, nb.length);
  const ratio = maxLen === 0 ? 0 : 1 - distanciaLevenshtein(na, nb) / maxLen;
  const pa = na.split(" ");
  const pb = nb.split(" ");
  let comunes = 0;
  for (const x of pa) {
    if (pb.some((y) => palabrasCoinciden(x, y))) comunes++;
  }
  const overlap = pa.length + pb.length === 0 ? 0 : (comunes * 2) / (pa.length + pb.length);
  const coberturaConsulta = pa.length === 0 ? 0 : comunes / pa.length;
  const coberturaBd = pb.length === 0 ? 0 : comunes / pb.length;
  const tokenScore = 0.5 * (coberturaConsulta + coberturaBd);
  return Math.max(ratio, overlap, tokenScore);
}

function resumenPaso(name: string, args: Record<string, unknown>): { titulo: string; detalle: string[] } {
  switch (name) {
    case "agregar_proveedor":
      return {
        titulo: `Agregar proveedor: ${TEXTO(args.nombre) ?? ""}`,
        detalle: [
          TEXTO(args.contacto) ? `Contacto: ${args.contacto}` : null,
          TEXTO(args.notas) ? `Notas: ${args.notas}` : null,
        ].filter(Boolean) as string[],
      };
    case "agregar_producto":
      return {
        titulo: `Agregar producto: ${TEXTO(args.nombre) ?? ""}`,
        detalle: [
          TEXTO(args.marca) ? `Marca: ${args.marca}` : null,
          TEXTO(args.tamano) ? `Tamaño: ${args.tamano}` : null,
          TEXTO(args.unidad) ? `Unidad: ${args.unidad}` : null,
          TEXTO(args.proveedor) ? `Proveedor: ${args.proveedor}` : null,
        ].filter(Boolean) as string[],
      };
    case "agregar_modelo": {
      const cant = args.cantidad;
      const unitDado = args.precio_costo_unitario != null && args.precio_costo_unitario !== "";
      const totalDado = args.precio_costo_total != null && args.precio_costo_total !== "";
      const cantValida = cant != null && cant !== "" && Number(cant) > 0;
      const costoUnitario =
        unitDado
          ? Number(args.precio_costo_unitario)
          : totalDado && cantValida
            ? Number(args.precio_costo_total) / Number(cant)
            : null;
      const detalle: string[] = [];
      if (cantValida) detalle.push(`Cantidad: ${cant}`);
      if (costoUnitario != null) detalle.push(`Costo unitario: ${SOLES(costoUnitario)}`);
      if (totalDado) detalle.push(`Costo total del lote: ${SOLES(args.precio_costo_total)}`);
      else if (costoUnitario != null && cantValida)
        detalle.push(`Costo total del lote: ${SOLES(costoUnitario * Number(cant))}`);
      const ventaUnitario =
        args.precio_venta != null && args.precio_venta !== ""
          ? Number(args.precio_venta)
          : args.precio_venta_total != null && args.precio_venta_total !== "" && cantValida
            ? Number(args.precio_venta_total) / Number(cant)
            : null;
      const ventaTotalDado = args.precio_venta_total != null && args.precio_venta_total !== "";
      if (ventaUnitario != null) detalle.push(`Precio de venta: ${SOLES(ventaUnitario)}`);
      if (ventaTotalDado) detalle.push(`Precio de venta total del lote: ${SOLES(args.precio_venta_total)}`);
      else if (ventaUnitario != null && cantValida)
        detalle.push(`Precio de venta total del lote: ${SOLES(ventaUnitario * Number(cant))}`);
      if (costoUnitario != null && ventaUnitario != null) {
        const gananciaUni = ventaUnitario - costoUnitario;
        detalle.push(`Ganancia por unidad: ${SOLES(gananciaUni)}`);
        if (cantValida) detalle.push(`Ganancia total: ${SOLES(gananciaUni * Number(cant))}`);
      }
      return {
        titulo: `Agregar modelo "${TEXTO(args.nombre) ?? TEXTO(args.producto) ?? ""}" a ${TEXTO(args.producto) ?? ""}`,
        detalle,
      };
    }
    case "actualizar_modelo": {
      const cant = args.cantidad;
      const unitDado = args.precio_costo_unitario != null && args.precio_costo_unitario !== "";
      const totalDado = args.precio_costo_total != null && args.precio_costo_total !== "";
      const cantValida = cant != null && cant !== "" && Number(cant) > 0;
      const costoUnitario =
        unitDado
          ? Number(args.precio_costo_unitario)
          : totalDado && cantValida
            ? Number(args.precio_costo_total) / Number(cant)
            : null;
      const detalle: string[] = [];
      if (cantValida) detalle.push(`Cantidad: ${cant}`);
      if (costoUnitario != null) detalle.push(`Costo unitario: ${SOLES(costoUnitario)}`);
      if (totalDado) detalle.push(`Costo total del lote: ${SOLES(args.precio_costo_total)}`);
      else if (costoUnitario != null && cantValida)
        detalle.push(`Costo total del lote: ${SOLES(costoUnitario * Number(cant))}`);
      const ventaUnitario =
        args.precio_venta != null && args.precio_venta !== ""
          ? Number(args.precio_venta)
          : args.precio_venta_total != null && args.precio_venta_total !== "" && cantValida
            ? Number(args.precio_venta_total) / Number(cant)
            : null;
      const ventaTotalDado = args.precio_venta_total != null && args.precio_venta_total !== "";
      if (ventaUnitario != null) detalle.push(`Precio de venta: ${SOLES(ventaUnitario)}`);
      if (ventaTotalDado) detalle.push(`Precio de venta total del lote: ${SOLES(args.precio_venta_total)}`);
      else if (ventaUnitario != null && cantValida)
        detalle.push(`Precio de venta total del lote: ${SOLES(ventaUnitario * Number(cant))}`);
      if (costoUnitario != null && ventaUnitario != null) {
        const gananciaUni = ventaUnitario - costoUnitario;
        detalle.push(`Ganancia por unidad: ${SOLES(gananciaUni)}`);
        if (cantValida) detalle.push(`Ganancia total: ${SOLES(gananciaUni * Number(cant))}`);
      }
      return {
        titulo: `Actualizar modelo "${TEXTO(args.modelo) ?? ""}" de ${TEXTO(args.producto) ?? ""}`,
        detalle,
      };
    }
    case "actualizar_producto":
      return {
        titulo: `Actualizar producto: ${TEXTO(args.producto) ?? ""}`,
        detalle: [
          TEXTO(args.marca) ? `Marca: ${args.marca}` : null,
          TEXTO(args.tamano) ? `Tamaño: ${args.tamano}` : null,
          TEXTO(args.unidad) ? `Unidad: ${args.unidad}` : null,
          TEXTO(args.proveedor) ? `Proveedor: ${args.proveedor}` : null,
        ].filter(Boolean) as string[],
      };
    default:
      return { titulo: name, detalle: [] };
  }
}

export type AgentResult = {
  reply: string;
  pendingAction: PendingAction | null;
  lastId: string | null;
};

const MAX_REINTENTOS = 2;

function esperar(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function tiempoDeEspera(err: unknown): number | null {
  const e = err as { status?: number; retry_in?: number; message?: string };
  if (typeof e.retry_in === "number" && e.retry_in > 0) return e.retry_in * 1000;
  if (typeof e.message === "string") {
    const m = e.message.match(/retry in (\d+(?:\.\d+)?)/i);
    if (m) return Number(m[1]) * 1000;
  }
  return null;
}

async function crearInteraccion(
  input: string | ToolResultInput[],
  prevId: string | null,
  conTools: boolean,
  tools?: ToolDeclaracion[],
  systemPrompt?: string
) {
  const ejecutar = () =>
    ai.interactions.create({
      model: GEMINI_MODEL,
      input,
      ...(prevId ? { previous_interaction_id: prevId } : {}),
      ...(conTools ? { tools: tools ?? TOOL_DECLARATIONS } : {}),
      system_instruction: systemPrompt ?? SYSTEM_PROMPT,
      stream: false,
    });

  for (let intento = 0; intento < MAX_REINTENTOS; intento++) {
    try {
      return await ejecutar();
    } catch (err) {
      const mensaje = (err as { message?: string })?.message ?? "";
      const esCuota =
        (err as { status?: number })?.status === 429 || /429|quota|rate limit/i.test(mensaje);
      if (!esCuota) throw err;
      if (hayRespaldo()) {
        throw new QuotaError(
          "La IA alcanzó el límite de uso gratuito por el momento. Espera unos minutos y vuelve a intentarlo. Para quitar este tope, contrata el plan de pago de Gemini."
        );
      }
      if (intento === MAX_REINTENTOS - 1) {
        throw new QuotaError(
          "La IA alcanzó el límite de uso gratuito por el momento. Espera unos minutos y vuelve a intentarlo. Para quitar este tope, contrata el plan de pago de Gemini."
        );
      }
      const esperaMs = Math.min(tiempoDeEspera(err) ?? 5000, 8000);
      await esperar(esperaMs);
    }
  }
  throw new Error("No se pudo contactar a la IA.");
}

const MENCIONA_PRECIO =
  /\bprecio\b|soles|s\/|\$|costo|cost|venta|unitario|total|pago|pagar|price|\b(?:a|por)\s+(?:\$|s\/|soles)?\s*\d[\d.,]*/i;
const TIPO_PRECIO_CLARO = /venta|vende|vendo|vender|unitario|por unidad|cada uno|total|el lote|por todo/i;

function precioAmbiguo(texto: string): boolean {
  return MENCIONA_PRECIO.test(texto) && !TIPO_PRECIO_CLARO.test(texto);
}

export async function runAgent(
  textoUsuario: string,
  prevId: string | null,
  textoCrudo?: string | null,
  accion?: string
): Promise<AgentResult> {
  console.error(`[agent] usando Gemini, prevId=${prevId ? "si" : "no"}`);
  const supabase = await createClient();
  const crudo = textoCrudo ?? textoUsuario;
  const toolsAccion =
    accion && TOOLS_POR_ACCION[accion]
      ? TOOL_DECLARATIONS.filter((t) => TOOLS_POR_ACCION[accion].includes(t.name))
      : undefined;
  const systemPrompt = accion ? SYSTEM_PROMPTS_POR_ACCION[accion] ?? SYSTEM_PROMPT : SYSTEM_PROMPT;
  let input: string | ToolResultInput[] = textoUsuario;
  let lastId = prevId;
  let clarificado = false;

  for (let i = 0; i < 6; i++) {
    const interaction = await crearInteraccion(input, lastId, true, toolsAccion, systemPrompt);
    lastId = interaction.id;

    let calls = (interaction.steps ?? [])
      .filter((s) => s.type === "function_call")
      .map((c) => ({
        id: c.id,
        name: c.name,
        arguments: normalizarArgumentos(c.name, (c.arguments ?? {}) as Record<string, unknown>),
      }));

    if (detectarIntencion(textoUsuario).tipo === "agregar") {
      const antes = calls.length;
      calls = calls.filter((c) => c.name !== "calcular_ganancia");
      if (calls.length !== antes) {
        console.error("[w] propuesta agregar: se eliminó calcular_ganancia de la propuesta");
      }
    }

    if (calls.length === 0) {
      return {
        reply: interaction.output_text ?? "Listo.",
        pendingAction: null,
        lastId,
      };
    }

    const restriccion = restringirModo(textoUsuario, calls);
    if (restriccion.restringidas) {
      input = restriccion.resultados;
      continue;
    }

    const slots = verificarSlotsActualizar(textoUsuario, calls);
    if (slots.faltan) {
      input = slots.resultados;
      continue;
    }

    const slotsAgregar = verificarSlotsAgregar(textoUsuario, crudo, calls);
    if (slotsAgregar.faltan) {
      input = slotsAgregar.resultados;
      continue;
    }

    const invalidas = calls.filter((c) => camposFaltantes(c.name, c.arguments).length > 0);
    if (invalidas.length > 0) {
      input = await Promise.all(
        calls.map(async (call) => {
          const faltan = camposFaltantes(call.name, call.arguments);
          let texto: string;
          if (faltan.length > 0) {
            texto = `La llamada a ${call.name} no es válida: faltan los campos ${faltan.join(", ")}. Si esos datos no están disponibles, NO llames la herramienta todavía: pregúntale al usuario esos datos faltantes y espera su respuesta. Nunca uses null ni valores vacíos.`;
          } else if (WRITE_NAMES.has(call.name)) {
            texto = "No se ejecutó esta llamada.";
          } else {
            texto = JSON.stringify(await executeReadTool(supabase, call.name, call.arguments));
          }
          return {
            type: "function_result" as const,
            call_id: call.id,
            name: call.name,
            result: [{ type: "text" as const, text: texto }],
          };
        })
      );
      continue;
    }

    const correccion = await calcularCorrecciones(supabase, textoUsuario, calls);
    if (correccion.corregidas) {
      input = correccion.resultados;
      continue;
    }

    const correccionUpdate = await calcularCorreccionesUpdate(supabase, textoUsuario, calls);
    if (correccionUpdate.corregidas) {
      input = correccionUpdate.resultados;
      continue;
    }

    const completitud = await revisarCompletitud(supabase, textoUsuario, calls);
    if (completitud.incompleto) {
      input = completitud.resultados;
      continue;
    }

    if (calls.some((c) => WRITE_NAMES.has(c.name))) {
      if (!clarificado && precioAmbiguo(crudo)) {
        clarificado = true;
        return { reply: preguntaTipoDePrecio(crudo), pendingAction: null, lastId: null };
      }

      const res = await resolverPasosEscritura(supabase, calls, crudo);
      if (res.pregunta) {
        return { reply: res.pregunta, pendingAction: null, lastId: null };
      }

      return {
        reply: "Necesito tu confirmación para realizar estos cambios.",
        pendingAction: {
          label: res.pasos
            .filter((p) => WRITE_NAMES.has(p.call.name))
            .map((p) => NOMBRES_ACCION[p.call.name] ?? p.call.name)
            .join(", "),
          steps: res.pasos.map((p) => {
            const base = {
              id: p.call.id,
              name: p.call.name,
              args: p.call.arguments,
              ...resumenPaso(p.call.name, p.call.arguments),
            };
            if (p.reusarProveedor) {
              if (p.call.name === "agregar_proveedor") {
                base.titulo = `Reutilizar proveedor: ${p.reusarProveedor} (ya existe)`;
              } else {
                base.detalle = [
                  ...base.detalle,
                  `Proveedor "${p.reusarProveedor}" ya existe: se enlazará con él (no se duplica).`,
                ];
              }
            }
            return base;
          }),
        },
        lastId,
      };
    }

    const results: ToolResultInput[] = [];
    for (const call of calls) {
      const data = await executeReadTool(supabase, call.name, call.arguments);
      results.push({
        type: "function_result",
        call_id: call.id,
        name: call.name,
        result: [{ type: "text", text: JSON.stringify(data) }],
      });
    }
    input = results;
  }

  return { reply: "Listo.", pendingAction: null, lastId };
}

export async function resolverAccionPendiente(
  supabase: SupabaseClient,
  action: PendingAction,
  confirmado: boolean,
  prevId: string | null
): Promise<{ ok: boolean; message: string; lastId: string | null }> {
  const results: ToolResultInput[] = [];
  let ok = true;
  const resumen: string[] = [];
  const pasos: { step: PendingStep; data: unknown }[] = [];
  const pasosOrdenados = ordenarPasos(action.steps);

  for (const step of pasosOrdenados) {
    let data: unknown;
    if (WRITE_NAMES.has(step.name)) {
      if (confirmado) {
        const r = await executeWriteAction({ name: step.name, args: step.args }, supabase);
        if (!r.ok) ok = false;
        resumen.push(r.message);
        data = r;
      } else {
        resumen.push(`Cancelado: ${step.titulo} (sin cambios)`);
        data = {
          ok: true,
          message: "El usuario canceló la operación. No se realizó ningún cambio en la base de datos.",
        };
      }
    } else {
      data = await executeReadTool(supabase, step.name, step.args);
    }
    pasos.push({ step, data });
    results.push({
      type: "function_result",
      call_id: step.id,
      name: step.name,
      result: [
        {
          type: "text",
          text: confirmado
            ? JSON.stringify(data)
            : JSON.stringify({
                ok: true,
                message: "El usuario canceló la operación. No se realizó ningún cambio en la base de datos.",
              }),
        },
      ],
    });
  }

  let message = confirmado
    ? resumen.join(" ") || "Listo."
    : "Acción cancelada. No se guardó ningún cambio.";
  let lastId = prevId;

  if (prevId) {
    try {
      const interaction = await crearInteraccion(results, prevId, false);
      lastId = interaction.id;
      message = interaction.output_text ?? message;
    } catch (e) {
      if (esErrorDeCuota(e) && hayRespaldo()) {
        message = await cerrarRespaldo(pasos, confirmado, message);
      } else {
        console.error("Error al cerrar la interacción:", e);
      }
    }
  }

  return { ok, message, lastId };
}

type OpenAIMsg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
};

function safeParse(s: string | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function esquemaDeTool(name: string): {
  properties?: Record<string, { type?: string | string[] }>;
  required?: string[];
} {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return {};
  return (tool.parameters ?? {}) as {
    properties?: Record<string, { type?: string | string[] }>;
    required?: string[];
  };
}

function schemaOpenAI(parameters: object): object {
  const p = parameters as {
    properties?: Record<string, { type?: string | string[]; description?: string }>;
    required?: string[];
  };
  const required = p.required ?? [];
  const properties: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(p.properties ?? {})) {
    const esObligatorio = required.includes(k);
    const tipo = Array.isArray(def.type) ? def.type[0] : def.type;
    const base: Record<string, unknown> = {};
    if (def.description) base.description = def.description;
    base.type = !esObligatorio ? [tipo, "null"] : tipo;
    properties[k] = base;
  }
  return { type: "object", properties, required };
}

function normalizarArgumentos(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const props = esquemaDeTool(name).properties;
  if (!props) return args;
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(props)) {
    const v = args[k];
    if (v == null || v === "") continue;
    if (
      typeof v === "string" &&
      (/^[¿?]+$/.test(v.trim()) ||
        /^(n\/a|na|no aplica|no disponible|desconocido|ninguno|null|none)$/i.test(v.trim()))
    ) {
      continue;
    }
    const tipos = Array.isArray(def.type) ? def.type : [def.type];
    if (tipos.includes("number")) {
      const n = Number(v);
      out[k] = Number.isFinite(n) ? n : v;
    } else if (tipos.includes("boolean") && typeof v === "string") {
      out[k] = v === "true" || v === "1";
    } else {
      out[k] = v;
    }
  }
  return out;
}

function camposFaltantes(name: string, args: Record<string, unknown>): string[] {
  return (esquemaDeTool(name).required ?? []).filter((r) => args[r] == null || args[r] === "");
}

async function llamarAProveedor(
  prov: Proveedor,
  messages: OpenAIMsg[],
  conTools: boolean,
  tools?: ToolDeclaracion[]
): Promise<OpenAIMsg> {
  const res = await fetch(`${prov.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${prov.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: prov.model,
      messages,
      ...(conTools
        ? {
            tools: (tools ?? TOOL_DECLARATIONS).map((t) => ({
              type: "function",
              function: {
                name: t.name,
                description: t.description,
                parameters: schemaOpenAI(t.parameters),
              },
            })),
            tool_choice: "auto",
          }
        : {}),
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const texto = await res.text();
    throw new Error(`IA de respaldo error ${res.status}: ${texto.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message as OpenAIMsg;
}

async function llamarRespaldo(
  messages: OpenAIMsg[],
  conTools: boolean,
  tools?: ToolDeclaracion[]
): Promise<OpenAIMsg> {
  const inicio = Math.min(proveedorActivo, proveedores.length - 1);
  let ultimoError: Error | null = null;
  for (let i = inicio; i < proveedores.length; i++) {
    try {
      const msg = await llamarAProveedor(proveedores[i], messages, conTools, tools);
      proveedorActivo = i;
      return msg;
    } catch (e) {
      ultimoError = e as Error;
      if (esLimiteTransitorio(e)) {
        let reintentos = 0;
        let exitoso = false;
        while (reintentos < 2 && !exitoso) {
          reintentos++;
          const espera = tiempoDeReintento(e);
          console.error(`[backup] ${proveedores[i].model} límite temporal, reintento ${reintentos} en ${Math.round(espera / 1000)}s`);
          await new Promise((r) => setTimeout(r, espera));
          try {
            const msg = await llamarAProveedor(proveedores[i], messages, conTools, tools);
            proveedorActivo = i;
            exitoso = true;
            return msg;
          } catch (e2) {
            ultimoError = e2 as Error;
            e = e2;
          }
        }
        if (!exitoso) proveedorActivo = i + 1;
      } else {
        proveedorActivo = i + 1;
      }
    }
  }
  if (ultimoError && esErrorDeLimite(ultimoError)) {
    throw new QuotaError(
      esLimiteDiario(ultimoError)
        ? "La IA de respaldo también alcanzó su límite de uso diario. Espera un poco o intenta mañana."
        : "La IA de respaldo está saturada por muchos pedidos seguidos. Espera un minuto y vuelve a intentarlo."
    );
  }
  throw ultimoError ?? new Error("No hay IA de respaldo configurada.");
}

function esErrorDeLimite(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e);
  return m.includes("429") || /rate limit|quota|limit/i.test(m);
}

function esLimiteDiario(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e);
  return /tokens per day|TPD|per day|quota exceeded|exceeded your current quota|daily/i.test(m);
}

function esLimiteTransitorio(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e);
  return (esErrorDeLimite(e) || /tool_use_failed|failed to call a function/i.test(m)) && !esLimiteDiario(e);
}

function tiempoDeReintento(e: unknown): number {
  const m = String((e as Error)?.message ?? e);
  const match = m.match(/try again in ([\d.]+) ?s/i) || m.match(/retry[- ]after.?[: ]\s*([\d.]+)/i);
  if (match) {
    const s = Number(match[1]);
    if (Number.isFinite(s) && s > 0) return Math.min(Math.round(s * 1000), 25000);
  }
  return 8000;
}

function extraerMonto(texto: string): number | null {
  const nums: { v: number; raw: string; idx: number }[] = [];
  const re = /(\d{1,6}(?:[.,]\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    const v = parseFloat(m[1].replace(",", "."));
    if (!Number.isFinite(v)) continue;
    nums.push({ v, raw: m[1], idx: m.index });
  }
  const conDecimal = nums.filter((n) => /[.,]/.test(n.raw));
  if (conDecimal.length > 0) return conDecimal[conDecimal.length - 1].v;
  for (const n of nums) {
    const antes = texto.slice(Math.max(0, n.idx - 12), n.idx).toLowerCase();
    if (/(?:a\s+|por\s+|precio\s+(?:de\s+)?|soles|s\/|costo\s*(?:total|unitario)?\s*(?:de\s*)?|\$)/.test(antes)) {
      return n.v;
    }
  }
  return null;
}

function campoPrecioSegunAclaracion(texto: string): string {
  const t = texto.toLowerCase();
  if (/venta.*total|total.*venta|todo el lote|el lote/.test(t)) return "precio_venta_total";
  if (/unitario|por unidad|cada uno|costo unitario/.test(t)) return "precio_costo_unitario";
  if (/precio de venta|a la venta|venta/.test(t)) return "precio_venta";
  return "precio_costo_total";
}

function preguntaTipoDePrecio(texto: string): string {
  const monto = extraerMonto(texto);
  if (monto == null) {
    return "¿El precio que indicas es el costo unitario, el costo total o el precio de venta?";
  }
  const montoFmt = monto.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `¿El precio de S/ ${montoFmt} es el costo unitario, el costo total o el precio de venta?`;
}

function construirMensajeConContexto(
  textoUsuario: string,
  historial: { role: string; content: string }[]
): string {
  const hist = historial.filter((m) => m.role === "user" || m.role === "assistant");
  const ultimoAsistente = [...hist].reverse().find((m) => m.role === "assistant");
  if (
    !ultimoAsistente ||
    !/costo unitario|costo total|precio de venta|precio total|tipo de precio/.test(ultimoAsistente.content)
  ) {
    return textoUsuario;
  }
  const anteriorUsuario = [...hist].reverse().find(
    (m) => m.role === "user" && m.content !== textoUsuario
  );
  const monto = extraerMonto(textoUsuario) ?? extraerMonto(anteriorUsuario?.content ?? "");
  const campo = campoPrecioSegunAclaracion(textoUsuario);
  return (
    `El usuario antes pidió registrar una compra y escribió: "${anteriorUsuario?.content ?? "—"}".\n` +
    `El sistema le preguntó qué tipo de precio era y el usuario respondió: "${textoUsuario}".\n` +
    (monto != null
      ? `Por tanto el precio S/ ${monto} es ${campo === "precio_costo_unitario" ? "el COSTO POR UNIDAD" : campo === "precio_venta" ? "el PRECIO DE VENTA por unidad" : "el COSTO TOTAL del lote"}. Usa SOLAMENTE el campo ${campo} con ese valor ${monto}, y NO uses ni calcules otros campos de precio ni multipliques el precio por la cantidad.\n`
      : "") +
     `En UN SOLO mensaje llama TODAS las herramientas de escritura para registrar la compra COMPLETA: agregar_proveedor, agregar_producto y agregar_modelo con la cantidad y el precio en el campo correcto según la aclaración. NO omitas agregar_modelo ni dejes el precio fuera de la propuesta. Nunca incluyas calcular_ganancia en una propuesta de agregar: es solo para consultas de ganancia. Recuerda: si el usuario quiere CAMBIAR unidades, stock o precio de algo que YA EXISTE, usa actualizar_modelo (nunca agregar_modelo sobre un producto existente).`
  );
}

export async function leerImagen(base64: string): Promise<string> {
  if (!backupApiKey) {
    throw new Error("No hay clave de respaldo configurada para leer imágenes.");
  }
  const res = await fetch(`${backupBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${backupApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: visionModel,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Eres un lector de boletas, facturas y notas de compra. Lee la imagen y extrae los datos de la compra en español.\n" +
                "- Proveedor: nombre y teléfono/RUC si aparecen.\n" +
                "- Por cada producto (ítem): nombre o descripción, marca o código si aparece, cantidad y el monto que sale en esa línea.\n" +
                "- Total de la compra si aparece.\n" +
                "REGLAS: escribe SOLO lo que realmente ves en la imagen, sin inventar nada. NO uses frases como 'no se ve', 'no aparece' ni pongas campos vacíos: simplemente omite lo que no esté. El monto de cada línea es el costo total de ese producto (cantidad x precio). Usa viñetas. Devuelve SOLO la lista de datos, sin preguntas, sin explicaciones y sin razonamientos.",
            },
            { type: "image_url", image_url: { url: base64 } },
          ],
        },
      ],
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const texto = await res.text();
    throw new Error(`No pude leer la imagen: error ${res.status}. ${texto.slice(0, 200)}`);
  }

  const data = await res.json();
  const crudo = data.choices?.[0]?.message?.content ?? "";
  const limpio = crudo
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .replace(/\s{3,}/g, " ")
    .trim();
  return limpio || "No encontré datos claros en la imagen.";
}

export async function runAgentBackup(
  textoUsuario: string,
  historial: { role: string; content: string }[],
  textoCrudo?: string | null,
  accion?: string
): Promise<AgentResult> {
  proveedorActivo = 0;
  const prov = proveedores[proveedorActivo];
  console.error(`[backup] iniciando con ${prov?.model ?? "?"} (proveedorActivo=${proveedorActivo})`);
  const supabase = await createClient();
  const crudo = textoCrudo ?? textoUsuario;
  const toolsAccion =
    accion && TOOLS_POR_ACCION[accion]
      ? TOOL_DECLARATIONS.filter((t) => TOOLS_POR_ACCION[accion].includes(t.name))
      : undefined;
  const systemPrompt = accion ? SYSTEM_PROMPTS_POR_ACCION[accion] ?? SYSTEM_PROMPT : SYSTEM_PROMPT;
  const messages: OpenAIMsg[] = [{ role: "system", content: systemPrompt }];

  // Solo los 2 turnos más recientes: evita que el modelo "recuerde" datos de
  // flujos anteriores no relacionados (contaminación de contexto).
  for (const m of historial.slice(-4)) {
    if (m.role === "user" || m.role === "assistant") {
      messages.push({ role: m.role, content: m.content });
    }
  }

  messages.push({ role: "user", content: construirMensajeConContexto(crudo, historial) });

  // Referencia de coherencia de entidad: el mensaje actual + los mensajes de
  // usuario de los 2 turnos recientes (para aclaraciones tipo "no, quiero...").
  const referencia = [
    crudo,
    ...historial
      .slice(-4)
      .filter((m) => m.role === "user" && m.content !== crudo)
      .map((m) => m.content),
  ].join(" ");

  let clarificado = false;

  for (let i = 0; i < 6; i++) {
    const msg = await llamarRespaldo(messages, true, toolsAccion);

    let calls = (msg.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: normalizarArgumentos(tc.function.name, safeParse(tc.function.arguments)),
    }));

    if (detectarIntencion(textoUsuario).tipo === "agregar") {
      const antes = calls.length;
      calls = calls.filter((c) => c.name !== "calcular_ganancia");
      if (calls.length !== antes) {
        console.error("[w] backup: propuesta agregar: se eliminó calcular_ganancia");
      }
    }

    if (calls.length > 0) {
      console.error(
        "[backup] tool_calls: " +
          JSON.stringify(calls.map((c) => ({ name: c.name, args: c.arguments })))
      );
    }

    if (calls.length === 0) {
      return { reply: msg.content ?? "Listo.", pendingAction: null, lastId: null };
    }

    const restriccion = restringirModo(textoUsuario, calls);
    if (restriccion.restringidas) {
      messages.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        })),
      });
      for (const r of restriccion.resultados) {
        messages.push({
          role: "tool",
          tool_call_id: r.call_id,
          name: r.name,
          content: r.result[0].text,
        });
      }
      continue;
    }

    const slots = verificarSlotsActualizar(textoUsuario, calls);
    if (slots.faltan) {
      messages.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        })),
      });
      for (const r of slots.resultados) {
        messages.push({
          role: "tool",
          tool_call_id: r.call_id,
          name: r.name,
          content: r.result[0].text,
        });
      }
      continue;
    }

    const slotsAgregar = verificarSlotsAgregar(textoUsuario, crudo, calls);
    if (slotsAgregar.faltan) {
      messages.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        })),
      });
      for (const r of slotsAgregar.resultados) {
        messages.push({
          role: "tool",
          tool_call_id: r.call_id,
          name: r.name,
          content: r.result[0].text,
        });
      }
      continue;
    }

    const invalidas = calls.filter((c) => camposFaltantes(c.name, c.arguments).length > 0);
    if (invalidas.length > 0) {
      messages.push({
        role: "assistant",
        content: (msg.content ?? "") + " (Las llamadas a herramientas fueron rechazadas por datos incompletos.)",
      });
      messages.push({
        role: "user",
        content: `Las siguientes llamadas fueron rechazadas por datos incompletos: ${invalidas.map((c) => `${c.name} (faltan los campos: ${camposFaltantes(c.name, c.arguments).join(", ")})`).join("; ")}. Si esos datos no están disponibles en la información que ya tienes, NO llames la herramienta todavía: pregúntale al usuario esos datos faltantes y espera su respuesta. Nunca uses null ni valores vacíos en los argumentos.`,
      });
      continue;
    }

    const correccion = await calcularCorrecciones(supabase, textoUsuario, calls);
    if (correccion.corregidas) {
      messages.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        })),
      });
      for (const r of correccion.resultados) {
        messages.push({
          role: "tool",
          tool_call_id: r.call_id,
          name: r.name,
          content: r.result[0].text,
        });
      }
      continue;
    }

    const correccionUpdate = await calcularCorreccionesUpdate(supabase, textoUsuario, calls);
    if (correccionUpdate.corregidas) {
      messages.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        })),
      });
      for (const r of correccionUpdate.resultados) {
        messages.push({
          role: "tool",
          tool_call_id: r.call_id,
          name: r.name,
          content: r.result[0].text,
        });
      }
      continue;
    }

    const completitud = await revisarCompletitud(supabase, textoUsuario, calls);
    if (completitud.incompleto) {
      messages.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        })),
      });
      for (const r of completitud.resultados) {
        messages.push({
          role: "tool",
          tool_call_id: r.call_id,
          name: r.name,
          content: r.result[0].text,
        });
      }
      continue;
    }

    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.arguments) },
      })),
    });

    if (calls.some((c) => WRITE_NAMES.has(c.name))) {
      if (!clarificado && precioAmbiguo(crudo)) {
        clarificado = true;
        return {
          reply: preguntaTipoDePrecio(crudo),
          pendingAction: null,
          lastId: null,
        };
      }

      const res = await resolverPasosEscritura(supabase, calls, referencia);
      if (res.pregunta) {
        return { reply: res.pregunta, pendingAction: null, lastId: null };
      }

      return {
        reply: "Necesito tu confirmación para realizar estos cambios.",
        pendingAction: {
          label: res.pasos
            .filter((p) => WRITE_NAMES.has(p.call.name))
            .map((p) => NOMBRES_ACCION[p.call.name] ?? p.call.name)
            .join(", "),
          steps: res.pasos.map((p) => {
            const base = {
              id: p.call.id,
              name: p.call.name,
              args: p.call.arguments,
              ...resumenPaso(p.call.name, p.call.arguments),
            };
            if (p.reusarProveedor) {
              if (p.call.name === "agregar_proveedor") {
                base.titulo = `Reutilizar proveedor: ${p.reusarProveedor} (ya existe)`;
              } else {
                base.detalle = [
                  ...base.detalle,
                  `Proveedor "${p.reusarProveedor}" ya existe: se enlazará con él (no se duplica).`,
                ];
              }
            }
            return base;
          }),
        },
        lastId: null,
      };
    }

    for (const call of calls) {
      const data = await executeReadTool(supabase, call.name, call.arguments);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.name,
        content: JSON.stringify(data),
      });
    }
  }

  return {
    reply: "No pude completar la operación con la IA de respaldo. Intenta de nuevo.",
    pendingAction: null,
    lastId: null,
  };
}

async function cerrarRespaldo(
  pasos: { step: PendingStep; data: unknown }[],
  confirmado: boolean,
  fallback: string
): Promise<string> {
  const messages: OpenAIMsg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "assistant",
      content: null,
      tool_calls: pasos.map(({ step }) => ({
        id: step.id,
        type: "function",
        function: { name: step.name, arguments: JSON.stringify(step.args ?? {}) },
      })),
    },
  ];

  for (const { step, data } of pasos) {
    messages.push({
      role: "tool",
      tool_call_id: step.id,
      name: step.name,
      content: confirmado
        ? JSON.stringify(data)
        : JSON.stringify({
            ok: true,
            message: "El usuario canceló la operación. No se realizó ningún cambio en la base de datos.",
          }),
    });
  }

  try {
    const msg = await llamarRespaldo(messages, false);
    return msg.content?.trim() ? msg.content : fallback;
  } catch (e) {
    console.error("Error al cerrar con IA de respaldo:", e);
    return fallback;
  }
}

async function executeReadTool(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown>
) {
  if (name === "buscar_productos") {
    const busqueda = String(args.busqueda ?? "").trim();
    let query = supabase
      .from("productos")
      .select("id, nombre, marca, tamano, unidad, foto_url, proveedores(nombre, contacto), modelos(nombre, precio_costo, precio_venta, cantidad)");
    if (busqueda) {
      query = query.or(`nombre.ilike.%${busqueda}%,marca.ilike.%${busqueda}%`);
    }
    const { data, error } = await query.order("nombre");
    if (error) return { error: error.message };
    if ((data?.length ?? 0) === 0 && busqueda) {
      const suger = await sugerirCoincidencias(supabase, "productos", busqueda, 3);
      if (suger.candidatos.length > 0) {
        return [
          {
            _sugerencia: `No encontré exactamente "${busqueda}". Quizás te refieres a: ${suger.candidatos.map((c, i) => `${i + 1}) ${c.nombre}`).join(", ")}.`,
          },
        ];
      }
    }
    return data;
  }

  if (name === "buscar_proveedores") {
    const busqueda = String(args.busqueda ?? "").trim();
    let query = supabase.from("proveedores").select("id, nombre, contacto, notas");
    if (busqueda) {
      query = query.ilike("nombre", `%${busqueda}%`);
    }
    const { data, error } = await query.order("nombre");
    if (error) return { error: error.message };
    if ((data?.length ?? 0) === 0 && busqueda) {
      const suger = await sugerirCoincidencias(supabase, "proveedores", busqueda, 3);
      if (suger.candidatos.length > 0) {
        return [
          {
            _sugerencia: `No encontré exactamente "${busqueda}". Quizás te refieres a: ${suger.candidatos.map((c, i) => `${i + 1}) ${c.nombre}`).join(", ")}.`,
          },
        ];
      }
    }
    return data;
  }

  if (name === "consultar_resumen") {
    const { count: productos } = await supabase
      .from("productos")
      .select("*", { count: "exact", head: true });
    const { count: modelos } = await supabase
      .from("modelos")
      .select("*", { count: "exact", head: true });
    const { count: proveedores } = await supabase
      .from("proveedores")
      .select("*", { count: "exact", head: true });
    return { productos: productos ?? 0, modelos: modelos ?? 0, proveedores: proveedores ?? 0 };
  }

  if (name === "calcular_ganancia") {
    const busqueda = String(args.producto ?? "").trim();
    const todos = busqueda === "" || busqueda.toLowerCase() === "todos";
    let query = supabase
      .from("productos")
      .select("id, nombre, foto_url, modelos(nombre, precio_costo, precio_venta, cantidad)");
    if (!todos) {
      query = query.ilike("nombre", `%${busqueda}%`);
    }
    const { data, error } = await query.order("nombre");
    if (error) return { error: error.message };

    const propuesto = args.precio_venta_propuesto != null ? Number(args.precio_venta_propuesto) : null;

    const resultado = (data ?? []).flatMap((p) => {
      const modelos = p.modelos ?? [];
      if (modelos.length === 0) return [];
      return modelos.map((m) => {
        const cantidad = m.cantidad ?? 0;
        const costo = m.precio_costo ?? null;
        const venta = propuesto ?? m.precio_venta ?? null;
        const costoTotal = costo != null ? costo * cantidad : null;
        const ventaTotal = venta != null ? venta * cantidad : null;
        const gananciaUnitaria = costo != null && venta != null ? venta - costo : null;
        const gananciaTotal = gananciaUnitaria != null ? gananciaUnitaria * cantidad : null;
        const margen =
          gananciaUnitaria != null && venta != null && venta !== 0
            ? Math.round((gananciaUnitaria / venta) * 1000) / 10
            : null;
        return {
          producto: p.nombre,
          modelo: m.nombre,
          cantidad,
          costo_unitario: costo,
          costo_total: costoTotal,
          venta_unitario: venta,
          venta_total: ventaTotal,
          precio_propuesto: propuesto ?? null,
          ganancia_unitaria: gananciaUnitaria,
          ganancia_total: gananciaTotal,
          margen_porcentaje: margen,
        };
      });
    });

    return resultado;
  }

  return { error: `Herramienta de lectura desconocida: ${name}` };
}

async function sugerirCoincidencias(
  supabase: SupabaseClient,
  tabla: "productos" | "proveedores",
  nombre: string,
  limite = 3
): Promise<{
  candidatos: { id: string; nombre: string; score: number }[];
  mejor: { id: string; nombre: string; score: number } | null;
  ambiguo: boolean;
}> {
  const { data } = await supabase
    .from(tabla)
    .select("id, nombre")
    .order("nombre")
    .limit(1000);
  const candidatos = (data ?? [])
    .map((f) => ({ id: f.id, nombre: f.nombre, score: similitud(nombre, f.nombre) }))
    .filter((c) => c.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limite);
  const mejor = candidatos[0] ?? null;
  const ambiguo = candidatos.length >= 2 && mejor.score - candidatos[1].score < 0.1;
  return { candidatos, mejor, ambiguo };
}

async function buscarMejorCoincidencia(
  supabase: SupabaseClient,
  tabla: "productos" | "proveedores",
  nombre: string,
  umbral = 0.6
): Promise<{ id: string; nombre: string } | null> {
  const { mejor, ambiguo } = await sugerirCoincidencias(supabase, tabla, nombre, 3);
  if (!mejor || mejor.score < umbral || ambiguo) return null;
  return { id: mejor.id, nombre: mejor.nombre };
}

async function buscarProductoId(supabase: SupabaseClient, nombre: string) {
  const n = normalizar(nombre);
  const { data } = await supabase
    .from("productos")
    .select("id, nombre")
    .order("nombre")
    .limit(1000);
  const filas = data ?? [];
  const exacto = filas.find((f) => normalizar(f.nombre) === n);
  if (exacto) return exacto;
  const contiene = filas.find((f) => normalizar(f.nombre).includes(n));
  if (contiene) return contiene;
  return buscarMejorCoincidencia(supabase, "productos", nombre);
}

// Para agregar_producto: solo reutiliza cuando es claramente el MISMO producto
// (nombre exacto o el existente contiene al nuevo, p.ej. "foco" dentro de "focos").
// No usa coincidencia fuzzy débil: un producto con marca distinta ("foco marca volt"
// frente a "focos") SIEMPRE se crea como producto nuevo, nunca se fusiona.
async function buscarProductoIdEstricto(supabase: SupabaseClient, nombre: string) {
  const n = normalizar(nombre);
  if (!n) return null;
  const { data } = await supabase
    .from("productos")
    .select("id, nombre")
    .order("nombre")
    .limit(1000);
  const filas = data ?? [];
  const exacto = filas.find((f) => normalizar(f.nombre) === n);
  if (exacto) return exacto;
  return filas.find((f) => normalizar(f.nombre).includes(n)) ?? null;
}

async function buscarProveedorId(supabase: SupabaseClient, nombre: string) {
  const n = normalizar(nombre);
  const { data } = await supabase
    .from("proveedores")
    .select("id, nombre")
    .order("nombre")
    .limit(1000);
  const filas = data ?? [];
  const exacto = filas.find((f) => normalizar(f.nombre) === n);
  if (exacto) return exacto;
  const contiene = filas.find((f) => normalizar(f.nombre).includes(n));
  if (contiene) return contiene;
  return buscarMejorCoincidencia(supabase, "proveedores", nombre);
}

function preguntaOpciones(tipo: string, pedido: string, candidatos: string[]): string {
  const opciones = candidatos.map((n, i) => `${i + 1}) ${n}`).join(" o ");
  return `No encontré exactamente "${pedido}" en la base de datos. ¿Te refieres a ${opciones}? Responde el número o el nombre.`;
}

function ordenarPasos(pasos: PendingStep[]): PendingStep[] {
  const prioridad: Record<string, number> = {
    agregar_proveedor: 1,
    buscar_proveedores: 1,
    agregar_producto: 2,
    actualizar_producto: 2,
    agregar_modelo: 3,
    actualizar_modelo: 3,
  };
  return pasos
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const pa = prioridad[a.p.name] ?? 0;
      const pb = prioridad[b.p.name] ?? 0;
      if (pa !== pb) return pa - pb;
      return a.i - b.i;
    })
    .map((x) => x.p);
}

async function resolverPasosEscritura(
  supabase: SupabaseClient,
  calls: { id: string; name: string; arguments: Record<string, unknown> }[],
  referencia?: string | null
): Promise<{
  pregunta: string | null;
  pasos: {
    call: { id: string; name: string; arguments: Record<string, unknown> };
    reusarProveedor: string | null;
  }[];
}> {
  const pasos: {
    call: { id: string; name: string; arguments: Record<string, unknown> };
    reusarProveedor: string | null;
  }[] = [];

  // Resolución de entidad obligatoria: el producto o proveedor propuesto debe
  // coincidir con el mensaje ACTUAL (o los 2 turnos recientes) del usuario; si el
  // modelo usa un nombre de un flujo anterior, se detiene y se le pide buscar el
  // correcto.
  if (referencia && normalizar(referencia)) {
    for (const c of calls) {
      const esDeProducto =
        c.name === "actualizar_producto" ||
        c.name === "actualizar_modelo" ||
        c.name === "agregar_modelo";
      const esDeProveedor =
        c.name === "actualizar_producto" || c.name === "agregar_producto";
      if (esDeProducto && c.arguments.producto) {
        if (!nombreMencionadoEnTexto(String(c.arguments.producto), referencia)) {
          return {
            pregunta: `El producto "${c.arguments.producto}" que propusiste NO coincide con lo que el usuario pidió. El usuario escribió: «${referencia.trim().slice(0, 160)}». Busca con buscar_productos el producto correcto ANTES de proponer el cambio y NO uses datos ni nombres de flujos anteriores.`,
            pasos: [],
          };
        }
      }
      if (esDeProveedor && c.arguments.proveedor) {
        if (!nombreMencionadoEnTexto(String(c.arguments.proveedor), referencia)) {
          return {
            pregunta: `El proveedor "${c.arguments.proveedor}" que propusiste NO coincide con lo que el usuario pidió. El usuario escribió: «${referencia.trim().slice(0, 160)}». Usa el nombre del proveedor que el usuario mencionó en este mensaje.`,
            pasos: [],
          };
        }
      }
    }
  }

  for (const c of calls) {
    const args = { ...c.arguments };
    let reusarProveedor: string | null = null;

    if (c.name === "agregar_proveedor" && args.nombre) {
      const prov = await buscarProveedorId(supabase, String(args.nombre));
      if (prov) reusarProveedor = prov.nombre;
      else {
        const suger = await sugerirCoincidencias(supabase, "proveedores", String(args.nombre), 3);
        if (suger.ambiguo)
          return {
            pregunta: preguntaOpciones("proveedor", String(args.nombre), suger.candidatos.map((x) => x.nombre)),
            pasos: [],
          };
        if (suger.mejor) reusarProveedor = suger.mejor.nombre;
      }
    }

    if ((c.name === "agregar_producto" || c.name === "actualizar_producto") && args.proveedor) {
      const prov = await buscarProveedorId(supabase, String(args.proveedor));
      if (prov) {
        args.proveedor = prov.nombre;
        reusarProveedor = prov.nombre;
      } else {
        const suger = await sugerirCoincidencias(supabase, "proveedores", String(args.proveedor), 3);
        if (suger.ambiguo)
          return {
            pregunta: preguntaOpciones("proveedor", String(args.proveedor), suger.candidatos.map((x) => x.nombre)),
            pasos: [],
          };
        if (suger.mejor) {
          args.proveedor = suger.mejor.nombre;
          reusarProveedor = suger.mejor.nombre;
        }
      }
    }

    // Corrección de "proveedor en marca": la IA de respaldo suele poner el nombre
    // del proveedor en el campo marca (ej: "griferia anita, tornillo 1/2..."). Si
    // la marca coincide con un proveedor que YA EXISTE, se mueve al campo
    // proveedor (enlazándolo y sin duplicar) y se quita de marca.
    if (
      (c.name === "agregar_producto" || c.name === "actualizar_producto") &&
      args.proveedor == null &&
      args.marca
    ) {
      const marcaTxt = String(args.marca);
      const prov = await buscarProveedorId(supabase, marcaTxt);
      if (prov) {
        console.error(`[intención] marca "${marcaTxt}" reconocida como proveedor existente "${prov.nombre}": se enlaza`);
        args.proveedor = prov.nombre;
        delete args.marca;
        reusarProveedor = prov.nombre;
      }
    }

    if (
      (c.name === "agregar_modelo" || c.name === "actualizar_modelo" || c.name === "actualizar_producto") &&
      args.producto
    ) {
      const prod = await buscarProductoId(supabase, String(args.producto));
      if (prod) args.producto = prod.nombre;
      else {
        const suger = await sugerirCoincidencias(supabase, "productos", String(args.producto), 3);
        if (suger.ambiguo)
          return {
            pregunta: preguntaOpciones("producto", String(args.producto), suger.candidatos.map((x) => x.nombre)),
            pasos: [],
          };
        if (suger.mejor) args.producto = suger.mejor.nombre;
      }
    }

    if (c.name === "actualizar_modelo" && args.modelo) {
      const prod = await buscarProductoId(supabase, String(args.producto));
      if (prod) {
        const { data: modelosData } = await supabase
          .from("modelos")
          .select("id, nombre")
          .eq("producto_id", prod.id);
        const listaModelos = modelosData ?? [];
        const mejor = mejorEnLista(String(args.modelo), listaModelos);
        if (mejor) args.modelo = mejor.nombre;
        else if (listaModelos.length === 1) args.modelo = listaModelos[0].nombre;
      }
    }

    pasos.push({ call: { id: c.id, name: c.name, arguments: args }, reusarProveedor });
  }

  const prioridadOrden: Record<string, number> = {
    agregar_proveedor: 1,
    buscar_proveedores: 1,
    agregar_producto: 2,
    actualizar_producto: 2,
    agregar_modelo: 3,
    actualizar_modelo: 3,
  };
  const pasosOrdenados = pasos
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const pa = prioridadOrden[a.p.call.name] ?? 0;
      const pb = prioridadOrden[b.p.call.name] ?? 0;
      if (pa !== pb) return pa - pb;
      return a.i - b.i;
    })
    .map((x) => x.p);

  return {
    pregunta: null,
    pasos: pasosOrdenados,
  };
}

// Cuando el usuario quiere AGREGAR algo nuevo y el modelo propone agregar_modelo sin
// incluir agregar_producto (o sin crear un proveedor nuevo mencionado), la propuesta es
// incompleta: fallaría al buscar el producto. Se devuelven "function_result" pidiendo al
// modelo que reproponga TODO en un solo mensaje (lector paso a paso, como el bloque de
// datos incompletos).
async function revisarCompletitud(
  supabase: SupabaseClient,
  textoUsuario: string,
  calls: { id: string; name: string; arguments: Record<string, string | unknown> }[]
): Promise<{ incompleto: boolean; resultados: ToolResultInput[] }> {
  const { tipo } = detectarIntencion(textoUsuario);
  if (tipo !== "agregar") return { incompleto: false, resultados: [] };

  const nombres = new Set(calls.map((c) => c.name));
  if (!nombres.has("agregar_modelo") && !nombres.has("agregar_producto") && !nombres.has("agregar_proveedor")) {
    return { incompleto: false, resultados: [] };
  }

  const faltan: string[] = [];

  // producto: si proponés agregar_modelo pero no agregar_producto, y el producto NO existe -> falta
  if (nombres.has("agregar_modelo") && !nombres.has("agregar_producto")) {
    const modeloStep = calls.find((c) => c.name === "agregar_modelo");
    const prodNombre = modeloStep ? String(modeloStep.arguments.producto ?? "") : "";
    if (prodNombre) {
      const prod = await buscarProductoIdEstricto(supabase, prodNombre);
      if (!prod) faltan.push(`agregar_producto (nombre="${prodNombre}")`);
    }
  }

  // proveedor: si alguna call menciona un proveedor (arg.proveedor o buscar_proveedores)
  // que NO existe y no hay agregar_proveedor -> falta
  const proveedoresRefs: string[] = [];
  for (const c of calls) {
    if (c.arguments.proveedor != null) proveedoresRefs.push(String(c.arguments.proveedor));
    if (c.name === "buscar_proveedores" && c.arguments.busqueda) proveedoresRefs.push(String(c.arguments.busqueda));
  }
  for (const pname of Array.from(new Set(proveedoresRefs))) {
    if (!pname) continue;
    if (nombres.has("agregar_proveedor")) continue;
    const prov = await buscarProveedorId(supabase, pname);
    if (!prov) faltan.push(`agregar_proveedor (nombre="${pname}")`);
  }

  if (faltan.length === 0) return { incompleto: false, resultados: [] };

  const msg = `Estás registrando algo nuevo, pero la propuesta NO incluye todos los pasos necesarios: ${faltan.join(", ")}. Registra TODO en un solo mensaje: agregar_proveedor (solo si el proveedor es nuevo), agregar_producto y agregar_modelo con cantidad y precio (o precio total + cantidad). No olvides agregar_producto cuando des un modelo. No ejecutes las herramientas hasta que la propuesta esté completa.`;
  console.error(`[intención] propuesta incompleta: faltan ${faltan.join(", ")}`);

  const resultados: ToolResultInput[] = await Promise.all(
    calls.map(async (call) => {
      let text: string;
      if (READ_NAMES.has(call.name)) {
        text = JSON.stringify(await executeReadTool(supabase, call.name, call.arguments));
      } else {
        text = "No se ejecutó: la propuesta es incompleta. " + msg;
      }
      return {
        type: "function_result" as const,
        call_id: call.id,
        name: call.name,
        result: [{ type: "text" as const, text }],
      };
    })
  );
  return { incompleto: true, resultados };
}

// Detecta si la IA se equivocó: el usuario quiere AGREGAR algo (nuevo) pero la IA propuso
// actualizar_* un registro que NO existe. En ese caso se devuelven "function_result" de
// corrección para que el modelo reproponga con agregar_* en el siguiente turno del loop.
async function calcularCorrecciones(
  supabase: SupabaseClient,
  textoUsuario: string,
  calls: { id: string; name: string; arguments: Record<string, string | unknown> }[]
): Promise<{ corregidas: boolean; resultados: ToolResultInput[] }> {
  const { tipo } = detectarIntencion(textoUsuario);
  if (tipo !== "agregar") return { corregidas: false, resultados: [] };

  const corregirIds = new Set<string>();
  for (const c of calls) {
    if (c.name !== "actualizar_producto" && c.name !== "actualizar_modelo") continue;
    const nombre = String(c.arguments.producto ?? "");
    if (!nombre) continue;
    const prod = await buscarProductoIdEstricto(supabase, nombre);
    if (!prod) corregirIds.add(c.id);
  }

  if (corregirIds.size === 0) return { corregidas: false, resultados: [] };

  const resultados: ToolResultInput[] = await Promise.all(
    calls.map(async (call) => {
      let text: string;
      if (READ_NAMES.has(call.name)) {
        text = JSON.stringify(await executeReadTool(supabase, call.name, call.arguments));
      } else if (corregirIds.has(call.id)) {
        const nombre = String(call.arguments.producto ?? call.arguments.nombre ?? "");
        text = `El usuario quiere REGISTRAR (agregar) un producto nuevo llamado "${nombre}", que NO existe en la base de datos. Usaste ${call.name}, que solo sirve para MODIFICAR algo existente. Corrige usando agregar_producto (y agregar_modelo para su modelo y precios) y, si el proveedor es nuevo, agrégalo con agregar_proveedor. NO uses actualizar_* para algo que no existe. Llama todas las herramientas de escritura en un solo mensaje.`;
        console.error(`[intención] ${call.name} corregida -> agregar (producto "${nombre}" no existe)`);
      } else {
        text = "No se ejecutó aún; vuelve a proponer esta llamada tras corregir las indicaciones.";
      }
      return {
        type: "function_result" as const,
        call_id: call.id,
        name: call.name,
        result: [{ type: "text" as const, text }],
      };
    })
  );

  return { corregidas: true, resultados };
}

// Regla inversa: el usuario quiere ACTUALIZAR/STOCK/PRECIO algo existente, pero
// la IA propuso agregar_producto o agregar_modelo para un producto que YA EXISTE.
// En ese caso se devuelven function_result para que el modelo reproponga con actualizar_*.
async function calcularCorreccionesUpdate(
  supabase: SupabaseClient,
  textoUsuario: string,
  calls: { id: string; name: string; arguments: Record<string, string | unknown> }[]
): Promise<{ corregidas: boolean; resultados: ToolResultInput[] }> {
  const { tipo } = detectarIntencion(textoUsuario);
  if (tipo !== "actualizar") return { corregidas: false, resultados: [] };

  const corregirIds = new Set<string>();
  for (const c of calls) {
    if (c.name !== "agregar_producto" && c.name !== "agregar_modelo") continue;
    const nombre = String(c.arguments.producto ?? c.arguments.nombre ?? "");
    if (!nombre) continue;
    const prod = await buscarProductoId(supabase, nombre);
    if (prod) corregirIds.add(c.id);
  }

  if (corregirIds.size === 0) return { corregidas: false, resultados: [] };

  const resultados: ToolResultInput[] = await Promise.all(
    calls.map(async (call) => {
      let text: string;
      if (READ_NAMES.has(call.name)) {
        text = JSON.stringify(await executeReadTool(supabase, call.name, call.arguments));
      } else if (corregirIds.has(call.id)) {
        const nombre = String(call.arguments.producto ?? call.arguments.nombre ?? "");
        const prod = await buscarProductoId(supabase, nombre);
        const modelo =
          call.name === "agregar_modelo"
            ? (await (async () => {
                const { data: m } = await supabase
                  .from("modelos")
                  .select("id, nombre")
                  .eq("producto_id", prod!.id);
                const lista = m ?? [];
                if (lista.length === 1) return lista[0].nombre;
                if (lista.length > 1) return (mejorEnLista(String(call.arguments.nombre ?? nombre), lista) ?? lista[0]).nombre;
                return null;
              })())
            : null;
        const sugerencia = modelo ? ` y el modelo "${modelo}"` : "";
        text = `El usuario quiere MODIFICAR algo que YA EXISTE ("${nombre}" está registrado). No uses ${call.name} (que crea uno nuevo). Usa actualizar_modelo apuntando al producto "${nombre}"${sugerencia}, con los campos que el usuario indicó (precio de venta, cantidad, etc.). Si no sabes el nombre exacto del modelo, busca primero con buscar_productos y reúne los modelos del producto.`;
        console.error(`[intención] ${call.name} corregida -> actualizar (producto "${nombre}" YA existe)`);
      } else {
        text = "No se ejecutó aún; vuelve a proponer esta llamada tras corregir las indicaciones.";
      }
      return {
        type: "function_result" as const,
        call_id: call.id,
        name: call.name,
        result: [{ type: "text" as const, text }],
      };
    })
  );

  return { corregidas: true, resultados };
}

// "La opción elegida es la función madre": bloquea llamadas que contradicen el
// modo activo. En consultar no se ejecuta NINGUNA escritura; en actualizar no se
// crean productos ni modelos nuevos (sí se permite agregar un proveedor nuevo,
// que es parte natural de actualizar un producto existente).
const CREAR_PRODUCTO_O_MODELO = new Set(["agregar_producto", "agregar_modelo"]);

function restringirModo(
  textoUsuario: string,
  calls: { id: string; name: string; arguments: Record<string, unknown> }[]
): { restringidas: boolean; resultados: ToolResultInput[] } {
  const { tipo } = detectarIntencion(textoUsuario);

  if (tipo === "consultar") {
    const bloqueadas = calls.filter((c) => WRITE_NAMES.has(c.name));
    if (bloqueadas.length === 0) return { restringidas: false, resultados: [] };
    return {
      restringidas: true,
      resultados: bloqueadas.map((c) => ({
        type: "function_result" as const,
        call_id: c.id,
        name: c.name,
        result: [
          {
            type: "text" as const,
            text: `Modo CONSULTA activo: la llamada ${c.name} modifica datos y fue bloqueada. NO la llames. Si el usuario quiere registrar o actualizar productos, debe elegir la opción correspondiente.`,
          },
        ],
      })),
    };
  }

  if (tipo === "actualizar") {
    const bloqueadas = calls.filter((c) => CREAR_PRODUCTO_O_MODELO.has(c.name));
    if (bloqueadas.length === 0) return { restringidas: false, resultados: [] };
    return {
      restringidas: true,
      resultados: bloqueadas.map((c) => ({
        type: "function_result" as const,
        call_id: c.id,
        name: c.name,
        result: [
          {
            type: "text" as const,
            text: `Modo ACTUALIZAR activo: la llamada ${c.name} crearía un producto/modelo nuevo y fue bloqueada. Usa actualizar_producto o actualizar_modelo sobre el registro existente.`,
          },
        ],
      })),
    };
  }

  return { restringidas: false, resultados: [] };
}

// Slots obligatorios de ACTUALIZAR: al menos un campo debe tener el nuevo valor.
function camposDeCambioActualizar(name: string, args: Record<string, unknown>): string[] {
  if (name === "actualizar_producto") {
    return ["marca", "tamano", "unidad", "proveedor"].filter(
      (k) => args[k] != null && args[k] !== ""
    );
  }
  if (name === "actualizar_modelo") {
    return [
      "cantidad",
      "precio_costo_unitario",
      "precio_costo_total",
      "precio_venta",
      "precio_venta_total",
    ].filter((k) => args[k] != null && args[k] !== "");
  }
  return [];
}

function verificarSlotsActualizar(
  textoUsuario: string,
  calls: { id: string; name: string; arguments: Record<string, unknown> }[]
): { faltan: boolean; resultados: ToolResultInput[] } {
  const { tipo } = detectarIntencion(textoUsuario);
  if (tipo !== "actualizar") return { faltan: false, resultados: [] };

  const vacias = calls.filter(
    (c) =>
      (c.name === "actualizar_producto" || c.name === "actualizar_modelo") &&
      camposDeCambioActualizar(c.name, c.arguments).length === 0
  );
  if (vacias.length === 0) return { faltan: false, resultados: [] };

  return {
    faltan: true,
    resultados: vacias.map((c) => ({
      type: "function_result" as const,
      call_id: c.id,
      name: c.name,
      result: [
        {
          type: "text" as const,
          text:
            `Modo ACTUALIZAR: la llamada ${c.name} no indica QUÉ quieres cambiar. ` +
            (c.name === "actualizar_producto"
              ? "Usa al menos uno de los campos: marca, tamano, unidad o proveedor."
              : "Usa al menos uno de los campos: cantidad, precio_costo_unitario, precio_costo_total, precio_venta o precio_venta_total.") +
            " Pregunta al usuario qué desea modificar antes de proponer el cambio.",
        },
      ],
    })),
  };
}

// Slots obligatorios de AGREGAR: si el usuario indicó cantidad o precio, la
// propuesta DEBE incluir agregar_modelo con esos datos. Evita que la IA proponga
// solo agregar_producto (sin modelo ni precios) cuando el usuario dio precio/cantidad.
function verificarSlotsAgregar(
  textoUsuario: string,
  textoCrudo: string | null,
  calls: { id: string; name: string; arguments: Record<string, unknown> }[]
): { faltan: boolean; resultados: ToolResultInput[] } {
  // Solo aplica cuando la intención es AGREGAR: en actualizar/consultar no debe
  // exigir agregar_modelo ni los precios.
  if (detectarIntencion(textoUsuario).tipo !== "agregar") {
    return { faltan: false, resultados: [] };
  }
  if (!textoCrudo || !normalizar(textoCrudo)) return { faltan: false, resultados: [] };

  const mencionaCantidad =
    /\b\d+(?:[.,]\d+)?\s*(?:unidad|unidades|und|uds|un|pieza|piezas|docena|docenas|par|pares|kilo|kilos|kg|metro|metros|litro|litros|galon|galones)\b/i.test(
      textoCrudo
    );
  const monto = extraerMonto(textoCrudo);
  const mencionaPrecio = monto != null;

  if (!mencionaCantidad && !mencionaPrecio) return { faltan: false, resultados: [] };

  const modelos = calls.filter((c) => c.name === "agregar_modelo");
  const queFalta: string[] = [];
  if (modelos.length === 0) {
    queFalta.push("agregar_modelo (donde van la cantidad y el precio del modelo)");
  } else {
    if (mencionaCantidad && !modelos.some((c) => c.arguments.cantidad != null && c.arguments.cantidad !== "")) {
      queFalta.push("la cantidad en agregar_modelo");
    }
    if (
      mencionaPrecio &&
      !modelos.some((c) =>
        [ "precio_costo_unitario", "precio_costo_total", "precio_venta", "precio_venta_total" ].some(
          (k) => c.arguments[k] != null && c.arguments[k] !== ""
        )
      )
    ) {
      queFalta.push(`el precio (S/ ${monto}) en agregar_modelo`);
    }
  }
  if (queFalta.length === 0) return { faltan: false, resultados: [] };

  const mensaje =
    `El usuario indicó ${[mencionaCantidad ? "cantidad" : null, mencionaPrecio ? "precio" : null].filter(Boolean).join(" y ")} en su mensaje, pero la propuesta no incluye ${queFalta.join(" ni ")}. ` +
    `Propón de nuevo TODO en un solo mensaje: agregar_proveedor (solo si el proveedor es nuevo), agregar_producto y agregar_modelo con la cantidad y el precio en el campo correcto (precio_costo_total si es el total del lote).`;

  return {
    faltan: true,
    resultados: calls.map((c) => {
      const text = READ_NAMES.has(c.name)
        ? "No se ejecutó aún; vuelve a proponer tras completar la propuesta."
        : `No se ejecutó: propuesta incompleta. ${mensaje}`;
      return {
        type: "function_result" as const,
        call_id: c.id,
        name: c.name,
        result: [{ type: "text" as const, text }],
      };
    }),
  };
}

// Resolución de entidad obligatoria: el nombre de un producto/proveedor que el
// modelo propone debe coincidir con lo que el usuario escribió en SU mensaje.
// Si el modelo usa un nombre de un flujo anterior (p.ej. "Focos Volt" cuando el
// usuario pidió "planchas de empastar"), se rechaza para que busque el correcto.
function nombreMencionadoEnTexto(nombre: string, textoCrudo: string): boolean {
  const n = normalizar(nombre);
  if (!n) return true;
  const crudo = normalizar(textoCrudo);
  const tokens = n.split(" ").filter((p) => p.length >= 3);
  if (tokens.length === 0) return true;
  return tokens.some((t) => crudo.includes(t));
}

function mejorEnLista(
  nombre: string,
  filas: { id: string; nombre: string }[]
): { id: string; nombre: string } | null {
  const n = normalizar(nombre);
  const exacto = filas.find((f) => normalizar(f.nombre) === n);
  if (exacto) return exacto;
  const contiene = filas.find(
    (f) => normalizar(f.nombre).includes(n) || n.includes(normalizar(f.nombre))
  );
  if (contiene) return contiene;
  const candidatos = filas
    .map((f) => ({ id: f.id, nombre: f.nombre, score: similitud(nombre, f.nombre) }))
    .filter((c) => c.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  const mejor = candidatos[0];
  if (!mejor || mejor.score < 0.5) return null;
  const ambiguo = candidatos.length >= 2 && mejor.score - candidatos[1].score < 0.1;
  if (ambiguo) return null;
  return { id: mejor.id, nombre: mejor.nombre };
}

function mensajeNoEncontrado(
  tipo: string,
  pedido: string,
  candidatos: { nombre: string; score: number }[],
  enDonde = ""
): string {
  if (candidatos.length === 0) {
    return `No encontré el ${tipo} "${pedido}"${enDonde ? ` ${enDonde}` : ""} en la base de datos.`;
  }
  const opciones = candidatos
    .slice(0, 3)
    .map((c, i) => `${i + 1}) ${c.nombre}`)
    .join(", ");
  return `No encontré el ${tipo} "${pedido}"${enDonde ? ` ${enDonde}` : ""}. Quizás te refieres a: ${opciones}. Responde el número o el nombre.`;
}

function calcularCosto(
  args: Record<string, unknown>
): { precio_costo: number | null; error: string | null } {
  const unit = args.precio_costo_unitario;
  const total = args.precio_costo_total;
  const cant = args.cantidad;

  if (unit != null && unit !== "") return { precio_costo: Number(unit), error: null };

  if (total != null && total !== "") {
    if (cant != null && cant !== "" && Number(cant) > 0) {
      return { precio_costo: Number(total) / Number(cant), error: null };
    }
    return {
      precio_costo: null,
      error: "Necesito la cantidad para calcular el costo unitario desde el costo total.",
    };
  }

  return { precio_costo: null, error: null };
}

function calcularVenta(
  args: Record<string, unknown>
): { precio_venta: number | null; error: string | null } {
  const unit = args.precio_venta;
  const total = args.precio_venta_total;
  const cant = args.cantidad;

  if (unit != null && unit !== "") return { precio_venta: Number(unit), error: null };

  if (total != null && total !== "") {
    if (cant != null && cant !== "" && Number(cant) > 0) {
      return { precio_venta: Number(total) / Number(cant), error: null };
    }
    return {
      precio_venta: null,
      error: "Necesito la cantidad para calcular el precio de venta por unidad desde el precio de venta total.",
    };
  }

  return { precio_venta: null, error: null };
}

export async function executeWriteAction(
  action: { name: string; args: Record<string, unknown> },
  supabase: SupabaseClient
): Promise<{ ok: boolean; message: string }> {
  const args = action.args;

  try {
    if (action.name === "agregar_proveedor") {
      const nombre = String(args.nombre ?? "").trim();
      const existente = await buscarProveedorId(supabase, nombre);
      if (existente) {
        const mensaje =
          existente.nombre !== nombre
            ? `Proveedor "${nombre}" ya existía como "${existente.nombre}". Los productos se enlazarán con él.`
            : `Proveedor "${existente.nombre}" ya existía. Los productos se enlazarán con él.`;
        await registrarHistorial(supabase, "proveedores", `Reutilizado proveedor existente: ${existente.nombre}`);
        return { ok: true, message: mensaje };
      }
      const { error } = await supabase
        .from("proveedores")
        .insert({ nombre: args.nombre, contacto: args.contacto ?? null, notas: args.notas ?? null });
      if (error) return { ok: false, message: error.message };
      await registrarHistorial(supabase, "proveedores", `Agregado proveedor: ${args.nombre}`);
      return { ok: true, message: `Proveedor "${args.nombre}" agregado correctamente.` };
    }

    if (action.name === "agregar_producto") {
      const proveedor = args.proveedor ? await buscarProveedorId(supabase, String(args.proveedor)) : null;
      if (args.proveedor && !proveedor) {
        const suger = await sugerirCoincidencias(supabase, "proveedores", String(args.proveedor), 5);
        return { ok: false, message: mensajeNoEncontrado("proveedor", String(args.proveedor), suger.candidatos) };
      }

      const existente = await buscarProductoIdEstricto(supabase, String(args.nombre ?? ""));
      if (existente) {
        await registrarHistorial(supabase, "productos", `Reutilizado producto existente: ${existente.nombre}`);
        return {
          ok: true,
          message:
            existente.nombre !== String(args.nombre ?? "")
              ? `Producto "${args.nombre}" ya existía como "${existente.nombre}". Se reutilizó el registro existente (no se duplicó).`
              : `Producto "${existente.nombre}" ya existía. Se reutilizó el registro existente (no se duplicó).`,
        };
      }

      const { error } = await supabase.from("productos").insert({
        nombre: args.nombre,
        marca: args.marca ?? null,
        tamano: args.tamano ?? null,
        unidad: args.unidad ?? "unidad",
        proveedor_id: proveedor?.id ?? null,
      });
      if (error) return { ok: false, message: error.message };
      await registrarHistorial(supabase, "productos", `Agregado producto: ${args.nombre}`);
      return { ok: true, message: `Producto "${args.nombre}" agregado correctamente.` };
    }

    if (action.name === "agregar_modelo") {
      const producto = await buscarProductoId(supabase, String(args.producto));
      if (!producto) {
        const suger = await sugerirCoincidencias(supabase, "productos", String(args.producto), 5);
        return { ok: false, message: mensajeNoEncontrado("producto", String(args.producto), suger.candidatos) };
      }
      const costo = calcularCosto(args);
      if (costo.error) return { ok: false, message: costo.error };
      const venta = calcularVenta(args);
      if (venta.error) return { ok: false, message: venta.error };
      const { error } = await supabase.from("modelos").insert({
        producto_id: producto.id,
        nombre: args.nombre ?? args.producto,
        precio_costo: costo.precio_costo,
        precio_venta: venta.precio_venta,
        cantidad: args.cantidad ?? 0,
      });
      if (error) return { ok: false, message: error.message };
      await registrarHistorial(supabase, "modelos", `Agregado modelo "${args.nombre ?? args.producto}" a ${producto.nombre}`);
      return { ok: true, message: `Modelo "${args.nombre ?? args.producto}" agregado a "${producto.nombre}".` };
    }

    if (action.name === "actualizar_modelo") {
      const producto = await buscarProductoId(supabase, String(args.producto));
      if (!producto) {
        const suger = await sugerirCoincidencias(supabase, "productos", String(args.producto), 5);
        console.error(`[w] actualizar_modelo: no se encontró producto "${args.producto}"`, suger.candidatos);
        return { ok: false, message: mensajeNoEncontrado("producto", String(args.producto), suger.candidatos) };
      }

      const { data: modelos } = await supabase
        .from("modelos")
        .select("id, nombre")
        .eq("producto_id", producto.id);
      const listaModelos = modelos ?? [];
      let modeloEncontrado = mejorEnLista(String(args.modelo), listaModelos);
      if (!modeloEncontrado && listaModelos.length === 1) {
        modeloEncontrado = listaModelos[0];
      }
      if (!modeloEncontrado) {
        const candidatos = listaModelos
          .map((m) => ({ nombre: m.nombre, score: similitud(String(args.modelo), m.nombre) }))
          .filter((c) => c.score >= 0.5)
          .sort((a, b) => b.score - a.score);
        console.error(
          `[w] actualizar_modelo: no se encontró modelo "${args.modelo}" en "${producto.nombre}". modelos reales: ${listaModelos.map((m) => m.nombre).join(", ")}; candidatos:`,
          candidatos
        );
        return {
          ok: false,
          message: mensajeNoEncontrado("modelo", String(args.modelo), candidatos, `en "${producto.nombre}"`),
        };
      }

      const campos: Record<string, unknown> = {};
      const costo = calcularCosto(args);
      if (costo.error) return { ok: false, message: costo.error };
      const venta = calcularVenta(args);
      if (venta.error) return { ok: false, message: venta.error };
      if (costo.precio_costo !== null) campos.precio_costo = costo.precio_costo;
      if (venta.precio_venta !== null) campos.precio_venta = venta.precio_venta;
      if (args.cantidad !== undefined) campos.cantidad = args.cantidad;

      const { error } = await supabase.from("modelos").update(campos).eq("id", modeloEncontrado.id);
      if (error) return { ok: false, message: error.message };
      await registrarHistorial(supabase, "modelos", `Actualizado modelo "${modeloEncontrado.nombre}" de ${producto.nombre}: ${JSON.stringify(campos)}`);
      return { ok: true, message: `Modelo "${modeloEncontrado.nombre}" de "${producto.nombre}" actualizado.` };
    }

    if (action.name === "actualizar_producto") {
      const producto = await buscarProductoId(supabase, String(args.producto));
      if (!producto) {
        const suger = await sugerirCoincidencias(supabase, "productos", String(args.producto), 5);
        return { ok: false, message: mensajeNoEncontrado("producto", String(args.producto), suger.candidatos) };
      }

      const campos: Record<string, unknown> = {};
      if (args.marca !== undefined) campos.marca = args.marca;
      if (args.tamano !== undefined) campos.tamano = args.tamano;
      if (args.unidad !== undefined) campos.unidad = args.unidad;
      if (args.proveedor !== undefined) {
        const prov = await buscarProveedorId(supabase, String(args.proveedor));
        if (!prov) {
          const suger = await sugerirCoincidencias(supabase, "proveedores", String(args.proveedor), 5);
          return { ok: false, message: mensajeNoEncontrado("proveedor", String(args.proveedor), suger.candidatos) };
        }
        campos.proveedor_id = prov.id;
      }

      const { error } = await supabase.from("productos").update(campos).eq("id", producto.id);
      if (error) return { ok: false, message: error.message };
      await registrarHistorial(supabase, "productos", `Actualizado producto "${producto.nombre}": ${JSON.stringify(campos)}`);
      return { ok: true, message: `Producto "${producto.nombre}" actualizado.` };
    }

    return { ok: false, message: `Acción desconocida: ${action.name}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
  }
}

async function registrarHistorial(
  supabase: SupabaseClient,
  tabla: string,
  detalle: string
) {
  await supabase.from("historial_cambios").insert({ tabla, detalle });
}