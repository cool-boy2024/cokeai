export function AppLoadingSkeleton() {
  return (
    <div className="app-loading" aria-hidden="true">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-sub" />
      <div className="skeleton-grid">
        {[0, 1, 2].map((item) => (
          <div className="skeleton-card" key={item}>
            <div className="skeleton skeleton-line short" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line medium" />
          </div>
        ))}
      </div>
    </div>
  );
}
