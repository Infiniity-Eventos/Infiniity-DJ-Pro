# Ícono y logo de Infiniity DJ

Marca: tema lavanda (`src/styles/theme.css`). Morado `#7C3AED`, morado oscuro
`#5B21B6`, morado claro `#A855F7`, rosa `#E5218F`, contorno `#2E1065`.
Personaje: Jimbo DJ, el mismo de `public/jimbo.webp`.

**Referencia que se adjunta en Gemini:** `~/Descargas/Jimbo-DJ-REFERENCIA.png`
(exportada de `public/jimbo.webp` sobre blanco, 520x510).

El ícono anterior era un vinilo morado sobre fondo casi negro: genérico y
desentonaba con el tema claro.

## Bloque de estilo (repetir idéntico en todo el set)
Bold flat cartoon illustration in the exact style of the reference: thick dark
purple outlines (#2E1065), flat cel-shaded colors with one simple soft shade,
simple shapes that stay legible when small.
Palette: #7C3AED, #5B21B6, #A855F7, #E5218F, #2E1065, white.

---

## 1. Ícono de la app
- Tipo A (recortable), croma verde `#00FF00`, cuadrado 1:1.
- Archivo fuente: `src-tauri/icons/fuente-icono.png` (1024x1024, transparente).
- Después: `npx tauri icon src-tauri/icons/fuente-icono.png` genera los 32x32,
  128x128, `icon.ico`, `icon.icns` y todos los `Square*.png` de golpe.
- Estado: LISTA (2026-10-24, v2). Original en `originales/icono-v2-aprobado.jpeg`,
  recorte en `originales/icono-recortado.png`, fuente cuadrada en
  `src-tauri/icons/fuente-icono.png`. Probada a 32 px antes de aprobar: se leen
  cara, audifonos y gorro. Croma plano (desv < 2), sin marca de Gemini.
  v1 RECHAZADA (misma fecha). Fallos: un cascabel salia del cuadro y quedo
  cortado por el borde; el brazo derecho se fundio en una forma angular rara; y a
  32 px el gorro se comia la cara. Prompt v2 abajo: sin brazos ni manos, cara mas
  grande, gorro compacto y obligado a quedar dentro del cuadro.

```
Using the attached image of Jimbo as the exact character reference, draw a single app icon tile: a rounded square with a generous corner radius (about 22% of its side), filled with a smooth purple gradient going from #7C3AED at the top to #5B21B6 at the bottom, with a thin lighter purple (#A855F7) inner rim along its edge. Inside the tile, show ONLY Jimbo's head and the very top of his shoulders, facing the viewer, centered. His face is big and bold: it fills about half of the tile's height, so it stays readable at 32 by 32 pixels. Keep his face identical to the reference: same big dark eyes, eyebrows, warm friendly smile, ears, skin tone, round cute proportions and simple soft shading, not a detailed or adult-looking face. He wears the same purple three-pointed jester hat with white bells, kept compact with short points, and the same big chunky over-ear DJ headphones in dark violet (#2E1065) with magenta (#E5218F) ear cups, sitting on his head under the hat. Magenta collar at his shoulders. Very important: his head, his hat, every hat point and every bell are COMPLETELY INSIDE the tile, with a clear even gap of flat purple all the way around them; nothing touches, overlaps or crosses the tile edge, and nothing is cut off by the tile. Do not draw his arms or his hands at all. Bold flat cartoon illustration in the exact style of the reference: thick dark purple outlines (#2E1065), flat cel-shaded colors with one simple soft shade, high contrast between Jimbo and the purple behind him, very simple shapes, no tiny details, no thin lines. Palette: #7C3AED, #5B21B6, #A855F7, #E5218F, #2E1065, white. The tile is fully visible and centered, with about 15% empty margin on every side, nothing cropped. Crisp clean edges, no motion blur, no depth of field. On a perfectly flat, solid pure green (#00FF00) background, uniform edge to edge, with no gradient, no texture, no vignette, no floor. No drop shadow, no cast shadow, no glow, no reflection, no white outline or sticker border around the tile. No green anywhere on the tile or the character. Square 1:1. No text, no letters, no numbers, no watermark, no music notes.
```

## 2. Logo horizontal con el nombre
- Tipo C (con texto) + recortable, croma verde `#00FF00`, 16:9.
- Archivo final: `public/logo-infiniity-dj.webp` (para la bienvenida, el README
  y el aviso de actualización).
- OJO: el nombre lleva **doble i** — "Infiniity".
- Estado: TEXTO APROBADO (2026-10-24). Gemini escribio "Infiniity" bien, con la
  doble i. El original esta en `originales/logo-texto-aprobado.jpeg`.
  El Jimbo de esa imagen NO se usa: era un dibujo distinto al del icono (cara mas
  chica, gorro mas largo). El logo se ARMA pegando el cuadro del icono v2 junto a
  ese texto, para que el icono y el logo sean la misma figura.
- HECHO (2026-10-24): `public/logo-infiniity-dj.webp` (transparente, 1045x360,
  para la app) y `public/logo-readme.webp` (sobre tarjeta lavanda, para GitHub:
  el texto morado oscuro desaparece en el tema oscuro de GitHub).
  La pantalla de bienvenida se dejo como estaba: ya tiene a Jimbo asomado + el
  titulo en degradado, y meter el logo encima era repetir lo mismo.

```
Using the attached image of Jimbo as the exact character reference, draw a horizontal brand lockup for a DJ app. On the left, a rounded square tile with a generous corner radius filled with a purple gradient from #7C3AED to #5B21B6, and inside it Jimbo from the chest up, facing the viewer, keeping his face identical to the reference: same big dark eyes, eyebrows, warm smile, dark brown hair, skin tone and proportions, the same purple three-pointed jester hat with white bells, the purple outfit with magenta collar, the same big chunky over-ear DJ headphones in dark violet (#2E1065) with magenta (#E5218F) ear cups, and the same bold dark purple outline style. To the right of the tile, on two lines and vertically centered against it, the wordmark: the word "Infiniity" in a bold rounded geometric sans-serif in dark purple (#2E1065), and directly below it the smaller word "DJ" in the same bold rounded sans-serif in magenta (#E5218F), left aligned with the word above. The brand name is deliberately spelled with a double i in the middle: I, N, F, I, N, I, I, T, Y. Render only the two quoted words, exactly as written, and nothing else. Flat vector logo style, bold and clean, high contrast, simple shapes that stay legible when small. Palette: #7C3AED, #5B21B6, #A855F7, #E5218F, #2E1065, white. The whole lockup is fully visible and centered, with about 18% empty margin on every side, nothing cropped. Crisp clean edges, no motion blur, no depth of field. On a perfectly flat, solid pure green (#00FF00) background, uniform edge to edge, with no gradient, no texture, no vignette, no floor. No drop shadow, no cast shadow, no glow, no reflection, no white outline or sticker border. No green anywhere on the lockup. Wide 16:9. No extra text, no tagline, no watermark, no music notes.
```

## Aprendido en este set
- Pedir "nothing touches the tile edge" NO basta si el personaje lleva brazos:
  en la v1 el brazo derecho se fundio en una forma rara. Quitar brazos y manos
  del prompt arreglo el ingrediente que se deformaba.
- A 32 px manda el tamano de la CARA, no el detalle. Hay que pedir
  explicitamente "his face fills about half of the tile's height".
- Gemini SI escribio "Infiniity" con la doble i cuando se deletrea en el prompt
  letra por letra ("I, N, F, I, N, I, I, T, Y").
- `npx tauri icon` crea ademas `icons/android/` e `icons/ios/`, inutiles en esta
  app de escritorio: se borran.
