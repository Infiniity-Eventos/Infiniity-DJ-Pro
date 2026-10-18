import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import type { FolderNode } from "../lib/tauri";
import { moveTrack } from "../lib/tauri";
import { reloadLibrary } from "../lib/library";

/**
 * Panel izquierdo con DOS modos:
 * - GÉNEROS: las carpetas de la biblioteca, planas (una por género), con
 *   "Sin clasificar" de primera para tenerla a mano. Se puede soltar una
 *   cancion encima para moverla (solo en el PC original).
 * - ARTISTAS: la lista de artistas que sale de la etiqueta de cada cancion
 *   (la escribe la skill /Organizar_Canciones, uniforme). Clic = todas las
 *   canciones de ese artista.
 * Sin "Nueva carpeta": las carpetas las crea la skill al organizar.
 */
const SIN_CLASIFICAR = "Sin clasificar";

/** "A x B x C" -> ["A", "B", "C"] (el separador lo pone la skill /Organizar_Canciones). */
export function partirArtistas(artist: string | null): string[] {
  if (!artist) return [];
  return artist
    .split(" x ")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

function FilaCarpeta({ node }: { node: FolderNode }) {
  const selectedFolder = useStore((s) => s.selectedFolder);
  const setSelectedFolder = useStore((s) => s.setSelectedFolder);
  const showToast = useStore((s) => s.showToast);
  const modoEquipo = useStore((s) => s.sync?.rol === "equipo");
  const [dropping, setDropping] = useState(false);
  const active = selectedFolder === node.path;

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const from = e.dataTransfer.getData("text/plain");
    if (!from) return;
    // En una PC del equipo mover = borrar en "Sin clasificar" (en TODAS) +
    // agregar en una carpeta que se revierte. La cancion desapareceria.
    if (modoEquipo) {
      showToast("Las carpetas las organiza el PC original. Aquí no se mueven canciones.");
      return;
    }
    try {
      await moveTrack(from, node.path);
      await reloadLibrary();
      showToast(`Movida a "${node.name}"`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo mover");
    }
  };

  return (
    <div
      className={`folder-row ${active ? "active" : ""} ${dropping ? "drop-target" : ""}`}
      onClick={() => setSelectedFolder(node.path)}
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
      title={node.path}
    >
      <span>{node.name === SIN_CLASIFICAR ? "📥" : "📁"}</span>
      <span className="folder-name">{node.name}</span>
      <span className="count">{node.track_count}</span>
    </div>
  );
}

export function FolderTree() {
  const library = useStore((s) => s.library);
  const selectedFolder = useStore((s) => s.selectedFolder);
  const setSelectedFolder = useStore((s) => s.setSelectedFolder);
  const selectedArtist = useStore((s) => s.selectedArtist);
  const setSelectedArtist = useStore((s) => s.setSelectedArtist);
  const vista = useStore((s) => s.vistaCarpetas);
  const setVista = useStore((s) => s.setVistaCarpetas);
  // Buscador del panel: filtra carpetas o artistas por nombre.
  const [filtro, setFiltro] = useState("");
  const q = filtro.trim().toLowerCase();

  // Carpetas de primer nivel: "Sin clasificar" primero, el resto por nombre.
  const carpetas = useMemo(() => {
    const hijos = library?.tree.children ?? [];
    const sin = hijos.filter((n) => n.name === SIN_CLASIFICAR);
    const resto = hijos
      .filter((n) => n.name !== SIN_CLASIFICAR)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    return [...sin, ...resto];
  }, [library]);

  // Artistas desde la etiqueta. "Bad Bunny x Jhay Cortez" son DOS artistas:
  // la cancion cuenta para cada uno (asi "Bad Bunny" junta tambien sus
  // colaboraciones). Sin etiqueta = "Sin artista" (lo que la skill no ha organizado).
  const artistas = useMemo(() => {
    const conteo = new Map<string, number>();
    for (const t of library?.tracks ?? []) {
      const partes = partirArtistas(t.artist);
      if (partes.length === 0) {
        conteo.set("", (conteo.get("") ?? 0) + 1);
        continue;
      }
      for (const a of partes) conteo.set(a, (conteo.get(a) ?? 0) + 1);
    }
    const lista = [...conteo.entries()]
      .filter(([a]) => a !== "")
      .sort((x, y) => x[0].localeCompare(y[0], "es"));
    const sin = conteo.get("") ?? 0;
    return { lista, sin };
  }, [library]);

  const total = library?.tracks.length ?? 0;
  const todasActiva = vista === "generos" ? selectedFolder === null : selectedArtist === null;

  return (
    <div className="glass folder-tree">
      <div className="folder-tabs">
        <button className={`btn folder-tab ${vista === "generos" ? "active" : ""}`} onClick={() => setVista("generos")}>
          Géneros
        </button>
        <button className={`btn folder-tab ${vista === "artistas" ? "active" : ""}`} onClick={() => setVista("artistas")}>
          Artistas
        </button>
      </div>

      <div
        className={`folder-row ${todasActiva ? "active" : ""}`}
        onClick={() => (vista === "generos" ? setSelectedFolder(null) : setSelectedArtist(null))}
      >
        <span>🗂️</span>
        <span className="folder-name">Todas las canciones</span>
        <span className="count">{total}</span>
      </div>

      <input
        className="dl-input folder-buscar"
        placeholder={vista === "generos" ? "Buscar carpeta..." : "Buscar artista..."}
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
      />

      {vista === "generos" &&
        carpetas.filter((n) => !q || n.name.toLowerCase().includes(q)).map((n) => <FilaCarpeta key={n.path} node={n} />)}

      {vista === "artistas" && (
        <>
          {artistas.lista.filter(([a]) => !q || a.toLowerCase().includes(q)).map(([a, n]) => (
            <div
              key={a}
              className={`folder-row ${selectedArtist === a ? "active" : ""}`}
              onClick={() => setSelectedArtist(a)}
              title={a}
            >
              <span>🎤</span>
              <span className="folder-name">{a}</span>
              <span className="count">{n}</span>
            </div>
          ))}
          {artistas.sin > 0 && (
            <div className="folder-row sync-dim" title="Canciones que la skill todavía no ha organizado">
              <span>❔</span>
              <span className="folder-name">Sin artista (sin organizar)</span>
              <span className="count">{artistas.sin}</span>
            </div>
          )}
          {artistas.lista.length === 0 && (
            <div className="folder-hint">Aquí aparecen los artistas cuando la skill /Organizar_Canciones organiza las canciones.</div>
          )}
        </>
      )}
    </div>
  );
}
