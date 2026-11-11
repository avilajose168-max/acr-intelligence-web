# Guardado personal en la nube

La copia completa del espacio personal (investigaciones, evidencias, compromisos y personalización) se guarda en `acr_personal_workspaces`, separada de las publicaciones corporativas. La migración `20261111172633_personal_workspace_cloud_sync` ya se aplicó en el proyecto de Supabase de ACR.

## Comportamiento

- Al entrar desde otro equipo se carga la copia de la cuenta.
- Cada edición guarda primero una copia local pendiente y luego solicita confirmación del servidor.
- Sin Internet se mantiene la copia pendiente y se reintenta al recuperar conexión, volver a la pestaña o cada 30 segundos mientras está visible.
- La revisión del servidor impide que dos equipos se sobrescriban silenciosamente. Ante un conflicto se detiene el envío y aparece «Conservar ambas copias»: conserva las investigaciones diferentes como copias separadas y crea un respaldo local exacto. La personalización de nube prevalece en campos en conflicto; la local queda en el respaldo.
- Las eliminaciones e importaciones del espacio personal se sincronizan. La publicación corporativa sigue siendo independiente.
- La primera carga de investigaciones antiguas es automática si aún no existe una copia de nube. Si ya hay otra, se pide conservar ambas.
- Las evidencias siguen dentro del documento y sujetas al espacio disponible del navegador; no se añadió almacenamiento de archivos separado. El servidor limita cada espacio a 15 MB.

## Validación completada

`node --test tests/cloud-workspace.test.cjs`: migración de datos antiguos con fotos, segundo dispositivo, desconexión/reinicio, conflicto y recuperación de ambas versiones, edición durante envío, cambio de cuenta, eliminación y pestañas simultáneas.

`node tests/logic.test.cjs`: lógica existente de investigación, calendarios y tableros.

En Supabase se verificaron dentro de una transacción revertida: guardado real, rechazo de revisión antigua y formato inválido, aislamiento entre dos usuarios y bloqueo de acceso anónimo. Los usuarios de prueba y sus datos no quedaron guardados.

## Antes de publicar

Revisar el despliegue de Vercel y probar el acceso real desde dos navegadores con una cuenta de prueba. La conexión de Vercel utilizada durante esta implementación no mostró el proyecto `acr-integrity`; no se creó otro proyecto ni se modificó el dominio.

Pendientes previos: protección de contraseñas filtradas de Supabase Auth y validación integral de registro/recuperación/PDF. Los tests de sincronización no sustituyen esas pruebas.
