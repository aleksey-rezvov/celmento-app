import type { ReactElement, ReactNode } from "react";

interface ScreenHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}

export function ScreenHeader({ title, subtitle, actions, back }: ScreenHeaderProps): ReactElement {
  return (
    <header className="shell-header">
      {back}
      <div className="shell-header-title">
        <h1>{title}</h1>
        {subtitle && <div className="shell-header-subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="shell-header-actions">{actions}</div>}
    </header>
  );
}
