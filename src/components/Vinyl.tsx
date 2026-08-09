import "./vinyl.css";

/** Disco giratorio (provisional). Gira solo cuando la cancion esta sonando. */
export function Vinyl({ playing }: { playing: boolean }) {
  return (
    <div className={`vinyl-wrap ${playing ? "playing" : ""}`}>
      <div
        className="vinyl"
        style={{ animationPlayState: playing ? "running" : "paused" }}
      />
    </div>
  );
}
