import Link from "next/link";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Alert } from "@/components/ui/Alert";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; info?: string }>;
}) {
  const params = await searchParams;

  return (
    <AuthLayout
      title="Ingresar"
      subtitle="Tu historial de matches y stages."
      footer={
        <>
          ¿No tenés cuenta?{" "}
          <Link href="/signup" className="text-accent hover:underline">
            Registrate
          </Link>
        </>
      }
    >
      {params.error && (
        <Alert tone="danger" className="mb-4" title="No se pudo ingresar">
          {params.error}
        </Alert>
      )}
      {params.info && (
        <Alert tone="info" className="mb-4">
          {params.info}
        </Alert>
      )}

      <GoogleSignInButton label="Continuar con Google" />

      <div className="my-5 flex items-center gap-3 text-xs text-fg-subtle">
        <span className="h-px flex-1 bg-border" aria-hidden />
        <span>o con tu email</span>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>

      <form action={login} className="space-y-4">
        <Input label="Email" type="email" name="email" required autoComplete="email" />
        <PasswordInput
          label="Contraseña"
          name="password"
          required
          autoComplete="current-password"
        />
        <Button type="submit" className="w-full">
          Ingresar
        </Button>
      </form>
    </AuthLayout>
  );
}
