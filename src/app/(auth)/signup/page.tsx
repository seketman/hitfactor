import Link from "next/link";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
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
