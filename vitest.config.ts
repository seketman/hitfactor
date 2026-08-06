import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    // Explícito, no heredado del default. `tests/format-date.test.ts` fuerza
    // `process.env.TZ` para verificar que las fechas no se corran de día según
    // el timezone, y eso solo funciona en procesos de verdad: bajo
    // `pool: "threads"` la asignación no cambia el timezone que resuelve
    // `Intl` en el worker, y esos tests pasarían en verde sin validar nada.
    // Si algún día se cambia esto por performance, ese archivo falla con un
    // mensaje que lo explica — no en silencio.
    pool: "forks",
  },
});
