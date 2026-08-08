"use server";

import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { redirectWithError } from "@/lib/redirects";
import { safeBackPath } from "@/lib/paths";

export async function login(formData: FormData) {
  const locale = await getLocale();
  const t = await getTranslations("actionError");
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  // Destino post-login. Validado con safeBackPath (whitelist de rutas
  // internas) para evitar open redirects. Si el campo viene vacío o con
  // basura, caemos al dashboard como antes.
  const nextRaw = formData.get("next");
  const next = safeBackPath(
    typeof nextRaw === "string" ? nextRaw : null,
    "/dashboard",
  );

  if (!email || !password) {
    redirectWithError("/login", t("missingCredentials"), locale);
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
      // Este mensaje distingue "existe pero sin confirmar" de "credenciales
      // inválidas", así que sí permite enumerar cuentas sin confirmar. Se
      // conserva a propósito: es una decisión de UX deliberada (ver el
      // comentario de arriba) y sacarla mandaría al usuario a probar la
      // contraseña una y otra vez sin saber que el problema es otro. La
      // superficie que abre es acotada — sólo cuentas registradas y nunca
      // confirmadas — y el signup ya no confirma ni desmiente nada.
      redirectWithError("/login", t("emailNotConfirmed", { email }), locale, {
        context: "auth.login",
        detail: error.message,
      });
    }
    // Todo el resto colapsa en un mensaje genérico. Antes viajaba
    // `error.message` de GoTrue tal cual: siempre en inglés (lo emite el
    // SDK, no la app) y distinguiendo "usuario no existe" de "contraseña
    // incorrecta", que es enumeración de cuentas servida en la URL.
    redirectWithError("/login", t("invalidCredentials"), locale, {
      context: "auth.login",
      detail: error.message,
    });
  }

  redirect({ href: next, locale });
}
