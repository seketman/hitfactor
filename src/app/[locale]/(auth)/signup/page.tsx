import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { signup } from "./actions";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const t = await getTranslations("auth");

  return (
    <AuthLayout
      title={t("signup.title")}
      subtitle={t("signup.subtitle")}
      footer={
        <>
          {t("signup.haveAccount")}{" "}
          <Link href="/login" className="text-accent hover:underline">
            {t("signup.loginLink")}
          </Link>
        </>
      }
    >
      {params.error && (
        <Alert tone="danger" className="mb-4" title={t("signup.errorTitle")}>
          {params.error}
        </Alert>
      )}

      <GoogleSignInButton label={t("signup.googleLabel")} />

      <div className="my-5 flex items-center gap-3 text-xs text-fg-subtle">
        <span className="h-px flex-1 bg-border" aria-hidden />
        <span>{t("orWithEmail")}</span>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>

      <form action={signup} className="space-y-4">
        <Input
          label={t("signup.displayName")}
          type="text"
          name="display_name"
          required
          autoComplete="name"
          placeholder={t("signup.displayNamePlaceholder")}
        />
        <Input label={t("email")} type="email" name="email" required autoComplete="email" />
        <Input
          label={t("password")}
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
          hint={t("signup.passwordHint")}
        />
        <Button type="submit" className="w-full">
          {t("signup.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}
