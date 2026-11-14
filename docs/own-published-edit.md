# Editing own published reports

The full published-report dialog now offers Editar mi investigación to its signed-in author. It opens an existing personal working draft without overwriting its edits; if no working draft exists, it recovers the publication payload using the original local case ID, company association, photographs and action plan. Recovery uses the existing personal workspace persistence and revision-controlled cloud synchronization. It does not directly update the published report.

Editing requires matching ownership, a currently available company and an approved affiliation (or platform administration). An unresolved cloud conflict prevents recovery. A failed synchronous local save rolls back only the attempted addition. Account changes are checked across awaited work. Corporate publication and technical review continue through their existing flows.

Validation: six Node tests exercise identity/evidence preservation, source immutability, preservation of an existing newer draft, rejected ownership, successful editor opening, blocked synchronization/membership and rollback of failed local storage. DOM tests verify the edit button callback closes the published preview and the original read-only discovery flow remains functional. JavaScript syntax checks passed. No customer data was modified during testing.
