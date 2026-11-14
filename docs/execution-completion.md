# Completion after execution with evidence

Saving an execution through Mejora y seguimiento completes its matching commitment. Execution and effectiveness remain distinct: a completed action can still await effectiveness verification or have a recorded ineffective result.

Corporate execution events remain the authoritative immutable journal. The existing corporate overlay is retained. Personal commitments now reconcile acknowledged corporate executions by signed-in owner, company, local case ID and the existing action key. Changed actions cannot inherit another action's completion. Refresh reads compact action/event metadata without downloading attached evidence. Account/workspace changes are checked before applying updates. Updated personal state is saved through the existing revision-controlled workspace synchronizer.

The execution form explains the automatic update, labels its button Guardar ejecución y completar compromiso and confirms the result. A successful server append is not presented as a failed execution if a later dashboard refresh fails. Personal offline saves explicitly indicate pending cloud synchronization.

Validation: six focused completion tests, existing continuous-improvement and filter tests, JavaScript syntax checks, and four isolated DOM form scenarios (corporate success, personal success, rejected server append, missing evidence). No real customer commitments were changed during testing. No schema or permission changes.
