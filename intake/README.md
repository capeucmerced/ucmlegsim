# Intake system (Google Forms → Sheets → site)

Everything in this folder is the **offline preparation** for the intake
system: it is written and version-controlled here, and deployed to the
course Google account when the admin designates it. Nothing in this folder
runs from the repository.

- `schemas.md` — the data contract: every sheet tab, its columns, who edits it.
- `apps-script/` — the Google Apps Script sources, one file per concern:
  - `rebuild.gs` — triggers a site rebuild via the GitHub API (+ admin menu)
  - `intake_workbook.gs` — routes form submissions (letters filing,
    registration → roster) and requests rebuilds
  - `newsfeed_api.gs` — the JSON endpoint the live newsfeed reads
  - `vote_sheet.gs` — auto date-stamp for the vote-entry workbook
  - `bills_assembler.gs`, `agenda_builder.gs` — document assembly
    (drafted; must be tested live at deploy)

## Deploy checklist (when the course Google account exists)

Roughly one sitting, in this order:

1. **Drive**: create folder `LegSim Files` with subfolders `bills`,
   `previous_bills`, `lobbyist_letters`, `agendas`, `role_profiles`.
   Create the Google Doc templates (bill template, agenda template)
   from the specs in this folder.
2. **Workbook `LegSim Intake`**: create it; add tabs `Roster` and `Budgets`
   per `schemas.md`.
3. **Forms**: build each form per `schemas.md` (question titles must match
   exactly), set *Collect email addresses → Verified*, and point every
   form's responses at the `LegSim Intake` workbook (Responses → link icon →
   Select destination). Rename each new response tab to its schema name.
4. **Apps Script**: open Extensions → Apps Script in the intake workbook;
   paste in `rebuild.gs`, `intake_workbook.gs`, `newsfeed_api.gs`,
   `bills_assembler.gs`, `agenda_builder.gs`. Fill the deploy constants at
   the top of each (folder ID, template doc IDs). Add the Script property
   `GITHUB_TOKEN` (fine-grained token for this repo). Add the installable
   trigger: `onAnyFormSubmit` → From spreadsheet → On form submit.
   Deploy `newsfeed_api.gs` as a web app (Execute as me / Anyone) and put
   the /exec URL into the site's feed code.
5. **Votes workbook**: paste `vote_sheet.gs` into its own Apps Script
   project. Set up the hidden `BillLists` tab (IMPORTRANGE from the intake
   workbook's Bills tab, FILTERed per committee) and point each tab's Bill
   column validation at it.
6. **Publish tabs to the web** (CSV) for every tab the site reads; put the
   URLs into `scripts/shared.R`.
7. **Test with a dummy account**: register, file a bill, file a letter,
   report spending, post to the wire, submit an agenda — confirm each lands,
   files correctly, and the site rebuild fires.

## Open items to settle at deploy

- How CI fetches the uploaded PDFs from Drive for the site build
  (service-account fetch vs. published-folder download) — decide and wire
  in the workflow when the account exists.
- The bill and agenda Doc templates themselves (built in Google Docs at
  deploy; specs live alongside the assembler scripts).
- The policy topic tag list (user is drafting).
