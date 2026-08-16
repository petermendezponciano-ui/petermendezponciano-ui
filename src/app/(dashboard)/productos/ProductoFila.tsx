"use client";

import EditarProducto from "./EditarProducto";
import EliminarProducto from "./EliminarProducto";
import ProductoFoto from "./ProductoFoto";

type Fila = {
  key: string;
  productoId: string;
  modeloId: string | null;
  nombre: string;
  marca: string | null;
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

type Props = {
  fila: Fila;
  esPrimera: boolean;
};

function celdaNum(n: number | null): string {
  return n != null
    ? `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";
}

function CeldaCantidad({ fila }: { fila: Fila }) {
  return fila.cantidad != null
    ? `${fila.cantidad}${fila.unidad ? ` ${fila.unidad}` : ""}`
    : "—";
}

export default function ProductoFila({ fila, esPrimera }: Props) {
  const celdas = (
    <>
      <td>{fila.nombre}</td>
      <td>{fila.marcaModelo}</td>
      <td>{fila.tamano ?? "—"}</td>
      <td className="num">
        <CeldaCantidad fila={fila} />
      </td>
      <td className="num">{celdaNum(fila.costoUnitario)}</td>
      <td className="num">{celdaNum(fila.costoTotal)}</td>
      <td className="num">{celdaNum(fila.ventaUnitario)}</td>
      <td className="num">{celdaNum(fila.ventaTotal)}</td>
      <td className="num gan-uni">{celdaNum(fila.gananciaUnitaria)}</td>
      <td className="num gan-total">{celdaNum(fila.gananciaTotal)}</td>
      <td>
        {fila.proveedor ? (
          <a
            className="link-proveedor"
            href={`/proveedores?nombre=${encodeURIComponent(fila.proveedor)}`}
          >
            {fila.proveedor}
          </a>
        ) : (
          "—"
        )}
      </td>
    </>
  );

  if (!esPrimera) {
    return (
      <tr key={fila.key}>
        <td></td>
        {celdas}
        <td></td>
      </tr>
    );
  }

  return (
    <tr key={fila.key}>
      <td>
        <ProductoFoto
          productoId={fila.productoId}
          fotoUrl={fila.fotoUrl}
          nombre={fila.nombre}
        />
      </td>
      {celdas}
      <td>
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          <EditarProducto
            datos={{
              productoId: fila.productoId,
              modeloId: fila.modeloId,
              nombre: fila.nombre,
              marca: fila.marca ?? fila.marcaModelo,
              tamano: fila.tamano,
              unidad: fila.unidad,
              proveedor: fila.proveedor,
              modelo: fila.marcaModelo,
              cantidad: fila.cantidad,
              costo_unitario: fila.costoUnitario,
              costo_total: fila.costoTotal,
              precio_unitario: fila.ventaUnitario,
              precio_total: fila.ventaTotal,
            }}
            onClose={() => {}}
          />
          <EliminarProducto productoId={fila.productoId} />
        </div>
      </td>
    </tr>
  );
}
