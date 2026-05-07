import Link from "next/link";
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

  return (
    <AuthLayout
      title="Crear cuenta"
      subtitle="Importá resultados y seguí tu evolución."
      footer={
        <>
          ¿Ya tenés cuenta?{" "}
          <Link href="/login" className="text-accent hover:underline">
            Iniciá sesión
          </Link>
        </>
      }
    >
      {params.error && (
        <Alert tone="danger" className="mb-4" title="No se pudo crear la cuenta">
          {params.error}
        </Alert>
      )}

      <GoogleSignInButton label="Registrarme con Google" />

      <div className="my-5 flex items-center gap-3 text-xs text-fg-subtle">
        <span className="h-px flex-1 bg-border" aria-hidden />
        <span>o con tu email</span>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>

      <form action={signup} className="space-y-4">
        <Input
          label="Nombre para mostrar"
          type="text"
          name="display_name"
          required
          autoComplete="name"
          placeholder="ej. Diego Demarziani"
        />
        <Input label="Email" type="email" name="email" required autoComplete="email" />
        <Input
          label="Contraseña"
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
          hint="Mínimo 8 caracteres."
        />
        <Button type="submit" className="w-full">
          Registrarme
        </Button>
      </form>
    </AuthLayout>
  );
}
