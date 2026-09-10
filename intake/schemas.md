# Intake data contract

This file defines every Google Sheet tab the intake system uses: which form
feeds it, its exact columns, and who may edit it by hand. The Google Forms,
the Apps Scripts in `apps-script/`, and the site pipeline are all written
against these layouts — if a column changes here, it changes in all three.

**Layout of the Google side (one workbook + one folder):**

- **Workbook "LegSim Intake"** — every form files its responses into a tab
  of this single workbook, alongside two hand-maintained tabs (Roster,
  Budgets). The admin can open this one file and see/fix everything.
- **Workbook "LegSim Votes"** — the existing vote-entry workbook students
  use live in class (one tab per committee + floor). Unchanged.
- **Drive folder "LegSim Files"** — uploaded PDFs land here, in
  subfolders mirroring `files/pdfs/` (bills, previous_bills,
  lobbyist_letters, agendas, role_profiles).

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
| First Name / Last Name | Senators: their senator persona’s name |
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

## Tab: Bills  (form: "File a Bill")

| Column | Question |
| --- | --- |
| Timestamp / Email Address | automatic |
| Filing Type | "Is this a new bill or an amended version of one of your bills?" (`New bill` / `Amendment`) |
| Amending | shown for amendments: "Which of your bills does this amend?" (dropdown, their bills) |
| Short Subject | "Short subject for the bill tables — a few concise words (e.g. Clean Air Near Schools Act)" |
| Digest | "Digest: one paragraph summarizing what the bill does" |
| Flags | checkboxes: `Appropriation` / `Fiscal committee` / `Local program` / `Urgency` (comma-joined by Forms) |
| Primary Topic | dropdown from the policy tag list (single choice, required) |
| Secondary Topic | same list, optional |
| Draft Doc | "Which of your two draft docs holds this bill’s text?" (`Draft 1` / `Draft 2`) |
| Body Ready | "Confirm the legal text in your bill doc is final" (checkbox) |
| — SB Number | **written by the on-submit script**, not a question |
| — Status | **written by scripts/admin**: blank = live; `void` = ignore this row |

## Tab: Letters  (form: "File a Position Letter")

| Column | Question |
| --- | --- |
| Timestamp / Email Address | automatic |
| Bill | "Which bill?" (dropdown of filed bills, synced by script) |
| Position | `Support` / `Support If Amended` / `Oppose Unless Amended` / `Oppose` |
| Letter PDF | file upload (PDF only) — Forms stores a Drive link |
| — Status | script/admin column: blank = current; `superseded` = older letter on the same bill |

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

(No time/room questions — chairs control those day-of; the generated
agenda prints the standing class time and room.)

## Tab: Assignments  (form: "Committee Assignments & Leadership")

One row per submission; the newest row is the current state of the body.

| Column | Question |
| --- | --- |
| Timestamp / Email Address | automatic |
| LGL Chair / LGL Vice Chair / LGL Members | dropdowns + checkbox list of senators |
| ANR Chair / ANR Vice Chair / ANR Members | 〃 |
| BLH Chair / BLH Vice Chair / BLH Members | 〃 |
| APP Chair / APP Vice Chair / APP Members | 〃 |
| Pro Tem / Majority Leader / Minority Leader | dropdowns of senators |

## Tab: Referrals  (form: "Refer Bills to Committee")

| Column | Question |
| --- | --- |
| Timestamp / Email Address | automatic |
| LGL referrals — one bill per line / ANR … / BLH … | one paragraph box per policy committee: bills one per line, no count limit (leadership refers everything in one sitting) |

(Appropriations has no referral question: fiscal-flagged bills route there
automatically after passing their policy committee.)

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
