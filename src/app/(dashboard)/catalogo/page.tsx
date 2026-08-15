import { createClient } from "@/lib/supabase/server";
import CatalogoPrint from "./CatalogoPrint";

type Modelo = {
  nombre: string;
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
  modelos: Modelo[] | null;
};

type Tarjeta = {
  key: string;
  nombre: string;
  marcaModelo: string;
  tamano: string | null;
  unidad: string | null;
  cantidad: number | null;
  precioUnitario: number | null;
  precioTotal: number | null;
  fotoUrl: string | null;
};

function soles(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatoCantidad(
  n: number | null | undefined,
  unidad: string | null | undefined
): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const num = Number.isInteger(n) ? String(n) : n.toLocaleString("es-PE");
  return unidad ? `${num} ${unidad}` : num;
}

export default async function CatalogoPage() {
  const supabase = await createClient();

  // Catálogo para clientes: SOLO columnas de cliente. No se consultan costo ni
  // proveedor — esos datos internos no deben viajar en esta respuesta.
  const { data } = await supabase
    .from("productos")
    .select("id, nombre, marca, tamano, unidad, foto_url, modelos(nombre, precio_venta, cantidad)")
    .order("nombre");

  const productos = data as ProductoFila[] | null;

  const tarjetas: Tarjeta[] = [];

  (productos ?? []).forEach((p) => {
    const modelos = (p.modelos ?? []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
    if (modelos.length > 0) {
      modelos.forEach((m, i) => {
        const cantidad = m.cantidad ?? null;
        const precioUnitario = m.precio_venta ?? null;
        tarjetas.push({
          key: `${p.id}-${i}`,
          nombre: p.nombre,
          marcaModelo: m.nombre,
          tamano: p.tamano,
          unidad: p.unidad,
          cantidad,
          precioUnitario,
          precioTotal:
            precioUnitario != null && cantidad != null ? precioUnitario * cantidad : null,
          fotoUrl: p.foto_url,
        });
      });
    } else {
      tarjetas.push({
        key: `${p.id}-sin-modelo`,
        nombre: p.nombre,
        marcaModelo: p.marca ?? "—",
        tamano: p.tamano,
        unidad: p.unidad,
        cantidad: null,
        precioUnitario: null,
        precioTotal: null,
        fotoUrl: p.foto_url,
      });
    }
  });

  const clasePrecio = (v: number | null) =>
    v != null ? "value value--precio" : "value value--dash";

  return (
    <div className="catalogo">
      <div className="catalogo-barra">
        <h1 className="page-title">Catálogo</h1>
        <CatalogoPrint />
      </div>

      <div className="catalogo-encabezado">
        <div className="catalogo-titulo">
          CATÁLOGO <span>›</span> PRODUCTOS FERRETERÍA
        </div>
        <div className="catalogo-marca">FERRETERÍA IA</div>
      </div>

      <div className="catalogo-grid">
        {tarjetas.length > 0 ? (
          tarjetas.map((t) => (
            <div className="catalogo-card" key={t.key}>
              <div className="catalogo-card-header">{t.nombre}</div>
              <div className="catalogo-card-body">
                <div className="catalogo-card-foto">
                  {t.fotoUrl ? (
                    <img src={t.fotoUrl} alt={t.nombre} />
                  ) : (
                    <span className="sin-foto">Sin foto</span>
                  )}
                </div>
                <div className="catalogo-specs">
                  <table>
                    <tbody>
                      <tr>
                        <td className="label">Marca o Modelo</td>
                        <td className="value">{t.marcaModelo}</td>
                      </tr>
                      <tr>
                        <td className="label">Tamaño</td>
                        <td className="value">{t.tamano ?? "—"}</td>
                      </tr>
                      <tr>
                        <td className="label">Cantidad</td>
                        <td className="value">{formatoCantidad(t.cantidad, t.unidad)}</td>
                      </tr>
                      <tr>
                        <td className="label">Precio Unitario</td>
                        <td className={clasePrecio(t.precioUnitario)}>
                          {soles(t.precioUnitario)}
                        </td>
                      </tr>
                      <tr>
                        <td className="label">Precio Total</td>
                        <td className={clasePrecio(t.precioTotal)}>{soles(t.precioTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="catalogo-vacio">
            Aún no hay productos para mostrar en el catálogo.
          </div>
        )}
      </div>
    </div>
  );
}
