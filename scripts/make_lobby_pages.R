# scripts/make_lobby_pages.R

library(tidyverse)
library(readxl)

lobby_csv <- "files/csvs/lobbyist_list.csv"
bills_csv <- "files/csvs/bill_list.csv"
letters_dir  <- "files/pdfs/lobbyist_letters"
cont_dir <- "files/csvs/lobbyist_contributions"
b_pages_dir  <- "bills-pages"
l_pages_dir <- "lobby-pages"

if (!dir.exists(l_pages_dir)) dir.create(l_pages_dir, recursive = TRUE)

lobbys <- read.csv(lobby_csv) 

bills <- read.csv(bills_csv)
bills <- bills %>%
  mutate(author_name = toupper(gsub(" ", "_", Last.Name)),
        bill_measure = paste0("SB", bill_number),
        bill_link = paste(author_name, bill_measure, sep = "_"))

senators <- read.csv("files/csvs/senator_list.csv")
senators <- senators %>%
  mutate(Recipient = paste0(Last.Name, ", ", First.Name)) %>%
  select(District, Recipient, Party)

  
# Creating pages

for (i in seq_len(nrow(lobbys))) {
  lobby <- lobbys$Lobby[i]
  lobby_code <- toupper(lobbys$Code[i])

  # Find all position letters for this lobby group
  if (dir.exists(letters_dir)) {
    all_letters <- list.files(letters_dir, pattern = paste0("^", lobby_code, "_SB[0-9]+_(support|oppose)\\.pdf$"), full.names = FALSE)
    
    if (length(all_letters) > 0) {
      # Parse the filenames to extract bill numbers and positions
      letters_df <- data.frame(
        filename = all_letters,
        stringsAsFactors = FALSE
      ) %>%
        mutate(
          bill_number = as.integer(gsub(paste0("^", lobby_code, "_SB([0-9]+)_(support|oppose)\\.pdf$"), "\\1", filename)),
          position = gsub(paste0("^", lobby_code, "_SB([0-9]+)_(support|oppose)\\.pdf$"), "\\2", filename),
          bill_measure = paste0("SB-", bill_number),
          Position = tools::toTitleCase(position),
          letter_path = file.path("..", letters_dir, filename),
          Letter_Link = paste0("[View Letter](", letter_path, ")")
        ) %>%
        left_join(bills %>% select(bill_number, bill_link), by = "bill_number") %>%
        mutate(
          Bill_Link = if_else(
            !is.na(bill_link),
            paste0("[", bill_measure, "](../", b_pages_dir, "/", bill_link, ")"),
            bill_measure
          )
        ) %>%
        select(Bill_Link, Position, Letter_Link) 
      
      # Convert to dput format for embedding in qmd
      letters_code <- capture.output(dput(letters_df)) %>%
        paste(collapse = "\n")
      
    } else {
      letters_code <- "data.frame()"
    }
  } else {
    letters_code <- "data.frame()"
  }

  # Spending data

  if (dir.exists(cont_dir)) {
    spending_file <- list.files(cont_dir, pattern = paste0("^", lobby_code, "_.*\\.csv$"), full.names = TRUE, ignore.case = TRUE)
    
    if (length(spending_file) > 0) {
      spending_df <- read.csv(spending_file[1])
      
      # Extract total and remove total row
      total_row <- spending_df %>% filter(grepl("^total$", Date, ignore.case = TRUE))
      total_cont <- if(nrow(total_row) > 0) as.numeric(gsub("\\$|,", "", total_row$Contribution[1])) else NA
      
      spending_df <- spending_df %>%
        filter(!grepl("^total$", Date, ignore.case = TRUE)) %>%
        mutate(Date = lubridate::mdy(Date),
              Senator.District = as.integer(gsub("\\$", "", Senator.District)),
              Contribution = as.numeric(gsub("\\$|,", "", Contribution))) %>%
        arrange(desc(Date)) %>%
        left_join(senators, by = c("Senator.District" = "District")) %>%
        mutate(Recipient = ifelse(is.na(Recipient), Senator.Name, Recipient)) %>%
        select(Date, Recipient, Senator.District, Party, Contribution) 
      
      d_support <- spending_df %>%
        filter(Party == "D") %>%
        summarize(Contributions = sum(Contribution)) %>%
        pull(Contributions)
      d_support_share <- d_support/total_cont

      r_support <- spending_df %>%
        filter(Party == "R") %>%
        summarize(Contributions = sum(Contribution)) %>%
        pull(Contributions)
      r_support_share <- r_support/total_cont

      top_recipients <- spending_df %>%
        group_by(Recipient) %>%
        summarize(contributions = sum(Contribution)) %>%
        arrange(desc(contributions)) %>%
        mutate(rank = dense_rank(desc(contributions))) %>%
        filter(rank <= 3)

      # Convert to dput format
      spending_code <- capture.output(dput(spending_df)) %>% paste(collapse = "\n")
      total_cont_code <- deparse(total_cont)
      d_support_code <- deparse(d_support)
      d_support_share_code <- deparse(d_support_share)
      r_support_code <- deparse(r_support)
      r_support_share_code <- deparse(r_support_share)
      top_recipients_code <- capture.output(dput(top_recipients)) %>% paste(collapse = "\n")
      
    } else {
      spending_code <- "data.frame()"
      total_cont_code <- "NA"
      d_support_code <- "0"
      d_support_share_code <- "0"
      r_support_code <- "0"
      r_support_share_code <- "0"
      top_recipients_code <- "data.frame()"
    }
  } else {
    spending_code <- "data.frame()"
    total_cont_code <- "NA"
    d_support_code <- "0"
    d_support_share_code <- "0"
    r_support_code <- "0"
    r_support_share_code <- "0"
    top_recipients_code <- "data.frame()"
  }
  
  # Create the QMD file path
  lobby_qmd_path <- file.path(l_pages_dir, paste0(lobby_code, ".qmd"))
  
  # Build YAML header
  yaml <- c(
    "---",
    sprintf('title: "%s"', lobby),
    "format:",
    "  html:",
    "    page-layout: full",
    "---"
  )
  
  # Build body
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
    "",
    "library(dplyr)",
    "library(gt)",
    "",
    paste("letters_df <-", letters_code),
    "",
    "if(nrow(letters_df) > 0) {",
    "  letters_df %>%",
    "    gt() %>%",
    "    cols_label(",
    "      Bill_Link = 'Bill',",
    "      Position = 'Position',",
    "      Letter_Link = 'Letter'",
    "    ) %>%",
    "    fmt_markdown(columns = c(Bill_Link, Letter_Link)) %>%",
    "    tab_header(",
    "      title = 'Position Letters'",
    "    ) %>%",
    "    opt_interactive(",
    "      use_sorting = TRUE,",
    "      use_search = TRUE,",
    "    ) %>%",
    "    opt_row_striping()",
    "} else {",
    "  cat('No position letters available for this lobby group.')",
    "}",
    "",
    "```",
    "",
    "## Spending",
    "",
    "```{r}",
    "#| echo: false",
    "#| warning: false",
    "#| message: false",
    "",
    "library(dplyr)",
    "library(gt)",
    "library(scales)",
    "library(bslib)",
    "library(bsicons)",
    "library(fontawesome)",
    "",
    paste("spending_df <-", spending_code),
    paste("total_cont <-", total_cont_code),
    paste("d_support <-", d_support_code),
    paste("d_support_share <-", d_support_share_code),
    paste("r_support <-", r_support_code),
    paste("r_support_share <-", r_support_share_code),
    paste("top_recipients <-", top_recipients_code),
    "",
    "if(nrow(spending_df) > 0) {",
    "  ",
    "  # Value boxes for contributions",
    "  layout_column_wrap(",
    "    width = 1/3,",
    "    value_box(",
    "      title = 'Total Contributions',",
    "      value = dollar(total_cont),",
    "      showcase = bs_icon('currency-dollar'),",
    "      theme = 'purple'",
    "    ),",
    "    value_box(",
    "      title = 'Democratic Contributions',",
    "      value = dollar(d_support),",
    "      showcase = fa('democrat', fill = 'blue', height = '3em'),",
    "      theme = 'primary',",
    "      paste0(percent(d_support_share, accuracy = 0.1), ' of total')",
    "    ),",
    "    value_box(",
    "      title = 'Republican Contributions',",
    "      value = dollar(r_support),",
    "      showcase = fa('republican', fill = '#c40000ff', height = '3em'),",
    "      theme = 'danger',",
    "      paste0(percent(r_support_share, accuracy = 0.1), ' of total')",
    "    )",
    "  )",
    "}",
    "```",
    "",
    "```{r}",
    "#| echo: false",
    "#| warning: false",
    "",
    "if(nrow(spending_df) > 0 && nrow(top_recipients) > 0) {",
    "  ",
    "  # Prepare top recipients with ties",
    "  rank_1 <- top_recipients %>% filter(rank == 1)",
    "  rank_2 <- top_recipients %>% filter(rank == 2)",
    "  rank_3 <- top_recipients %>% filter(rank == 3)",
    "  ",
    "  # Determine how many boxes we need",
    "  num_boxes <- sum(nrow(rank_1) > 0, nrow(rank_2) > 0, nrow(rank_3) > 0)",
    "  box_width <- if(num_boxes > 0) 1/num_boxes else 1/3",
    "  ",
    "  # Build box arguments conditionally",
    "  box_args <- list(width = box_width)",
    "  ",
    "  if(nrow(rank_1) > 0) {",
    "    recipients_1 <- paste(rank_1$Recipient, collapse = ', ')",
    "    box_args <- c(box_args, list(",
    "      value_box(",
    "        title = 'Top Recipient',",
    "        value = recipients_1,",
    "        showcase = bs_icon('trophy-fill'),",
    "        theme = 'success',",
    "        dollar(rank_1$contributions[1])",
    "      )",
    "    ))",
    "  }",
    "  ",
    "  if(nrow(rank_2) > 0) {",
    "    recipients_2 <- paste(rank_2$Recipient, collapse = ', ')",
    "    box_args <- c(box_args, list(",
    "      value_box(",
    "        title = '2nd Recipient',",
    "        value = recipients_2,",
    "        showcase = bs_icon('award-fill'),",
    "        theme = 'secondary',",
    "        dollar(rank_2$contributions[1])",
    "      )",
    "    ))",
    "  }",
    "  ",
    "  if(nrow(rank_3) > 0) {",
    "    recipients_3 <- paste(rank_3$Recipient, collapse = ', ')",
    "    box_args <- c(box_args, list(",
    "      value_box(",
    "        title = '3rd Recipient',",
    "        value = recipients_3,",
    "        showcase = bs_icon('award-fill'),",
    "        theme = 'secondary',",
    "        dollar(rank_3$contributions[1])",
    "      )",
    "    ))",
    "  }",
    "  ",
    "  do.call(layout_column_wrap, box_args)",
    "}",
    "```",
    "",
    "```{r}",
    "#| echo: false",
    "#| warning: false",
    "",
    "if(nrow(spending_df) > 0) {",
    "  ",
    "  # Create linked table",
    "  spending_df %>%",
    "    mutate(",
    "      Recipient_Link = ifelse(",
    "        !is.na(Senator.District),",
    "        paste0('[', Recipient, '](../senator-pages/district_', Senator.District, '.html)'),",
    "        Recipient",
    "      )",
    "    ) %>%",
    "    select(Date, Recipient_Link, Contribution, Party) %>%",
    "    gt() %>%",
    "    cols_label(",
    "      Date = 'Date',",
    "      Recipient_Link = 'Recipient',",
    "      Contribution = 'Amount',",
    "      Party = 'Party'",
    "    ) %>%",
    "    fmt_markdown(columns = Recipient_Link) %>%",
    "    fmt_currency(columns = Contribution, currency = 'USD') %>%",
    "    fmt_date(columns = Date, date_style = 'yMd') %>%",
    "    tab_header(title = 'All Contributions') %>%",
    "    opt_interactive(",
    "      use_sorting = TRUE,",
    "      use_search = TRUE",
    "    ) %>%",
    "    opt_row_striping()",
    "",
    "} else {",
    "  cat('No spending data available for this lobby group.')",
    "}",
    "",
    "```",
    "",
    ":::",
    ""
  )
  
  # Write the file
  cat(paste(c(yaml, body), collapse = "\n"), file = lobby_qmd_path)
}
