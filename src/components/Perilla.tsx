import { useRef } from "react";

/**
 * Perilla (manecilla) de efecto. Valor 0..1.
 *
 * - Arrastrar hacia arriba sube, hacia abajo baja (como en los mezcladores).
 * - Rueda del raton: pasos finos.
 * - Doble clic: vuelve al neutro.
 * - Sin animaciones continuas: se dibuja con SVG estatico y solo cambia el arco
 *   y la aguja cuando cambia el valor (rendimiento en gama baja).
 *
 * `neutro` es el valor "sin efecto" (0.5 para EQ/filtro, 0 para Voz): el arco
 * se pinta desde el neutro hasta el valor, asi se ve de un vistazo cuanto se
 * movio y hacia donde.
 */
export function Perilla({
  valor,
  neutro,
  etiqueta,
  onChange,
  titulo,
}: {
  valor: number;
  neutro: number;
  etiqueta: string;
  onChange: (v: number) => void;
  titulo?: string;
}) {
  const arrastre = useRef<{ y0: number; v0: number } | null>(null);

  // Geometria: arco de 270° (de -135° a +135°), centro arriba.
  const R = 15;
  const C = 20;
  const ang = (v: number) => (-135 + 270 * v) * (Math.PI / 180);
  const punto = (v: number, r: number) => ({ x: C + r * Math.sin(ang(v)), y: C - r * Math.cos(ang(v)) });
  const arco = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (hi - lo < 0.002) return "";
    const p1 = punto(lo, R);
    const p2 = punto(hi, R);
    const grande = (hi - lo) * 270 > 180 ? 1 : 0;
    return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${R} ${R} 0 ${grande} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  };
  const fondo = arco(0, 1);
  const activo = arco(neutro, valor);
  const aguja = punto(valor, R - 4);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    arrastre.current = { y0: e.clientY, v0: valor };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!arrastre.current) return;
    // 150 px de recorrido = todo el rango; con Shift, el doble de fino.
    const sens = e.shiftKey ? 300 : 150;
    const v = arrastre.current.v0 + (arrastre.current.y0 - e.clientY) / sens;
    onChange(Math.min(1, Math.max(0, v)));
  };
  const onPointerUp = () => {
    arrastre.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    const paso = e.shiftKey ? 0.01 : 0.04;
    onChange(Math.min(1, Math.max(0, valor + (e.deltaY < 0 ? paso : -paso))));
  };

  const desvio = valor - neutro;
  return (
    <div className="perilla" title={titulo ?? etiqueta}>
      <svg
        viewBox="0 0 40 40"
        width="40"
        height="40"
        className={`perilla-svg ${Math.abs(desvio) > 0.005 ? "activa" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => onChange(neutro)}
        onWheel={onWheel}
      >
        <path className="perilla-fondo" d={fondo} />
        {activo && <path className="perilla-activo" d={activo} />}
        <circle className="perilla-cuerpo" cx={C} cy={C} r={R - 5} />
        <line className="perilla-aguja" x1={C} y1={C} x2={aguja.x.toFixed(2)} y2={aguja.y.toFixed(2)} />
      </svg>
      <span className="perilla-etiqueta">{etiqueta}</span>
    </div>
  );
}
