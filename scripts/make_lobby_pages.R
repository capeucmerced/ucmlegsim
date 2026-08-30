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
  top_code      <- paste(capture.output(dput(top_recipients)), collapse = "\n")

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
    "    tab_header(title = 'Position Letters') |>",
    "    opt_interactive(use_sorting = TRUE, use_search = TRUE) |>",
    "    opt_row_striping()",
    "} else {",
    "  cat('No position letters available for this lobby group.')",
    "}",
    "```",
    "",
    "## Spending",
    "",
    "```{r}",
    "#| echo: false",
    "#| warning: false",
    "#| message: false",
    "library(scales)",
    "library(bslib)",
    "library(bsicons)",
    "library(fontawesome)",
    "",
    paste("spending_df <-", spending_code),
    paste("total_spend <-", deparse(total_spend)),
    paste("d_support <-", deparse(d_support)),
    paste("d_share <-", deparse(d_share)),
    paste("r_support <-", deparse(r_support)),
    paste("r_share <-", deparse(r_share)),
    paste("top_recipients <-", top_code),
    "",
    "if (nrow(spending_df) > 0) {",
    "  layout_column_wrap(",
    "    width = 1/3,",
    "    value_box(",
    "      title = 'Total Contributions',",
    "      value = dollar(total_spend),",
    "      showcase = bs_icon('currency-dollar'),",
    "      theme = 'purple'",
    "    ),",
    "    value_box(",
    "      title = 'Democratic Contributions',",
    "      value = dollar(d_support),",
    "      showcase = fa('democrat', fill = 'blue', height = '3em'),",
    "      theme = 'primary',",
    "      paste0(percent(d_share, accuracy = 0.1), ' of total')",
    "    ),",
    "    value_box(",
    "      title = 'Republican Contributions',",
    "      value = dollar(r_support),",
    "      showcase = fa('republican', fill = '#c40000ff', height = '3em'),",
    "      theme = 'danger',",
    "      paste0(percent(r_share, accuracy = 0.1), ' of total')",
    "    )",
    "  )",
    "}",
    "```",
    "",
    "```{r}",
    "#| echo: false",
    "#| warning: false",
    "# Top recipients, tolerating ties at each rank",
    "if (nrow(spending_df) > 0 && nrow(top_recipients) > 0) {",
    "  titles <- c('Top Recipient', '2nd Recipient', '3rd Recipient')",
    "  icons  <- c('trophy-fill', 'award-fill', 'award-fill')",
    "  themes <- c('success', 'secondary', 'secondary')",
    "  box_args <- list()",
    "  for (r in 1:3) {",
    "    rows <- top_recipients[top_recipients$rank == r, ]",
    "    if (nrow(rows) > 0) {",
    "      box_args <- c(box_args, list(value_box(",
    "        title = titles[r],",
    "        value = paste(rows$Recipient, collapse = ', '),",
    "        showcase = bs_icon(icons[r]),",
    "        theme = themes[r],",
    "        dollar(rows$contributions[1])",
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
    "if (nrow(spending_df) > 0) {",
    "  spending_df |>",
    "    mutate(",
    "      Recipient_Link = ifelse(",
    "        !is.na(Recipient.District),",
    "        sprintf('[%s](../senator-pages/district_%s.html)', Recipient, Recipient.District),",
    "        Recipient",
    "      )",
    "    ) |>",
    "    select(Date, Recipient_Link, Contribution, Party) |>",
    "    gt() |>",
    "    cols_label(Date = 'Date', Recipient_Link = 'Recipient',",
    "               Contribution = 'Amount', Party = 'Party') |>",
    "    fmt_markdown(columns = Recipient_Link) |>",
    "    fmt_currency(columns = Contribution, currency = 'USD') |>",
    "    fmt_date(columns = Date, date_style = 'yMd') |>",
    "    tab_header(title = 'All Contributions') |>",
    "    opt_interactive(use_sorting = TRUE, use_search = TRUE) |>",
    "    opt_row_striping()",
    "} else {",
    "  cat('No spending data available for this lobby group.')",
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
