import { useState } from "react";
import { useStore } from "../state/store";
import type { FolderNode } from "../lib/tauri";
import { createFolder, moveTrack } from "../lib/tauri";
import { reloadLibrary } from "../lib/library";

function FolderRow({ node, depth }: { node: FolderNode; depth: number }) {
  const selectedFolder = useStore((s) => s.selectedFolder);
  const setSelectedFolder = useStore((s) => s.setSelectedFolder);
  const showToast = useStore((s) => s.showToast);
  const [open, setOpen] = useState(depth < 1);
  const [dropping, setDropping] = useState(false);

  const active = selectedFolder === node.path;

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const from = e.dataTransfer.getData("text/plain");
    if (!from) return;
    try {
      await moveTrack(from, node.path);
      await reloadLibrary();
      showToast(`Movida a "${node.name}"`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo mover");
    }
  };

  return (
    <div className="folder-node">
      <div
        className={`folder-row ${active ? "active" : ""} ${dropping ? "drop-target" : ""}`}
        onClick={() => setSelectedFolder(node.path)}
        onDragOver={(e) => {
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
      >
        {node.children.length > 0 ? (
          <span
            style={{ width: 14, cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(!open);
            }}
          >
            {open ? "▾" : "▸"}
          </span>
        ) : (
          <span style={{ width: 14 }} />
        )}
        <span>{depth === 0 ? "🎵" : "📁"}</span>
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node.name}
        </span>
        <span className="count">{node.track_count > 0 ? node.track_count : ""}</span>
      </div>
      {open && node.children.length > 0 && (
        <div className="folder-children">
          {node.children.map((c) => (
            <FolderRow key={c.path} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FolderTree() {
  const library = useStore((s) => s.library);
  const selectedFolder = useStore((s) => s.selectedFolder);
  const setSelectedFolder = useStore((s) => s.setSelectedFolder);
  const showToast = useStore((s) => s.showToast);

  const newFolder = async () => {
    const parent = selectedFolder ?? library?.root;
    if (!parent) return;
    const name = window.prompt("Nombre de la nueva carpeta (ej: Merengue)");
    if (!name) return;
    try {
      await createFolder(parent, name);
      await reloadLibrary();
      showToast(`Carpeta "${name}" creada`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo crear");
    }
  };

  return (
    <div className="glass folder-tree">
      <h3>Carpetas</h3>
      <div
        className={`folder-row ${selectedFolder === null ? "active" : ""}`}
        onClick={() => setSelectedFolder(null)}
      >
        <span style={{ width: 14 }} />
        <span>🗂️</span>
        <span>Todas las canciones</span>
      </div>
      {library && <FolderRow node={library.tree} depth={0} />}
      <button className="btn" style={{ marginTop: 10, width: "100%" }} onClick={newFolder}>
        ＋ Nueva carpeta
      </button>
    </div>
  );
}
