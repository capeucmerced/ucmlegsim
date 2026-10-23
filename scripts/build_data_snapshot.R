# scripts/build_data_snapshot.R — the FIRST pre-render step (_quarto.yml).
#
# Takes ONE snapshot of every live data source at the start of the build, so
# that every page — the generated pages baked right now by the make_*.R
# scripts AND the top-level pages that render up to half an hour later, each
# in its own R session — bakes the SAME data. Before this step existed, the
# shared cache expired mid-build: the Senators table could show fundraising
# bars that matched nothing on the senator pages, because the two were
# computed from different fetches (and a flaky gateway answer could hand a
# late page zero contributions altogether).
#
# How: wipe the per-build caches, then fetch each source once, with retries.
# read_intake_json() and read_sheet_safe() (scripts/shared.R) keep successful
# results on disk for hours, so every later R session in this build reads
# these snapshot files instead of the network.
#
# If a source stays unreachable the build STOPS on purpose: a failed build
# leaves the last good site deployed, which beats publishing pages that are
# each missing a different slice of data.
#
# Rendering offline (plane, outage)? Keep the snapshot you already have:
#   LEGSIM_OFFLINE=1 quarto render

source("scripts/shared.R")

if (Sys.getenv("LEGSIM_OFFLINE") == "1") {
  message("LEGSIM_OFFLINE=1 — keeping the existing data snapshot")
} else {
  unlink(INTAKE_CACHE_DIR, recursive = TRUE)
  unlink(SHEET_CACHE_DIR,  recursive = TRUE)

  failed <- character(0)

  # The intake gateway, one fetch per live view (read_intake_json retries
  # internally before giving up)
  for (view in INTAKE_LIVE) {
    if (is.null(read_intake_json(view))) failed <- c(failed, paste("intake view:", view))
  }

  # The five vote tabs. A successful read always has columns (the header
  # row), even before any votes exist — zero columns means the fetch failed.
  for (code in names(VOTE_SHEET_URLS)) {
    ok <- FALSE
    for (attempt in 1:3) {
      if (ncol(read_sheet_safe(VOTE_SHEET_URLS[[code]])) > 0) { ok <- TRUE; break }
      if (attempt < 3) Sys.sleep(2 * attempt)
    }
    if (!ok) failed <- c(failed, paste("vote sheet:", code))
  }

  if (length(failed) > 0) {
    stop("Could not snapshot these data sources — stopping the build rather than ",
         "publishing pages with missing data:\n  ",
         paste(failed, collapse = "\n  "),
         "\n(Rendering offline on purpose? LEGSIM_OFFLINE=1 quarto render)")
  }
  message("Data snapshot complete: ", length(INTAKE_LIVE), " intake views + ",
          length(VOTE_SHEET_URLS), " vote sheets")
}
