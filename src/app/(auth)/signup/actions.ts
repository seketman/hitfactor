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

  // Si el proyecto requiere confirmación de email, no habrá session aún.
  // Igual mostramos un mensaje de éxito.
  redirect("/login?info=Cuenta%20creada.%20Inici%C3%A1%20sesi%C3%B3n.");
}
