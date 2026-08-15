import { createClient } from "@/lib/supabase/server";

export default async function DashboardHome() {
  const supabase = await createClient();

  const { count: totalProductos } = await supabase
    .from("productos")
    .select("*", { count: "exact", head: true });
  const { count: totalModelos } = await supabase
    .from("modelos")
    .select("*", { count: "exact", head: true });
  const { count: totalProveedores } = await supabase
    .from("proveedores")
    .select("*", { count: "exact", head: true });

  const stats = [
    { label: "Productos", value: totalProductos ?? 0, href: "/productos" },
    { label: "Modelos", value: totalModelos ?? 0, href: "/productos" },
    { label: "Proveedores", value: totalProveedores ?? 0, href: "/proveedores" },
  ];

  return (
    <div>
      <div className="stats-grid">
        {stats.map((s) => (
          <a key={s.label} href={s.href} className="stat-card">
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
