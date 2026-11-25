import type { ReactElement, ReactNode } from "react";
import { Character } from "@/components/Character";
import type { CharacterState } from "@/lib/characters";

interface AuthCardProps {
  title: string;
  subtitle?: string;
  illustration: CharacterState;
  intro?: ReactNode;
  children: ReactNode;
}

export function AuthCard({
  title,
  subtitle,
  illustration,
  intro,
  children,
}: AuthCardProps): ReactElement {
  const isPair = illustration === "login_pair" || illustration === "finish_pair";

  return (
    <main className="auth-screen">
      {intro}
      <div className="auth-illustration">
        <Character state={illustration} size={isPair ? 172 : 208} />
      </div>
      <section className="auth-card" aria-labelledby="auth-title">
        <header className="auth-card-heading">
          <h1 id="auth-title">{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </header>
        {children}
      </section>
    </main>
  );
}
