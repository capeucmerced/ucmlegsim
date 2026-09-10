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
SEN_PROFILE_DIR   <- "files/pdfs/role_profiles/senators"

# Where the generated pages go (created by the make_*.R scripts each render)
BILL_PAGES_DIR    <- "bills-pages"
SENATOR_PAGES_DIR <- "senator-pages"
LOBBY_PAGES_DIR   <- "lobby-pages"

# --- Live Google Sheets (published-to-web CSV links) ------------------------

# The five vote tally tabs. Names here are the committee codes used everywhere.
VOTE_SHEET_URLS <- c(
  lgl   = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSWsxVKMyPrvGZW1VFD0_DdTsMmH-dzITniXvWusbbG34FPwj7uWsIDB6B_6Sb5AdK94SbZ75eL0vTT/pub?gid=0&single=true&output=csv",
  anr   = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSWsxVKMyPrvGZW1VFD0_DdTsMmH-dzITniXvWusbbG34FPwj7uWsIDB6B_6Sb5AdK94SbZ75eL0vTT/pub?gid=1077921709&single=true&output=csv",
  blh   = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSWsxVKMyPrvGZW1VFD0_DdTsMmH-dzITniXvWusbbG34FPwj7uWsIDB6B_6Sb5AdK94SbZ75eL0vTT/pub?gid=1971997036&single=true&output=csv",
  app   = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSWsxVKMyPrvGZW1VFD0_DdTsMmH-dzITniXvWusbbG34FPwj7uWsIDB6B_6Sb5AdK94SbZ75eL0vTT/pub?gid=578574660&single=true&output=csv",
  floor = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSWsxVKMyPrvGZW1VFD0_DdTsMmH-dzITniXvWusbbG34FPwj7uWsIDB6B_6Sb5AdK94SbZ75eL0vTT/pub?gid=192921423&single=true&output=csv"
)

# Class newspaper editions (News page)
NEWSPAPER_SHEET_URL <- "https://docs.google.com/spreadsheets/d/e/2PACX-1vTenWjAnSsUSJxazVdGIKxSVhONVPHrgvkxTSJrdZtdaNN4zziuvtTepefp06r_iWL-iuYIq8NsrQW1/pub?gid=0&single=true&output=csv"

# Where votes are entered (link shown on the Votes page)
VOTE_ENTRY_URL <- "https://docs.google.com/spreadsheets/d/1O3c2ZGWMUwBu_q2Yjr0nbfBOn9qD2T3A_zhYH8Q2ZHs/edit?gid=0#gid=0"

# --- 2026 intake sources (the Google Forms era) -----------------------------
# All intake data reaches the site through ONE Apps Script endpoint (see
# intake/apps-script/newsfeed_api.gs) that joins the roster SERVER-SIDE and
# strips emails before anything leaves Google. Intake tabs are never
# published to the web — every response tab contains submitter emails, so
# a published-CSV link would leak them. This URL is safe in public code
# precisely because its output is de-identified.
# BETA: the instructor's personal-account deployment; swaps at real deploy.
INTAKE_API_URL <- "https://script.google.com/macros/s/AKfycbzV8j7CpZvdkmS44vdWTzUxw0_tLufgwN0gz-QCdswe_5wujNiS4YXVLZVkQUqGDMLJ/exec"

# Which intake streams are live (their loaders merge rows in; the 2025
# fixture files stay alongside until the semester-start data reset)
INTAKE_LIVE <- c("spending", "letters")

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
load_bills <- function() {
  read.csv(BILLS_CSV) |>
    mutate(
      name         = trimws(gsub("\\s+", " ", paste(First.Name, Last.Name))),
      name_join    = tolower(gsub(" ", "", paste0(First.Name, Last.Name))),
      bill_measure = paste0("SB-", bill_number),
      url_slug     = paste0(toupper(gsub(" ", "_", Last.Name)), "_SB", bill_number),
      committee    = ifelse(committee == "" | is.na(committee), "Unassigned", committee),
      # A blank fiscal flag counts as "No" (admin can correct the sheet)
      appropriations = ifelse(!is.na(appropriations) & appropriations == 1, "Yes", "No")
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
      Bill    = as.character(Bill),
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
      left_join(lobbys |> select(Code, Lobby), by = c("Lobby_Code" = "Code"))
  }

  bind_rows(fixture_rows, load_intake_contributions())
}
