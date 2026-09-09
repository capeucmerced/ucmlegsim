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

Each tab that the site reads is published to the web as CSV
(File → Share → Publish to web → that tab → CSV); the URLs go in
`scripts/shared.R` at deploy time.

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
| First Name / Last Name | Senators: their senator persona's name |
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
| Short Subject | "Short subject for the bill tables — a few concise words (e.g. Affordable Housing)" |
| Digest | "Digest: one paragraph summarizing what the bill does" |
| Flags | checkboxes: `Appropriation` / `Fiscal committee` / `Local program` / `Urgency` (comma-joined by Forms) |
| Primary Topic | dropdown from the policy tag list (single choice, required) |
| Secondary Topic | same list, optional |
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
| Recipient | "Who received the contribution?" (dropdown: `D-16 · Torres, Maria (D)` format, synced from Roster) |
| Amount | "Amount (dollars)" (number, 100–10000) |

## Tabs: Agenda LGL / ANR / BLH / APP / Floor  (five forms, one per body)

| Column | Question |
| --- | --- |
| Timestamp / Email Address | automatic |
| Meeting Date | date question |
| Time | "Meeting time (blank = usual class time)" (optional) |
| Room | "Room (blank = usual room)" (optional) |
| Item 1 … Item 10 | dropdowns of that body's eligible bills, in file order (blank = unused) |
| — Revision | **script column**: revision number within the same Meeting Date |

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
| LGL Referrals / ANR Referrals / BLH Referrals | slot dropdowns of *unreferred* bills (synced by script) |

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
