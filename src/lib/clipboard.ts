/**
 * Copiar texto al portapapeles.
 *
 * Se intenta primero la forma moderna y, si no está disponible, se cae a la
 * antigua: dentro de WebKitGTK (el motor que usa la app en Linux) la API
 * moderna a veces no existe, y quedarse solo con ella significaría un botón
 * de copiar que no copia nada.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // Sin permiso o sin contexto seguro: probamos el metodo viejo.
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = texto;
    // Fuera de la vista, pero seleccionable (display:none no funcionaria).
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
