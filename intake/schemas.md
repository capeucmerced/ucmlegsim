# Intake data contract

This file defines every Google Sheet tab the intake system uses: which form
feeds it, its exact columns, and who may edit it by hand. The Google Forms,
the Apps Scripts in `apps-script/`, and the site pipeline are all written
against these layouts — if a column changes here, it changes in all three.

**Layout of the Google side (one workbook + one folder, all inside the
year's `LegSim <year>` container folder — the sim repeats yearly and a
finished year's folder is left untouched as its archive; see "Yearly
turnover" in README.md):**

- **Workbook "LegSim Intake"** — every form files its responses into a tab
  of this single workbook, alongside two hand-maintained tabs (Roster,
  Budgets). The admin can open this one file and see/fix everything.
- **Workbook "LegSim Votes"** — the existing vote-entry workbook students
  use live in class (one tab per committee + floor). Unchanged.
- **Drive folder "LegSim Files"** — uploaded PDFs land here, in
  subfolders mirroring `files/pdfs/` (bills, previous_bills,
  lobbyist_letters, agendas, and role_profiles with its senators/,
  lobbyists/, journalists/ subfolders).

**Intake tabs are NEVER published to the web** — every response tab
carries the submitter's email, and a published-CSV URL would expose them
(especially once the URL sits in the public site repo). Instead, ALL
intake data reaches the site through one Apps Script web app
(`newsfeed_api.gs`) that joins the Roster server-side and emits
de-identified JSON per view (`?view=posts`, `?view=spending`, …). Its
/exec URL goes in `scripts/shared.R` (`INTAKE_API_URL`) and is safe in
public code because its output contains no emails.

Google Forms always writes `Timestamp` first. Forms set to *verified email
collection* write `Email Address` second. Question columns use the exact
question titles below. **Emails never appear on the website** — the pipeline
joins email → Roster and publishes display fields only.

---

## Tab: Roster  (hand-maintained by admin; seeded from Registration)

The master mapping of people to roles. One row per student.

| Column | Meaning |
| --- | --- |
| Email | The Google account the student registered with (lowercase) |
| Role | `senator` / `lobbyist` / `journalist` |
| District | Senators only: 1–40 |
| First Name / Last Name | Senators: their senator persona’s name. Lobbyists/journalists: BLANK (no real student names on the site — Wire bylines fall back to the Outlet or "Staff"); a pen name here becomes the byline |
| Party | Senators only: `D` / `R` |
| Org Code | Lobbyists only: code from `lobbyist_list.csv` (e.g. `ENV`) |
| Outlet | Journalists only: newspaper name |
| Chair / Vice Chair | Committee code they lead, if any (e.g. `anr`) |
| Leadership | `Pro Tem`, `Majority Leader`, `Minority Leader`, or blank |
| Bill Doc 1 / Bill Doc 2 | Senators: Google Doc IDs of their pre-provisioned bill-body docs (filled by the provisioning script) |

## Tab: Registration  (form: "Register for the Simulation")

| Column | Question |
| --- | --- |
| Timestamp / Email Address | automatic |
| Full Name | "Your full name" |

## Tab: Role Check  (form: "LegSim — Check My Role", built by `buildRoleCheckForm()`)

Self-service hookup receipt: on submit, the router emails the account
what the Roster says it is (see `role_check.gs`). No site rebuild.

| Column | Question |
| --- | --- |
| Timestamp / Email Address | automatic |
| Email me my role | required checkbox (`Yes`) — the form's only question |
| — Result | script column: the summary that was emailed back (audit) |

## Tab: Bills  (form: "File a Bill")

| Column | Question |
| --- | --- |
| Timestamp / Email Address | automatic |
| Filing Type | "Is this a new bill or an amended version of one of your bills?" (`New bill` / `Amendment`) |
| Amending | amendments only: "Which of your bills does this amend?" (dropdown — every newly numbered bill is appended automatically on filing) |
| Updated short subject / digest / flags / primary topic / secondary topic | amendments only, all optional: **blank = keep the current value**. **Updated flags is a wholesale replacement, not a toggle**: anything checked becomes the bill's complete flag set (to de-flag `Local program` from `Appropriations/fiscal + Local program`, check only `Appropriations/fiscal`; the 2/3rds checkbox is part of the set, so leaving it unchecked makes the bill majority-vote). Because blank means keep, the flags and secondary-topic lists carry an explicit `None — …` choice for clearing entirely. |
| Short Subject | new bills only: "Short subject for the bill tables — a few concise words (e.g. Clean Air Near Schools Act)" |
| Digest | new bills only: "Digest" (help: a plain-text description of existing law and what the bill changes; each line of the answer prints as its own paragraph) |
| Flags | new bills only: checkboxes `Appropriations/fiscal` / `Local program` / `2/3rds vote` (comma-joined by Forms). Printed as the digest line "Vote: 2/3rds or Majority. Appropriations/fiscal: yes/no. Local program: yes/no." Any flag containing "Appropriation" makes the bill fiscal on the site (routed through Appropriations/Rules). Rows filed before Sep 2026 may carry the retired `Appropriation` / `Fiscal committee` / `Urgency` labels; they still read. |
| Primary Topic | new bills only: dropdown from the policy tag list (required) |
| Secondary Topic | same list, optional |
| Draft Doc | both paths: "Which of your two draft docs holds this bill’s text?" (`Draft A` / `Draft B`) |
| Body Ready | both paths: "Confirm the legal text in your bill doc is final" (checkbox) |
| — SB Number | **written by the on-submit script**, not a question |
| — Status | **written by scripts/admin**: blank = live; `void` = ignore this row |

Per field, the site and the assembled PDF use the latest non-empty value
across the bill's non-void rows — an amendment inherits everything it left
blank. An amendment filed against a bill the account didn't introduce
bounces: the row is voided, the student gets an email, nothing changes.
Undoing an accidental amendment: set its row's Status to `void`, then in
Drive move the newest `previous_bills/…_vN.pdf` back into `bills/` under
the plain name.

## Tab: Letters  (form: "File a Position Letter")

| Column | Question |
| --- | --- |
| Timestamp / Email Address | automatic |
| Bill | "Which bill?" (dropdown of filed bills, synced by script) |
| Position | `Support` / `Support If Amended` / `Oppose Unless Amended` / `Oppose` |
| Letter PDF | file upload (PDF only) — Forms stores a Drive link. Any question title works: the scripts find the upload by its Drive link, not the column name (`Letter PDF` is just the recommended title) |
| — Status | script/admin column: blank = current; `superseded` = older letter on the same bill |

## Tab: Profiles  (form: "Upload Your Role Profile")

One form for every role. The verified email finds the person on the
Roster, which decides where the PDF goes and what it's named — students
enter nothing but the file.

| Column | Question |
| --- | --- |
| Timestamp / Email Address | automatic |
| Profile PDF | file upload (PDF only) — Forms stores a Drive link. Any question title works (found by the link, not the name) |

The submit script renames the upload to its canonical name, moves it into
`role_profiles/<role>/`, and link-shares it; a resubmission trashes the
old file and takes its place (no paper trail — the folder is the state,
so the tab needs no Status column):

| Role | Folder | Canonical name |
| --- | --- | --- |
| senator | `role_profiles/senators/` | `<last_name>_<district>_profile.pdf` (lowercase, spaces → `_` — matches `name_link` in `scripts/shared.R`) |
| lobbyist | `role_profiles/lobbyists/` | `<ORG CODE>_profile.pdf` |
| journalist | `role_profiles/journalists/` | `<outlet slug>_profile.pdf` (collected now; shown once journalist pages exist) |

Senator pages and the senators table pick profiles up automatically;
lobby pages grow a Profile tab when their org's PDF exists.

## Tab: Spending  (form: "Report a Contribution")

| Column | Question |
| --- | --- |
| Timestamp / Email Address | automatic |
| Recipient | "Who received the contribution?" (dropdown: `SD-16 · Torres, Maria (D)` format, synced from Roster) |
| Amount | "Amount (dollars)" (number, 100–10000) |

## Tabs: Agenda LGL / ANR / BLH / APP / Floor  (five forms, one per body)

| Column | Question |
| --- | --- |
| Timestamp / Email Address | automatic |
| Meeting Date | date question |
| Bills in file order — one per line | paragraph: one bill per line (e.g. `SB-12`), up to 30; the listed order is the file order |
| — Revision | **script column**: revision number within the same Meeting Date |

(No time or room anywhere — the agenda carries only the meeting date;
chairs handle time and room in class.)

## Tab: Assignments  (form: "Committee Assignments & Leadership")

One row per submission; the newest row is the current state of the body.

| Column | Question |
| --- | --- |
| Timestamp / Email Address | automatic |
| LGL Chair / LGL Vice Chair / LGL Members | dropdowns + checkbox list of senators (filled by `syncRosterDropdowns()`, `SD-2 · Tester, New (D)` format) |
| ANR Chair / ANR Vice Chair / ANR Members | 〃 |
| BLH Chair / BLH Vice Chair / BLH Members | 〃 |
| APP Chair / APP Vice Chair / APP Members | 〃 |
| Pro Tem / Majority Leader / Minority Leader | dropdowns of senators |

Served by `?view=assignments` as district numbers only. On submit, the
votes workbook's senator columns are rewritten to match (floor = every
senator; data rows never touched) and the submitter gets a receipt.
Any senator account may submit — leadership is *defined by* this form,
so it can't gate on leadership; the receipt keeps changes visible.

## Tab: Referrals  (form: "Refer Bills to Committee")

| Column | Question |
| --- | --- |
| Timestamp / Email Address | automatic |
| LGL referrals — one bill per line / ANR … / BLH … | one paragraph box per policy committee: bills one per line, no count limit (leadership refers everything in one sitting) |

(Appropriations has no referral question: fiscal-flagged bills route there
automatically after passing their policy committee.)

Served by `?view=referrals`: every row in submission order, later
referrals of the same bill overriding earlier ones — the site moves
referred bills out of "Unassigned" into their policy committee. The
submitter gets a parse report naming any line that matched no filed bill.

## Tab: Posts  (form: "Post to the Wire")

| Column | Question |
| --- | --- |
| Timestamp / Email Address | automatic |
| Headline | "Headline (max 100 characters)" |
| Description | "Description line (max 250 characters)" |
| Link | "Link to the full story (optional)" (URL validation) |

Served to the site by the `newsfeed_api.gs` JSON endpoint, which joins the
Roster and returns **only**: time, name, outlet, headline,
description, link. Never the email.

## Tab: Editions  (form: "Publish a Newspaper Edition")

| Column | Question |
| --- | --- |
| Timestamp / Email Address | automatic |
| Edition | "Edition name/number" |
| Link | "Link to the edition" (URL validation) |

Served to the site by the gateway's `?view=editions` (edition, link,
submission time, outlet from the Roster — never the email). The Home
page's Papers card shows the newest row; the News page lists them all.

## Tab: Budgets  (hand-maintained)

| Column | Meaning |
| --- | --- |
| Org Code | e.g. `ENV` |
| Budget | total semester budget (number) |
| Spent | formula: sum of that org's Spending rows |
| Remaining | formula: Budget − Spent |

---

## Admin overrides, uniformly

Every stream follows the same two rules the course decided on:

1. **No approval gates** — rows publish automatically.
2. **The sheet is the source of truth** — to fix a mistake, edit the cell;
   to remove a submission, delete the row (or set its Status column where
   one exists). The next site build reflects it.
