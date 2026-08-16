import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = (await request.json()) as {
    producto_id?: string;
    modelo_id?: string | null;
    nombre?: string;
    marca?: string | null;
    tamano?: string | null;
    cantidad?: number | null;
    precio_costo?: number | null;
    precio_venta?: number | null;
  };

  const productoId = String(body.producto_id ?? "").trim();
  const nombre = String(body.nombre ?? "").trim();
  if (!productoId || !nombre) {
    return NextResponse.json({ error: "Faltan datos del producto" }, { status: 400 });
  }

  const marca = body.marca ? String(body.marca).trim() : null;
  const tamano = body.tamano ? String(body.tamano).trim() : null;

  const { error: errProducto } = await supabase
    .from("productos")
    .update({ nombre, marca, tamano })
    .eq("id", productoId);
  if (errProducto) {
    return NextResponse.json({ error: errProducto.message }, { status: 500 });
  }

  const modeloId = body.modelo_id ? String(body.modelo_id).trim() : null;
  if (modeloId) {
    const cantidad =
      body.cantidad != null && !Number.isNaN(body.cantidad) ? body.cantidad : null;
    const precioCosto =
      body.precio_costo != null && !Number.isNaN(body.precio_costo)
        ? body.precio_costo
        : null;
    const precioVenta =
      body.precio_venta != null && !Number.isNaN(body.precio_venta)
        ? body.precio_venta
        : null;

    const { error: errModelo } = await supabase
      .from("modelos")
      .update({ cantidad, precio_costo: precioCosto, precio_venta: precioVenta })
      .eq("id", modeloId);
    if (errModelo) {
      return NextResponse.json({ error: errModelo.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}