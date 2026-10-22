# Changesets de Billing

`@hemia/payments` es el paquete público. Las apps son privadas. Cada cambio de API o comportamiento del SDK incluye un changeset para `@hemia/payments` con impacto SemVer. El changeset inicial `payments-nest-integration.md` solicita una versión minor: desde 0.2.0 prepara 0.3.0.

```sh
bun run changeset
bun run changeset status
```

No edites versiones ni ejecutes `changeset version` en un PR de funcionalidad. El workflow de release en `main` abre el PR de versión con `bun run version:payments`, actualiza el changelog y sincroniza el lockfile. La publicación requiere un merge compuesto exclusivamente por archivos de versión, validación del tarball y `ENABLE_NPM_PUBLISH=true`.

Preparación externa, primera publicación y dependencia de Auth: [Guía de release](../docs/payments-release.md).
