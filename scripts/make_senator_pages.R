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

# Money: lobby contributions, transfers between senators, and each
# senator's standing. Balance = lobby money + transfers in − transfers out
# is what the goal is judged on, so bars and ranks use it.
contributions <- load_all_contributions()
transfers     <- load_intake_transfers()
fin <- senator_finance(senators, contributions, transfers) |>
  mutate(rank = ifelse(Balance > 0, dense_rank(desc(Balance)), NA_integer_))

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
      # Each committee links to its own tab on the Committees page
      nm <- html_link(nm, committee_url(code, rel = "../"))
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
            if (leadership != "") sprintf(' &middot; <b><a href="%s">%s</a></b>',
                                          leadership_url(rel = "../"), leadership) else ""),
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
      # Each bill number links to its page (hidden url column)
      left_join(bills |> transmute(Bill = as.integer(bill_number),
                                   bill_url = sprintf("../%s/%s.html", BILL_PAGES_DIR, url_slug)) |>
                  distinct(Bill, .keep_all = TRUE),
                by = "Bill") |>
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

  # --- Their money ---------------------------------------------------------
  # The ledger is every lobby gift and every transfer in or out, with the
  # running balance; the dashboard blocks are cut from it.
  my_fin <- fin[fin$District == as.integer(district), , drop = FALSE]
  ledger <- senator_ledger(district, senators, contributions, transfers, rel = "../")
  gifts     <- ledger |> filter(Type == "Lobby gift")
  xfers_in  <- ledger |> filter(Type == "Transfer in")  |> arrange(desc(Amount))
  xfers_out <- ledger |> filter(Type == "Transfer out")
  top_contributors <- data.frame()
  if (nrow(gifts) > 0) {
    top_contributors <- gifts |>
      group_by(Who, Link) |>
      summarize(total = sum(Amount), .groups = "drop") |>
      arrange(desc(total)) |>
      mutate(rank = dense_rank(desc(total))) |>
      filter(rank <= 3) |>
      as.data.frame()
  }
  ledger_code <- paste(capture.output(dput(ledger)), collapse = "\n")

  # --- Dashboard ------------------------------------------------------------
  # The coffer against the goal (judged on the balance at session's end),
  # with where the money came from underneath. Shown before the first
  # dollar arrives so every senator sees their target.
  parts <- sprintf("%s from lobbies", scales::dollar(my_fin$Raised))
  if (my_fin$TransfersIn > 0)
    parts <- c(parts, sprintf("+%s from other senators", scales::dollar(my_fin$TransfersIn)))
  if (my_fin$TransfersOut > 0)
    parts <- c(parts, sprintf("&minus;%s transferred out", scales::dollar(my_fin$TransfersOut)))
  breakdown <- sprintf('<span class="stat-sub">%s</span>', paste(parts, collapse = " &middot; "))
  fund_stat <- if (nrow(my_fin) == 1 && !is.na(my_fin$Goal)) {
    stat_html("Fundraising", scales::dollar(my_fin$Balance),
              sprintf("of %s goal &middot; %s", scales::dollar(my_fin$Goal), my_fin$Race),
              paste0(progress_bar_html(my_fin$Pct, sprintf("%s%% of goal", round(my_fin$Pct))), breakdown))
  } else stat_html("Fundraising", scales::dollar(my_fin$Balance), "no goal set", breakdown)

  align_stat <- if (cast > 0) {
    stat_html("Voted With Party", sprintf("%d%%", round(100 * aligned / cast)),
              sprintf("%d of %d votes cast", aligned, cast))
  } else stat_html("Voted With Party", "&mdash;", "no votes recorded yet")

  missed_stat <- if (n_roll > 0) {
    stat_html("Missed Votes", absent,
              sprintf("%d%% of %d roll call%s", round(100 * absent / n_roll), n_roll, ifelse(n_roll == 1, "", "s")))
  } else stat_html("Missed Votes", "&mdash;", "no roll calls yet")

  money_stat <- if (nrow(gifts) > 0 || nrow(xfers_in) > 0) {
    stat_html("Contributions", nrow(gifts),
              sprintf("ranked #%s of %d by balance",
                      ifelse(is.na(my_fin$rank), "&mdash;", my_fin$rank), nrow(senators)))
  } else stat_html("Contributions", "0", "none received yet")

  donors_block <- c(
    '<div class="lb-block">',
    '<div class="lb-label">Top Donors</div>',
    if (nrow(top_contributors) > 0) c(
      '<ol class="leaderboard">',
      sprintf('<li><span class="lb-rank">%d</span><span class="lb-name">%s</span><span class="lb-amt">%s</span></li>',
              top_contributors$rank, html_link(top_contributors$Who, top_contributors$Link),
              scales::dollar(top_contributors$total)),
      '</ol>'
    ) else '<p class="muted">No contributions received yet.</p>',
    '</div>'
  )

  # Money that arrived from other senators (and, in a line, what went out)
  transfers_block <- c(
    '<div class="lb-block">',
    '<div class="lb-label">Transfers from other Senators</div>',
    if (nrow(xfers_in) > 0) c(
      '<ol class="leaderboard">',
      sprintf('<li><span class="lb-rank">%d</span><span class="lb-name">%s &middot; %s</span><span class="lb-amt">%s</span></li>',
              seq_len(nrow(xfers_in)), html_link(xfers_in$Who, xfers_in$Link),
              format(xfers_in$Date, "%b %d"), scales::dollar(xfers_in$Amount)),
      '</ol>'
    ) else '<p class="muted">None yet.</p>',
    if (nrow(xfers_out) > 0) sprintf('<p class="muted">Sent to other senators: %s.</p>',
      paste(sprintf("%s to %s", scales::dollar(-xfers_out$Amount),
                    html_link(xfers_out$Who, xfers_out$Link)), collapse = "; ")),
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
    '<div class="lb-cols">', donors_block, transfers_block, votes_block, '</div>'
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
    "      Bill = colDef(width = 90, cell = function(value, index) {",
    "        if (is.na(value)) return('')",
    "        url <- votes_including_s$bill_url[index]",
    "        if (is.na(url)) paste0('SB-', value) else htmltools::tags$a(href = url, paste0('SB-', value))",
    "      }),",
    "      bill_url = colDef(show = FALSE),",
    "      Vote = colDef(width = 90),",
    "      `Party Vote` = colDef(width = 110),",
    "      `Voted With Party?` = colDef(width = 130)",
    "    ))",
    "} else {",
    "  htmltools::p(class = 'muted', 'No votes recorded for this senator yet.')",
    "}",
    "```",
    "",
    "## Ledger",
    "",
    "```{r}",
    "#| echo: false",
    "#| warning: false",
    "#| message: false",
    "# A bank statement: lobby gifts and transfers in or out, newest first,",
    "# with the balance after each. Transfers out are negative, in red.",
    "library(reactable)",
    "",
    paste("ledger <-", ledger_code),
    "",
    "if (nrow(ledger) > 0) {",
    "  reactable(ledger, sortable = TRUE, highlight = TRUE,",
    "    searchable = TRUE, defaultPageSize = 20, showPageSizeOptions = FALSE,",
    "    defaultColDef = colDef(na = ''),",
    "    columns = list(",
    "      Date = colDef(format = colFormat(date = TRUE, locales = 'en-US'), width = 110),",
    "      Type = colDef(width = 120),",
    "      Who = colDef(name = 'From / To', cell = function(value, index) {",
    "        url <- ledger$Link[index]",
    "        if (is.na(url) || url == '') value else htmltools::tags$a(href = url, value)",
    "      }),",
    "      Link = colDef(show = FALSE),",
    "      Amount = colDef(width = 120, cell = function(value) {",
    "        txt <- scales::dollar(abs(value))",
    "        if (value < 0) htmltools::span(style = 'color:#a33131', paste0('\\u2212', txt)) else txt",
    "      }),",
    "      Balance = colDef(width = 120, cell = function(value) scales::dollar(value))",
    "    ))",
    "} else {",
    "  htmltools::p(class = 'muted', 'No money in or out yet.')",
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
