import { useStore } from "../state/store";
import { pickFolder, isTauri } from "../lib/tauri";
import { reloadLibrary } from "../lib/library";

export function Welcome() {
  const setMusicRoot = useStore((s) => s.setMusicRoot);
  const showToast = useStore((s) => s.showToast);

  const choose = async () => {
    if (!isTauri()) {
      showToast("Esta pantalla funciona dentro de la app instalada");
      return;
    }
    const folder = await pickFolder();
    if (folder) {
      setMusicRoot(folder);
      await reloadLibrary();
    }
  };

  return (
    <div className="welcome">
      <h1>Infiniity DJ</h1>
      <p>
        Para empezar, elige la carpeta de tu computador donde vive toda la musica.
        Adentro puedes tener subcarpetas por genero (merengue, salsa, vallenato...).
        Crearemos una carpeta <b>"Sin clasificar"</b> para las canciones nuevas.
      </p>
      <button className="btn btn-accent" style={{ fontSize: 18, padding: "14px 28px" }} onClick={choose}>
        📁 Elegir carpeta de musica
      </button>
    </div>
  );
}
