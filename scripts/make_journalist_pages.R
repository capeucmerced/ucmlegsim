# scripts/make_journalist_pages.R
# ---------------------------------------------------------------------------
# Generates one page per newspaper outlet into journalist-pages/. Runs
# automatically before every render (see pre-render in _quarto.yml).
#
# Layout: the outlet's wire history in the left column (client-side —
# the site-wide js/feed.js, filtered to this outlet, so it updates in
# seconds with no rebuild), and on the right two tabs: Stories (the
# pieces filed through "Publish a Story", newest first as the lead) and
# Profile. Stories and profile presence are baked in at generation time,
# like every other generated page; the page always exists either way.
# ---------------------------------------------------------------------------

source("scripts/shared.R")

if (!dir.exists(JOURNALIST_PAGES_DIR)) dir.create(JOURNALIST_PAGES_DIR, recursive = TRUE)

# Profiles and stories uploaded through the intake forms land in their
# folders before the pages bake them in
sync_intake_profiles()
sync_intake_stories()
all_stories <- load_intake_stories()

news <- read.csv(JOURNALIST_CSV)

for (i in seq_len(nrow(news))) {
  outlet <- news$Newspaper[i]
  slug   <- outlet_slug(outlet)

  # The outlet's own articles page, when the admin has set one
  link <- news$Link[i]
  link_line <- if (!is.na(link) && link != "") {
    sprintf('<p class="table-note"><a href="%s" target="_blank" rel="noopener">Read their published articles &rarr;</a></p>', link)
  } else ""

  profile_file <- sprintf("%s_profile.pdf", slug)
  has_profile  <- file.exists(file.path(JOUR_PROFILE_DIR, profile_file))
  profile_pdf  <- sprintf("../%s/%s", JOUR_PROFILE_DIR, profile_file)

  theirs <- all_stories[all_stories$outlet == outlet, , drop = FALSE]

  yaml <- c(
    "---",
    sprintf('title: "%s"', outlet),
    "format:",
    "  html:",
    "    page-layout: full",
    "freeze: auto",
    "---"
  )

  body <- c(
    "",
    "::: {.grid}",
    "",
    "::: {.g-col-12 .g-col-lg-4}",
    "",
    "## The Wire",
    "",
    "Dispatches from this outlet — newest first, live from the feed.",
    "",
    sprintf('<div class="wire-feed" data-outlet="%s"></div>', outlet),
    "",
    ":::",
    "",
    "::: {.g-col-12 .g-col-lg-8}",
    "",
    "::: {.panel-tabset}",
    "",
    "## Stories",
    "",
    stories_html(theirs, rel = "../"),
    "",
    link_line,
    "",
    "## Profile",
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
    "",
    ":::",
    "",
    ":::",
    ""
  )

  cat(paste(c(yaml, body), collapse = "\n"),
      file = file.path(JOURNALIST_PAGES_DIR, paste0(slug, ".qmd")))
}

message("make_journalist_pages: wrote ", nrow(news), " pages.")
