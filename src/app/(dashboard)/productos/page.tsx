import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ProductoFoto from "./ProductoFoto";
import EliminarProducto from "./EliminarProducto";

type Modelo = {
  nombre: string;
  precio_costo: number | null;
  precio_venta: number | null;
  cantidad: number | null;
};

type ProductoFila = {
  id: string;
  nombre: string;
  marca: string | null;
  tamano: string | null;
  unidad: string | null;
  foto_url: string | null;
  proveedores: { nombre: string } | null;
  modelos: Modelo[] | null;
};

function soles(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function ProductosPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("productos")
    .select("*, proveedores(nombre), modelos(nombre, precio_costo, precio_venta, cantidad)")
    .order("nombre");

  const productos = data as ProductoFila[] | null;

  type Fila = {
    key: string;
    productoId: string;
    nombre: string;
    fotoUrl: string | null;
    esPrimera: boolean;
    marcaModelo: string;
    tamano: string | null;
    unidad: string | null;
    cantidad: number | null;
    costoUnitario: number | null;
    costoTotal: number | null;
    ventaUnitario: number | null;
    ventaTotal: number | null;
    gananciaUnitaria: number | null;
    gananciaTotal: number | null;
    proveedor: string | null;
  };

  const filas: Fila[] = [];
  const productosConFila = new Set<string>();

  (productos ?? []).forEach((p) => {
    const modelos = (p.modelos ?? []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
    const proveedor = p.proveedores?.nombre ?? null;
    const esPrimera = !productosConFila.has(p.id);
    productosConFila.add(p.id);

    const construir = (m: Modelo | null, key: string, marcaModelo: string): Fila => {
      const cantidad = m?.cantidad ?? null;
      const costoUnitario = m?.precio_costo ?? null;
      const ventaUnitario = m?.precio_venta ?? null;
      const costoTotal =
        costoUnitario != null && cantidad != null ? costoUnitario * cantidad : null;
      const ventaTotal =
        ventaUnitario != null && cantidad != null ? ventaUnitario * cantidad : null;
      const gananciaUnitaria =
        ventaUnitario != null && costoUnitario != null ? ventaUnitario - costoUnitario : null;
      const gananciaTotal =
        gananciaUnitaria != null && cantidad != null ? gananciaUnitaria * cantidad : null;

      return {
        key,
        productoId: p.id,
        nombre: p.nombre,
        fotoUrl: p.foto_url,
        esPrimera,
        marcaModelo,
        tamano: p.tamano,
        unidad: p.unidad,
        cantidad,
        costoUnitario,
        costoTotal,
        ventaUnitario,
        ventaTotal,
        gananciaUnitaria,
        gananciaTotal,
        proveedor,
      };
    };

    if (modelos.length > 0) {
      modelos.forEach((m, i) => filas.push(construir(m, `${p.id}-${i}`, m.nombre)));
    } else {
      filas.push(construir(null, `${p.id}-sin-modelo`, p.marca ?? "—"));
    }
  });

  return (
    <div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th rowSpan={2}>Foto</th>
              <th rowSpan={2}>Nombre</th>
              <th rowSpan={2}>Marca o modelo</th>
              <th rowSpan={2}>Tamaño</th>
              <th rowSpan={2} className="num">Cantidad</th>
              <th colSpan={2} className="th-group">Costo</th>
              <th colSpan={2} className="th-group">Precio de venta</th>
              <th colSpan={2} className="th-group">Ganancia</th>
              <th rowSpan={2}>Proveedor</th>
              <th rowSpan={2}>Acciones</th>
            </tr>
            <tr>
              <th className="num">Unitario</th>
              <th className="num">Total</th>
              <th className="num">Unitario</th>
              <th className="num">Total</th>
              <th className="num">Unitario</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.length > 0 ? (
              filas.map((f) => (
                <tr key={f.key}>
                  <td>
                    {f.esPrimera ? (
                      <ProductoFoto
                        productoId={f.productoId}
                        fotoUrl={f.fotoUrl}
                        nombre={f.nombre}
                      />
                    ) : (
                      ""
                    )}
                  </td>
                  <td>{f.nombre}</td>
                  <td>{f.marcaModelo}</td>
                  <td>{f.tamano ?? "—"}</td>
                  <td className="num">
                    {f.cantidad != null
                      ? `${f.cantidad}${f.unidad ? ` ${f.unidad}` : ""}`
                      : "—"}
                  </td>
                  <td className="num">{soles(f.costoUnitario)}</td>
                  <td className="num">{soles(f.costoTotal)}</td>
                  <td className="num">{soles(f.ventaUnitario)}</td>
                  <td className="num">{soles(f.ventaTotal)}</td>
                  <td className="num gan-uni">
                    {f.gananciaUnitaria != null ? soles(f.gananciaUnitaria) : "—"}
                  </td>
                  <td className="num gan-total">
                    {f.gananciaTotal != null ? soles(f.gananciaTotal) : "—"}
                  </td>
                  <td>
                    {f.proveedor ? (
                      <Link
                        className="link-proveedor"
                        href={`/proveedores?nombre=${encodeURIComponent(f.proveedor)}`}
                      >
                        {f.proveedor}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {f.esPrimera ? <EliminarProducto productoId={f.productoId} /> : ""}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={13} className="empty-cell">
                  Aún no hay productos. Se agregarán cuando hables con la IA.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}