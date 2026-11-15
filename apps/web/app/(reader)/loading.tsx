/** Shown while a reader screen loads: soft placeholder cards in the Pocket shape. */
export default function Loading() {
  return (
    <div className="screen" aria-busy="true" aria-label="Loading">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-pill" />
      <div className="skeleton skeleton-card tall" />
    </div>
  );
}
