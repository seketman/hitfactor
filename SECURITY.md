# Política de seguridad

Si descubrís una vulnerabilidad de seguridad en HitFactor, agradecemos
que la reportes de forma privada antes de hacerla pública.

## Cómo reportar

**Por favor no abras un issue público para vulnerabilidades de seguridad** —
los issues son visibles a todo el mundo y un atacante podría aprovecharse
del reporte antes de que tengamos chance de arreglarlo.

Usá una de estas vías privadas:

1. **GitHub Security Advisories** (recomendado):
   [Reportar una vulnerabilidad](https://github.com/seketman/hitfactor/security/advisories/new).
   Solo vos y los mantenedores ven el reporte.
2. **Mail privado**: el contacto está en el perfil de GitHub del mantenedor
   ([@seketman](https://github.com/seketman)).

## Qué incluir

- Descripción de la vulnerabilidad y su impacto potencial
- Pasos para reproducirla (o proof of concept)
- Versión afectada (la ves al pie del sidebar de la app, ej `v1.0.1`)
- Si tenés una idea de fix, mejor — pero no es requisito

## Qué esperar

- **Acuse de recibo**: dentro de 72hs hábiles
- **Triage inicial**: 7 días para una primera evaluación de severidad e impacto
- **Fix**: depende de la severidad; los críticos en producción se priorizan
  por sobre cualquier otro trabajo

Si tu reporte resulta en un fix te acreditamos en las release notes,
salvo que prefieras quedar anónimo.

## Versiones soportadas

Solo la última versión publicada en `main` recibe parches de seguridad.
No hay branches de long-term support.

| Versión | Soportada |
|---------|-----------|
| 1.x.x   | ✅        |
| < 1.0.0 | ❌        |

## Fuera de scope

- Reportes generados exclusivamente por scanners automáticos sin contexto
  adicional o un PoC funcionando
- Issues que requieran acceso físico al dispositivo del usuario
- Issues en dependencias de terceros — reportalas upstream
  (nosotros igual recibimos parches automáticamente vía Dependabot)
