import "./vinyl.css";

/** Disco del deck (quieto). Sonando lleva un aro rosado. */
export function Vinyl({ playing }: { playing: boolean }) {
  return (
    <div className={`vinyl-wrap ${playing ? "playing" : ""}`}>
      <div className="vinyl" />
    </div>
  );
}
