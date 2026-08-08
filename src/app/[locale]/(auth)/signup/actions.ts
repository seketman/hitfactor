"use server";

import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { redirectWithError } from "@/lib/redirects";

export async function signup(formData: FormData) {
  const locale = await getLocale();
  const t = await getTranslations("actionError");
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("display_name") ?? "").trim();

  if (!email || !password || !displayName) {
    redirectWithError("/signup", t("missingSignupData"), locale);
  }

  if (password.length < 8) {
    redirectWithError("/signup", t("passwordTooShort"), locale);
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
    // Genérico a propósito. `error.message` de GoTrue viaja siempre en
    // inglés y distingue causas —entre ellas "el email ya está
    // registrado"—, así que ponerlo en la URL era enumeración de cuentas
    // servida en bandeja. El detalle va a los logs. Ver issue #199.
    redirectWithError("/signup", t("signupFailed"), locale, {
      context: "auth.signup",
      detail: error.message,
    });
  }

  // Supabase está configurado con "Confirm email" obligatorio (ver Dashboard
  // → Auth → Email). El signup NO devuelve sesión, el user tiene que abrir
  // el mail de confirmación PRIMERO. El mensaje viejo "Cuenta creada.
  // Iniciá sesión." inducía a probar login antes de confirmar y caer en
  // "Email not confirmed". Incluimos el email destino para que el usuario
  // sepa qué casilla revisar (importa especialmente con `+alias`).
  //
  // Este aviso sale igual exista o no la cuenta: Supabase no distingue el
  // re-signup de un email ya registrado, y nosotros tampoco.
  const tAuth = await getTranslations("auth");
  redirect({
    href: {
      pathname: "/login",
      query: { info: tAuth("signup.confirmSent", { email }) },
    },
    locale,
  });
}
