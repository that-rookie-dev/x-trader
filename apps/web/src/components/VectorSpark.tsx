"use client";

/** Tiny animated vector glyph used near primary actions. */
export function VectorSpark({ className = "" }: { className?: string }) {
  return (
    <svg className={`vec-spark ${className}`} viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path className="vec-spark-path" d="M12 2 L13.2 9.2 L20 12 L13.2 14.8 L12 22 L10.8 14.8 L4 12 L10.8 9.2 Z" />
      <circle className="vec-spark-core" cx="12" cy="12" r="1.4" />
    </svg>
  );
}
