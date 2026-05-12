import packageJson from "../../package.json";

/**
 * Versión de la app, leída de `package.json` en build time. release-please
 * la actualiza automáticamente cuando se mergea una release PR (ver
 * `.release-please-manifest.json` y `release-please-config.json`).
 *
 * La exponemos como string acá para tener un único punto de import desde
 * la UI — si más adelante queremos sumar más metadata (build sha, deploy
 * timestamp, etc.) ya está el lugar.
 */
export const APP_VERSION = packageJson.version as string;
