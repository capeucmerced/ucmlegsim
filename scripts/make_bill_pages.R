# scripts/make_bill_pages.R
# ---------------------------------------------------------------------------
# Generates one page per bill into bills-pages/. Runs automatically before
# every render (see pre-render in _quarto.yml).
#
# IMPORTANT: everything a generated page shows is baked in HERE, at
# generation time (vote tables via dput(), letter links as plain markdown).
# That is what makes Quarto's freeze work — a page whose text didn't change
# skips re-execution, keeping builds fast. Never add code to a generated
# page that reads files or URLs at render time; it would silently go stale.
# ---------------------------------------------------------------------------

source("scripts/shared.R")

if (!dir.exists(BILL_PAGES_DIR)) dir.create(BILL_PAGES_DIR, recursive = TRUE)

senators <- load_senators()
ns       <- senator_name_sets(senators)
votes    <- load_all_votes(ns)
letters  <- scan_letters()

bills <- load_bills() |>
  left_join(senators |> select(name_join, District), by = "name_join")

# All votes from all committees in one frame (empty if none taken yet)
all_vote_rows <- if (length(votes) > 0) bind_rows(votes, .id = "source") else data.frame()

for (i in seq_len(nrow(bills))) {
  b <- bills[i, ]
  page_title <- paste(b$bill_measure, b$title)

  # --- This bill's vote history (newest first), baked in as data ----------
  if (nrow(all_vote_rows) > 0) {
    matches <- all_vote_rows |>
      filter(Bill == b$bill_measure) |>
      arrange(desc(Date)) |>
      mutate(
        source = COMMITTEE_NAMES[source],
        Date   = format(Date, "%m/%d/%y")
      ) |>
      select(Date, source, Vote, Result, Dem_percent_sign, Rep_percent_sign) |>
      as.data.frame()
  } else {
    matches <- data.frame()
  }
  matches_code <- paste(capture.output(dput(matches)), collapse = "\n")

  # --- Previous versions of the bill text ---------------------------------
  prev_pattern <- paste0("^", b$url_slug, "_v[0-9]+\\.pdf$")
  prev_files   <- list.files(PREV_BILL_PDF_DIR, pattern = prev_pattern)
  prev_df <- data.frame()
  if (length(prev_files) > 0) {
    prev_df <- data.frame(
      file    = prev_files,
      version = as.numeric(gsub(paste0("^", b$url_slug, "_v([0-9]+)\\.pdf$"), "\\1", prev_files))
    ) |>
      arrange(desc(version))
  }

  # --- This bill's lobbyist letters, as plain markdown links --------------
  bill_letters <- data.frame()
  if (nrow(letters) > 0) {
    bill_letters <- letters |>
      filter(bill_number == b$bill_number) |>
      arrange(position, Lobby)
  }

  letter_lines <- c()
  if (nrow(bill_letters) > 0) {
    # Conditional positions group with their side; the exact position is
    # shown next to each org's name.
    support <- bill_letters |> filter(position %in% c("Support", "Support If Amended"))
    oppose  <- bill_letters |> filter(position %in% c("Oppose", "Oppose Unless Amended"))
    if (nrow(support) > 0) {
      letter_lines <- c(letter_lines, "### Support Letters", "",
                        sprintf("[%s — %s](../%s/%s)  ", support$Lobby, support$position, LETTERS_DIR, support$filename), "")
    }
    if (nrow(oppose) > 0) {
      letter_lines <- c(letter_lines, "### Opposition Letters", "",
                        sprintf("[%s — %s](../%s/%s)  ", oppose$Lobby, oppose$position, LETTERS_DIR, oppose$filename), "")
    }
  } else {
    letter_lines <- "No lobbyist letters available for this bill."
  }

  # --- Booktabs: colored index tabs on the bill PDF, one per letter --------
  # Each org's color comes from the Color column of lobbyist_list.csv.
  booktab_rail <- ""
  if (nrow(bill_letters) > 0) {
    position_icons <- c("Support" = "✓", "Support If Amended" = "✓*",
                        "Oppose Unless Amended" = "✗*", "Oppose" = "✗")
    tab_colors <- if ("Color" %in% names(bill_letters)) {
      ifelse(is.na(bill_letters$Color) | bill_letters$Color == "", "#17345a", bill_letters$Color)
    } else rep("#17345a", nrow(bill_letters))

    tabs <- sprintf(
      '<a class="booktab" style="--org-color:%s" href="../%s/%s" title="%s — %s">%s %s</a>',
      tab_colors, LETTERS_DIR, bill_letters$filename,
      bill_letters$Lobby, bill_letters$position,
      bill_letters$org_code, position_icons[bill_letters$position]
    )
    booktab_rail <- paste0('<div class="booktab-rail">', paste(tabs, collapse = ""), "</div>")
  }

  # --- Assemble the page ---------------------------------------------------
  pdf_path    <- sprintf("../%s/%s.pdf", BILL_PDF_DIR, b$url_slug)
  author_page <- sprintf("../%s/district_%s.qmd", SENATOR_PAGES_DIR, b$District)

  yaml <- c(
    "---",
    sprintf('title: "%s"', page_title),
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
    sprintf("**Author:** [%s](%s)", b$name, author_page),
    "",
    sprintf("**Committee:** %s", b$committee),
    "",
    sprintf("**Appropriations:** %s", b$appropriations),
    "",
    sprintf("**Text:** [View Bill](%s)", pdf_path),
    "",
    sprintf('<div class="bill-doc-wrap">%s<iframe src="%s" width="100%%" height="600px"></iframe></div>',
            booktab_rail, pdf_path),
    "",
    "## Vote History",
    "",
    "```{r}",
    "#| echo: false",
    "#| warning: false",
    "#| message: false",
    "library(dplyr)",
    "library(gt)",
    "",
    paste("matches <-", matches_code),
    "",
    "if (nrow(matches) > 0) {",
    "  matches |>",
    "    gt() |>",
    "    cols_label(",
    "      Date = 'Date',",
    "      source = 'Committee',",
    "      Vote = 'Vote',",
    "      Result = 'Result',",
    "      Dem_percent_sign = 'Democratic Support',",
    "      Rep_percent_sign = 'Republican Support'",
    "    ) |>",
    "    tab_header(",
    "      title = 'Vote History',",
    "      subtitle = 'Sorted by newer to older votes'",
    "    ) |>",
    "    opt_interactive(use_sorting = TRUE, use_highlight = TRUE) |>",
    "    opt_row_striping()",
    "} else {",
    "  cat('No vote history available for this bill.')",
    "}",
    "```",
    "",
    "## Previous Text",
    "",
    if (nrow(prev_df) > 0) {
      c(
        "::: {.panel-tabset}",
        "",
        unlist(lapply(seq_len(nrow(prev_df)), function(j) {
          c(
            sprintf("### Version %d", prev_df$version[j]),
            "",
            sprintf('<iframe src="../%s/%s" width="100%%" height="600px"></iframe>',
                    PREV_BILL_PDF_DIR, prev_df$file[j]),
            ""
          )
        })),
        ":::",
        ""
      )
    } else {
      "No previous versions available for this bill."
    },
    "",
    "## Lobbyist Letters",
    "",
    letter_lines,
    "",
    ":::",
    ""
  )

  cat(paste(c(yaml, body), collapse = "\n"),
      file = file.path(BILL_PAGES_DIR, paste0(b$url_slug, ".qmd")))
}

message("make_bill_pages: wrote ", nrow(bills), " pages.")
