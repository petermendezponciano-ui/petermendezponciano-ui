"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { login, type LoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="auth-button" type="submit" disabled={pending}>
      {pending ? "Entrando..." : "Entrar"}
    </button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useActionState<LoginState, FormData>(login, { error: null });

  return (
    <main className="auth-page">
      <form className="auth-card" action={formAction}>
        <h1 className="auth-title">Ferretería Méndez</h1>
        <p className="auth-subtitle">Acceso exclusivo del administrador</p>

        <label className="auth-label" htmlFor="email">
          Correo
        </label>
        <input
          id="email"
          name="email"
          className="auth-input"
          type="email"
          required
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="tu@correo.com"
        />

        <label className="auth-label" htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          className="auth-input"
          type="password"
          required
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="••••••••"
        />

        {state.error && <p className="auth-error">{state.error}</p>}

        <SubmitButton />
      </form>
    </main>
  );
}