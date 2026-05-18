"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { redirectWithError } from "@/lib/redirects";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirectWithError("/login", "Faltan credenciales");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Caso típico post-signup: el usuario intenta ingresar antes de hacer
    // click en el link del mail. Supabase devuelve `code: "email_not_confirmed"`
    // (y `message: "Email not confirmed"`) — el mensaje crudo no dice qué
    // hacer. Lo mapeamos a algo accionable, con el email destino para que
    // sepa qué casilla revisar.
    //
    // Fallback por mensaje: por si el `code` no viene seteado en alguna
    // versión del SDK, matcheamos contra el texto canónico también.
    const code = (error as { code?: string }).code;
    const isUnconfirmed =
      code === "email_not_confirmed" ||
      /email\s+not\s+confirmed/i.test(error.message ?? "");
    if (isUnconfirmed) {
      redirectWithError(
        "/login",
        `Tu email todavía no está confirmado. Revisá la casilla de ${email} y hacé click en el link que te mandamos al registrarte. Si no lo ves, revisá tu carpeta de spam.`,
      );
    }
    redirectWithError("/login", error.message);
  }

  redirect("/dashboard");
}
