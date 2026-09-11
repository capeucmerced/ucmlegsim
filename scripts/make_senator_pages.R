# scripts/make_senator_pages.R
# ---------------------------------------------------------------------------
# Generates one page per senator (district) into senator-pages/. Runs
# automatically before every render (see pre-render in _quarto.yml).
#
# As with the other generators: all data a page shows is baked in here at
# generation time, so frozen pages can safely skip re-execution. Never add
# render-time data reads to a generated page.
# ---------------------------------------------------------------------------

source("scripts/shared.R")

if (!dir.exists(SENATOR_PAGES_DIR)) dir.create(SENATOR_PAGES_DIR, recursive = TRUE)

# Profiles uploaded through the intake form land in SEN_PROFILE_DIR before
# the pages bake in their profile section
sync_intake_profiles()

senators <- load_senators()
ns       <- senator_name_sets(senators)
bills    <- load_bills()
votes    <- load_all_votes(ns)

# Contributions across all lobbies, plus each district's total-received rank
contributions <- load_all_contributions()
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
  district <- as.character(s$District)

  # --- Committee assignments line ----------------------------------------
  # Roster columns: Committee is ";"-separated codes (e.g. "anr;app"),
  # Chair / Vice.Chair hold the code of the committee they lead, if any.
  if (!is.na(s$Committee) && s$Committee != "") {
    codes <- trimws(unlist(strsplit(s$Committee, ";")))
    committee_names <- COMMITTEE_NAMES[codes]
    for (j in seq_along(codes)) {
      if (!is.na(s$Chair) && codes[j] == s$Chair) {
        committee_names[j] <- paste("Chair,", committee_names[j])
      } else if (!is.na(s$Vice.Chair) && codes[j] == s$Vice.Chair) {
        committee_names[j] <- paste("Vice Chair,", committee_names[j])
      }
    }
    committees_line <- paste(committee_names, collapse = "  \n")
  } else {
    committees_line <- "No Committee Assignments"
  }

  # --- Their bills (works for 0, 1, 2, or more) ---------------------------
  their_bills <- bills |> filter(name_join == s$name_join)
  if (nrow(their_bills) > 0) {
    bill_links_line <- paste(
      sprintf("[%s](../%s/%s.qmd)", their_bills$bill_measure, BILL_PAGES_DIR, their_bills$url_slug),
      collapse = "  \n"
    )
  } else {
    bill_links_line <- "No bills introduced yet."
  }

  # --- Their vote record --------------------------------------------------
  # Committees whose vote sheet has a column for this senator
  their_votes <- data.frame()
  in_committees <- votes[sapply(votes, function(df) s$name_period %in% names(df))]
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

  # --- Their contributions ------------------------------------------------
  their_contribs <- data.frame()
  total_received <- 0
  senator_rank   <- NA
  top_contributors <- data.frame()
  if (nrow(contributions) > 0) {
    their_contribs <- contributions |>
      filter(Recipient.District == as.integer(district)) |>
      arrange(desc(Date)) |>
      select(Date, Lobby, Contribution) |>
      as.data.frame()

    if (nrow(their_contribs) > 0) {
      total_received <- sum(their_contribs$Contribution, na.rm = TRUE)
      rank_row <- senator_totals |> filter(Recipient.District == as.integer(district))
      if (nrow(rank_row) > 0) senator_rank <- rank_row$rank

      top_contributors <- their_contribs |>
        group_by(Lobby) |>
        summarize(total = sum(Contribution, na.rm = TRUE)) |>
        arrange(desc(total)) |>
        mutate(rank = dense_rank(desc(total))) |>
        filter(rank <= 3) |>
        as.data.frame()
    }
  }
  contribs_code  <- paste(capture.output(dput(their_contribs)), collapse = "\n")

  # The contributions infographic (stat blocks + leaderboard), built here
  # as plain HTML in the site's own components
  if (nrow(their_contribs) > 0) {
    rank_txt <- if (!is.na(senator_rank)) paste0("#", senator_rank) else "—"
    contrib_html <- c(
      '<div class="stat-strip">',
      sprintf('<div class="stat"><span class="stat-label">Total Received</span><span class="stat-value">%s</span></div>',
              scales::dollar(total_received)),
      sprintf('<div class="stat"><span class="stat-label">Rank Among Senators</span><span class="stat-value">%s</span><span class="stat-sub">of 40 districts</span></div>',
              rank_txt),
      '</div>'
    )
    if (nrow(top_contributors) > 0) {
      contrib_html <- c(
        contrib_html,
        '<div class="lb-label">Top Contributors</div>',
        '<ol class="leaderboard">',
        sprintf('<li><span class="lb-rank">%d</span><span class="lb-name">%s</span><span class="lb-amt">%s</span></li>',
                top_contributors$rank, top_contributors$Lobby, scales::dollar(top_contributors$total)),
        '</ol>'
      )
    }
  } else {
    contrib_html <- "No contribution data available for this senator."
  }

  # --- Assemble the page ---------------------------------------------------
  # The profile section only appears once the PDF exists (uploaded through
  # the profile form, or dropped in the folder by hand) — no broken iframes.
  profile_file <- sprintf("%s_%s_profile.pdf", s$name_link, district)
  has_profile  <- file.exists(file.path(SEN_PROFILE_DIR, profile_file))
  profile_pdf  <- sprintf("../%s/%s", SEN_PROFILE_DIR, profile_file)

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
    "::: {.panel-tabset}",
    "",
    "## Details",
    "",
    sprintf("**District:** %s", district),
    "",
    sprintf("**Committee Assignments:** %s", committees_line),
    "",
    "**Bills:**",
    "",
    bill_links_line,
    "",
    if (has_profile) {
      c(sprintf("[View Profile](%s)", profile_pdf),
        "",
        sprintf('<iframe src="%s" width="100%%" height="600px"></iframe>', profile_pdf))
    } else {
      "*Role profile not posted yet.*"
    },
    "",
    "## Vote History",
    "",
    "```{r}",
    "#| echo: false",
    "#| warning: false",
    "#| message: false",
    "library(dplyr)",
    "library(reactable)",
    "library(plotly)",
    "library(bslib)",
    "library(bsicons)",
    "",
    paste("votes_including_s <-", votes_code),
    "",
    "# Summary metrics for the value boxes",
    "if (nrow(votes_including_s) > 0) {",
    "  total_votes    <- sum(votes_including_s$Vote %in% c('Aye', 'No', 'Abstain'))",
    "  possible_votes <- nrow(votes_including_s)",
    "  aligned_votes  <- sum(votes_including_s$`Voted With Party?` == 'Yes', na.rm = TRUE)",
    "  against_votes  <- sum(votes_including_s$`Voted With Party?` == 'No', na.rm = TRUE)",
    "  absent_votes   <- sum(votes_including_s$`Voted With Party?` == 'Absent', na.rm = TRUE)",
    "  alignment_pct  <- round((aligned_votes / total_votes) * 100, 1)",
    "  against_pct    <- round((against_votes / total_votes) * 100, 1)",
    "}",
    "```",
    "",
    "```{r}",
    "#| echo: false",
    "if (nrow(votes_including_s) > 0) {",
    "  layout_column_wrap(",
    "    width = 1/3,",
    "    value_box(",
    "      title = 'Voted With Party',",
    "      value = paste0(alignment_pct, '%'),",
    "      showcase = bs_icon('check-circle-fill'),",
    "      theme = 'success',",
    "      paste(aligned_votes, ' votes')",
    "    ),",
    "    value_box(",
    "      title = 'Voted Against Party',",
    "      value = paste0(against_pct, '%'),",
    "      showcase = bs_icon('x-circle-fill'),",
    "      theme = 'danger',",
    "      paste0(against_votes, ' votes')",
    "    ),",
    "    value_box(",
    "      title = 'Missed Votes',",
    "      value = absent_votes,",
    "      showcase = bs_icon('dash-circle-fill'),",
    "      theme = 'secondary',",
    "      paste0(round((absent_votes / possible_votes) * 100, 1), '% of votes missed')",
    "    )",
    "  )",
    "}",
    "```",
    "",
    "```{r}",
    "#| echo: false",
    "#| warning: false",
    "if (nrow(votes_including_s) > 0) {",
    "  vote_counts <- data.frame(",
    "    Vote_Type = factor(c('Aye', 'No', 'Abstain', 'Absent'),",
    "                       levels = c('Aye', 'No', 'Abstain', 'Absent')),",
    "    Count = c(",
    "      sum(votes_including_s$Vote == 'Aye', na.rm = TRUE),",
    "      sum(votes_including_s$Vote == 'No', na.rm = TRUE),",
    "      sum(votes_including_s$Vote == 'Abstain', na.rm = TRUE),",
    "      absent_votes",
    "    )",
    "  )",
    "  plot_ly(vote_counts,",
    "    x = ~Vote_Type, y = ~Count, type = 'bar',",
    "    marker = list(color = '#17345a'),",
    "    text = ~Count, textposition = 'outside',",
    "    hovertemplate = '<b>%{x}</b><br>Count: %{y}<br><extra></extra>'",
    "  ) |>",
    "  layout(",
    "    title = list(text = '<b>Vote Distribution</b>', x = 0.5),",
    "    xaxis = list(title = ''),",
    "    yaxis = list(title = 'Number of Votes'),",
    "    plot_bgcolor = 'rgba(0,0,0,0)',",
    "    paper_bgcolor = 'rgba(0,0,0,0)',",
    "    margin = list(t = 50, b = 40, l = 60, r = 40)",
    "  ) |>",
    "  config(displayModeBar = FALSE)",
    "}",
    "```",
    "",
    "```{r}",
    "#| echo: false",
    "#| warning: false",
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
    "  cat('No vote history available for this senator.')",
    "}",
    "```",
    "",
    "## Campaign Contributions",
    "",
    contrib_html,
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
    "      Lobby = colDef(name = 'Contributor'),",
    "      Contribution = colDef(name = 'Amount', width = 120,",
    "        format = colFormat(currency = 'USD', separators = TRUE, locales = 'en-US'))",
    "    ))",
    "} else {",
    "  invisible(NULL)  # the section text above already says there is no data",
    "}",
    "```",
    "",
    ":::",
    ""
  )

  cat(paste(c(yaml, body), collapse = "\n"),
      file = file.path(SENATOR_PAGES_DIR, paste0("district_", district, ".qmd")))
}

message("make_senator_pages: wrote ", nrow(senators), " pages.")
