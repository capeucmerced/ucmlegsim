# Intake system (Google Forms → Sheets → site)

Everything in this folder is the **offline preparation** for the intake
system: it is written and version-controlled here, and deployed to the
course Google account when the admin designates it. Nothing in this folder
runs from the repository.

- `schemas.md` — the data contract: every sheet tab, its columns, who edits it.
- `apps-script/` — the Google Apps Script sources, one file per concern:
  - `forms_builder.gs` — **creates all fourteen forms programmatically**
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

1. `INTAKE_API_URL` (and `VOTE_SHEET_URLS` / `VOTE_ENTRY_URL`) in
   `scripts/shared.R`
2. `FEED_URL` in `js/feed.js`
3. the Script Properties in the Apps Script project (`GITHUB_TOKEN`,
   `FILES_FOLDER_ID`, `BILL_TEMPLATE_DOC_ID`, `AGENDA_TEMPLATE_DOC_ID`,
   `SB_NUMBER_FLOOR`, `VOTES_WORKBOOK_ID`)

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

1. **Drive**: create the YEAR container folder, e.g. `LegSim 2026`, and
   inside it a folder `LegSim Files`; copy the `LegSim Files` folder ID
   from the URL. (Its subfolders, and the sibling `LegSim Forms` folder,
   are created automatically by the scripts.) Everything this year makes
   lives inside the year folder — see **Yearly turnover** below.
2. **Workbook `LegSim Intake 2026`**: create an empty spreadsheet inside
   the year folder; copy its ID.
3. **Apps Script** (Extensions → Apps Script in that workbook — being
   bound to the workbook is how the scripts know which spreadsheet is
   the intake workbook; no ID to set anywhere): paste in ALL the `.gs`
   files from `apps-script/` except `vote_sheet.gs` (that one belongs to
   the votes workbook, step 7). Under ⚙ Project Settings → **Script properties**,
   add: `FILES_FOLDER_ID`, and `SB_NUMBER_FLOOR` = `75` while the 2025
   fixtures are still on the site (test bills then number from 76 and
   can't collide with fixture SB-1..75; the fixture reset in step 9
   flips it to `0`). Later additions: `BILL_TEMPLATE_DOC_ID` (step 5),
   and `GITHUB_TOKEN` (a fine-grained PAT for this repo) which can wait
   until launch day — without it, submissions simply skip the automatic
   rebuild request (a logged no-op), which is right before launch anyway.
   Properties survive code re-pastes; never edit constants in the code.
4. **Build the forms**: run `buildAllForms()`, then `addAdminTabs()`.
   Manual finish per the builder's header: add a file-upload question
   (PDF only, 10 MB) to the Letters and Role Profile forms — any
   question title works; the scripts find uploads by their Drive link —
   and Settings → *Collect email addresses → Verified* on every form. Add the script columns by hand:
   `Status` on the Letters and Bills tabs, `SB Number` on Bills.
   The builder stores each form's id in Script Properties (`FORM_ID_…`);
   that is what lets every newly numbered bill append itself to the
   amend and letter dropdowns — no manual dropdown upkeep for bills.
5. **Templates**: run `createBillTemplate()` and put the logged ID into
   the `BILL_TEMPLATE_DOC_ID` script property; run `createAgendaTemplate()`
   and put its ID into `AGENDA_TEMPLATE_DOC_ID` (restyle both docs freely
   — keep the `{{PLACEHOLDERS}}`; drag them into the year folder). After the Roster has its
   senators (roles, districts, names, Party), run `provisionBillDocs()`
   AND `syncRosterDropdowns()` (fills the spending recipient and
   assignment pickers from the Roster) — rerun both whenever senators
   are added or changed. With a full class (~40
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
7. **Votes workbook**: create `LegSim Votes 2026` inside the year folder;
   paste `vote_sheet.gs` into its own Apps Script project. Set up the
   hidden `BillLists` tab (IMPORTRANGE from the intake workbook's Bills
   tab, FILTERed per committee) and point each tab's Bill column
   validation at it. Publish the five vote tabs to the web (votes hold no
   emails — the one kind of tab that publishing rule allows) and put the
   new CSV links + edit link into `VOTE_SHEET_URLS` / `VOTE_ENTRY_URL` in
   `scripts/shared.R`.
8. **Test with a dummy account**: register, file a bill (check the PDF
   receipt's red/blue amendment marks), file a letter, report spending,
   post to the wire, submit an agenda, submit assignments (watch the
   vote tabs' senator columns rewrite themselves), refer a bill —
   confirm each lands, files correctly, and the site rebuild fires. Remember the deployment rule:
   after any change to `newsfeed_api.gs`, Manage deployments → ✏ →
   **New version** (same URL); form-trigger code only needs saving.
9. **The fixture reset (before students start)**: delete the 2025 fixture
   data from the repo — `files/csvs/lobbyist_contributions/*`, the letter
   PDFs in `files/pdfs/lobbyist_letters/`, and (when the bills slice is
   live) the 2025 bill/profile PDFs and `bill_list.csv` rows. The 2025
   site keeps its own copies under `archive/`, so nothing is lost. Mixed
   eras cause ghosts — e.g. a fixture Support letter coexisting with an
   intake Oppose from the same org, which the sheet-based supersede logic
   cannot see. At the same time: **delete** (don't just void) the step-8
   test rows from the intake tabs and trash their filed PDFs/dropdown
   entries, then set `SB_NUMBER_FLOOR` to `0` — numbering reads the max
   SB in the Bills tab even on void rows, so leftover test rows would
   make the first real bill SB-77 instead of SB-1.

## Roster day (when the class list is final)

1. **Fill the Roster tab**, one row per student: their Google email
   (lowercase), Role, and the role's fields — senators get a persona
   from `files/csvs/senator_list.csv` (First/Last/District/Party must
   match it exactly; that's how votes and bills join), lobbyists get
   their Org Code, journalists their Outlet. Emails never reach the
   site. **Leave First/Last blank for lobbyists and journalists** — no
   real student names anywhere: Wire bylines then fall back to the
   outlet (journalists) or "Staff" (lobbyists). A pen name in those
   cells becomes the byline, if one is ever wanted.
2. Run **`provisionBillDocs()`** — rerun until it says nothing left to
   do (each run may stop at the 6-minute limit). Each senator gets
   Draft A/B docs shared to their email automatically.
3. Run **`syncRosterDropdowns()`** — fills the Spending recipient list
   and every Assignments-form picker. Rerun both whenever the Roster
   changes.
   Also give each form's Settings a quick look before students get the
   links: accepting responses on, *Collect email addresses → Verified*,
   every question still required — undoing anything toggled by hand
   during shakedown testing.
4. After the class organizes, the Pro Tem (or you) submits the
   **Committee Assignments & Leadership** form — that single submission
   updates the site AND writes the vote workbook's senator columns by
   itself. Resubmit any time things change.
5. Registration is self-serve: students' form submissions append their
   email + name to the Roster; you assign the Role and fields.

## Launch day (the one push)

The order matters: a workflow GitHub has disabled ignores every
trigger (including the push), and the dispatch test can only work
after the merge, because only the new workflow on main listens for
`repository_dispatch` — testing it earlier is a silent no-op.

1. In the repo's **Actions** tab, re-enable the workflow if GitHub
   auto-disabled it (it does so after ~60 days without repo activity —
   a banner on the workflow says so, with an Enable button).
2. Add the `GITHUB_TOKEN` script property: a **classic** PAT
   (github.com/settings/tokens → Tokens (classic)), scope
   **`public_repo`** only, expiration past the end of the semester,
   minted by an account with write access — signed in as `capeucmerced`
   itself is best (no dependence on any individual's access).
   Fine-grained tokens cannot work here: `capeucmerced` is a plain user
   account, not an org, and fine-grained PATs can only target your own
   account or an org you belong to (TA-GUIDE.md §4 tells the whole
   story). Don't test it yet.
3. Merge and push — the project's one push:
   `git checkout main && git merge revamp-2026 && git push`
4. Watch the Actions run build and deploy; then hard-refresh
   ucmlegsim.com and spot-check `/archive/2025/`.
5. Now test the token from the workbook's **LegSim → Rebuild site now**
   menu: a run should appear under the repo's Actions tab within
   seconds. (A 401/403 in the Apps Script executions log means the
   token expired, lacks the `public_repo` scope, or its account lost
   write access to the repo.)
6. Live smoke test: post to the Wire (appears in seconds, no rebuild
   needed) and file one submission (site updates after the triggered
   build finishes).

## The role checker (self-service hookup receipts)

Built mid-semester 2026 (`role_check.gs`): a question-free **Check My
Role** form. A student submits it and the router emails that account
what the Roster says it is ("You are Senator Steve Choi, R-SD37" / "the
CTA lobbyist" / "not registered yet"), plus a `Result` audit column on
the Role Check tab. It exercises the same verified-email → Roster join
every real form uses, so a passing check proves the whole hookup.
Role checks trigger no site rebuild. Install steps are in the file's
header; the builder (`buildRoleCheckForm()`) creates and links the form.

## Parked for next year

- **Welcome email on hookup** (the push version of the role checker): an
  installable trigger on the Roster — when a row gains its Role, the
  dept account emails the student their summary unprompted, with a
  `Welcomed` timestamp column for idempotence. A wrong assignment then
  surfaces without the student doing anything. (Careful with bulk
  pastes firing mass emails — that is why it stayed unbuilt in 2026.)

## Yearly turnover (the sim repeats — no year ever overwrites another)

Each year gets its own containers on both sides; a finished year is
never touched again.

**Google side — one folder per year.** Everything a year creates lives
inside its `LegSim <year>` Drive folder: the intake workbook, `LegSim
Files` (every filed PDF), `LegSim Forms`, the votes workbook, the bill
template and draft docs. When the sim ends, that folder simply stays put
as the archive — no renaming, no cleanup, and old years' student emails
stay in workbooks shared with nobody. Next year: create `LegSim
<year+1>` and run the deploy checklist again from step 1 — the builder
recreates all fourteen forms identically, so the whole rebuild is one
sitting. A fresh year starts with `SB_NUMBER_FLOOR` = `0` (its Bills tab
is empty and the site has no fixtures). Once the site is repointed,
**archive the old year's web-app deployment** (Manage deployments →
Archive) so a retired /exec URL can't serve stale data.

**Repo side — archive, then reset.** Before new data starts: mirror the
live site into `archive/<year>/` (`scripts/archive_site.ps1`), add the
year to `archive/index.html`, then clear the old year's working data
(contribution CSVs, letter/bill/profile PDFs, `bill_list.csv` rows, vote
fixtures) — the archived copy keeps everything.

**The cutover is the swap surface.** Repointing the site at a new year
touches exactly four things: `INTAKE_API_URL` and `VOTE_SHEET_URLS` /
`VOTE_ENTRY_URL` in `scripts/shared.R`, `FEED_URL` in `js/feed.js`, and
the new year's own Script Properties. Nothing else on the site knows
which year it is.

## Open items

- The policy topic tag list (instructor drafting; placeholder list lives
  in `forms_builder.gs`).
- (Settled by the beta, for the record: PDFs reach the build by file id —
  filed documents share themselves link-view and the site downloads them
  anonymously, identical locally and in CI; no service account needed.
  Templates are created by `createBillTemplate()`, not built by hand.)
