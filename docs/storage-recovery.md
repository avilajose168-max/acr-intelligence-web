# Personal commitment changes and browser storage

Personal workspaces include photographs. Previously every synchronous save error was presented as full photograph storage, regardless of its cause. A full browser localStorage outbox could prevent a commitment status change even with available cloud capacity.

The workspace synchronizer now moves this account's active recovery copies to IndexedDB when localStorage rejects writes because of quota or browser storage restrictions. Writes are ordered and transactional. Existing active localStorage copies are removed only after the replacement transaction commits; other accounts, other tab outboxes and historical recovery copies are retained. Cloud revision checks and explicit conflict resolution remain in place.

If local recovery also fails, the interface states that changes are held only in the open tab and attempts cloud synchronization. Cloud success is reported only after server acknowledgement. Unexpected synchronous errors no longer claim that photographs filled the storage. No customer investigations or photographs are deleted.

Validation: cloud-workspace tests cover migration, offline restart, concurrent edits, account switching, deletion, tab isolation, quota fallback, retained photographs, failed recovery and cloud acknowledgement. The IndexedDB adapter was separately checked for transactional save, confirmation, reload and recovery backup.
