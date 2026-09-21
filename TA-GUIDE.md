# The Website: A TA's Guide

*This is the website portion of the simulation TA bible. It assumes you
are new to the course, comfortable with basic R, not much of a
programmer otherwise, and that you have an AI assistant to lean on. It
walks through what the website is, what you must do each semester to
keep it alive, how to make the changes that predictably come up, and
what to do when something breaks. The course-materials portion (Canvas,
assignments, grading) lives elsewhere.*

*Two other documents matter: [README.md](README.md) is the quick
reference for the repository itself (what each folder is, filename
conventions, one-line fixes), and [intake/README.md](intake/README.md)
holds the step-by-step **runbooks** for the big once-a-semester
operations. This guide tells the story and points you to those at the
right moments.*

---

## 0. Read this first

**Your job, in one sentence:** keep a website running that students
never edit directly — everything they do flows through Google Forms,
and robots rebuild the site from that data automatically.

Five facts protect you from every disaster:

1. **You can't destroy history.** The site's code lives in git, which
   keeps every prior version of every file. If you break something,
   the old version is always recoverable. The live site also keeps
   serving its last good build until a *successful* new build replaces
   it — a broken build never takes the site down; it just stops
   updates until fixed.
2. **The robot goes to sleep.** GitHub silently disables the site's
   automatic rebuilds after ~60 days without repository activity —
   which is exactly what a winter or summer break looks like. Waking
   it up is one click (§4, launch day). If "the site stopped
   updating," check this first, always.
3. **The password that expires.** The Google side asks GitHub to
   rebuild the site using a stored token that has an expiration date.
   A new one must be minted every year (§4, launch day). If form
   submissions stop triggering rebuilds mid-year, this is suspect #2.
4. **Never publish the intake tabs.** The workbook tabs holding form
   responses contain student emails. They must never be shared
   publicly or "published to the web." The vote tabs are the one
   designed exception (they hold no emails). Everything the site needs
   is served through code that strips identity first.
5. **Ask your AI assistant properly.** When you're stuck, paste in the
   *exact* error message plus the *contents of the relevant file* (or
   a link — this repository is public at
   `github.com/capeucmerced/ucmlegsim`). "The website is broken" gets
   you nothing; "this GitHub Actions log ends with this error, and
   here is the file it mentions" gets you an answer.

---

## 1. What the website actually is

**The site** — [ucmlegsim.com](https://ucmlegsim.com) — is a
[Quarto](https://quarto.org) website. Each page is a plain-text file
ending in `.qmd` (Quarto markdown): mostly ordinary text, with chunks
of R code that run *when the site is built* to produce the tables,
maps, and charts. Building ("rendering") turns those `.qmd` files into
the finished HTML. Nobody ever edits HTML by hand.

**The code** lives in a GitHub repository:
`github.com/capeucmerced/ucmlegsim`. GitHub is where the code is
stored, versioned, and built. `capeucmerced` is a GitHub account the
department controls (note for later: it is a regular *user* account,
not an "organization" — this matters once, in §4).

**The building and hosting** are both GitHub's:

- **GitHub Actions** is GitHub's build robot. The recipe file is
  `.github/workflows/update-site.yml`; the workflow's name in the
  interface is **Build and Deploy Site**. It rebuilds the whole site
  (1) on every push of new code, (2) hourly as a backstop, (3) when
  you press its "Run workflow" button, and (4) whenever the Google
  side asks it to — which is how a form submission updates the site
  within ~10 minutes.
- **GitHub Pages** serves the built site to the world at
  ucmlegsim.com.

**The data** lives on the Google side, all owned by one department
Google account (the "CAPE sim account" — you'll be handed its login,
§2). Each year gets its own Drive folder, `LegSim <year>`, containing:

- **LegSim Intake** — THE workbook. Every Google Form files its
  responses into one tab of this spreadsheet, alongside two
  hand-maintained tabs: **Roster** (who is who: each student's email,
  role, and persona/org/outlet) and **Budgets**. When you fix
  something by hand, it's almost always here.
- **LegSim Votes** — the vote-entry workbook used live in class.
- **LegSim Files** — every PDF students file (bills, letters,
  agendas, profiles), auto-named and auto-sorted.
- The Google Forms themselves, and two template Docs.

**The automation** is Apps Script — JavaScript code attached to the
intake workbook (in the Sheet: Extensions → Apps Script). It numbers
bills, assembles bill PDFs from a template, files uploads under
canonical names, keeps form dropdowns in sync, and asks GitHub for a
rebuild after each submission. Every Apps Script file is mirrored in
this repository under `intake/apps-script/` — **the repo copies are
the master**. If code needs changing, change it here first, then paste
it into the Apps Script editor.

**The bridge between Google and the site** is the *gateway*: one Apps
Script "web app" (`newsfeed_api.gs`) with a public URL ending in
`/exec`. It serves the workbook's data as JSON **with all emails and
student names stripped**. When the site builds, it fetches from the
gateway. The gateway URL is written in exactly two places:
`INTAKE_API_URL` in `scripts/shared.R` and `FEED_URL` in `js/feed.js`.

**The one live wire:** almost everything on the site updates by
rebuild (~10 minutes). The Wire — the journalist newsfeed — is the
exception: the reader's *browser* fetches posts straight from the
gateway, so posts appear in seconds with no rebuild at all.

Putting it together:

```
student signs into a Google Form and submits
        │
        ▼
row lands in a tab of the LegSim Intake workbook
        │
        ▼
Apps Script reacts: numbers the bill / files the PDF / etc.,
then calls GitHub: "rebuild the site"
        │
        ▼
GitHub Actions renders every page (fetching de-identified
data from the gateway) and deploys to ucmlegsim.com
        │
        ▼
the change is live, usually within ~10 minutes

(Wire posts skip the bottom half: browsers read them
 straight from the gateway, seconds after posting.)
```

**The privacy model** (memorize this part):

- Student **emails** exist only inside the intake workbook and reach
  the site never. The gateway strips them; intake tabs are never
  shared or published.
- Student **names** don't appear on the site either. Senators appear
  as their assigned real-senator *persona*; lobbyists as their
  *organization*; journalists as their *outlet* (their Roster name
  cells are deliberately left blank, which makes Wire bylines show
  the paper's name alone).
- The **archive** (`archive/` — prior years' complete sites) is
  frozen. Never edit anything in it.

---

## 2. Getting your access (do this in week one)

Five things, in order. Each is quick; waiting on other people is the
slow part, so start early.

1. **Make yourself a GitHub account** (skip if you have one). Go to
   [github.com](https://github.com), Sign up, use an email you'll
   still own after graduating. Free tier is fine.

2. **Get write access to the repository.** Ask the CAPE director (or
   the outgoing TA) to add your GitHub username as a **collaborator**
   on `capeucmerced/ucmlegsim`. Whoever can sign in as `capeucmerced`
   does this at: repository → Settings → Collaborators → Add people.
   You'll get an email invitation — accept it. "Write" access lets
   you edit code and watch builds; it's all you need.

3. **Get the CAPE sim Google account login** from the CAPE director.
   This is the department Google account that owns the whole Google
   side. Treat its password like a grade roster. You will do all
   Google-side admin work signed in as this account.

   > **The one Google gotcha you'll hit immediately:** if your
   > personal Gmail and the CAPE account are signed into the same
   > browser, opening Extensions → Apps Script often fails with
   > "Sorry, unable to open the file." Google opened the editor under
   > the wrong account. Fix forever: do CAPE-account work in an
   > **incognito/private window** signed into only the CAPE account
   > (or a separate browser profile dedicated to it).

4. **Find the year's Drive folder.** Signed in as the CAPE account,
   open Drive and find `LegSim <year>`. Open the LegSim Intake
   workbook and bookmark it — you'll live there.

5. **Optional, not urgent: a local copy of the code.** For routine
   semester operations you do **not** need R, Quarto, or anything
   installed — small code edits can be made directly on the GitHub
   website (§6), and all building happens in the cloud. Set up a
   local copy only when you get to §7.

---

## 3. The rhythm of a semester

The website work clusters into four moments. Each has a detailed
runbook in [intake/README.md](intake/README.md); this section tells
you when to use which and what actually happens.

| When | What | Runbook section |
| --- | --- | --- |
| Before the semester | Stand up this year's Google side; archive last year | "Yearly turnover", "Deploy checklist" |
| First week | Wake the robot, mint the token, the launch push | "Launch day" |
| When the class list is final | Fill the Roster, provision bill docs, sync dropdowns | "Roster day" |
| All semester | Watch, fix data by hand, add stragglers | §5 of this guide |
| After finals | Freeze the year into the archive | "Yearly turnover" again |

A few translations of what those runbooks accomplish:

**Yearly turnover** exists so no year ever overwrites another. Google
side: a brand-new `LegSim <year>` folder gets fresh copies of the
workbooks and forms (the old folder just sits there forever as the
raw-data archive). Website side: the retiring year's finished site is
crawled into `archive/<year>/` (see `scripts/archive_site.ps1` and the
notes at the bottom of README.md), and the new year starts with
emptied intake data. The repo's yearly bindings — gateway URL, form
links, vote-sheet URLs — all live in **one file**, `scripts/shared.R`,
plus the feed URL in `js/feed.js`.

**Launch day** is three unforgiving details and one push:
the auto-disabled workflow must be re-enabled *first* (a disabled
workflow ignores everything, including your push); the `GITHUB_TOKEN`
script property gets a fresh token (details in §4 below — the runbook
has the exact clicks); and the token test only works *after* the new
code is on `main`. Do it in the runbook's order and it just works.

**Roster day** is where students become senators. The iron rule: a
senator row's First/Last/District/Party must match
`files/csvs/senator_list.csv` **letter for letter** — that name is the
join key connecting bills, votes, and pages. Lobbyist and journalist
rows get their Org Code / Outlet and **blank name cells** (that's the
anonymity working, not an oversight). Then two functions run in the
Apps Script editor: `provisionBillDocs()` (creates and shares each
senator's two draft docs; rerun until it says nothing left to do — it
safely skips anyone already provisioned) and `syncRosterDropdowns()`
(fills every form dropdown from the real roster). Students confirm
their own hookup with the **Check My Role** form (in the site's Filing
Cabinet): it emails them what the system thinks they are.

---

## 4. The GitHub token, fully explained (because it *will* bite)

Every form submission ends with Apps Script calling GitHub's API:
"rebuild the site." GitHub only obeys if the call carries a valid
**personal access token (PAT)** — a long password-like string — stored
in the Apps Script project as the Script Property `GITHUB_TOKEN`
(Apps Script editor → Project Settings ⚙ → Script Properties).

What you need to know:

- **Type matters.** It must be a **classic** token with the single
  scope **`public_repo`**. GitHub's newer "fine-grained" tokens
  *cannot work here*: `capeucmerced` is a plain user account, not an
  organization, and fine-grained tokens can only target your own
  account or an organization you belong to. If you follow a generic
  tutorial and it 403s, this is why.
- **Where to mint it:** signed in as an account with write access to
  the repo, go to GitHub → Settings → Developer settings → Personal
  access tokens → **Tokens (classic)** → Generate new token. Name it,
  set the expiration past the semester, tick `public_repo` only,
  generate, copy immediately (it's shown once), paste into the
  `GITHUB_TOKEN` Script Property.
- **Whose account?** Minting it while signed in *as `capeucmerced`*
  is best — then it never depends on any individual keeping repo
  access. A token from your personal account works identically but
  dies if your access is ever removed.
- **It expires.** When it does (or when the account loses access),
  the symptom is: submissions still land in the workbook, but the
  site stops updating until the hourly build (and the Apps Script
  execution log shows the rebuild call failing with 401/403). Fix:
  mint a fresh token, update the property. Takes five minutes.
- **Script Properties survive code re-pastes.** Updating `.gs` code
  never wipes the token (or any other stored setting).

---

## 5. Running the simulation (your semester-long duties)

Honestly, the system mostly runs itself. Your recurring work:

**Watch the builds (weekly, 30 seconds).** Repository → Actions. Green
checks: fine. A grey octagon (cancelled) followed by a newer run is
normal — when submissions stack up, only the newest build runs; it
contains everything the cancelled one would have. A **red X** means a
build failed and the site is frozen at its last good state — see §8.

**Hook up new registrations.** Students who register late append
themselves to the Roster tab (email + name, nothing else). You fill in
their Role and role fields — senator persona *exactly* as in
`senator_list.csv`, or Org Code, or Outlet (name cells blank for
those two) — then rerun `provisionBillDocs()` and
`syncRosterDropdowns()`. They verify with Check My Role.

**Fix data by hand.** The design principle: *the workbook is the
database and you are allowed to edit it.* A bad Wire post, a wrong
contribution amount, a duplicate letter — edit or delete the row in
the matching intake tab. Wire changes show in seconds; everything else
on the next build. Two cautions: (1) never delete rows in the
**Bills** tab to undo a bill — bill numbering reads the highest SB
number present, so voiding is a job for the runbooks; ask before
improvising; (2) votes are fixed in the **LegSim Votes** workbook, not
the intake workbook.

**Replace files.** A corrected bill PDF, letter, agenda, or profile
can be dropped over the old one — same folder, same exact filename —
either in `files/pdfs/...` (commit + push) or by re-submitting through
the form. Filename conventions are in README.md.

**During class votes:** nothing. The vote sheet's own script stamps
dates; the site reads the published vote tabs on each build.

---

## 6. Making the predictable changes

First, the universal mechanic. Every site change is: edit a file in
the repository → commit (save with a message) → push (send to GitHub)
→ Actions rebuilds automatically. For a single file, the GitHub
website alone suffices:

> **Editing without installing anything:** on github.com, open the
> file → click the pencil icon → make the change → "Commit changes"
> (green button). That commit *is* the push; the rebuild starts
> immediately. This is fine for text edits, CSV rows, and small
> fixes.

Now the changes that predictably come up:

**Page wording.** Top-level pages are the `.qmd` files at the repo
root (`index.qmd`, `bills.qmd`, `help.qmd`, `life-of-a-bill.qmd`, …).
Text in them is ordinary markdown — edit and commit. Leave the R code
chunks alone unless you know why you're in one.

**New senators after an election.** `files/csvs/senator_list.csv` is
the canon: District, First Name, Last Name, Party (plus
Leadership/Committee columns filled during the sim). Update the rows
that changed. Remember the iron rule — the Roster's senator rows must
match this file exactly, so if a persona changes mid-cycle, change it
in both places. District boundaries themselves basically never change;
the map data (`files/other/`) stays put.

**Add/remove/rename a lobbyist organization.**
`files/csvs/lobbyist_list.csv`: one row per org — display name, its
short **Code** (the uppercase key used in filenames and the Roster),
Spending Power (leave blank until you've set the year's tiers; blank =
no badge on the tile), and its brand Color (hex) for the tile and
bill-page bookmarks. Adding a row creates the tile and its page on the
next build. Also give the org a row in the workbook's Budgets tab.

**Add/remove a newspaper.** `files/csvs/journalist_list.csv`: Newspaper
(display name), Link (optional; the outlet's own articles page if the
class makes one). Each row automatically gets a tile on News and its
own page (wire history + profile). The profile-PDF filename is derived
from the name (lowercased, punctuation → underscores), so renaming an
outlet mid-semester orphans an uploaded profile — avoid renames after
profiles start arriving.

**Change the bill policy-topic list.** The topic dropdowns live in the
Bills form itself. Edit the form's question choices directly in the
Google Forms editor (signed in as the CAPE account). Keep site-side
displays in mind: topics are just text, nothing else keys off them.

**Adjust spending-power badges.** Fill the Spending Power column in
`lobbyist_list.csv` (e.g. High/Medium/Low) and the tiles show badges
again; blank the column to hide them. That's the whole mechanism.

**Add a whole new form / role behavior.** This is the one "real
programming" task. The pattern to copy is the role checker, our
simplest complete example: `intake/apps-script/role_check.gs` builds
the form and handles submissions, plus one dispatch line in
`intake_workbook.gs`'s router (every form files into one workbook; a
single trigger routes by tab name). The data contract for every
existing form is written down in `intake/schemas.md`. Read those two,
then design with your AI assistant.

**Colors, fonts, look and feel.** All design lives in
`styles/brand.scss`. The role colors (senator red, lobbyist green,
journalist purple) are deliberate canon — used sparingly, only where
color distinguishes roles. One trap for sizing math: the site's root
font size is 17px, so `1rem` = 17px here, not the usual 16.

**Things you should not touch:** anything in `archive/` (frozen
history); the render list in `_quarto.yml` (it exists to keep repo
docs like this one off the public site — yes, `.md` files don't
render, but the principle stands); the privacy model (§1); and the
generated folders (`bills-pages/`, `senator-pages/`, `lobby-pages/`,
`journalist-pages/`) — they're rebuilt from scratch every render, so
edits there evaporate. To change those pages, change their generator
in `scripts/make_*.R`.

---

## 7. Working locally (only when you need it)

You need a local setup when a change is too big to eyeball from a
GitHub edit box — layout work, new pages, anything you want to *see*
before the world does.

Install, in order: [R](https://cran.r-project.org),
[RStudio](https://posit.co/download/rstudio-desktop/),
[Quarto](https://quarto.org/docs/get-started/), and
[Git](https://git-scm.com/downloads). Then clone the repository
(RStudio: File → New Project → Version Control → Git → paste
`https://github.com/capeucmerced/ucmlegsim.git`).

> **Put the clone in a plain local folder** — `C:\Users\you\ucmlegsim`
> or similar. **Not** inside Box, OneDrive, Dropbox, or Google Drive.
> Cloud-sync tools grab files mid-render and corrupt builds in
> maddening, random ways. (Ask the 2026 revamp how it knows.) GitHub
> itself is your backup; the clone needs no other syncing.

First render: open the project and run `quarto render` in the
Terminal tab. The first one is slow (every page executes; R will need
the packages listed in `.github/workflows/update-site.yml` —
`install.packages(...)` them when it complains). After that, Quarto's
freeze cache skips unchanged pages and re-renders take a couple of
minutes. Preview by opening `_site/index.html` in a browser. Render a
single page while iterating: `quarto render news.qmd`.

Then the git cycle: commit your changes with a short message and push
(RStudio's Git pane has buttons for all of it). The push triggers the
real build.

---

## 8. When something breaks

**The site stopped updating.** In order:
1. Actions tab — is the workflow *disabled*? (The 60-day sleep — one
   click to enable. This is the answer right after any break.)
2. Actions tab — is the newest run a red X? Open it, click the failed
   step, read the last ~30 lines. Copy them to your AI assistant with
   "this is a Quarto website built by GitHub Actions; here's the
   failing log." Most common causes: an R error from a data mismatch
   (e.g., a Roster senator name not in `senator_list.csv`), or a
   malformed CSV edit (a stray comma or quote).
3. Nothing red, nothing disabled? Hard-refresh the page
   (Ctrl+Shift+R) — you may be staring at your browser's cache.

**A form submission didn't do what it should** (bill didn't get
numbered, PDF didn't get filed): Apps Script editor → Executions (the
clock-ish icon). Find the failed run, read its log. Handler failures
also email the CAPE account automatically with the error. The row is
always safely in the sheet — fix the cause, then reprocess or
resubmit.

**Submissions land but no rebuild follows:** the token (§4). Check
Executions for a 401/403 on the rebuild call.

**The Wire is empty / "connects when the session begins":** the
gateway. Check `FEED_URL` in `js/feed.js` is the current `/exec` URL.
If someone redeployed the web app as a *new deployment*, the URL
changed — the rule is **Manage deployments → ✏ edit → New version**,
which keeps the same URL. If the URL truly changed, update it in
`js/feed.js` *and* `scripts/shared.R`, commit, push.

**You pushed something broken:** don't panic — the live site is still
serving the last good build. Fix forward (edit again) or revert: on
github.com, the commit page has a "Revert" button; locally,
`git revert HEAD` then push. Ask your AI assistant before improvising
with anything scarier (`reset`, `force`) — you almost never need
those.

**Something Google-side is deeply wrong** (workbook deleted, account
lockout): stop and contact the CAPE director. The workbooks are only
recoverable from Drive's trash within 30 days.

---

## 9. FAQ

**Q: I've never used git. What's the minimum I must understand?**
A repository is a folder whose entire history is saved. A *commit* is
a saved snapshot with a note; a *push* uploads your commits to GitHub.
That's genuinely enough: for most of your work, the GitHub website's
pencil-edit button commits and pushes in one step. Learn the rest only
when you set up locally (§7), and let RStudio's buttons do it.

**Q: Where is the data? Is there a database?**
No database. Three places, by kind: *site content* (senator/org/paper
lists, PDFs) = CSVs and files in the repo under `files/`; *everything
students submit* = tabs of the LegSim Intake workbook; *votes* = the
LegSim Votes workbook. If you're unsure where to fix something:
README.md's "Fixing things by hand" section is the router.

**Q: Can I really just edit the Google Sheet?**
Yes — it's designed for that. Edit or delete rows freely in intake
tabs (except Bills — see §5), fix vote cells in the votes workbook.
The site simply reflects the sheets on the next build.

**Q: The form dropdowns show the wrong people.**
Rerun `syncRosterDropdowns()` in the Apps Script editor. Dropdowns are
snapshots of the Roster, refreshed only when that function runs. (The
bill dropdowns are different — they append automatically as bills are
numbered.)

**Q: A student registered with the wrong account / registered twice.**
The account is the identity — everything keys off the email they
*submit forms with*. Keep whichever row has the account they'll
actually use, fill it, delete the other. If a senator switches
accounts after doc provisioning, update the Email cell, then either
re-share their two draft docs to the new address (open each doc →
Share) or blank the row's Bill Doc cells and rerun
`provisionBillDocs()` for fresh ones.

**Q: A senator filed a bill and the site shows nobody as author.**
Their Roster persona doesn't exactly match `senator_list.csv`
(spelling, spacing, middle names count). Fix the Roster row to match
the CSV letter-for-letter; next build heals.

**Q: Why do journalists' Wire posts show no student name?**
By design — the anonymity model (§1). Bylines are the outlet. If a
student's real name is appearing anywhere, their Roster name cells
were filled in; blank them.

**Q: Apps Script says "Sorry, unable to open the file."**
The multi-account gotcha (§2): open it from an incognito window signed
into only the CAPE account.

**Q: The hourly rebuild stopped over break. Broken?**
No — the 60-day sleep (§0, fact 2). Actions tab → the workflow → Enable.

**Q: How do I hand this to next year's TA?**
Have the director add their GitHub account as a collaborator, pass on
the CAPE Google login, walk the "Yearly turnover" runbook together,
and have them read this guide *before* the semester starts. Budget one
afternoon together; it saves a semester of confusion.

**Q: What's safe to ask AI to do versus doing myself?**
Great uses: explaining any file in this repo, diagnosing a build log,
drafting a CSV edit, writing/reviewing R or Apps Script changes
against the patterns here. Keep for yourself: anything touching the
CAPE account's credentials, deleting data, and the final click on
anything irreversible. Never paste the token, passwords, or student
emails into an AI tool — there is no legitimate reason a fix needs
them.

**Q: The site looks wrong only on my machine.**
Hard-refresh (Ctrl+Shift+R). The site's stylesheets change filenames
every build; browsers sometimes cling to a stale page that references
the old ones.

**Q: Who do I call?**
Access and accounts: the CAPE director. Everything else: the Actions
log, the Executions log, this guide's §8, and your AI assistant — in
that order. The original developer's contact is in the site footer as
a true last resort.
