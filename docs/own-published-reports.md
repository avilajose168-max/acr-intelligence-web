# Finding own published reports

The Investigaciones screen previously listed only the personal workspace. An investigation can remain published in a company after its personal draft no longer exists, so a valid company report appeared missing to its owner.

A new read-only panel, Mis informes publicados en compañías, lists the signed-in user's published reports with equipment, event, area and sector/unit. Ver informe publicado opens the full existing report renderer with 5 Porqués, A3 and ACR format options, company identity and the existing review/completion hydration. It does not import, overwrite, republish or delete investigations.

Security: both metadata and single-report requests explicitly filter owner_id by the signed-in user and use the existing authenticated RLS API. Returned owner and report IDs are checked again before rendering. Account changes invalidate in-flight work; logout clears cached rows and closes/empties the dialog. No database policies, roles or schema changes.

Validation: isolated DOM tests verified owner-only discovery, wet-area identification, opening the report, format switching, logout clearing, account switch during loading, rejected ownership, and visible network errors. Browser fixtures verified native dialog opening and no page overflow at 1500px and 390px. Read-only authenticated-role SQL verified existing company visibility. No customer data was modified.
