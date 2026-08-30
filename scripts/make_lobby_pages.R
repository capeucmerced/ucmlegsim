# scripts/make_lobby_pages.R
# ---------------------------------------------------------------------------
# Generates one page per lobby organization into lobby-pages/. Runs
# automatically before every render (see pre-render in _quarto.yml).
# All shown data is baked in at generation time (see note in the other
# make_*.R scripts about why that matters for freeze).
# ---------------------------------------------------------------------------

source("scripts/shared.R")

if (!dir.exists(LOBBY_PAGES_DIR)) dir.create(LOBBY_PAGES_DIR, recursive = TRUE)

lobbys   <- read.csv(LOBBY_CSV) |> mutate(Code = toupper(Code))
bills    <- load_bills()
letters  <- scan_letters()
senators <- load_senators() |>
  mutate(Recipient = paste0(Last.Name, ", ", First.Name)) |>
  select(District, Recipient, Party)

for (i in seq_len(nrow(lobbys))) {
  lobby      <- lobbys$Lobby[i]
  lobby_code <- lobbys$Code[i]

  # --- This lobby's position letters, linked to bill pages ----------------
  letters_df <- data.frame()
  if (nrow(letters) > 0) {
    letters_df <- letters |>
      filter(org_code == lobby_code) |>
      left_join(bills |> select(bill_number, bill_measure, url_slug), by = "bill_number") |>
      mutate(
        # NOTE: links inside gt tables are NOT rewritten by Quarto, so they
        # must point at the final .html, never the .qmd source.
        Bill_Link = ifelse(is.na(url_slug),
                           paste0("SB-", bill_number),
                           sprintf("[SB-%s](../%s/%s.html)", bill_number, BILL_PAGES_DIR, url_slug)),
        Letter_Link = sprintf("[View Letter](../%s/%s)", LETTERS_DIR, filename)
      ) |>
      select(Bill_Link, Position = position, Letter_Link) |>
      as.data.frame()
  }
  letters_code <- paste(capture.output(dput(letters_df)), collapse = "\n")

  # --- Spending ------------------------------------------------------------
  spending_df <- data.frame()
  total_spend <- NA
  d_support <- 0; d_share <- 0
  r_support <- 0; r_share <- 0
  top_recipients <- data.frame()

  spending_file <- list.files(CONTRIB_DIR,
                              pattern = paste0("^", lobby_code, "_.*\\.csv$"),
                              full.names = TRUE, ignore.case = TRUE)
  if (length(spending_file) > 0) {
    contrib <- read_contribution_file(spending_file[1])
    total_spend <- contrib$total

    spending_df <- contrib$rows |>
      arrange(desc(Date)) |>
      left_join(senators, by = c("Recipient.District" = "District")) |>
      # Recipients who aren't senators keep the name typed in the sheet
      mutate(Recipient = ifelse(is.na(Recipient), Recipient.Name, Recipient)) |>
      select(Date, Recipient, Recipient.District, Party, Contribution) |>
      as.data.frame()

    d_support <- sum(spending_df$Contribution[spending_df$Party %in% "D"], na.rm = TRUE)
    r_support <- sum(spending_df$Contribution[spending_df$Party %in% "R"], na.rm = TRUE)
    if (!is.na(total_spend) && total_spend > 0) {
      d_share <- d_support / total_spend
      r_share <- r_support / total_spend
    }

    top_recipients <- spending_df |>
      group_by(Recipient) |>
      summarize(contributions = sum(Contribution, na.rm = TRUE)) |>
      arrange(desc(contributions)) |>
      mutate(rank = dense_rank(desc(contributions))) |>
      filter(rank <= 3) |>
      as.data.frame()
  }

  spending_code <- paste(capture.output(dput(spending_df)), collapse = "\n")

  # The spending infographic (stat blocks + party share bar + leaderboard),
  # built here as plain HTML in the site's own components
  if (nrow(spending_df) > 0) {
    spent <- d_support + r_support
    spend_html <- c(
      '<div class="stat-strip">',
      sprintf('<div class="stat"><span class="stat-label">Total Budget</span><span class="stat-value">%s</span></div>',
              ifelse(is.na(total_spend), "—", scales::dollar(total_spend))),
      sprintf('<div class="stat"><span class="stat-label">Contributed So Far</span><span class="stat-value">%s</span><span class="stat-sub">across %d contributions</span></div>',
              scales::dollar(sum(spending_df$Contribution, na.rm = TRUE)), nrow(spending_df)),
      '</div>'
    )
    if (!is.na(total_spend) && total_spend > 0) {
      spend_html <- c(
        spend_html,
        '<div class="lb-label">Where the Money Went</div>',
        sprintf('<div class="share-bar"><span class="share-d" style="width:%.1f%%"></span><span class="share-r" style="width:%.1f%%"></span></div>',
                100 * d_share, 100 * r_share),
        sprintf('<div class="share-legend"><span><span class="dot dot-d">●</span> Democrats <b>%s</b> (%s)</span><span><span class="dot dot-r">●</span> Republicans <b>%s</b> (%s)</span><span>Remaining budget <b>%s</b></span></div>',
                scales::dollar(d_support), scales::percent(d_share, accuracy = 1),
                scales::dollar(r_support), scales::percent(r_share, accuracy = 1),
                scales::dollar(max(total_spend - spent, 0)))
      )
    }
    if (nrow(top_recipients) > 0) {
      spend_html <- c(
        spend_html,
        '<div class="lb-label">Top Recipients</div>',
        '<ol class="leaderboard">',
        sprintf('<li><span class="lb-rank">%d</span><span class="lb-name">%s</span><span class="lb-amt">%s</span></li>',
                top_recipients$rank, top_recipients$Recipient, scales::dollar(top_recipients$contributions)),
        '</ol>'
      )
    }
  } else {
    spend_html <- "No spending data available for this lobby group."
  }

  # --- Assemble the page ---------------------------------------------------
  yaml <- c(
    "---",
    sprintf('title: "%s"', lobby),
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
    "## Position Letters",
    "",
    "```{r}",
    "#| echo: false",
    "#| warning: false",
    "#| message: false",
    "library(dplyr)",
    "library(gt)",
    "",
    paste("letters_df <-", letters_code),
    "",
    "if (nrow(letters_df) > 0) {",
    "  letters_df |>",
    "    gt() |>",
    "    cols_label(Bill_Link = 'Bill', Position = 'Position', Letter_Link = 'Letter') |>",
    "    fmt_markdown(columns = c(Bill_Link, Letter_Link)) |>",
    "    opt_interactive(use_sorting = TRUE, use_search = TRUE)",
    "} else {",
    "  cat('No position letters available for this lobby group.')",
    "}",
    "```",
    "",
    "## Spending",
    "",
    spend_html,
    "",
    "```{r}",
    "#| echo: false",
    "#| warning: false",
    "#| message: false",
    "library(dplyr)",
    "library(gt)",
    "",
    paste("spending_df <-", spending_code),
    "",
    "if (nrow(spending_df) > 0) {",
    "  spending_df |>",
    "    mutate(",
    "      Recipient_Link = ifelse(",
    "        !is.na(Recipient.District),",
    "        sprintf('[%s](../senator-pages/district_%s.html)', Recipient, Recipient.District),",
    "        Recipient",
    "      )",
    "    ) |>",
    "    select(Date, Recipient_Link, Party, Contribution) |>",
    "    gt() |>",
    "    cols_label(Date = 'Date', Recipient_Link = 'Recipient',",
    "               Party = 'Party', Contribution = 'Amount') |>",
    "    fmt_markdown(columns = Recipient_Link) |>",
    "    fmt_currency(columns = Contribution, currency = 'USD') |>",
    "    fmt_date(columns = Date, date_style = 'yMd') |>",
    "    opt_interactive(use_sorting = TRUE, use_search = TRUE)",
    "} else {",
    "  invisible(NULL)  # the section text above already says there is no data",
    "}",
    "```",
    "",
    ":::",
    ""
  )

  cat(paste(c(yaml, body), collapse = "\n"),
      file = file.path(LOBBY_PAGES_DIR, paste0(lobby_code, ".qmd")))
}

message("make_lobby_pages: wrote ", nrow(lobbys), " pages.")
