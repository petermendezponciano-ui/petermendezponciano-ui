"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type LoginState = { error: string | null };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const mensaje = error.message ?? "";
    let msg: string;
    if (/invalid login credentials/i.test(mensaje)) {
      msg = "Correo o contraseña incorrectos. Revisa mayúsculas y espacios.";
    } else if (/email not confirmed/i.test(mensaje)) {
      msg = "Este correo aún no está confirmado.";
    } else if (/429|rate limit|too many/i.test(mensaje)) {
      msg = "Demasiados intentos. Espera un minuto y vuelve a intentar.";
    } else if (/fetch|network|ERR_/i.test(mensaje)) {
      msg = "Sin conexión con el servidor de acceso. Revisa el Wi-Fi.";
    } else {
      msg = `No se pudo entrar: ${mensaje}`;
    }
    return { error: msg };
  }

  redirect("/");
}