# Company local connector pilot

Company administrators configure a Windows/UNC directory in Empresas. An outbound Python connector uses a one-use pairing code to receive a seven-day company-scoped credential; only its SHA-256 hash is stored in the database. The Windows client stores its credential using current-user DPAPI. It opens no listening ports and never receives a Supabase service key or user password.

## Scope

Only fictitious HTML connection documents are queued. A write is confirmed after disk readback and hash verification. A separate retrieval job supplies no document content to the worker: it must read the existing file from disk. The platform previews only the verified returned document in a sandboxed iframe. No real investigations, photos, evidence, retention policies, cloud deletion, background Windows service, automatic monthly archival, or normal-user archival retrieval are enabled by this pilot.

The administrator must leave the connector window open. The root folder must already exist. Files live under `ACR_Conexion_Prueba/YYYY/MM/UUID/informe.html`; the worker rejects any other path or operation and will not overwrite different existing content. Revocation, membership withdrawal, inactive company, and credential expiration stop authorization. Retries use short leases and idempotent identical-file writes.

## Files

- `database/company-local-connector.sql`: one-time schema/function installation, already applied for the pilot.
- `windows/`: extractable Windows client; Python 3.10+ standard library only.
- `../company-local-storage.js`: company-admin panel, wired into `drawOrganizationStatus` and logout.
- `downloads/ACR_Conector_Local_Prueba.zip`: client package published at the site's `/downloads/` path.

## Verification

Run `python company-local-connector/tests/connector_test.py` for real temporary-disk file and worker tests. Run `node company-local-connector/tests/panel.test.cjs` after installing jsdom and setting `NODE_PATH` appropriately. Run `tests/backend-security.sql` through a database administrative connection: all fake fixtures and changes are rolled back. It verifies actual authenticated/anonymous roles, company isolation, one-use pairing, invalid credentials, content verification, replay protection and revocation.

The client public publishable key is intentionally public; its API role cannot directly read private tables. Administrative access is checked in the database. Platform/company approval uses existing authorization functions, not editable user metadata. Windows DPAPI and actual customer directory permissions require an on-PC acceptance test; Linux tests do not establish those Windows-specific behaviors.

Before expanding to real archival: implement versioned report/evidence packages, durable indexing, admin-approved retention, end-user document authorization, verified restore, service installation/updates and operation monitoring. Define recovery and independent backups with the company's IT team. A local folder alone is not a backup policy.
