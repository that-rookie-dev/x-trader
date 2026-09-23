import type { ReactNode } from "react";

type PageHeaderProps = {
  kicker: string;
  title: string;
  lede?: string;
  actions?: ReactNode;
};

/** Shared page chrome for every non-desk route. */
export function PageHeader({ kicker, title, lede, actions }: PageHeaderProps) {
  return (
    <header className="page-hero">
      <div className="page-hero-copy">
        <p className="eyebrow">
          <span className="eyebrow-dot" aria-hidden="true" />
          {kicker}
        </p>
        <h1>{title}</h1>
        {lede ? <p className="lede">{lede}</p> : null}
      </div>
      {actions ? <div className="page-hero-actions">{actions}</div> : null}
    </header>
  );
}
