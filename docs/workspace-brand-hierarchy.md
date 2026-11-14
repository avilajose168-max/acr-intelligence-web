# Workspace brand hierarchy

The signed-in workspace displays ACR Integrity once: in the desktop sidebar at widths of 1000px and above, and in the header below that breakpoint. The redundant decorative logo inside the home assistant panel has been removed. The home title uses the available width.

On desktop, the top bar identifies the selected company or personal workspace and retains the existing account/profile/logout and synchronization controls. The standalone scope banner is hidden on desktop to avoid duplicate context; its existing text updates and observers remain intact. On mobile, the header brand remains visible and the scope banner continues to identify the workspace. Login and exported report/company identities are unchanged.

Only two presentation labels were added to companyWorkspace; no permissions, selection rules, data, calculations or synchronization behavior were changed. Company names use textContent.

Validation: browser fixtures built from the actual home markup at desktop 1500px and mobile 390px/320px. Exactly one brand lockup is visible at each width, scope is visible once, and there is no horizontal page overflow. Personal, company and platform context labels and main script syntax were checked.
