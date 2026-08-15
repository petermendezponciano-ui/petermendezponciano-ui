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

  const body = (await request.json()) as { producto_id?: string };
  const productoId = String(body.producto_id ?? "").trim();
  if (!productoId) {
    return NextResponse.json({ error: "Falta el producto" }, { status: 400 });
  }

  await supabase.storage
    .from("productos")
    .remove([`${productoId}/foto.jpg`]);

  const { error } = await supabase.from("productos").delete().eq("id", productoId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
