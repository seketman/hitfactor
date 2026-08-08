import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Alert } from "@/components/ui/Alert";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { isInternalAppPath } from "@/lib/paths";
import { login } from "./actions";

/**
 * Error codes the auth route handlers can hand us. They live outside the
 * `[locale]` segment and so have no locale to translate with — they send a
 * code, this page turns it into text (#218). Same split the parsers use
 * with `ParserError`.
 *
 * Whitelisted rather than interpolated straight into `t()`, so a crafted
 * `?authError=` can't probe the message catalogue.
 */
const AUTH_ERROR_CODES = new Set(["exchangeFailed", "confirmFailed"]);

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    info?: string;
    next?: string;
    authError?: string;
  }>;
}) {
  const params = await searchParams;
  const t = await getTranslations("auth");
  // Validamos el `next` acá mismo: si no es interno, no lo metemos en el
  // form (la server action también lo re-valida — defense in depth).
  const next = isInternalAppPath(params.next) ? params.next : null;
  const authError =
    params.authError && AUTH_ERROR_CODES.has(params.authError)
      ? params.authError
      : null;

  return (
    <AuthLayout
      title={t("login.title")}
      subtitle={t("login.subtitle")}
      footer={
        <>
          {t("login.noAccount")}{" "}
          <Link href="/signup" className="text-accent hover:underline">
            {t("login.signUpLink")}
          </Link>
        </>
      }
    >
      {params.error && (
        <Alert tone="danger" className="mb-4" title={t("login.errorTitle")}>
          {params.error}
        </Alert>
      )}
      {authError && (
        <Alert tone="danger" className="mb-4" title={t("login.errorTitle")}>
          {t(`login.authError.${authError}` as "login.authError.exchangeFailed")}
        </Alert>
      )}
      {params.info && (
        <Alert tone="info" className="mb-4">
          {params.info}
        </Alert>
      )}

      <GoogleSignInButton label={t("continueWithGoogle")} />

      <div className="my-5 flex items-center gap-3 text-xs text-fg-subtle">
        <span className="h-px flex-1 bg-border" aria-hidden />
        <span>{t("orWithEmail")}</span>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>

      <form action={login} className="space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        <Input label={t("email")} type="email" name="email" required autoComplete="email" />
        <PasswordInput
          label={t("password")}
          name="password"
          required
          autoComplete="current-password"
        />
        <Button type="submit" className="w-full">
          {t("login.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}
