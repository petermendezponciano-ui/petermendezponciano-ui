import { createClient } from "@/lib/supabase/server";
import TablaProveedores from "./tabla";

type ProveedorFila = {
  id: string;
  nombre: string;
  contacto: string | null;
  notas: string | null;
  productos: { nombre: string }[] | null;
};

export default async function ProveedoresPage({
  searchParams,
}: {
  searchParams: Promise<{ nombre?: string }>;
}) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("proveedores")
    .select("*, productos(nombre, marca)")
    .order("nombre");

  const proveedores = data as ProveedorFila[] | null;
  const params = await searchParams;

  return (
    <TablaProveedores
      proveedores={proveedores ?? []}
      destacado={params.nombre ?? null}
    />
  );
}