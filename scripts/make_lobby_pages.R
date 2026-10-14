# scripts/make_lobby_pages.R
# ---------------------------------------------------------------------------
# Generates one page per lobby organization into lobby-pages/. Runs
# automatically before every render (see pre-render in _quarto.yml).
#
# Page shape, top to bottom (mirrors the senator pages):
#   1. Dossier header — org chip, spending tier, PAC budget, a count of
#      position letters by position, profile link.
#   2. Dashboard — budget, contributed, remaining, senators funded, letters
#      filed; then the party split of the money and the top recipients.
#   3. Tabs — the position letters, the contribution ledger, the profile.
#
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
budgets <- load_budgets()   # PAC budget and tier per org (campaign finance)

for (i in seq_len(nrow(lobbys))) {
  lobby      <- lobbys$Lobby[i]
  lobby_code <- lobbys$Code[i]
  color      <- if ("Color" %in% names(lobbys) && !is.na(lobbys$Color[i]) && lobbys$Color[i] != "") {
    lobbys$Color[i]
  } else "#17345a"

  # --- This lobby's position letters, linked to bill pages ----------------
  # Bill stays a plain number so the column sorts 2, 10, 76 (the renderer
  # adds "SB-" back); the url columns ride along hidden for the links.
  # NOTE: links inside table widgets are NOT rewritten by Quarto, so they
  # must point at the final .html, never the .qmd source.
  letters_df  <- data.frame()
  n_letters   <- 0
  by_position <- character(0)
  if (nrow(letters) > 0) {
    mine <- letters |> filter(org_code == lobby_code)
    if (nrow(mine) > 0) {
      n_letters <- nrow(mine)
      counts <- table(factor(mine$position, levels = unname(LETTER_POSITIONS)))
      by_position <- sprintf("%d %s", as.integer(counts[counts > 0]), names(counts)[counts > 0])
      letters_df <- mine |>
        left_join(bills |> select(bill_number, title, url_slug), by = "bill_number") |>
        arrange_letters() |>
        transmute(
          Filed      = filed,
          Bill       = bill_number,
          bill_url   = ifelse(is.na(url_slug), NA,
                              sprintf("../%s/%s.html", BILL_PAGES_DIR, url_slug)),
          Subject    = coalesce(title, ""),
          Position   = position,
          letter_url = sprintf("../%s/%s", LETTERS_DIR, filename)
        ) |>
        as.data.frame()
    }
  }
  letters_code <- paste(capture.output(dput(letters_df)), collapse = "\n")

  # --- Spending ------------------------------------------------------------
  spending_df <- data.frame()
  total_spend <- NA
  d_support <- 0; r_support <- 0
  top_recipients <- data.frame()

  # Rows come from the unified frame (fixtures + intake); the fixture file
  # is only consulted for the org's budget total, when one exists.
  spending_file <- list.files(CONTRIB_DIR,
                              pattern = paste0("^", lobby_code, "_.*\\.csv$"),
                              full.names = TRUE, ignore.case = TRUE)
  org_rows <- all_contributions |> filter(Lobby_Code == lobby_code)

  # The PAC budget comes from the org's tier (campaign finance; shared.R);
  # the fixture file is only a fallback for an org without one
  total_spend <- budgets$Budget[match(lobby_code, budgets$Code)]
  if (is.na(total_spend) && length(spending_file) > 0) {
    total_spend <- read_contribution_file(spending_file[1])$total
  }
  tier <- budgets$Tier[match(lobby_code, budgets$Code)]

  if (nrow(org_rows) > 0) {
    spending_df <- org_rows |>
      arrange(desc(Date)) |>
      left_join(senators, by = c("Recipient.District" = "District")) |>
      # Recipients who aren't senators keep the name typed in the sheet
      mutate(Recipient = ifelse(is.na(Recipient), Recipient.Name, Recipient)) |>
      select(Date, Recipient, Recipient.District, Party, Contribution) |>
      as.data.frame()

    d_support <- sum(spending_df$Contribution[spending_df$Party %in% "D"], na.rm = TRUE)
    r_support <- sum(spending_df$Contribution[spending_df$Party %in% "R"], na.rm = TRUE)

    top_recipients <- spending_df |>
      group_by(Recipient, Recipient.District) |>
      summarize(contributions = sum(Contribution, na.rm = TRUE), .groups = "drop") |>
      arrange(desc(contributions)) |>
      mutate(rank = dense_rank(desc(contributions))) |>
      filter(rank <= 3) |>
      as.data.frame()
  }
  spending_code <- paste(capture.output(dput(spending_df)), collapse = "\n")

  spent_total  <- if (nrow(spending_df) > 0) sum(spending_df$Contribution, na.rm = TRUE) else 0
  n_recipients <- if (nrow(spending_df) > 0) length(unique(spending_df$Recipient)) else 0
  tier_txt     <- if (is.na(tier) || tier == "") "" else paste(tier, "capacity")
  budget_txt   <- if (is.na(total_spend)) "&mdash;" else scales::dollar(total_spend)

  # --- Role profile (only linked once the PDF exists) ----------------------
  profile_file <- paste0(lobby_code, "_profile.pdf")
  has_profile  <- file.exists(file.path(LOBBY_PROFILE_DIR, profile_file))
  profile_pdf  <- sprintf("../%s/%s", LOBBY_PROFILE_DIR, profile_file)
  profile_html <- if (has_profile) {
    sprintf('<a href="%s">View role profile (PDF)</a>', profile_pdf)
  } else '<span class="muted">Not posted yet</span>'

  # --- Dossier header ------------------------------------------------------
  letters_fact <- if (n_letters > 0) {
    sprintf("%d filed &middot; %s", n_letters, paste(by_position, collapse = " &middot; "))
  } else '<span class="muted">None filed yet</span>'

  header_html <- raw_html(
    '<div class="dossier">',
    sprintf('<div class="dossier-meta"><span class="org-chip" style="--org-color:%s">%s</span> %sPAC budget <b>%s</b></div>',
            color, lobby_code,
            if (tier_txt == "") "" else paste0(tier_txt, " &middot; "), budget_txt),
    '<dl class="dossier-facts">',
    sprintf('<dt>Position letters</dt><dd>%s</dd>', letters_fact),
    sprintf('<dt>Role profile</dt><dd>%s</dd>', profile_html),
    '</dl>',
    '</div>'
  )

  # --- Dashboard ------------------------------------------------------------
  # The budget strip appears even before the first contribution
  stats <- c(
    stat_html("PAC Budget", budget_txt, tier_txt),
    stat_html("Contributed So Far", scales::dollar(spent_total),
              sprintf("across %d contribution%s", nrow(spending_df), ifelse(nrow(spending_df) == 1, "", "s"))),
    stat_html("Remaining",
              if (is.na(total_spend)) "&mdash;" else scales::dollar(total_spend - spent_total),
              sprintf("up to %s per senator", scales::dollar(CONTRIBUTION_LIMIT))),
    stat_html("Senators Funded", n_recipients,
              if (nrow(spending_df) > 0) {
                sprintf("%s to Democrats &middot; %s to Republicans", scales::dollar(d_support), scales::dollar(r_support))
              } else "none yet"),
    stat_html("Letters Filed", n_letters,
              if (n_letters > 0) paste(by_position, collapse = " &middot; ") else "none yet")
  )

  # Party split of the money: shares of the budget when one is known,
  # otherwise shares of what was spent
  denom <- if (!is.na(total_spend) && total_spend > 0) total_spend else spent_total
  money_block <- c(
    '<div class="lb-block">',
    '<div class="lb-label">Where the Money Went</div>',
    if (nrow(spending_df) > 0 && denom > 0) c(
      sprintf('<div class="share-bar"><span class="share-d" style="width:%.1f%%"></span><span class="share-r" style="width:%.1f%%"></span></div>',
              100 * d_support / denom, 100 * r_support / denom),
      sprintf('<div class="share-legend"><span><span class="dot dot-d">&#9679;</span> Democrats <b>%s</b> (%s)</span><span><span class="dot dot-r">&#9679;</span> Republicans <b>%s</b> (%s)</span>%s</div>',
              scales::dollar(d_support), scales::percent(d_support / denom, accuracy = 1),
              scales::dollar(r_support), scales::percent(r_support / denom, accuracy = 1),
              if (!is.na(total_spend)) sprintf('<span>Remaining budget <b>%s</b></span>', scales::dollar(max(total_spend - spent_total, 0))) else "")
    ) else '<p class="muted">No contributions reported yet.</p>',
    '</div>'
  )

  recipients_block <- c(
    '<div class="lb-block">',
    '<div class="lb-label">Top Recipients</div>',
    if (nrow(top_recipients) > 0) c(
      '<ol class="leaderboard">',
      sprintf('<li><span class="lb-rank">%d</span><span class="lb-name">%s</span><span class="lb-amt">%s</span></li>',
              top_recipients$rank,
              ifelse(is.na(top_recipients$Recipient.District), top_recipients$Recipient,
                     sprintf('<a href="../%s/district_%s.html">%s</a>', SENATOR_PAGES_DIR,
                             top_recipients$Recipient.District, top_recipients$Recipient)),
              scales::dollar(top_recipients$contributions)),
      '</ol>'
    ) else '<p class="muted">No recipients yet.</p>',
    '</div>'
  )

  dashboard_html <- raw_html(
    '<div class="stat-strip">', stats, '</div>',
    '<div class="lb-cols">', money_block, recipients_block, '</div>'
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
    header_html,
    "",
    dashboard_html,
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
    "      Filed = colDef(format = colFormat(date = TRUE, locales = 'en-US'), width = 100),",
    "      Bill = colDef(width = 85, cell = function(value, index) {",
    "        if (is.na(letters_df$bill_url[index])) return(paste0('SB-', value))",
    "        htmltools::tags$a(href = letters_df$bill_url[index], paste0('SB-', value))",
    "      }),",
    "      bill_url = colDef(show = FALSE),",
    "      Subject = colDef(minWidth = 160),",
    "      Position = colDef(width = 185),",
    "      letter_url = colDef(name = 'Letter', sortable = FALSE, width = 110,",
    "        cell = function(value) htmltools::tags$a(href = value, 'View Letter'))",
    "    ))",
    "} else {",
    "  htmltools::p(class = 'muted', 'No position letters filed by this organization yet.')",
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
    sprintf("        htmltools::tags$a(href = sprintf('../%s/district_%%s.html', d), value)", SENATOR_PAGES_DIR),
    "      }),",
    "      Recipient.District = colDef(show = FALSE),",
    "      Party = colDef(width = 70),",
    "      Contribution = colDef(name = 'Amount', width = 120,",
    "        format = colFormat(currency = 'USD', separators = TRUE, locales = 'en-US'))",
    "    ))",
    "} else {",
    "  htmltools::p(class = 'muted', 'No contributions reported yet.')",
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
      file = file.path(LOBBY_PAGES_DIR, paste0(lobby_code, ".qmd")))
}

message("make_lobby_pages: wrote ", nrow(lobbys), " pages.")
