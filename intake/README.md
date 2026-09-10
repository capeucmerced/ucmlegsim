# Intake system (Google Forms → Sheets → site)

Everything in this folder is the **offline preparation** for the intake
system: it is written and version-controlled here, and deployed to the
course Google account when the admin designates it. Nothing in this folder
runs from the repository.

- `schemas.md` — the data contract: every sheet tab, its columns, who edits it.
- `apps-script/` — the Google Apps Script sources, one file per concern:
  - `forms_builder.gs` — **creates all thirteen forms programmatically**
    on whatever account runs it (see its header for the run steps and the
    short manual-finish list). Forms are code, not clicks: rebuildable on
    any account, any year.
  - `rebuild.gs` — triggers a site rebuild via the GitHub API (+ admin menu)
  - `intake_workbook.gs` — routes form submissions (letters filing,
    registration → roster) and requests rebuilds
  - `newsfeed_api.gs` — the JSON endpoint the live newsfeed reads
  - `vote_sheet.gs` — auto date-stamp for the vote-entry workbook
  - `bills_assembler.gs`, `agenda_builder.gs` — document assembly
    (drafted; must be tested live at deploy)

## Beta on a personal account (supported)

The whole Google side can be stood up on a personal account for testing
before the department deploy, because every binding between Google and the
site sits in three known places (the **swap surface**):

1. the published-CSV URL block in `scripts/shared.R`
2. `FEED_URL` in `js/feed.js`
3. the deploy constants at the top of the `.gs` files
   (spreadsheet/folder/template IDs, `GITHUB_TOKEN` property)

Beta flow: run `forms_builder.gs` + the setup steps below on the personal
account, wire those three places to it, and test freely. Cutover: repeat
the same steps on the department account (the builder makes the forms
identical) and re-point the swap surface — about fifteen minutes plus one
render. **Hard rule: the beta retires before the first real student
submission.** Response rows, uploaded PDFs, and pre-provisioned bill docs
do not migrate between accounts — test data is disposable, student data is
not. Whenever form links get embedded in site pages, put the URLs in
`scripts/shared.R` too, so they stay inside the swap surface.

## Deploy checklist (when the course Google account exists)

**Do every step below signed in AS the department's Google account.** It
must OWN everything — forms, workbooks, Drive folder, scripts, triggers,
web app. Ownership can't be cleanly transferred later (copies get new file
IDs, which breaks every published URL), and triggers/web apps run as the
account that created them. After setup, share the folder and workbooks to
the instructor's personal account as *Editor* for day-to-day admin; when an
instructor leaves, revoking that access is the entire handover. The
department account's credentials must be kept department-side.

After setup, the department login is only needed again for four rare
events (everything else is editor-level): (1) re-authorizing the on-submit
trigger if Google asks (password change, or the script code gains a new
service); (2) publishing a new version of the newsfeed web app after its
code changes — only the owner can update the deployment without changing
its URL; (3) creating any NEW form/workbook/doc that must be
department-owned; (4) account security/recovery events.

Same continuity rule for the rest of the stack: the repo lives in the CAPE
GitHub org — keep at least one org OWNER who isn't the departing
instructor; the rebuild PAT is per-user and expiring, so a successor
simply creates their own and updates the GITHUB_TOKEN script property
(two minutes); and the ucmlegsim.com domain registration/renewal should be
in department hands and documented.

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
8. **The fixture reset (before students start)**: delete the 2025 fixture
   data from the repo — `files/csvs/lobbyist_contributions/*`, the letter
   PDFs in `files/pdfs/lobbyist_letters/`, and (when the bills slice is
   live) the 2025 bill/profile PDFs and `bill_list.csv` rows. The 2025
   site keeps its own copies under `archive/`, so nothing is lost. Mixed
   eras cause ghosts — e.g. a fixture Support letter coexisting with an
   intake Oppose from the same org, which the sheet-based supersede logic
   cannot see.

## Open items to settle at deploy

- How CI fetches the uploaded PDFs from Drive for the site build
  (service-account fetch vs. published-folder download) — decide and wire
  in the workflow when the account exists.
- The bill and agenda Doc templates themselves (built in Google Docs at
  deploy; specs live alongside the assembler scripts).
- The policy topic tag list (user is drafting).
