/**
 * Iconos SVG limpios (heredan el color del texto con `currentColor`).
 * Reemplazan a los emojis de transporte, que se veian fuera de la paleta morada.
 */

type P = { size?: number };

export const IconPrev = ({ size = 20 }: P) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
    <path d="M12 6v12l-8-6zM21 6v12l-8-6z" />
  </svg>
);

export const IconNext = ({ size = 20 }: P) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
    <path d="M12 6v12l8-6zM3 6v12l8-6z" />
  </svg>
);

export const IconPlay = ({ size = 20 }: P) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
    <path d="M8 5v14l11-7z" />
  </svg>
);

export const IconPause = ({ size = 20 }: P) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
    <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
  </svg>
);
