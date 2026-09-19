# scripts/make_lobby_pages.R
# ---------------------------------------------------------------------------
# Generates one page per lobby organization into lobby-pages/. Runs
# automatically before every render (see pre-render in _quarto.yml).
# All shown data is baked in at generation time (see note in the other
# make_*.R scripts about why that matters for freeze).
# ---------------------------------------------------------------------------

source("scripts/shared.R")

if (!dir.exists(LOBBY_PAGES_DIR)) dir.create(LOBBY_PAGES_DIR, recursive = TRUE)

# Profiles uploaded through the intake form land in LOBBY_PROFILE_DIR
# before the pages bake in their profile tab
sync_intake_profiles()

lobbys   <- read.csv(LOBBY_CSV) |> mutate(Code = toupper(Code))
bills    <- load_bills()
letters  <- scan_letters()
senators <- load_senators() |>
  mutate(Recipient = paste0(Last.Name, ", ", First.Name)) |>
  select(District, Recipient, Party)

# Every org's contributions in one frame (2025 fixtures + 2026 intake rows)
all_contributions <- load_all_contributions()

for (i in seq_len(nrow(lobbys))) {
  lobby      <- lobbys$Lobby[i]
  lobby_code <- lobbys$Code[i]

  # --- This lobby's position letters, linked to bill pages ----------------
  # Bill stays a plain number so the column sorts 2, 10, 76 (the renderer
  # adds "SB-" back); the url columns ride along hidden for the links.
  # NOTE: links inside table widgets are NOT rewritten by Quarto, so they
  # must point at the final .html, never the .qmd source.
  letters_df <- data.frame()
  if (nrow(letters) > 0) {
    letters_df <- letters |>
      filter(org_code == lobby_code) |>
      left_join(bills |> select(bill_number, bill_measure, url_slug), by = "bill_number") |>
      mutate(
        bill_url   = ifelse(is.na(url_slug), NA,
                            sprintf("../%s/%s.html", BILL_PAGES_DIR, url_slug)),
        letter_url = sprintf("../%s/%s", LETTERS_DIR, filename)
      ) |>
      select(Bill = bill_number, bill_url, Position = position, letter_url) |>
      as.data.frame()
  }
  letters_code <- paste(capture.output(dput(letters_df)), collapse = "\n")

  # --- Spending ------------------------------------------------------------
  spending_df <- data.frame()
  total_spend <- NA
  d_support <- 0; d_share <- 0
  r_support <- 0; r_share <- 0
  top_recipients <- data.frame()

  # Rows come from the unified frame (fixtures + intake); the fixture file
  # is only consulted for the org's budget total, when one exists.
  spending_file <- list.files(CONTRIB_DIR,
                              pattern = paste0("^", lobby_code, "_.*\\.csv$"),
                              full.names = TRUE, ignore.case = TRUE)
  org_rows <- all_contributions |> filter(Lobby_Code == lobby_code)

  if (nrow(org_rows) > 0) {
    if (length(spending_file) > 0) {
      total_spend <- read_contribution_file(spending_file[1])$total
    }

    spending_df <- org_rows |>
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

  # --- Profile tab (always present; shows the PDF once it exists) ----------
  profile_file <- paste0(lobby_code, "_profile.pdf")
  has_profile  <- file.exists(file.path(LOBBY_PROFILE_DIR, profile_file))
  profile_tab  <- c(
    "",
    "## Profile",
    "",
    if (has_profile) {
      c(sprintf("[View Profile](../%s/%s)", LOBBY_PROFILE_DIR, profile_file),
        "",
        sprintf('<iframe src="../%s/%s" width="100%%" height="600px"></iframe>',
                LOBBY_PROFILE_DIR, profile_file))
    } else {
      "*Role profile not posted yet.*"
    },
    ""
  )

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
    "# Self-contained on purpose: generated pages never source shared.R or",
    "# read files at render time.",
    "library(reactable)",
    "",
    paste("letters_df <-", letters_code),
    "",
    "if (nrow(letters_df) > 0) {",
    "  reactable(letters_df, sortable = TRUE, highlight = TRUE,",
    "    defaultPageSize = 20, showPageSizeOptions = FALSE,",
    "    defaultColDef = colDef(na = ''),",
    "    columns = list(",
    "      Bill = colDef(width = 90, cell = function(value, index) {",
    "        if (is.na(letters_df$bill_url[index])) return(paste0('SB-', value))",
    "        htmltools::tags$a(href = letters_df$bill_url[index], paste0('SB-', value))",
    "      }),",
    "      bill_url = colDef(show = FALSE),",
    "      letter_url = colDef(name = 'Letter', sortable = FALSE, width = 110,",
    "        cell = function(value) htmltools::tags$a(href = value, 'View Letter'))",
    "    ))",
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
    "library(reactable)",
    "",
    paste("spending_df <-", spending_code),
    "",
    "if (nrow(spending_df) > 0) {",
    "  reactable(spending_df, sortable = TRUE, highlight = TRUE,",
    "    searchable = TRUE, defaultPageSize = 20, showPageSizeOptions = FALSE,",
    "    defaultColDef = colDef(na = ''),",
    "    columns = list(",
    "      Date = colDef(format = colFormat(date = TRUE, locales = 'en-US'), width = 110),",
    "      Recipient = colDef(cell = function(value, index) {",
    "        d <- spending_df$Recipient.District[index]",
    "        if (is.na(d)) return(value)",
    "        htmltools::tags$a(href = sprintf('../senator-pages/district_%s.html', d), value)",
    "      }),",
    "      Recipient.District = colDef(show = FALSE),",
    "      Party = colDef(width = 70),",
    "      Contribution = colDef(name = 'Amount', width = 120,",
    "        format = colFormat(currency = 'USD', separators = TRUE, locales = 'en-US'))",
    "    ))",
    "} else {",
    "  invisible(NULL)  # the section text above already says there is no data",
    "}",
    "```",
    profile_tab,
    "",
    ":::",
    ""
  )

  cat(paste(c(yaml, body), collapse = "\n"),
      file = file.path(LOBBY_PAGES_DIR, paste0(lobby_code, ".qmd")))
}

message("make_lobby_pages: wrote ", nrow(lobbys), " pages.")
