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

/** Logo infinito de la marca (rosa -> lila), para la barra de arriba. Estatico. */
export const IconInfinito = ({ size = 34 }: P) => (
  <svg viewBox="0 0 48 24" width={size} height={size / 2} aria-hidden>
    <defs>
      <linearGradient id="infinito-g" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#f472b6" />
        <stop offset="1" stopColor="#c4b5fd" />
      </linearGradient>
    </defs>
    <path
      d="M13 4C7 4 3.5 8 3.5 12s3.5 8 9.5 8c7 0 15-16 22-16 6 0 9.5 4 9.5 8s-3.5 8-9.5 8c-7 0-15-16-22-16z"
      fill="none"
      stroke="url(#infinito-g)"
      strokeWidth="4.2"
      strokeLinecap="round"
    />
  </svg>
);

export const IconAudifonos = ({ size = 16 }: P) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
    <path d="M12 3a9 9 0 0 0-9 9v6a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5v-1a7 7 0 0 1 14 0v1h-2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1a3 3 0 0 0 3-3v-6a9 9 0 0 0-9-9z" />
  </svg>
);
