# Event registration visual theme

`event-visual-theme.css` scopes all rules to `#registro` (step 1). The page adds three static date hints and replaces two decorative heading emoji with CSS vector icons. No input IDs, data keys, field types or application scripts were changed.

The datetime-local fields retain their native browser picker, now use a dark color scheme, clearer borders, larger touch targets and a visible calendar indicator. Date picker appearance remains browser-dependent, including on iOS.

Verification: all 78 CSS rules parsed; source comparison confirms unchanged operational code; no horizontal overflow in desktop, 390px and 320px browser fixtures; date fields accept native ISO values; duration output remains read-only; unchanged duration function tested for 4 hours, midnight crossing and incomplete dates. No live customer records were modified.

Rollback: remove the event-visual-theme.css link, the three `.event-date-hint` spans, and restore the two previous heading decorations if desired. Keep the home and corporate reliability visual themes. Existing Git history preserves the prior appearance.
