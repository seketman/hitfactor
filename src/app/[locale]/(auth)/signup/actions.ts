"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { redirectWithError } from "@/lib/redirects";

export async function signup(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("display_name") ?? "").trim();

  if (!email || !password || !displayName) {
    redirectWithError("/signup", "Faltan datos");
  }

  if (password.length < 8) {
    redirectWithError("/signup", "La contraseña debe tener al menos 8 caracteres");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
      },
    },
  });

  if (error) {
    redirectWithError("/signup", error.message);
  }

  // Supabase está configurado con "Confirm email" obligatorio (ver Dashboard
  // → Auth → Email). El signup NO devuelve sesión, el user tiene que abrir
  // el mail de confirmación PRIMERO. El mensaje viejo "Cuenta creada.
  // Iniciá sesión." inducía a probar login antes de confirmar y caer en
  // "Email not confirmed". Incluimos el email destino para que el usuario
  // sepa qué casilla revisar (importa especialmente con `+alias`).
  const info =
    `Cuenta creada. Te enviamos un email a ${email} con un link de ` +
    `confirmación. Hacé click ahí y volvé a ingresar. Si no lo ves, ` +
    `revisá tu carpeta de spam.`;
  redirect(`/login?info=${encodeURIComponent(info)}`);
}
