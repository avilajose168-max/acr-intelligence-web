# Home visual theme

The home presentation uses `home-visual-theme.css` plus two static blocks inside `#homeFailureStart`: `.home-visual-brand` and `.home-benefits`.

No JavaScript, buttons, control IDs, data-format values, authentication, database or report generation code changed. The decorative vectors are inline CSS assets and require no external image service or additional dependencies.

To restore the prior home appearance, remove the home-visual-theme.css link and the two presentation blocks. Keep corporate-reliability-theme.css, which belongs to the separate corporate reliability screen.

Verified: all 66 CSS rules parsed; operational source identical after removing these additions; desktop three-card layout; 390px and 320px stacked layouts without horizontal document overflow; existing format selection handler exercised with a local start-action stub.
