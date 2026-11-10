# ACR Integrity — Plan de beta pública (10-11-2026)

Sitio: https://avilajose168-max.github.io/acr-intelligence-web/

## Objetivo y alcance
Beta pública gratuita para validar registro, investigaciones ACR, 5 Porqués, A3, tableros e informes con cuentas reales de prueba. **No activar pagos ni ingresar datos confidenciales de empresas en esta fase**. Publicación web correcta no equivale a validación funcional completa.

## Criterios de salida (cada escenario requiere evidencia y resultado aprobado)
- [ ] B01. Usuario nuevo: registro, confirmación si aplica, acceso, cierre y recuperación de contraseña.
- [ ] B02. Usuario independiente: guardar investigación, cerrar sesión, volver a entrar, confirmar persistencia.
- [ ] B03. Evidencias: adjuntar imagen desde PC y móvil, tomar foto, comprobar tamaño y visualización.
- [ ] B04. Mejorar redacción y 5 Porqués (mínimo 4 niveles); editar resultados y guardar.
- [ ] B05. Crear ACR con fecha inicial/final, horas detenidas y validaciones de fechas.
- [ ] B06. Alternar ACR completo / 5 Porqués / A3 sin perder información.
- [ ] B07. Exportar PDF e imprimir desde escritorio y móvil; validar formato, tablas, fotos y márgenes.
- [ ] B08. Crear compromisos con responsable, vencimiento, estado y prioridad; guardar y recargar.
- [ ] B09. Tablero personal: KPIs, filtros, tabla, selección, acciones relacionadas y cumplimiento.
- [ ] B10. Tablero corporativo: dos gráficos (Pareto y ocho semanas) con indicador compartido, PDF en dos columnas.
- [ ] B11. Tablero corporativo de compromisos: diseño ejecutivo, filtros, tabla, detalles y gráfico de cumplimiento, solo lectura para administradores.
- [ ] B12. Aislamiento de usuarios: cuenta A no puede consultar/modificar investigaciones privadas de cuenta B.
- [ ] B13. Aislamiento de compañías: usuario y administrador de empresa A no ven datos de empresa B; solicitudes pendientes no dan acceso.
- [ ] B14. Afiliación: usuario solicita ingreso, administrador aprueba/rechaza; usuario no se autoasigna privilegios.
- [ ] B15. Compartir por enlace: permisos, copia editable, expiración/revocación si el producto la admite.
- [ ] B16. Pruebas de sesión, expiración, errores de red y sincronización tras desconexión.
- [ ] B17. Pruebas de navegación en Chrome, Edge, Android e iOS.
- [ ] B18. Accesibilidad básica: etiquetas, teclado, textos legibles y contraste.
- [ ] B19. Observabilidad: errores del frontend, fallas de API y despliegue registrado.
- [ ] B20. Validación de política de privacidad, términos, canal de soporte y procedimiento de eliminación de cuenta/datos antes de promoción masiva.
- [ ] B21. Protección contra contraseñas filtradas en Auth activada y revisada.
- [ ] B22. Prueba automatizada de autenticación y reglas RLS con **dos usuarios de prueba y dos empresas**, sin información sensible.

## Incidencias
Registrar: ID, fecha, dispositivo, pantalla, pasos para reproducir, esperado, real, severidad (bloqueante/alta/media/baja), captura sin datos sensibles, estado.

## Estado inicial de revisión
- GitHub Pages: último despliegue revisado exitoso (commit 3a978e4987226fdf4ba5269658b477048f16b77d).
- Supabase: proyecto activo. RLS activada en tablas de la aplicación.
- Seguridad: revocados permisos TRUNCATE/TRIGGER/REFERENCES de roles públicos y operaciones anónimas sobre datos privados; migración `tighten_public_beta_table_grants`, verificación SQL satisfactoria.
- Alerta pendiente: protección de contraseñas filtradas deshabilitada en Supabase Auth. Referencia: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- `acr_shared_snapshots` sin políticas RLS intencionalmente; confirmar acceso exclusivamente mediante función segura y token.
- No se han ejecutado todavía pruebas end-to-end de separación entre dos cuentas reales.
- No dar por aprobado ni usar datos empresariales confidenciales hasta cerrar los puntos de seguridad y privacidad.

## Regla de lanzamiento
Beta abierta a usuarios de prueba con datos ficticios después de validar B01 y B12–B14. Lanzamiento comercial solo con todos los puntos críticos aprobados.
