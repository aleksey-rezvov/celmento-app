import type { ReactElement, ReactNode } from "react";

interface GroupedFieldProps {
  children: ReactNode;
  label?: string;
}

export function GroupedField({ children, label }: GroupedFieldProps): ReactElement {
  return (
    <div className="shell-field-group" role={label ? "group" : undefined} aria-label={label}>
      {children}
    </div>
  );
}
