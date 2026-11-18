# Company work documents linked to local storage

Protocolos and Procedimientos share a company-scoped catalog with area, sector,
plant and equipment/SAP filters. Only the platform administrator uploads or
manages versions. Approved company members and company administrators consult
current documents in their own companies. Discovery filters do not assign new
plant-specific permissions. Independent accounts have no company files.

Install database.sql first, then local-database.sql once. Existing cloud metadata
keeps storage_backend=cloud; new reservations default to local and require a live
V3 company connector. The existing cloud bucket remains private for legacy rows,
while its policies reject binary uploads for local rows.

A local upload is staged in private database chunks, then queued. The connector
writes the original PDF/Word/Excel/image file and a manifest into the company's
configured root under ACR_Documentos/{Protocolos|Procedimientos}/YYYY/MM/id/hash/.
Only a complete disk readback matching the reserved byte size and SHA-256
publishes a draft. This atomically retires the previous current revision.
The verified write clears source and readback bytes from the temporary relay.

A reader requests a company-authorized job; the connector reads the disk file and
manifest, verifies them, and relays original binary chunks. The requester alone
can retrieve that job and the browser verifies SHA-256 and length before preview.
Consumption clears relay bytes. Scheduled pg_cron cleanup every five minutes
expires abandoned uploads after 24 hours and verified unread downloads after
15 minutes. The catalog, document versions and disk files are retained. Cleanup
never deletes original report archives or report cloud records. Normal PostgreSQL
backups/WAL retention applies to transient database writes.

The connector must remain online with folder permissions and a current pairing.
It uses outbound HTTPS, Windows DPAPI and the previous pairing profile; no inbound
port or browser access to filesystem paths. V3 also retains probes and real report
backups. Folder browsing and arbitrary paths are not exposed. File limit 10 MiB;
PDF/images preview in the app; Word/Excel download to the user's application.

Tests: local-security-test-body.sql runs only disposable fixtures and ends with
ROLLBACK, covering actual database roles, verified writes/reads, company/requester
isolation, no cloud fallback, membership revocation, staging cleanup and expiry.
ui.test.cjs checks local chunks, checksum rejection, consumption, offline notices,
catalog filters, interrupted drafts and logout cleanup. Connector tests exercise
actual disk files, original Office/PDF bytes, multichunk transfers, manifests,
missing/modified files, retries and path/symlink rejection.

Deployment does not upload user files. The company must start the extracted V3
connector on its own Windows server, then send and open a first actual document
to confirm that PC end to end. Existing report cloud originals remain unchanged.
