"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signup(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("display_name") ?? "").trim();

  if (!email || !password || !displayName) {
    redirect("/signup?error=Faltan%20datos");
  }

  if (password.length < 8) {
    redirect("/signup?error=La%20contrase%C3%B1a%20debe%20tener%20al%20menos%208%20caracteres");
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
    redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  // Si el proyecto requiere confirmación de email, no habrá session aún.
  // Igual mostramos un mensaje de éxito.
  redirect("/login?info=Cuenta%20creada.%20Inici%C3%A1%20sesi%C3%B3n.");
}
