# Corporate reliability screen theme

The dashboard theme is contained in `corporate-reliability-theme.css` and enabled by one stylesheet link in `index.html`.

## Scope

All selectors target `#corporateReliabilityPanel` and all rules are restricted to screen media. No application JavaScript, control IDs, data, calculations, chart geometry or report templates were changed. Print styles retain the existing presentation.

## Restore the previous appearance

Remove the stylesheet link containing `corporate-reliability-theme.css` from `index.html` and publish through the existing Vercel integration. The remaining application source is identical to its state before this visual change; the separate stylesheet can remain unused.

## Verification

Checked the source to ensure that the stylesheet link was the only index.html change. Parsed all 97 stylesheet rules and verified dashboard-only selectors and screen-only media. Browser layout checks with the existing dashboard HTML and illustrative data passed at desktop, 390px and 320px widths without document-level horizontal overflow. No customer records were modified. Signed-in customer flows were not exercised as part of this visual-only update.
