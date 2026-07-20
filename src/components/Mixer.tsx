import { engine } from "../audio/AudioEngine";
import { useStore } from "../state/store";

export function Mixer() {
  const crossfader = useStore((s) => s.crossfader);
  const masterVolume = useStore((s) => s.masterVolume);
  const autoMixing = useStore((s) => s.autoMixing);
  const decks = useStore((s) => s.decks);
  const showToast = useStore((s) => s.showToast);

  const canMix = !!decks.A.trackPath && !!decks.B.trackPath;

  const doMix = async () => {
    if (autoMixing) {
      engine.cancelMix();
      showToast("Mezcla cancelada");
      return;
    }
    // Mezclamos DESDE el deck que se escucha hacia el otro.
    const source = crossfader <= 0.5 ? "A" : "B";
    const target = source === "A" ? "B" : "A";
    const res = await engine.autoMix(source, target);
    if (!res.ok && res.reason) showToast(res.reason);
    else if (res.ok) showToast(`Mezcla ${source} → ${target} lista`);
  };

  return (
    <div className="glass glass-strong mixer">
      <button
        className={`btn ${autoMixing ? "btn" : "btn-accent"} mix-btn`}
        disabled={!canMix && !autoMixing}
        onClick={doMix}
      >
        {autoMixing ? "CANCELAR" : "MEZCLAR"}
        <span className="mix-sub">
          {autoMixing ? "mezcla en curso..." : "transición automática"}
        </span>
      </button>

      <div className="crossfader-block">
        <div className="crossfader-labels">
          <span>A</span>
          <span>Crossfader</span>
          <span>B</span>
        </div>
        <input
          className="vol-slider"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={crossfader}
          onChange={(e) => engine.setCrossfader(parseFloat(e.target.value))}
        />
      </div>

      <div className="master-block">
        <div className="crossfader-labels">
          <span>Volumen general</span>
          <span>{Math.round(masterVolume * 100)}%</span>
        </div>
        <input
          className="vol-slider"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={masterVolume}
          onChange={(e) => engine.setMasterVolume(parseFloat(e.target.value))}
        />
      </div>
    </div>
  );
}
