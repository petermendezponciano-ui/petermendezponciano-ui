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

  const body = (await request.json()) as { proveedor_id?: string };
  const proveedorId = String(body.proveedor_id ?? "").trim();
  if (!proveedorId) {
    return NextResponse.json({ error: "Falta el proveedor" }, { status: 400 });
  }

  const { error } = await supabase.from("proveedores").delete().eq("id", proveedorId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
