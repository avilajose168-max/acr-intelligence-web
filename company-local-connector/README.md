# Company local connector, version 2

Company administrators configure a Windows/UNC directory in Empresas. An outbound Python connector uses a one-use pairing code to receive a seven-day company-scoped credential; only its SHA-256 hash is stored in the database. The Windows client stores its credential using current-user DPAPI. It opens no listening ports and never receives a Supabase service key or user password.

## Scope

The original fictitious connection probes remain available. Version 2 additionally backs up actual published company reports, the company brand, embedded photographs and the complete follow-up event history (reviews, execution/effectiveness and evidence). A SHA-256 version covers the frozen package. The local connector creates `paquete.json`, printable `informe.html`, evidence files and `manifest.json`, verifies every file from disk and uploads the readback in bounded blocks. The database checks the complete bytes before acknowledging a write or retrieval. A read job cannot download a cloud copy. Verified write staging bytes are cleared; original reports in the application remain intact.

Administrators can copy a selected real report for validation and opt into automatic copies when every nonempty action is completed or has a registered execution with evidence. Completion does not imply effectiveness. Publication/follow-up database triggers enqueue new versions after activation. Failures are recorded without blocking operational report saves. Activation examines the most recent 100 existing reports; later changes trigger copying automatically. Limits: 32 MiB per package and 100 pending jobs per company. The local worker must remain running; pending jobs expire after 24 hours and can be retried by the administrator. Files are organized by the report's creation month and immutable content version, not a manual monthly archive action.

Authenticated report authors may find and retrieve their own company archives while their membership is approved. Company/platform administrators may retrieve authorized company reports. Permission is checked on every list/retrieve/read request against current platform and company access. Normal users do not receive the root path or directory browsing access. Retrieval bytes are temporarily available to the requesting account for 15 minutes; worker polling clears expired temporary readbacks. No cloud-original deletion, independent-account retention cleanup, background Windows service, port opening or direct network share browsing is implemented.

The administrator must leave the connector window open. The root folder must already exist. Probes live under `ACR_Conexion_Prueba/YYYY/MM/UUID/informe.html`; real archives live under `ACR_Informes/YYYY/MM/report-UUID/content-hash/`. The worker rejects any other path/operation, symlink/junction destinations and different existing file content. Revocation, membership withdrawal, inactive company and credential expiration stop authorization. Retries use leases and idempotent identical-file writes. Supported inline evidence is PNG/JPEG/WEBP/PDF. External URLs or unsupported data MIME types fail explicitly, preserving the cloud original.

## Files

- `database/company-local-connector.sql`: one-time schema/function installation, already applied for the pilot.
- `database/real-archives.sql`: version 2 schema, RPCs, authorization, triggers and chunk verification.
- `windows/`: extractable Windows client; Python 3.10+ standard library only.
- `../company-local-storage.js`: company-admin panel, wired into `drawOrganizationStatus` and logout.
- `../real-archives.js`: real archive management and permission-scoped retrieval in Investigaciones.
- `downloads/ACR_Conector_Local_Prueba.zip`: client package published at the site's `/downloads/` path.
- `downloads/ACR_Conector_Local_V2.zip`: updated five-file client, reusing the existing DPAPI binding.

## Verification

Run `tests/connector_test.py` and `tests/real_archives_test.py` with Python for real temporary-disk file/worker tests, multiblock transfer, missing/corrupt evidence, no cloud fallback, path rejection and retries. Run `tests/panel.test.cjs` and `tests/real-archives-panel.test.cjs` with Node/jsdom for browser module flows. Run `tests/backend-security.sql` and `tests/real-archives-security.sql` through an administrative database connection: fixtures and changes roll back. They cover actual authenticated/anonymous roles, cross-company isolation, removed membership, staged multiblock readback, checksum rejection, replay, one-use pairing and automatic completed-only copies with follow-up evidence.

The client public publishable key is intentionally public; its API role cannot directly read private tables. Administrative access is checked in the database. Platform/company approval uses existing authorization functions, not editable user metadata. Windows DPAPI and actual customer directory permissions require an on-PC acceptance test; Linux tests do not establish those Windows-specific behaviors.

Before releasing cloud storage: implement a separate admin-approved retention policy, recovery drills with real company data and independent backup of the local server. Production hardening also requires signed installation/updates, Windows service operation and monitoring. This version proves real archive copying and retrieval while retaining cloud originals. A local folder alone is not a backup policy. Keep version-1 local HTML/manifest generation compatible when changing the connector, so older packages remain verifiable.
