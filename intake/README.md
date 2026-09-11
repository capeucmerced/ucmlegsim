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
  - `bills_assembler.gs` — assembles filed bills into numbered, formatted
    PDFs (leginfo-style red/blue amendment marks); beta-tested end to end
  - `provisioning.gs` — one-time runs: the bill-template Doc and each
    senator's two draft docs
  - `agenda_builder.gs` — agenda assembly (drafted; the one script not
    yet walked live — test at deploy)

## Beta on a personal account (supported)

The whole Google side can be stood up on a personal account for testing
before the department deploy, because every binding between Google and the
site sits in three known places (the **swap surface**):

1. `INTAKE_API_URL` in `scripts/shared.R`
2. `FEED_URL` in `js/feed.js`
3. the Script Properties in the Apps Script project
   (`GITHUB_TOKEN`, `FILES_FOLDER_ID`, `BILL_TEMPLATE_DOC_ID`,
   `SB_NUMBER_FLOOR`) plus `INTAKE_SPREADSHEET_ID` in `forms_builder.gs`

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

Roughly one sitting, in this order (every manual step here was walked
live in the Sep 2026 beta — the scripts carry those fixes):

1. **Drive**: create folder `LegSim Files` and copy its folder ID from the
   URL. (Subfolders are created automatically by the scripts.)
2. **Workbook `LegSim Intake`**: create an empty spreadsheet; copy its ID.
3. **Apps Script** (Extensions → Apps Script in that workbook): paste in
   ALL the `.gs` files from `apps-script/`; set `INTAKE_SPREADSHEET_ID` in
   `forms_builder.gs`. Under ⚙ Project Settings → **Script properties**,
   add: `GITHUB_TOKEN` (fine-grained PAT for this repo),
   `FILES_FOLDER_ID`, `SB_NUMBER_FLOOR` = `0` — and later
   `BILL_TEMPLATE_DOC_ID` (step 5). Properties survive code re-pastes;
   never edit constants in the code.
4. **Build the forms**: run `buildAllForms()`, then `addAdminTabs()`.
   Manual finish per the builder's header: the file-upload questions
   (title exactly `Letter PDF` on the Letters form, `Profile PDF` on the
   Role Profile form), and Settings → *Collect email addresses →
   Verified* on every form. Add the script columns by hand:
   `Status` on the Letters and Bills tabs, `SB Number` on Bills.
   The builder stores each form's id in Script Properties (`FORM_ID_…`);
   that is what lets every newly numbered bill append itself to the
   amend and letter dropdowns — no manual dropdown upkeep for bills.
5. **Bill machinery**: run `createBillTemplate()` and put the logged ID
   into the `BILL_TEMPLATE_DOC_ID` script property (restyle the template
   doc freely — keep the `{{PLACEHOLDERS}}`). After the Roster has its
   senators (roles, districts, names, Party), run `provisionBillDocs()`
   — rerun it whenever senators are added. With a full class (~40
   senators × 2 draft docs) one run may hit Apps Script's 6-minute
   execution limit and stop partway; that is harmless — it skips
   senators who already have docs, so just run it again until it
   reports nothing left to do.
6. **Wire up**: add the installable trigger (`onAnyFormSubmit` → From
   spreadsheet → On form submit). Deploy `newsfeed_api.gs` as a Web app
   (Execute as: Me / Access: Anyone); put the /exec URL into
   `INTAKE_API_URL` in `scripts/shared.R` AND `FEED_URL` in `js/feed.js`.
   **Never publish intake tabs to the web** — the gateway is the only
   data exit (see the privacy rule above).
7. **Votes workbook**: paste `vote_sheet.gs` into its own Apps Script
   project. Set up the hidden `BillLists` tab (IMPORTRANGE from the intake
   workbook's Bills tab, FILTERed per committee) and point each tab's Bill
   column validation at it.
8. **Test with a dummy account**: register, file a bill (check the PDF
   receipt's red/blue amendment marks), file a letter, report spending,
   post to the wire, submit an agenda — confirm each lands, files
   correctly, and the site rebuild fires. Remember the deployment rule:
   after any change to `newsfeed_api.gs`, Manage deployments → ✏ →
   **New version** (same URL); form-trigger code only needs saving.
9. **The fixture reset (before students start)**: delete the 2025 fixture
   data from the repo — `files/csvs/lobbyist_contributions/*`, the letter
   PDFs in `files/pdfs/lobbyist_letters/`, and (when the bills slice is
   live) the 2025 bill/profile PDFs and `bill_list.csv` rows. The 2025
   site keeps its own copies under `archive/`, so nothing is lost. Mixed
   eras cause ghosts — e.g. a fixture Support letter coexisting with an
   intake Oppose from the same org, which the sheet-based supersede logic
   cannot see.

## Open items

- The policy topic tag list (instructor drafting; placeholder list lives
  in `forms_builder.gs`).
- The agenda template Doc + first live run of `agenda_builder.gs`.
- (Settled by the beta, for the record: PDFs reach the build by file id —
  filed documents share themselves link-view and the site downloads them
  anonymously, identical locally and in CI; no service account needed.
  Templates are created by `createBillTemplate()`, not built by hand.)
