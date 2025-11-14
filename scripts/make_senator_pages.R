# scripts/make_senator_pages.R

library(tidyverse)
library(purrr)

senator_csv <- "files/csvs/senator_list.csv"
bills_csv <- "files/csvs/bill_list.csv"
senator_dir  <- "files/pdfs/role_profiles/senators"
s_pages_dir  <- "senator-pages"
b_pages_dir  <- "bills-pages"

if (!dir.exists(s_pages_dir)) dir.create(s_pages_dir, recursive = TRUE)

# Read your spreadsheet
senators <- read.csv(senator_csv) 
senators <- senators %>%
  mutate(name_join = tolower(paste0(First.Name, Last.Name)),
          name_join = gsub(" ", "", name_join))

senators$Name <- paste(senators$First.Name, senators$Last.Name, sep = " ")
senators$Name <- trimws(gsub("\\s+", " ", senators$Name)) 
senators <- senators %>%
  mutate(Last.Name_Link = gsub(" ", "_", Last.Name))

s_names <- senators$Name
s_names_period <- make.names(s_names) #R doesn't like spaces, creates issues with names with hyphens, easiest to just work with "." instead of spaces and switch back for display later
d_sen <- senators$Name[senators$Party == "D"]
d_sen_period <- make.names(d_sen)
r_sen <- senators$Name[senators$Party == "R"]
r_sen_period <- make.names(r_sen)
          

bills <- read.csv(bills_csv)
bills <- bills %>%
  mutate(name = paste(First.Name, Last.Name, sep = " "),
        name_join = tolower(paste0(First.Name, Last.Name)),
        name_join = gsub(" ", "", name_join),
        bill_measure = paste0("SB-", bill_number))

senator_bills <- senators %>%
  left_join(bills, by = "name_join") %>%
  group_by(name_join) %>%
  mutate(bill_count = row_number()) %>%
  select(name_join, bill_count, bill_number, bill_measure) %>%
  pivot_wider(
    names_from = bill_count, 
    values_from = bill_number,
    names_prefix = "bill_"
  ) %>%
  mutate(across(bill_1:bill_2, ~ as.integer(.)))

#votes data


clean_votes <- function(votes_df){

  dat <- votes_df

  if(nrow(dat) == 0) {
    return(NULL)
  }

  dat <- dat %>%
    mutate(across(any_of(s_names_period), as.character)) %>%
    filter(!is.na(Bill) & Bill != "") %>%
    rowwise() %>%
    mutate(
      Bill = as.character(Bill),
      yes = sum(c_across(any_of(s_names_period)) == "Aye", na.rm = TRUE),
      no = sum(c_across(any_of(s_names_period)) == "No", na.rm = TRUE),
      abstain = sum(c_across(any_of(s_names_period)) == "Abstain", na.rm = TRUE),
      absent = sum(c_across(any_of(s_names_period)) == "" | is.na(c_across(any_of(s_names_period)))),
      Vote = paste(yes, no, abstain, absent, sep = "-"),
      d_yes = sum(c_across(any_of(d_sen_period)) == "Aye", na.rm = TRUE),
      d_no = sum(c_across(any_of(d_sen_period)) == "No", na.rm = TRUE),
      d_abstain = sum(c_across(any_of(d_sen_period)) == "Abstain", na.rm = TRUE),
      d_absent = sum(c_across(any_of(d_sen_period)) == "" | is.na(c_across(any_of(d_sen_period)))),
      Dem_vote = paste(d_yes, d_no, d_abstain, d_absent, sep = "-"),
      Dem_percent = round((d_yes/(d_yes + d_no + d_abstain + d_absent)*100)),
      Dem_percent_sign = ifelse(is.nan(Dem_percent), "NA", paste0(Dem_percent, "%")),
      Dem_choice = case_when(
        pmax(d_yes, d_no, d_abstain) == d_yes ~ "Aye",
        pmax(d_yes, d_no, d_abstain) == d_no ~ "No",
        pmax(d_yes, d_no, d_abstain) == d_abstain ~ "Abstain"
      ),
      r_yes = sum(c_across(any_of(r_sen_period)) == "Aye", na.rm = TRUE),
      r_no = sum(c_across(any_of(r_sen_period)) == "No", na.rm = TRUE),
      r_abstain = sum(c_across(any_of(r_sen_period)) == "Abstain", na.rm = TRUE),
      r_absent = sum(c_across(any_of(r_sen_period)) == "" | is.na(c_across(any_of(r_sen_period)))),
      Rep_vote = paste(r_yes, r_no, r_abstain, r_absent, sep = "-"),
      Rep_percent = round((r_yes/(r_yes + r_no + r_abstain + r_absent)*100)),
      Rep_percent_sign = ifelse(is.nan(Rep_percent), "NA", paste0(Rep_percent, "%")),
      Rep_choice = case_when(
        pmax(r_yes, r_no, r_abstain) == r_yes ~ "Aye",
        pmax(r_yes, r_no, r_abstain) == r_no ~ "No",
        pmax(r_yes, r_no, r_abstain) == r_abstain ~ "Abstain"
      )
          ) %>%
    ungroup()
}

votes_lgl <- read.csv("https://docs.google.com/spreadsheets/d/e/2PACX-1vSWsxVKMyPrvGZW1VFD0_DdTsMmH-dzITniXvWusbbG34FPwj7uWsIDB6B_6Sb5AdK94SbZ75eL0vTT/pub?gid=0&single=true&output=csv") 
votes_anr <- read.csv("https://docs.google.com/spreadsheets/d/e/2PACX-1vSWsxVKMyPrvGZW1VFD0_DdTsMmH-dzITniXvWusbbG34FPwj7uWsIDB6B_6Sb5AdK94SbZ75eL0vTT/pub?gid=1077921709&single=true&output=csv") 
votes_blh <- read.csv("https://docs.google.com/spreadsheets/d/e/2PACX-1vSWsxVKMyPrvGZW1VFD0_DdTsMmH-dzITniXvWusbbG34FPwj7uWsIDB6B_6Sb5AdK94SbZ75eL0vTT/pub?gid=1971997036&single=true&output=csv") 
votes_app <- read.csv("https://docs.google.com/spreadsheets/d/e/2PACX-1vSWsxVKMyPrvGZW1VFD0_DdTsMmH-dzITniXvWusbbG34FPwj7uWsIDB6B_6Sb5AdK94SbZ75eL0vTT/pub?gid=578574660&single=true&output=csv") 
votes_floor <- read.csv("https://docs.google.com/spreadsheets/d/e/2PACX-1vSWsxVKMyPrvGZW1VFD0_DdTsMmH-dzITniXvWusbbG34FPwj7uWsIDB6B_6Sb5AdK94SbZ75eL0vTT/pub?gid=192921423&single=true&output=csv")

votes <- list(lgl = votes_lgl,
              anr = votes_anr,
              blh = votes_blh,
              app = votes_app,
              floor = votes_floor)
votes <- lapply(votes, clean_votes)
  

# Loop to create pages

for (i in seq_len(nrow(senators))) {
  senator_id <- as.character(senators$District[i])
  name_link <- tolower(senators$Last.Name_Link[i])
  name   <- paste(senators$First.Name[i], senators$Last.Name[i], sep = " ")
  senate_name <- as.character(senators$name_join[i])
  senator_bills_sub <- senator_bills %>%
    filter(name_join %in% senate_name)
  bill1 <- as.character(senator_bills_sub$bill_1[1])
  bill_measure1 <- if(!is.na(bill1)) paste0("SB-", bill1) else NULL
  bill2 <- as.character(senator_bills_sub$bill_2[2])
  bill_measure2 <- if(!is.na(bill2)) paste0("SB-", bill2) else NULL

  name <- senators$Name[i]
  name_period <- s_names_period[i]
  party <- senators$Party[i]

  party_choice <- ifelse(party == "D", "Dem_choice", "Rep_choice")
  party_percent <- ifelse(party == "D", "Dem_percent", "Rep_percent")

  committee_assignments <- senators$Committee[i]
  chair_assignment <- senators$Chair[i]
  vice_chair_assignment <- senators$Vice.Chair[i]

  committee_fullnames <- c(
    "lgl" = "Local Government and Labor",
    "anr" = "Agriculture and Natural Resources", 
    "blh" = "Business, Law, and Health",
    "app" = "Appropriations"
  )

  if(!is.na(committee_assignments) && committee_assignments != "") {
    committee_codes <- trimws(unlist(strsplit(committee_assignments, ";")))
    committee_names <- committee_fullnames[committee_codes]
    
    # Add Chair or Vice Chair prefix if applicable
    for(j in seq_along(committee_codes)) {
      if(!is.na(chair_assignment) && committee_codes[j] == chair_assignment) {
        committee_names[j] <- paste("Chair, ", committee_names[j])
      } else if(!is.na(vice_chair_assignment) && committee_codes[j] == vice_chair_assignment) {
        committee_names[j] <- paste("Vice Chair, ", committee_names[j])
      }
    }
    
    committees_yaml <- paste(committee_names, collapse = "  \n")
  } else {
    committees_yaml <- "No Committee Assignments"
  }

  
  s_qmd_path <- file.path(s_pages_dir, paste0("district_", senator_id, ".qmd"))
  pdf_rel  <- file.path("..", senator_dir, paste0(name_link, "_", senator_id, "_profile.pdf"))
  
  b_qmd_path1 <- file.path("..", b_pages_dir, paste0(toupper(name_link), "_SB", bill1, ".qmd"))
  b_qmd_path2 <- file.path("..", b_pages_dir, paste0(toupper(name_link), "_SB", bill2, ".qmd"))
  
  bill_links <- c()
  if(!is.na(bill1)) {
    bill_links <- c(bill_links, sprintf("[%s](%s)", bill_measure1, b_qmd_path1))
  }
  if(!is.na(bill2)) {
    bill_links <- c(bill_links, sprintf("[%s](%s)", bill_measure2, b_qmd_path2))
  }
  
  bill_links_yaml <- paste(bill_links, collapse = "  \n")

  # This is all for finding the votes the senator has taken
    committees <- sapply(votes, function(df) name_period %in% names(df))
    committees <- which(committees)

    votes_including_s <- votes[committees]
    # Keep only non-empty dataframes
    votes_including_s <- Filter(function(df) {
      !is.null(df) && is.data.frame(df) && nrow(df) > 0
    }, votes_including_s)
  

    # Check if we have any dataframes left
    if(length(votes_including_s) > 0) {
      # Debug: check what columns each dataframe has
      cat("Columns in each dataframe:\n")
      lapply(names(votes_including_s), function(name) {
        cat(name, ":", paste(colnames(votes_including_s[[name]]), collapse = ", "), "\n")
      })
  
      votes_including_s <- bind_rows(votes_including_s, .id = "Committee")
  
    # Check if Date column exists after binding
    if("Date" %in% colnames(votes_including_s) & name_period %in% colnames(votes_including_s)) {
      votes_including_s <- votes_including_s %>%
        select(Date, Bill, Committee, all_of(name_period), all_of(party_choice)) %>%  
        mutate(
          party_aligned = case_when(
            .data[[party_choice]] == .data[[name_period]]  ~ "Yes",
            is.na(.data[[name_period]]) | .data[[name_period]] == "" ~ "Absent",
            TRUE ~ "No"
          ),
          Committee = case_when(
            Committee == "lgl" ~ "Local Government and Labor",
            Committee == "anr" ~ "Agriculture and Natural Resources", 
            Committee == "blh" ~ "Business, Law, and Health",
            Committee == "app" ~ "Appropriations",
            Committee == "floor" ~ "Floor",
            TRUE ~ ""
          )) %>%
        select(Date, Bill, Committee, all_of(name_period), party_choice, party_aligned) %>%  
        rename("Vote" = all_of(name_period),  # And here
          "Party Vote" = party_choice,
          "Voted With Party?" = party_aligned)  %>%
        arrange(desc(Date))
    } else {
      # Handle case where columns don't exist
      votes_including_s <- data.frame()
    }
    } else {
      # No dataframes with data for this senator
      votes_including_s <- data.frame()
    }


  
    vote_table <- if(nrow(votes_including_s) > 0) {
      votes_str <- capture.output(dput(votes_including_s))
      paste(votes_str, collapse = "\n") 
    } else {
      "data.frame()"
    }

  
  # Constructing the actual pages

  yaml <- c(
    "---",
    sprintf('title: "%s"', name),
    "format:",
    "  html:",
    "    page-layout: full",  # Uses full page width
    "---"
  )
  body <- c(
    "",
    "::: {.panel-tabset}",
    "",
    "## Details",
    "",
    sprintf("**District:** %s", senator_id),
    "",
    sprintf("**Committee Assignments:** %s", committees_yaml),
    "",
    "**Bills:**",
    "",
    bill_links_yaml,
    "",
    sprintf("[View Profile](%s)", pdf_rel),
    "",
    sprintf('<iframe src="%s" width="100%%" height="600px"></iframe>', pdf_rel),
    "",
    "## Vote History",
"",
"```{r}",
"#| echo: false",
"#| warning: false",
"#| message: false",
"",
"library(tidyverse)",
"library(gt)",
"library(plotly)",
"library(bslib)",
"library(bsicons)",
"",
paste("votes_including_s <-", vote_table),
"",
"# Calculate metrics",
"if(nrow(votes_including_s) > 0) {",
"  total_votes <- nrow(votes_including_s[votes_including_s$Vote %in% c('Aye', 'No', 'Abstain'),])",
"  possible_votes <- nrow(votes_including_s)",
"  aligned_votes <- sum(votes_including_s$`Voted With Party?` == 'Yes', na.rm = TRUE)",
"  against_votes <- sum(votes_including_s$`Voted With Party?` == 'No', na.rm = TRUE)",
"  absent_votes <- sum(votes_including_s$`Voted With Party?` == 'Absent', na.rm = TRUE)",
"  alignment_pct <- round((aligned_votes / total_votes) * 100, 1)",
"  against_pct <- round((against_votes / total_votes) * 100, 1)",
"}",
"```",
"",
"```{r}",
"#| echo: false",
"",
"if(nrow(votes_including_s) > 0) {",
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
"      paste0(round((absent_votes/possible_votes)*100, 1), '% of votes missed')",
"    )",
"  )",
"}",
"```",
"",
"```{r}",
"#| echo: false",
"#| warning: false",
"",
"library(plotly)",
"",
"if(nrow(votes_including_s) > 0) {",
"  vote_counts <- data.frame(",
"    Vote_Type = c('Aye', 'No', 'Abstain', 'Absent'),",
"    Count = c(",
"      sum(votes_including_s$Vote == 'Aye', na.rm = TRUE),",
"      sum(votes_including_s$Vote == 'No', na.rm = TRUE),",
"      sum(votes_including_s$Vote == 'Abstain', na.rm = TRUE),",
"      absent_votes",
"    )",
"  )",
"  ",
"  vote_counts$Vote_Type <- factor(vote_counts$Vote_Type, levels = c('Aye', 'No', 'Abstain', 'Absent'))",
"  ",
"  plot_ly(vote_counts, ",
"    x = ~Vote_Type, ",
"    y = ~Count, ",
"    type = 'bar',",
"    marker = list(color = c('#17345a', '#17345a', '#17345a', '#17345a')),",
"    text = ~Count,",
"    textposition = 'outside',",
"    hovertemplate = paste('<b>%{x}</b><br>',",
"                          'Count: %{y}<br>',",
"                          '<extra></extra>')",
"  ) %>%",
"  layout(",
"    title = list(text = '<b>Vote Distribution</b>', x = 0.5),",
"    xaxis = list(title = ''),",
"    yaxis = list(title = 'Number of Votes'),",
"    plot_bgcolor = 'rgba(0,0,0,0)',",
"    paper_bgcolor = 'rgba(0,0,0,0)',",
"    margin = list(t = 50, b = 40, l = 60, r = 40)",
"  ) %>%",
"  config(displayModeBar = FALSE)",
"}",
"```",
"",
"```{r}",
"#| echo: false",
"#| warning: false",
"",
"if(nrow(votes_including_s) > 0) {",
"  votes_including_s %>%",
"    gt() %>%",
"    tab_header(",
"      title = 'Vote History',",
"      subtitle = 'Sorted by newer to older votes'",
"    ) %>%",
"    opt_interactive(",
"      use_sorting = TRUE,",
"      use_highlight = TRUE",
"    ) %>%",
"    opt_row_striping()",
"} else {",
"  cat('No vote history available for this senator.')",
"}",
"```",
"",
":::",
""
  )
  
  cat(paste(c(yaml, body), collapse = "\n"), file = s_qmd_path)
}
