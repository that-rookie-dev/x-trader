"use client";

/** Ambient mono vector motion for the shell backdrop. */
export function VectorAtmosphere() {
  return (
    <div className="vec-atm" aria-hidden="true">
      <svg className="vec-grid" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="vecDots" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" className="vec-ink-faint" />
          </pattern>
        </defs>
        <rect width="1200" height="800" fill="url(#vecDots)" />
        <g className="vec-orbit">
          <circle cx="200" cy="160" r="90" className="vec-stroke" />
          <circle cx="200" cy="160" r="4" className="vec-ink vec-pulse" />
        </g>
        <g className="vec-orbit vec-orbit-b">
          <circle cx="980" cy="620" r="120" className="vec-stroke" />
          <circle cx="980" cy="620" r="3" className="vec-ink vec-pulse" />
        </g>
        <path
          className="vec-draw"
          d="M80 640 C220 520, 340 700, 480 580 S780 420, 920 500 S1100 640, 1140 560"
          fill="none"
        />
        <path
          className="vec-draw vec-draw-delay"
          d="M60 220 L180 220 L220 160 L320 280 L420 200 L520 200"
          fill="none"
        />
        <g className="vec-scan">
          <line x1="0" y1="0" x2="1200" y2="0" className="vec-stroke-strong" />
        </g>
      </svg>
    </div>
  );
}
