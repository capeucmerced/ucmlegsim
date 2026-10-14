# scripts/make_senator_pages.R
# ---------------------------------------------------------------------------
# Generates one page per senator (district) into senator-pages/. Runs
# automatically before every render (see pre-render in _quarto.yml).
#
# Page shape, top to bottom:
#   1. Dossier header — party, district (linked to the map), leadership
#      role, committees, bills with where each one stands, profile link.
#   2. Dashboard — fundraising vs goal, party alignment, missed votes,
#      contribution count and rank; then top donors and the vote split.
#   3. Tabs — the full vote history, the contribution ledger, the profile.
#
# As with the other generators: all data a page shows is baked in here at
# generation time, so frozen pages can safely skip re-execution. Never add
# render-time data reads to a generated page. The header and dashboard are
# written as raw HTML; only the two tables run R when the page renders.
# ---------------------------------------------------------------------------

source("scripts/shared.R")

if (!dir.exists(SENATOR_PAGES_DIR)) dir.create(SENATOR_PAGES_DIR, recursive = TRUE)

# Profiles uploaded through the intake form land in SEN_PROFILE_DIR before
# the pages bake in their profile tab
sync_intake_profiles()

senators <- load_senators()
ns       <- senator_name_sets(senators)
votes    <- load_all_votes(ns)
bills    <- bill_statuses(load_bills(), votes)   # adds each bill's status

# Contributions across all lobbies, plus each district's total-received rank
contributions <- load_all_contributions()
fin <- senator_finance(senators, contributions)   # goals and progress
senator_totals <- data.frame()
if (nrow(contributions) > 0) {
  senator_totals <- contributions |>
    filter(!is.na(Recipient.District)) |>
    group_by(Recipient.District) |>
    summarize(total_received = sum(Contribution, na.rm = TRUE)) |>
    arrange(desc(total_received)) |>
    mutate(rank = row_number())
}

for (i in seq_len(nrow(senators))) {
  s <- senators[i, ]
  district   <- as.character(s$District)
  party_name <- if (s$Party == "D") "Democrat" else "Republican"
  leadership <- if (!is.na(s$Leadership) && s$Leadership != "") s$Leadership else ""

  # --- Committees ----------------------------------------------------------
  # Roster columns: Committee is ";"-separated codes (e.g. "anr;app"),
  # Chair / Vice.Chair hold the code of the committee they lead, if any.
  committee_bits <- character(0)
  if (!is.na(s$Committee) && s$Committee != "") {
    codes <- trimws(unlist(strsplit(s$Committee, ";")))
    codes <- codes[codes != ""]
    committee_bits <- vapply(codes, function(code) {
      nm <- unname(COMMITTEE_NAMES[code])
      if (is.na(nm)) nm <- toupper(code)
      if (!is.na(s$Chair) && code == s$Chair) paste("Chair,", nm)
      else if (!is.na(s$Vice.Chair) && code == s$Vice.Chair) paste("Vice Chair,", nm)
      else nm
    }, character(1))
  }
  committees_html <- if (length(committee_bits) > 0) {
    paste(committee_bits, collapse = " &middot; ")
  } else '<span class="muted">No committee assignments yet</span>'

  # --- Bills, with where each one stands (works for 0, 1, 2, or more) ------
  their_bills <- bills |> filter(name_join == s$name_join) |> arrange(bill_number)
  bills_html <- if (nrow(their_bills) > 0) {
    paste(sprintf('<span class="bill-row"><span class="status-dot %s"></span> <a href="../%s/%s.html">%s</a> %s <span class="bill-status">&mdash; %s</span></span>',
                  status_dot_class(their_bills$status), BILL_PAGES_DIR, their_bills$url_slug,
                  their_bills$bill_measure, coalesce(their_bills$title, ""), their_bills$status),
          collapse = "")
  } else '<span class="muted">No bills introduced yet</span>'

  # --- Role profile (only linked once the PDF exists) ----------------------
  profile_file <- sprintf("%s_%s_profile.pdf", s$name_link, district)
  has_profile  <- file.exists(file.path(SEN_PROFILE_DIR, profile_file))
  profile_pdf  <- sprintf("../%s/%s", SEN_PROFILE_DIR, profile_file)
  profile_html <- if (has_profile) {
    sprintf('<a href="%s">View role profile (PDF)</a>', profile_pdf)
  } else '<span class="muted">Not posted yet</span>'

  header_html <- raw_html(
    '<div class="dossier">',
    # the district number links to the Districts map, zoomed to and
    # highlighting this district
    sprintf('<div class="dossier-meta"><span class="party-chip %s">%s</span> <a href="../map.html?district=%s">District %s</a>%s</div>',
            tolower(s$Party), party_name, district, district,
            if (leadership != "") sprintf(' &middot; <b>%s</b>', leadership) else ""),
    '<dl class="dossier-facts">',
    sprintf('<dt>Committees</dt><dd>%s</dd>', committees_html),
    sprintf('<dt>Bills</dt><dd>%s</dd>', bills_html),
    sprintf('<dt>Role profile</dt><dd>%s</dd>', profile_html),
    '</dl>',
    '</div>'
  )

  # --- Their vote record --------------------------------------------------
  # Committees whose vote sheet has a column for this senator.
  # vapply, not sapply: over an EMPTY votes list (start of a session,
  # before any vote is taken) sapply returns list() and the subscript
  # crashes — the shakedown's first vote-less build found this.
  their_votes <- data.frame()
  in_committees <- votes[vapply(votes, function(df) s$name_period %in% names(df), logical(1))]
  if (length(in_committees) > 0) {
    party_choice_col <- if (s$Party == "D") "Dem_choice" else "Rep_choice"

    # Date stays a Date and Bill becomes its number (the table renderer adds
    # the "SB-" back) so both columns sort the way people expect.
    their_votes <- bind_rows(in_committees, .id = "Committee") |>
      select(Date, Bill, Committee, all_of(c(s$name_period, party_choice_col))) |>
      mutate(
        party_aligned = case_when(
          is.na(.data[[s$name_period]]) | .data[[s$name_period]] == "" ~ "Absent",
          .data[[party_choice_col]] == .data[[s$name_period]] ~ "Yes",
          TRUE ~ "No"
        ),
        Committee = unname(COMMITTEE_NAMES[Committee]),
        Bill = suppressWarnings(as.integer(sub("SB-", "", Bill)))
      ) |>
      arrange(desc(Date)) |>
      rename("Vote" = all_of(s$name_period),
             "Party Vote" = all_of(party_choice_col),
             "Voted With Party?" = party_aligned) |>
      as.data.frame()
  }
  votes_code <- paste(capture.output(dput(their_votes)), collapse = "\n")

  # Summary figures for the dashboard (alignment is among votes cast)
  n_roll <- nrow(their_votes)
  cast <- aligned <- against <- absent <- n_aye <- n_no <- n_abstain <- 0
  if (n_roll > 0) {
    with_party <- their_votes[["Voted With Party?"]]
    cast      <- sum(their_votes$Vote %in% c("Aye", "No", "Abstain"))
    aligned   <- sum(with_party == "Yes", na.rm = TRUE)
    against   <- sum(with_party == "No", na.rm = TRUE)
    absent    <- sum(with_party == "Absent", na.rm = TRUE)
    n_aye     <- sum(their_votes$Vote == "Aye", na.rm = TRUE)
    n_no      <- sum(their_votes$Vote == "No", na.rm = TRUE)
    n_abstain <- sum(their_votes$Vote == "Abstain", na.rm = TRUE)
  }

  # --- Their contributions ------------------------------------------------
  their_contribs   <- data.frame()
  total_received   <- 0
  senator_rank     <- NA
  top_contributors <- data.frame()
  if (nrow(contributions) > 0) {
    their_contribs <- contributions |>
      filter(Recipient.District == as.integer(district)) |>
      arrange(desc(Date)) |>
      select(Date, Lobby, Lobby_Code, Contribution) |>
      as.data.frame()

    if (nrow(their_contribs) > 0) {
      total_received <- sum(their_contribs$Contribution, na.rm = TRUE)
      rank_row <- senator_totals |> filter(Recipient.District == as.integer(district))
      if (nrow(rank_row) > 0) senator_rank <- rank_row$rank

      top_contributors <- their_contribs |>
        group_by(Lobby, Lobby_Code) |>
        summarize(total = sum(Contribution, na.rm = TRUE), .groups = "drop") |>
        arrange(desc(total)) |>
        mutate(rank = dense_rank(desc(total))) |>
        filter(rank <= 3) |>
        as.data.frame()
    }
  }
  contribs_code <- paste(capture.output(dput(their_contribs)), collapse = "\n")

  # --- Dashboard ------------------------------------------------------------
  # Fundraising goal and progress (campaign finance), shown even before the
  # first contribution so every senator sees their target
  my_fin <- fin[fin$District == as.integer(district), , drop = FALSE]
  fund_stat <- if (nrow(my_fin) == 1 && !is.na(my_fin$Goal)) {
    stat_html("Fundraising", scales::dollar(my_fin$Raised),
              sprintf("of %s goal &middot; %s", scales::dollar(my_fin$Goal), my_fin$Race),
              progress_bar_html(my_fin$Pct, sprintf("%s%% of goal", round(my_fin$Pct))))
  } else stat_html("Fundraising", scales::dollar(total_received), "no goal set")

  align_stat <- if (cast > 0) {
    stat_html("Voted With Party", sprintf("%d%%", round(100 * aligned / cast)),
              sprintf("%d of %d votes cast", aligned, cast))
  } else stat_html("Voted With Party", "&mdash;", "no votes recorded yet")

  missed_stat <- if (n_roll > 0) {
    stat_html("Missed Votes", absent,
              sprintf("%d%% of %d roll call%s", round(100 * absent / n_roll), n_roll, ifelse(n_roll == 1, "", "s")))
  } else stat_html("Missed Votes", "&mdash;", "no roll calls yet")

  money_stat <- if (nrow(their_contribs) > 0) {
    stat_html("Contributions", nrow(their_contribs),
              sprintf("ranked #%s of 40 by total received", ifelse(is.na(senator_rank), "&mdash;", senator_rank)))
  } else stat_html("Contributions", "0", "none received yet")

  donors_block <- c(
    '<div class="lb-block">',
    '<div class="lb-label">Top Donors</div>',
    if (nrow(top_contributors) > 0) c(
      '<ol class="leaderboard">',
      sprintf('<li><span class="lb-rank">%d</span><span class="lb-name"><a href="../%s/%s.html">%s</a></span><span class="lb-amt">%s</span></li>',
              top_contributors$rank, LOBBY_PAGES_DIR, top_contributors$Lobby_Code,
              top_contributors$Lobby, scales::dollar(top_contributors$total)),
      '</ol>'
    ) else '<p class="muted">No contributions received yet.</p>',
    '</div>'
  )

  votes_block <- c(
    '<div class="lb-block">',
    '<div class="lb-label">Vote Record</div>',
    if (n_roll > 0) c(
      sprintf('<div class="vote-bar"><span class="v-aye" style="width:%.1f%%"></span><span class="v-no" style="width:%.1f%%"></span><span class="v-abstain" style="width:%.1f%%"></span><span class="v-absent" style="width:%.1f%%"></span></div>',
              100 * n_aye / n_roll, 100 * n_no / n_roll, 100 * n_abstain / n_roll, 100 * absent / n_roll),
      sprintf('<div class="share-legend"><span><span class="dot dot-aye">&#9679;</span> Aye <b>%d</b></span><span><span class="dot dot-no">&#9679;</span> No <b>%d</b></span><span><span class="dot dot-abstain">&#9679;</span> Abstain <b>%d</b></span><span><span class="dot dot-absent">&#9679;</span> Absent <b>%d</b></span></div>',
              n_aye, n_no, n_abstain, absent),
      sprintf('<p class="muted">Voted against the party line %d time%s.</p>',
              against, ifelse(against == 1, "", "s"))
    ) else '<p class="muted">No votes taken yet.</p>',
    '</div>'
  )

  dashboard_html <- raw_html(
    '<div class="stat-strip">', fund_stat, align_stat, missed_stat, money_stat, '</div>',
    '<div class="lb-cols">', donors_block, votes_block, '</div>'
  )

  # --- Assemble the page ---------------------------------------------------
  yaml <- c(
    "---",
    sprintf('title: "%s"', s$Name),
    "format:",
    "  html:",
    "    page-layout: full",
    "freeze: auto",
    "---"
  )

  body <- c(
    "",
    header_html,
    "",
    dashboard_html,
    "",
    "::: {.panel-tabset}",
    "",
    "## Vote History",
    "",
    "```{r}",
    "#| echo: false",
    "#| warning: false",
    "#| message: false",
    "# Self-contained on purpose: generated pages never source shared.R or",
    "# read files at render time.",
    "library(reactable)",
    "",
    paste("votes_including_s <-", votes_code),
    "",
    "if (nrow(votes_including_s) > 0) {",
    "  reactable(votes_including_s, sortable = TRUE, highlight = TRUE,",
    "    defaultPageSize = 20, showPageSizeOptions = FALSE,",
    "    defaultColDef = colDef(na = ''),",
    "    columns = list(",
    "      Date = colDef(format = colFormat(date = TRUE, locales = 'en-US'), width = 100),",
    "      Bill = colDef(width = 90, cell = function(value) {",
    "        if (is.na(value)) '' else paste0('SB-', value)",
    "      }),",
    "      Vote = colDef(width = 90),",
    "      `Party Vote` = colDef(width = 110),",
    "      `Voted With Party?` = colDef(width = 130)",
    "    ))",
    "} else {",
    "  htmltools::p(class = 'muted', 'No votes recorded for this senator yet.')",
    "}",
    "```",
    "",
    "## Contributions",
    "",
    "```{r}",
    "#| echo: false",
    "#| warning: false",
    "#| message: false",
    "library(reactable)",
    "",
    paste("senator_contributions <-", contribs_code),
    "",
    "if (nrow(senator_contributions) > 0) {",
    "  reactable(senator_contributions, sortable = TRUE, highlight = TRUE,",
    "    searchable = TRUE, defaultPageSize = 20, showPageSizeOptions = FALSE,",
    "    defaultColDef = colDef(na = ''),",
    "    columns = list(",
    "      Date = colDef(format = colFormat(date = TRUE, locales = 'en-US'), width = 110),",
    "      Lobby = colDef(name = 'Contributor', cell = function(value, index) {",
    "        code <- senator_contributions$Lobby_Code[index]",
    "        if (is.na(code) || code == '') return(value)",
    sprintf("        htmltools::tags$a(href = sprintf('../%s/%%s.html', code), value)", LOBBY_PAGES_DIR),
    "      }),",
    "      Lobby_Code = colDef(show = FALSE),",
    "      Contribution = colDef(name = 'Amount', width = 120,",
    "        format = colFormat(currency = 'USD', separators = TRUE, locales = 'en-US'))",
    "    ))",
    "} else {",
    "  htmltools::p(class = 'muted', 'No contributions received yet.')",
    "}",
    "```",
    "",
    "## Role Profile",
    "",
    if (has_profile) {
      c(sprintf("[View Profile](%s)", profile_pdf),
        "",
        sprintf('<iframe src="%s" width="100%%" height="600px"></iframe>', profile_pdf))
    } else {
      "*Role profile not posted yet.*"
    },
    "",
    ":::",
    ""
  )

  cat(paste(c(yaml, body), collapse = "\n"),
      file = file.path(SENATOR_PAGES_DIR, paste0("district_", district, ".qmd")))
}

message("make_senator_pages: wrote ", nrow(senators), " pages.")
