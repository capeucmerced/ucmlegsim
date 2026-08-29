# UC Merced California Legislative Simulation — Course Website

This repository builds [ucmlegsim.com](https://ucmlegsim.com) — the tracking
site for the UC Merced CA Legislative Simulation course. It is a
[Quarto](https://quarto.org) website: the pages are written in R, rendered to
HTML by GitHub Actions, and served on GitHub Pages. Nobody edits HTML by hand.

## How the site updates

1. Data lives in `files/` (CSVs and PDFs) and in published Google Sheets
   (vote tallies, class newspaper). See `scripts/shared.R` for every URL.
2. On every push to `main` — and hourly as a backstop — GitHub Actions
   renders the whole site and deploys it. The workflow is
   `.github/workflows/update-site.yml`.
3. Before each render, three scripts regenerate the per-bill, per-senator,
   and per-lobby pages from the data (`scripts/make_*.R`). Those generated
   pages are **not** kept in the repository — they are rebuilt every time.

To force an immediate rebuild: GitHub → Actions → "Build and Deploy Site" →
"Run workflow".

## Directory map

| Path | What it is |
| --- | --- |
| `*.qmd` (top level) | The eight main pages (Home, Bills, Senators, Votes, Districts, Agendas, Lobbyists, News) |
| `scripts/shared.R` | **The one place** for data locations, Google Sheet URLs, committee names, and shared loading/cleaning functions |
| `scripts/make_*.R` | Generators that write one page per bill / senator / lobby before each render |
| `scripts/archive_site.ps1` | The crawler used to snapshot a retiring year's site |
| `files/csvs/` | Rosters and lists: senators, bills, lobbies, journalists, contributions |
| `files/pdfs/` | Bill texts, previous versions, agendas, lobbyist letters, role profiles |
| `files/images/`, `files/other/` | Logo images; district map GeoJSON |
| `archive/` | Frozen snapshots of prior years' sites (`archive/2025/` etc.), served as-is at `/archive/`. Never edit these. |
| `_quarto.yml` | Site configuration: navbar, theme, pre-render scripts |

`bills-pages/`, `senator-pages/`, `lobby-pages/`, `_site/`, and `_freeze/`
appear locally after a render. They are build output, ignored by git.

## Fixing things by hand (admin quick reference)

- **A vote is wrong** → edit the cell in the vote-entry Google Sheet; the
  next build picks it up.
- **A bill/senator/lobby detail is wrong** → edit the matching CSV in
  `files/csvs/`, commit, push.
- **Replace a PDF** (bill text, letter, agenda, profile) → drop the new file
  over the old one in `files/pdfs/...`, keeping the same filename
  convention, commit, push.
- **Filename conventions** (case matters):
  - bills: `LASTNAME_SB12.pdf` · previous versions: `LASTNAME_SB12_v1.pdf`
  - letters: `ORG_SB12_support.pdf` / `ORG_SB12_oppose.pdf` (org codes from `lobbyist_list.csv`, uppercased)
  - agendas: `anr_10_17_25.pdf` (committee code + M_D_Y)
  - senator profiles: `ochoa_bogh_19_profile.pdf` (last name lowercased, spaces→underscores, then district)
- **A Google Sheet URL changed** → update it in `scripts/shared.R` (nothing
  else references URLs directly).

## Working locally

Requirements: R (with the packages listed in the workflow file) and Quarto.

```bash
quarto render
```

renders the full site into `_site/`. The first render executes every page;
after that, Quarto's freeze cache skips pages whose data didn't change, so
re-renders are much faster. Open `_site/index.html` in a browser to check
the result.

## Notes for maintainers

- Generated pages bake all their data in at generation time (`dput()` blocks
  and plain markdown links). Don't add code to a *generated* page that reads
  files or URLs when the page renders — the freeze cache would serve a stale
  copy. Runtime reads belong only in the eight top-level `.qmd` pages, which
  are never frozen.
- The hourly schedule in the workflow is disabled automatically by GitHub
  after ~60 days without repository activity. Re-enable it from the Actions
  tab at the start of a semester.
- To retire a year and archive it, see `scripts/archive_site.ps1` and the
  `archive/` folder: mirror the live site into `archive/<year>/`, patch any
  root-absolute links (the district map's click handler is the known one),
  and add a line to `archive/index.html`.
