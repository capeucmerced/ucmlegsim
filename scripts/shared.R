# scripts/shared.R
# ---------------------------------------------------------------------------
# One place for everything used by more than one page or script:
# data locations, the vote-sheet URLs, committee names, and the functions
# that load senators/bills and clean vote sheets.
#
# Every top-level .qmd page and every scripts/make_*.R generator starts with:
#     source("scripts/shared.R")
#
# If a Google Sheet URL or a folder ever moves, this file is the only place
# that needs editing.
# ---------------------------------------------------------------------------

library(tidyverse)

# --- Where the data lives ---------------------------------------------------

BILLS_CSV     <- "files/csvs/bill_list.csv"
SENATORS_CSV  <- "files/csvs/senator_list.csv"
LOBBY_CSV     <- "files/csvs/lobbyist_list.csv"
JOURNALIST_CSV<- "files/csvs/journalist_list.csv"
CONTRIB_DIR   <- "files/csvs/lobbyist_contributions"

BILL_PDF_DIR      <- "files/pdfs/bills"
PREV_BILL_PDF_DIR <- "files/pdfs/previous_bills"
LETTERS_DIR       <- "files/pdfs/lobbyist_letters"
AGENDAS_DIR       <- "files/pdfs/agendas"
PROFILE_DIR       <- "files/pdfs/role_profiles"
SEN_PROFILE_DIR   <- "files/pdfs/role_profiles/senators"
LOBBY_PROFILE_DIR <- "files/pdfs/role_profiles/lobbyists"
# journalists' profiles sync into role_profiles/journalists — collected
# now, displayed once per-journalist pages exist

# Where the generated pages go (created by the make_*.R scripts each render)
BILL_PAGES_DIR    <- "bills-pages"
SENATOR_PAGES_DIR <- "senator-pages"
LOBBY_PAGES_DIR   <- "lobby-pages"

# --- Live Google Sheets (published-to-web CSV links) ------------------------

# The five vote tally tabs (the dept's LegSim Votes 2026 workbook — these
# links change once a year at turnover). Names here are the committee
# codes used everywhere.
VOTE_SHEET_URLS <- c(
  lgl   = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSJsQMxkEycDp8_wEucU9S-ZNxlC1ylRprZAMIFwvxM0P9tT3tOU-5uthfaMQR34AKEJyQ5_Fl3Z-sV/pub?gid=1874825266&single=true&output=csv",
  anr   = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSJsQMxkEycDp8_wEucU9S-ZNxlC1ylRprZAMIFwvxM0P9tT3tOU-5uthfaMQR34AKEJyQ5_Fl3Z-sV/pub?gid=243814767&single=true&output=csv",
  blh   = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSJsQMxkEycDp8_wEucU9S-ZNxlC1ylRprZAMIFwvxM0P9tT3tOU-5uthfaMQR34AKEJyQ5_Fl3Z-sV/pub?gid=711683643&single=true&output=csv",
  app   = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSJsQMxkEycDp8_wEucU9S-ZNxlC1ylRprZAMIFwvxM0P9tT3tOU-5uthfaMQR34AKEJyQ5_Fl3Z-sV/pub?gid=890174714&single=true&output=csv",
  floor = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSJsQMxkEycDp8_wEucU9S-ZNxlC1ylRprZAMIFwvxM0P9tT3tOU-5uthfaMQR34AKEJyQ5_Fl3Z-sV/pub?gid=1361712932&single=true&output=csv"
)

# Where votes are entered (link shown on the Votes page)
VOTE_ENTRY_URL <- "https://docs.google.com/spreadsheets/d/1O3c2ZGWMUwBu_q2Yjr0nbfBOn9qD2T3A_zhYH8Q2ZHs/edit?gid=0#gid=0"

# --- 2026 intake sources (the Google Forms era) -----------------------------
# All intake data reaches the site through ONE Apps Script endpoint (see
# intake/apps-script/newsfeed_api.gs) that joins the roster SERVER-SIDE and
# strips emails before anything leaves Google. Intake tabs are never
# published to the web — every response tab contains submitter emails, so
# a published-CSV link would leak them. This URL is safe in public code
# precisely because its output is de-identified.
# The DEPARTMENT account's 2026 deployment (swapped from the beta
# Sep 2026; changes once a year at turnover — see intake/README.md).
INTAKE_API_URL <- "https://script.google.com/macros/s/AKfycbwcPcwt8LTJri6lBrbarYTzzxuMyDPSR5Ek1nNXrsAzLSDEinia3oXBgt9PEshfqEjoSw/exec"

# Which intake streams are live (their loaders merge rows in; the 2025
# fixture files stay alongside until the semester-start data reset)
INTAKE_LIVE <- c("spending", "letters", "bills", "profiles", "editions")

read_intake_json <- function(view) {
  tryCatch({
    # curl (not base url connections): Apps Script answers through a
    # redirect that base R handles unreliably, and wants a user agent
    h <- curl::new_handle(followlocation = TRUE, useragent = "ucmlegsim-build/1.0")
    resp <- curl::curl_fetch_memory(paste0(INTAKE_API_URL, "?view=", view), handle = h)
    jsonlite::fromJSON(rawToChar(resp$content))
  }, error = function(e) {
    message("WARNING: intake endpoint unreachable (", conditionMessage(e), ") — view: ", view)
    NULL
  })
}

# Contributions filed through the 2026 Spending form, reshaped to the same
# columns as the fixture contributions. The endpoint has already resolved
# each submitter to their org and dropped the email.
load_intake_contributions <- function() {
  if (!"spending" %in% INTAKE_LIVE) return(data.frame())
  j <- read_intake_json("spending")
  if (is.null(j) || length(j$contributions) == 0) return(data.frame())

  lobbys <- read.csv(LOBBY_CSV) |> mutate(Code = toupper(Code))

  as.data.frame(j$contributions) |>
    transmute(
      Date = as.Date(substr(time, 1, 10)),
      Recipient.Name = as.character(recipient),
      Recipient.District = suppressWarnings(as.integer(district)),
      Contribution = suppressWarnings(as.numeric(amount)),
      Lobby_Code = toupper(as.character(org))
    ) |>
    filter(!is.na(Contribution)) |>
    left_join(lobbys |> select(Code, Lobby), by = c("Lobby_Code" = "Code")) |>
    mutate(Lobby = ifelse(is.na(Lobby), Lobby_Code, Lobby))
}

# --- Names --------------------------------------------------------------

# Committee codes -> full display names
COMMITTEE_NAMES <- c(
  lgl   = "Local Government and Labor",
  anr   = "Agriculture and Natural Resources",
  blh   = "Business, Law, and Health",
  app   = "Appropriations",
  floor = "Floor"
)

# --- Small helpers ----------------------------------------------------------

# The house interactive table. Direct reactable (not gt's interactive
# mode) so column TYPES drive sorting: numbers sort as numbers, Dates as
# dates — gt hands reactable pre-rendered strings, which is why "SB-10"
# sorted before "SB-2". Styling comes from styles/brand.scss, which
# targets reactable's classes.
#
#   legsim_table(df,
#     columns = list(col = reactable::colDef(...)),
#     searchable = TRUE, page_size = 20)
#
# For a linked column that must sort numerically, keep the column numeric
# and draw the link in a cell renderer:
#   colDef(name = "Bill", cell = link_cell("SB-", urls))
link_cell <- function(prefix, urls) {
  force(urls)
  function(value, index) {
    if (is.na(urls[index])) return(paste0(prefix, value))  # no page: plain text
    htmltools::tags$a(href = urls[index], paste0(prefix, value))
  }
}

legsim_table <- function(data, columns = list(), searchable = TRUE,
                         page_size = 20, ...) {
  reactable::reactable(
    data,
    columns = columns,
    searchable = searchable,
    sortable = TRUE,
    highlight = TRUE,
    defaultPageSize = page_size,
    showPageSizeOptions = FALSE,
    defaultColDef = reactable::colDef(na = ""),
    ...
  )
}

# Date columns: pass real Date objects and give the colDef
# format = LEGSIM_DATE — sorts chronologically, displays like 12/5/25.
LEGSIM_DATE <- reactable::colFormat(date = TRUE, locales = "en-US")

# Read a published Google Sheet without letting one bad fetch kill the whole
# site build. On any error this returns an empty data frame, which every
# downstream table treats as "no data yet".
read_sheet_safe <- function(url) {
  tryCatch(
    read.csv(url),
    error = function(e) {
      message("WARNING: could not read sheet (", conditionMessage(e), ") — continuing with no data: ", url)
      data.frame()
    }
  )
}

# --- Senators ---------------------------------------------------------------

# Read the senator roster and add the standard derived columns every page uses:
#   Name        "First Last" (single spaces)
#   name_join   "firstlast" lowercased, no spaces — for joining with bills
#   name_link   "last_name" lowercased, spaces -> underscores — for file names
#   name_period make.names() version of Name — how R writes their vote column
load_senators <- function() {
  read.csv(SENATORS_CSV) |>
    mutate(
      Name        = trimws(gsub("\\s+", " ", paste(First.Name, Last.Name))),
      name_join   = tolower(gsub(" ", "", paste0(First.Name, Last.Name))),
      name_link   = tolower(gsub(" ", "_", Last.Name)),
      name_period = make.names(Name)
    )
}

# The name vectors used when counting votes. R replaces spaces/hyphens with
# periods in column names, so vote sheets are always handled via the
# "period" versions and renamed back for display at the end.
senator_name_sets <- function(senators) {
  list(
    s_names        = senators$Name,
    s_names_period = senators$name_period,
    d_sen          = senators$Name[senators$Party == "D"],
    d_sen_period   = senators$name_period[senators$Party == "D"],
    r_sen          = senators$Name[senators$Party == "R"],
    r_sen_period   = senators$name_period[senators$Party == "R"]
  )
}

# --- Bills ------------------------------------------------------------------

# Read the bill list and add the standard derived columns:
#   name         author's "First Last"
#   name_join    join key matching load_senators()$name_join
#   bill_measure "SB-12" (display)   url_slug "LASTNAME_SB12" (file/page names)
# Combines the 2025 fixture list with bills filed through the 2026 form.
load_bills <- function() {
  fixture <- read.csv(BILLS_CSV) |>
    mutate(
      name         = trimws(gsub("\\s+", " ", paste(First.Name, Last.Name))),
      name_join    = tolower(gsub(" ", "", paste0(First.Name, Last.Name))),
      bill_measure = paste0("SB-", bill_number),
      url_slug     = paste0(toupper(gsub(" ", "_", Last.Name)), "_SB", bill_number),
      committee    = ifelse(committee == "" | is.na(committee), "Unassigned", committee),
      # A blank fiscal flag counts as "No" (admin can correct the sheet)
      appropriations = ifelse(!is.na(appropriations) & appropriations == 1, "Yes", "No")
    )
  bind_rows(fixture, load_intake_bills())
}

# Bills filed through the 2026 form, from the gateway's bills view,
# shaped like the fixture rows. Also downloads each bill's assembled PDF
# into BILL_PDF_DIR under the conventional name (once per R session).
load_intake_bills <- function() {
  if (!"bills" %in% INTAKE_LIVE) return(data.frame())
  j <- read_intake_json("bills")
  if (is.null(j) || length(j$bills) == 0) return(data.frame())

  rows <- as.data.frame(j$bills) |>
    transmute(
      bill_number  = suppressWarnings(as.integer(sb)),
      title        = as.character(subject),
      First.Name   = as.character(first),
      Last.Name    = as.character(last),
      lobbyist     = NA_character_,
      committee    = "Unassigned",   # referrals come later in the process
      appropriations = ifelse(grepl("Appropriation", as.character(flags)), "Yes", "No"),
      digest       = as.character(digest),
      topic        = as.character(topic),
      name         = trimws(gsub("\\s+", " ", paste(First.Name, Last.Name))),
      name_join    = tolower(gsub(" ", "", paste0(First.Name, Last.Name))),
      bill_measure = paste0("SB-", bill_number),
      url_slug     = paste0(toupper(gsub(" ", "_", Last.Name)), "_SB", bill_number),
      file_id      = as.character(fileId)
    ) |>
    filter(!is.na(bill_number))

  # Fetch the assembled PDFs so links and iframes work like fixtures'
  if (!isTRUE(getOption("legsim.bills_synced"))) {
    for (i in seq_len(nrow(rows))) {
      if (rows$file_id[i] == "") next
      dest <- file.path(BILL_PDF_DIR, paste0(rows$url_slug[i], ".pdf"))
      tryCatch(
        curl::curl_download(
          paste0("https://drive.google.com/uc?export=download&id=", rows$file_id[i]),
          dest, quiet = TRUE
        ),
        error = function(e) message("WARNING: could not fetch bill PDF ",
                                    rows$url_slug[i], ": ", conditionMessage(e))
      )
    }

    # Archived pre-amendment versions (the "prev" list on each bill) fill
    # PREV_BILL_PDF_DIR so bill pages get their Previous Text tab. An
    # archived version never changes, so an existing file is skipped —
    # which is why a bad download (an unshared file returns a sign-in
    # HTML page, not a PDF) must be deleted, or it would stick forever.
    is_pdf <- function(path) {
      identical(tryCatch(readBin(path, "raw", n = 4), error = function(e) raw(0)),
                charToRaw("%PDF"))
    }
    raw_bills <- as.data.frame(j$bills)
    if ("prev" %in% names(raw_bills)) {
      for (i in seq_len(nrow(raw_bills))) {
        p <- raw_bills$prev[[i]]
        if (is.null(p) || NROW(p) == 0) next
        slug <- paste0(toupper(gsub(" ", "_", raw_bills$last[i])),
                       "_SB", as.integer(raw_bills$sb[i]))
        for (k in seq_len(NROW(p))) {
          dest <- file.path(PREV_BILL_PDF_DIR, paste0(slug, "_v", p$v[k], ".pdf"))
          if (file.exists(dest) && is_pdf(dest)) next
          tryCatch({
            curl::curl_download(
              paste0("https://drive.google.com/uc?export=download&id=", p$id[k]),
              dest, quiet = TRUE
            )
            if (!is_pdf(dest)) {
              unlink(dest)
              message("WARNING: previous bill version ", basename(dest),
                      " is not shared (got a sign-in page); skipped.")
            }
          },
          error = function(e) message("WARNING: could not fetch previous bill version ",
                                      basename(dest), ": ", conditionMessage(e)))
        }
      }
    }
    options(legsim.bills_synced = TRUE)
  }

  rows |> select(-file_id)
}

# Newspaper editions filed through the 2026 form, via the gateway (the
# Editions tab carries submitter emails, so it is never published to the
# web — same privacy rule as every intake tab). Shaped like the old
# hand-kept sheet the News/Home pages already read: Edition, Link, Date.
load_intake_editions <- function() {
  if (!"editions" %in% INTAKE_LIVE) return(data.frame())
  j <- read_intake_json("editions")
  if (is.null(j) || length(j$editions) == 0) return(data.frame())

  as.data.frame(j$editions) |>
    transmute(
      Edition = as.character(edition),
      Link    = as.character(link),
      Date    = format(as.Date(substr(as.character(time), 1, 10)), "%b %d"),
      Outlet  = as.character(outlet)
    )
}

# --- Votes ------------------------------------------------------------------

# Clean one raw vote sheet into the standard shape used everywhere.
#
# Input: the raw data frame from a vote tab (one row per vote taken; one
# column per senator, in R's period-separated form). Returns NULL for an
# empty sheet. Otherwise adds, per row:
#   Vote                "12-3-1-2"  (Aye-No-Abstain-Absent, whole chamber)
#   Dem_vote/Rep_vote   the same, per party
#   Dem_percent(_sign)  % Aye among that party's members PRESENT
#                       (Aye + No + Abstain; absences don't count against)
#   Dem_choice/Rep_choice  the party's plurality position on the vote
# and parses Date into a real date (accepts 10/17/25 or 10/17/2025).
clean_votes <- function(dat, ns) {
  if (is.null(dat) || nrow(dat) == 0) return(NULL)

  pct <- function(yes, no, abstain) round(yes / (yes + no + abstain) * 100)

  dat |>
    mutate(across(any_of(ns$s_names_period), as.character)) |>
    filter(!is.na(Bill) & Bill != "") |>
    rowwise() |>
    mutate(
      Date    = lubridate::mdy(Date),
      # Chairs type bill numbers in many shapes ("SB-31", "SB 31", "sb31",
      # bare "31"). Canonicalize to "SB-<n>" so joins against bill_measure,
      # the status tracker, and numeric sorting never miss a vote.
      Bill    = ifelse(grepl("[0-9]", as.character(Bill)),
                       paste0("SB-", as.integer(gsub("\\D+", "", as.character(Bill)))),
                       as.character(Bill)),
      yes     = sum(c_across(any_of(ns$s_names_period)) == "Aye", na.rm = TRUE),
      no      = sum(c_across(any_of(ns$s_names_period)) == "No", na.rm = TRUE),
      abstain = sum(c_across(any_of(ns$s_names_period)) == "Abstain", na.rm = TRUE),
      absent  = sum(c_across(any_of(ns$s_names_period)) == "" | is.na(c_across(any_of(ns$s_names_period)))),
      Vote    = paste(yes, no, abstain, absent, sep = "-"),

      d_yes     = sum(c_across(any_of(ns$d_sen_period)) == "Aye", na.rm = TRUE),
      d_no      = sum(c_across(any_of(ns$d_sen_period)) == "No", na.rm = TRUE),
      d_abstain = sum(c_across(any_of(ns$d_sen_period)) == "Abstain", na.rm = TRUE),
      d_absent  = sum(c_across(any_of(ns$d_sen_period)) == "" | is.na(c_across(any_of(ns$d_sen_period)))),
      Dem_vote  = paste(d_yes, d_no, d_abstain, d_absent, sep = "-"),
      Dem_percent      = pct(d_yes, d_no, d_abstain),
      Dem_percent_sign = ifelse(is.nan(Dem_percent), "NA", paste0(Dem_percent, "%")),
      Dem_choice = case_when(
        pmax(d_yes, d_no, d_abstain) == d_yes ~ "Aye",
        pmax(d_yes, d_no, d_abstain) == d_no ~ "No",
        TRUE ~ "Abstain"
      ),

      r_yes     = sum(c_across(any_of(ns$r_sen_period)) == "Aye", na.rm = TRUE),
      r_no      = sum(c_across(any_of(ns$r_sen_period)) == "No", na.rm = TRUE),
      r_abstain = sum(c_across(any_of(ns$r_sen_period)) == "Abstain", na.rm = TRUE),
      r_absent  = sum(c_across(any_of(ns$r_sen_period)) == "" | is.na(c_across(any_of(ns$r_sen_period)))),
      Rep_vote  = paste(r_yes, r_no, r_abstain, r_absent, sep = "-"),
      Rep_percent      = pct(r_yes, r_no, r_abstain),
      Rep_percent_sign = ifelse(is.nan(Rep_percent), "NA", paste0(Rep_percent, "%")),
      Rep_choice = case_when(
        pmax(r_yes, r_no, r_abstain) == r_yes ~ "Aye",
        pmax(r_yes, r_no, r_abstain) == r_no ~ "No",
        TRUE ~ "Abstain"
      )
    ) |>
    ungroup()
}

# Fetch and clean all five vote tabs at once. Returns a named list
# (lgl, anr, blh, app, floor) containing only the tabs that have data.
load_all_votes <- function(ns) {
  votes <- lapply(VOTE_SHEET_URLS, function(u) clean_votes(read_sheet_safe(u), ns))
  votes[!sapply(votes, is.null)]
}

# --- Bill status (the tracker) ----------------------------------------------

# The bill list's committee column holds full names typed by hand
# ("Local Government & Labor"); map them back to committee codes loosely.
committee_code_from_name <- function(name) {
  n <- tolower(gsub("&", "and", name))
  hit <- sapply(names(COMMITTEE_NAMES), function(code) {
    grepl(substr(tolower(COMMITTEE_NAMES[code]), 1, 12), n, fixed = TRUE)
  })
  if (any(hit)) names(COMMITTEE_NAMES)[which(hit)[1]] else NA
}

# Derive each bill's position in the process from records that already
# exist — nobody enters "status" anywhere. Adds these columns:
#   policy_result / app_result / floor_result  (latest vote result per stage)
#   status        one label: Introduced / In Committee / To Appropriations /
#                 To Floor / Passed Senate / Failed — <stage>
# A bill that never gets a committee vote simply stays "In Committee".
bill_statuses <- function(bills, votes) {
  rows <- if (length(votes) > 0) bind_rows(votes, .id = "source") else data.frame()

  latest_result <- function(bm, srcs) {
    if (nrow(rows) == 0) return(NA_character_)
    r <- rows |> filter(Bill == bm, source %in% srcs) |> arrange(desc(Date))
    if (nrow(r) == 0) NA_character_ else as.character(r$Result[1])
  }
  passed <- function(x) !is.na(x) & grepl("pass", x, ignore.case = TRUE)

  bills |>
    rowwise() |>
    mutate(
      policy_result = latest_result(bill_measure, c("lgl", "anr", "blh")),
      app_result    = latest_result(bill_measure, "app"),
      floor_result  = latest_result(bill_measure, "floor")
    ) |>
    ungroup() |>
    mutate(
      status = case_when(
        passed(floor_result)                                ~ "Passed Senate",
        !is.na(floor_result)                                ~ "Failed — Floor",
        passed(app_result)                                  ~ "To Floor",
        !is.na(app_result)                                  ~ "Failed — Appropriations",
        passed(policy_result) & appropriations == "Yes"     ~ "To Appropriations",
        passed(policy_result)                               ~ "To Floor",
        !is.na(policy_result)                               ~ "Failed — Committee",
        committee != "Unassigned"                           ~ "In Committee",
        TRUE                                                ~ "Introduced"
      )
    )
}

# --- Lobbyist letters -------------------------------------------------------

# The four letter positions and their filename tokens. A letter file is
# named ORG_SB12_<token>.pdf, e.g. SC_SB12_oua.pdf. (2025 files only used
# support/oppose; all four are accepted going forward.)
LETTER_POSITIONS <- c(
  support = "Support",
  sia     = "Support If Amended",
  oua     = "Oppose Unless Amended",
  oppose  = "Oppose"
)

# Letters filed through the 2026 form, from the gateway's letters view.
# Rows carry org/bill/position/file id (no emails); the conventional
# filename is composed here so everything downstream stays unchanged.
load_intake_letters <- function() {
  if (!"letters" %in% INTAKE_LIVE) return(data.frame())
  j <- read_intake_json("letters")
  if (is.null(j) || length(j$letters) == 0) return(data.frame())

  as.data.frame(j$letters) |>
    transmute(
      org_code    = toupper(as.character(org)),
      bill_number = suppressWarnings(as.integer(bill)),
      token       = names(LETTER_POSITIONS)[match(as.character(position), LETTER_POSITIONS)],
      file_id     = as.character(fileId)
    ) |>
    filter(!is.na(bill_number) & !is.na(token) & file_id != "") |>
    mutate(filename = paste0(org_code, "_SB", bill_number, "_", token, ".pdf"))
}

# Download filed letter PDFs into the letters folder so links and the
# filename-based scan work exactly as with the fixture files. Runs once
# per R session. CI builds start from a clean checkout, so superseded
# letters disappear there automatically; a local working copy may keep a
# stray until deleted by hand.
sync_intake_letters <- function() {
  if (isTRUE(getOption("legsim.letters_synced"))) return(invisible())
  rows <- load_intake_letters()
  if (nrow(rows) > 0) {
    for (i in seq_len(nrow(rows))) {
      dest <- file.path(LETTERS_DIR, rows$filename[i])
      tryCatch(
        curl::curl_download(
          paste0("https://drive.google.com/uc?export=download&id=", rows$file_id[i]),
          dest, quiet = TRUE
        ),
        error = function(e) message("WARNING: could not fetch letter ",
                                    rows$filename[i], ": ", conditionMessage(e))
      )
    }
  }
  options(legsim.letters_synced = TRUE)
  invisible()
}

# Role-profile PDFs (senators / lobbyists / journalists) from the gateway's
# profiles view into files/pdfs/role_profiles/<role>/. A resubmitted
# profile keeps the same canonical name, so downloads always overwrite;
# a download that isn't a real PDF (an unshared file returns a sign-in
# page) is deleted so it can't linger. Runs once per R session. Called
# explicitly by senators.qmd and the senator/lobby page generators.
sync_intake_profiles <- function() {
  if (!"profiles" %in% INTAKE_LIVE) return(invisible())
  if (isTRUE(getOption("legsim.profiles_synced"))) return(invisible())
  j <- read_intake_json("profiles")
  if (!is.null(j) && length(j$profiles) > 0) {
    p <- as.data.frame(j$profiles)
    for (i in seq_len(nrow(p))) {
      dir <- file.path(PROFILE_DIR, basename(p$role[i]))
      if (!dir.exists(dir)) dir.create(dir, recursive = TRUE)
      dest <- file.path(dir, basename(p$name[i]))
      tryCatch({
        curl::curl_download(
          paste0("https://drive.google.com/uc?export=download&id=", p$id[i]),
          dest, quiet = TRUE
        )
        first4 <- tryCatch(readBin(dest, "raw", n = 4), error = function(e) raw(0))
        if (!identical(first4, charToRaw("%PDF"))) {
          unlink(dest)
          message("WARNING: profile ", p$name[i],
                  " is not shared (got a sign-in page); skipped.")
        }
      },
      error = function(e) message("WARNING: could not fetch profile ",
                                  p$name[i], ": ", conditionMessage(e)))
    }
  }
  options(legsim.profiles_synced = TRUE)
  invisible()
}

# Scan the letters folder once (after syncing any letters filed through
# the intake form). Returns one row per letter with the org's full name
# joined in from the lobby list (empty data frame if none).
scan_letters <- function() {
  sync_intake_letters()
  token_pattern <- paste(names(LETTER_POSITIONS), collapse = "|")
  files <- list.files(LETTERS_DIR,
                      pattern = paste0("^[A-Za-z]+_SB[0-9]+_(", token_pattern, ")\\.pdf$"))
  if (length(files) == 0) return(data.frame())

  lobbys <- read.csv(LOBBY_CSV) |> mutate(Code = toupper(Code))

  data.frame(filename = files) |>
    mutate(
      org_code    = toupper(gsub("^([A-Za-z]+)_.*$", "\\1", filename)),
      bill_number = as.integer(gsub("^[A-Za-z]+_SB([0-9]+)_.*$", "\\1", filename)),
      token       = gsub("^.*_([a-z]+)\\.pdf$", "\\1", filename),
      position    = unname(LETTER_POSITIONS[token])
    ) |>
    select(-token) |>
    left_join(lobbys |> select(Code, Lobby, any_of("Color")), by = c("org_code" = "Code")) |>
    mutate(Lobby = ifelse(is.na(Lobby), org_code, Lobby))
}

# --- Lobbyist contributions -------------------------------------------------

# Read one lobby's contribution CSV (files/csvs/lobbyist_contributions/
# XXX_contributions.csv). The Total column holds the lobby's overall budget
# in its first row only. Returns list(rows = <clean data frame>, total = <number>).
# Cleaning is deliberately forgiving: last year's files mixed date formats,
# dollar signs, and decimal districts.
read_contribution_file <- function(path) {
  raw <- read.csv(path)

  total <- suppressWarnings(as.numeric(gsub("[$,]", "", as.character(raw$Total))))
  total <- total[!is.na(total)][1]

  rows <- raw |>
    select(-Total) |>
    mutate(
      Date = lubridate::mdy(Date),
      Recipient.District = suppressWarnings(
        as.integer(round(as.numeric(gsub("[$,]", "", as.character(Recipient.District)))))
      ),
      Contribution = suppressWarnings(as.numeric(gsub("[$,]", "", as.character(Contribution))))
    )

  list(rows = rows, total = total)
}

# All lobbies' contributions in one tidy frame: Date, Recipient.Name,
# Recipient.District, Contribution, Lobby_Code, Lobby. Rows with no usable
# district are kept (some recipients may not be senators). Combines the
# 2025 fixture files with rows filed through the 2026 Spending form.
load_all_contributions <- function() {
  files <- list.files(CONTRIB_DIR, pattern = "_contributions\\.csv$", full.names = TRUE)

  fixture_rows <- data.frame()
  if (length(files) > 0) {
    lobbys <- read.csv(LOBBY_CSV) |> mutate(Code = toupper(Code))
    fixture_rows <- map_df(files, function(f) {
      read_contribution_file(f)$rows |>
        mutate(Lobby_Code = toupper(gsub("_contributions\\.csv$", "", basename(f))))
    }) |>
      left_join(lobbys |> select(Code, Lobby), by = c("Lobby_Code" = "Code")) |>
      # A file whose code isn't in lobbyist_list.csv still displays as its
      # code instead of a literal "NA" on senator pages.
      mutate(Lobby = coalesce(Lobby, Lobby_Code))
  }

  bind_rows(fixture_rows, load_intake_contributions())
}
