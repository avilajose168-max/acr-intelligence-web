# Shared platform visual theme

`platform-visual-theme.css` is enabled through one stylesheet link in `index.html`. All rules apply to screen media only. Existing operational code, form field types and values, navigation, permissions, calculations and report-generation templates are unchanged.

## Scope

Shared native date, datetime-local, time, month and week fields across the page, including dynamically inserted actions, handover dates, subscriptions, trial forms, audit filters and dialog fields. Read-only and disabled date fields retain their restrictions and have a distinct presentation. Native pickers remain browser-owned, so their locale and iOS appearance can vary.

The interface treatment covers the main header and navigation, company scope banner, analysis forms, administration, subscriptions, personal reliability and commitments dashboards, continuous improvement and account dialogs. Existing home, corporate reliability and event visual layers remain enabled. On phones the continuous-improvement cards no longer force an additional 260px internal scrolling region.

## Verification

All 62 CSS rules parsed successfully and are restricted to screen media. Source comparison confirms that the stylesheet link is the only index change. Local browser fixtures using desktop, 390px and 320px views showed no document-level horizontal overflow for representative module forms and all five native date/time types. Newly inserted commitment date fields receive the theme and accept ISO date input. Rendered dialog date fields use the same dark scheme and borders. Printed/exported documents keep existing rules. No live customer accounts or records were modified.

## Rollback

Remove the stylesheet link containing `platform-visual-theme.css` from `index.html` and publish through the existing Vercel integration. Earlier section-specific themes remain active. No database rollback is required.
