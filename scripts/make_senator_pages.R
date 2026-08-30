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

    their_votes <- bind_rows(in_committees, .id = "Committee") |>
      select(Date, Bill, Committee, all_of(c(s$name_period, party_choice_col))) |>
      mutate(
        party_aligned = case_when(
          is.na(.data[[s$name_period]]) | .data[[s$name_period]] == "" ~ "Absent",
          .data[[party_choice_col]] == .data[[s$name_period]] ~ "Yes",
          TRUE ~ "No"
        ),
        Committee = COMMITTEE_NAMES[Committee]
      ) |>
      arrange(desc(Date)) |>
      mutate(Date = format(Date, "%m/%d/%y")) |>
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
  top_code       <- paste(capture.output(dput(top_contributors)), collapse = "\n")

  # --- Assemble the page ---------------------------------------------------
  profile_pdf <- sprintf("../%s/%s_%s_profile.pdf", SEN_PROFILE_DIR, s$name_link, district)

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
    sprintf("[View Profile](%s)", profile_pdf),
    "",
    sprintf('<iframe src="%s" width="100%%" height="600px"></iframe>', profile_pdf),
    "",
    "## Vote History",
    "",
    "```{r}",
    "#| echo: false",
    "#| warning: false",
    "#| message: false",
    "library(dplyr)",
    "library(gt)",
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
    "  votes_including_s |>",
    "    gt() |>",
    "    opt_interactive(use_sorting = TRUE, use_highlight = TRUE)",
    "} else {",
    "  cat('No vote history available for this senator.')",
    "}",
    "```",
    "",
    "## Campaign Contributions",
    "",
    "```{r}",
    "#| echo: false",
    "#| warning: false",
    "#| message: false",
    "library(scales)",
    "",
    paste("senator_contributions <-", contribs_code),
    paste("total_received <-", deparse(total_received)),
    paste("senator_rank <-", deparse(senator_rank)),
    paste("top_contributors <-", top_code),
    "",
    "if (nrow(senator_contributions) > 0) {",
    "  layout_column_wrap(",
    "    width = 1/2,",
    "    value_box(",
    "      title = 'Total Contributions Received',",
    "      value = dollar(total_received),",
    "      showcase = bs_icon('currency-dollar'),",
    "      theme = 'purple'",
    "    ),",
    "    value_box(",
    "      title = 'Rank Among All Senators',",
    "      value = if (!is.na(senator_rank)) paste0('#', senator_rank) else 'N/A',",
    "      showcase = bs_icon('bar-chart-fill'),",
    "      theme = 'primary',",
    "      if (!is.na(senator_rank)) 'Out of 40 senators' else ''",
    "    )",
    "  )",
    "}",
    "```",
    "",
    "```{r}",
    "#| echo: false",
    "#| warning: false",
    "# Top contributors, tolerating ties at each rank",
    "if (nrow(senator_contributions) > 0 && nrow(top_contributors) > 0) {",
    "  titles <- c('Top Contributor', '2nd Contributor', '3rd Contributor')",
    "  icons  <- c('trophy-fill', 'award-fill', 'award-fill')",
    "  themes <- c('success', 'secondary', 'secondary')",
    "  box_args <- list()",
    "  for (r in 1:3) {",
    "    rows <- top_contributors[top_contributors$rank == r, ]",
    "    if (nrow(rows) > 0) {",
    "      box_args <- c(box_args, list(value_box(",
    "        title = titles[r],",
    "        value = paste(rows$Lobby, collapse = ', '),",
    "        showcase = bs_icon(icons[r]),",
    "        theme = themes[r],",
    "        dollar(rows$total[1])",
    "      )))",
    "    }",
    "  }",
    "  if (length(box_args) > 0) {",
    "    do.call(layout_column_wrap, c(list(width = 1 / length(box_args)), box_args))",
    "  }",
    "}",
    "```",
    "",
    "```{r}",
    "#| echo: false",
    "#| warning: false",
    "if (nrow(senator_contributions) > 0) {",
    "  senator_contributions |>",
    "    gt() |>",
    "    cols_label(Date = 'Date', Lobby = 'Contributor', Contribution = 'Amount') |>",
    "    fmt_currency(columns = Contribution, currency = 'USD') |>",
    "    fmt_date(columns = Date, date_style = 'yMd') |>",
    "    opt_interactive(use_sorting = TRUE, use_search = TRUE)",
    "} else {",
    "  cat('No contribution data available for this senator.')",
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
