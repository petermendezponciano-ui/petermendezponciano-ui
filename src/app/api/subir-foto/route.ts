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

  const form = await request.formData();
  const productoId = String(form.get("producto_id") ?? "").trim();
  const accion = String(form.get("accion") ?? "subir");
  if (!productoId) {
    return NextResponse.json({ error: "Falta el producto" }, { status: 400 });
  }

  const ruta = `${productoId}/foto.jpg`;

  if (accion === "quitar") {
    await supabase.storage.from("productos").remove([ruta]);
    const { error } = await supabase
      .from("productos")
      .update({ foto_url: null })
      .eq("id", productoId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, url: null });
  }

  const archivo = form.get("foto");
  if (!archivo || typeof archivo === "string") {
    return NextResponse.json({ error: "Falta la imagen" }, { status: 400 });
  }

  const { error: subidaError } = await supabase.storage
    .from("productos")
    .upload(ruta, archivo, {
      contentType: archivo.type || "image/jpeg",
      upsert: true,
    });
  if (subidaError) {
    return NextResponse.json({ error: `No se pudo guardar la foto: ${subidaError.message}` }, { status: 500 });
  }

  const { data } = supabase.storage.from("productos").getPublicUrl(ruta);

  const { error: dbError } = await supabase
    .from("productos")
    .update({ foto_url: data.publicUrl })
    .eq("id", productoId);
  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url: data.publicUrl });
}
