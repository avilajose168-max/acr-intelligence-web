# Corporate commitments visual theme

`corporate-commitments-theme.css` is a screen-only visual layer scoped to `#mainApp #corporateCommitmentsPanel`. It is enabled by one index.html stylesheet link. Three decorative heading glyphs were replaced by CSS vector icons.

No application scripts, metrics, field IDs, table data, click handlers, publication permissions or export templates were changed. The fifth KPI remains upcoming actions within seven days, with its existing completion percentage subtitle. It was not replaced with a new metric. Existing deadline and priority meanings are preserved.

## Responsive layout

Desktop uses the existing table and five KPI cards where space allows. At phone widths each existing table row is displayed as a card with labels for investigation, action, owner, priority, deadline and status, plus the original View ACR button. Selection and button handlers remain attached to the same nodes. Narrow phones use one KPI column. Print keeps the original table layout.

## Verification

Parsed all 117 scoped screen-only rules. Source comparison verified unchanged operational code. Browser fixtures at desktop, 390px and 320px had no document-level horizontal overflow; all four sample rows and the upcoming-action count were preserved. Phone View ACR targets measure at least 44px high. Customer records and signed-in company data were not modified or used in the fixtures.

## Rollback

Remove the corporate-commitments-theme.css link and restore the three old decorative heading glyphs if desired. Earlier visual themes remain active. Git history preserves the prior appearance. No database changes require reversal.
