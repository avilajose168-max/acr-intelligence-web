# Personal dashboard visual consistency

The personal reliability and commitment dashboards now use the same visual language as the corporate dashboards: dark blue panels, gold values and period labels, cyan accents, masked vector icons and stronger chart headings. These views are shared by independent users, company users and company administrators viewing their personal investigations. Corporate styles and permissions are unchanged.

The personal reliability dashboard retains all six indicators, including operating hours. The commitment dashboard retains the upcoming-seven-days metric, editable status selectors and existing actions. The filter area uses its available width. Mobile commitment rows become labeled cards, with readable wrapping and touch controls at least 46px high. Changes apply only on screen; report templates and print styles are untouched.

Implementation: personal-dashboard-theme.css plus its stylesheet link and removal of decorative heading glyphs in index.html. Every operational script is byte-for-byte identical to the previous version. Remove the new stylesheet link to revert its visual treatment.

Verification: actual dashboard markup in isolated fixtures with sample data; browser checks at 1500px, 390px and 320px widths; no horizontal page overflow; all commitment cell content fits; native status selector remains usable; two SVG charts fit mobile containers. No production customer data was modified during verification.
