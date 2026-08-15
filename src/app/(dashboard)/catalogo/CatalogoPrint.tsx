"use client";

export default function CatalogoPrint() {
  return (
    <div className="catalogo-print">
      <button
        type="button"
        className="catalogo-print-btn"
        onClick={() => window.print()}
      >
        Imprimir / Guardar PDF
      </button>
      <div className="catalogo-print-ayuda">
        En Android marca “Background graphics” en el diálogo de impresión para
        conservar los colores.
      </div>
    </div>
  );
}
