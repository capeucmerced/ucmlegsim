/**
 * forms_builder.gs — creates ALL the intake forms, programmatically.
 *
 * Because form creation is code, the whole set can be rebuilt identically
 * on any account in minutes: run it on a personal account for beta
 * testing, run it again on the department account for the real deploy,
 * rerun it any year a form gets mangled. The layouts come from
 * intake/schemas.md — if that file changes, change this one to match.
 *
 * HOW TO RUN (one time per account):
 *   1. Create the "LegSim Intake" spreadsheet first (empty is fine) and
 *      paste its ID into INTAKE_SPREADSHEET_ID below.
 *   2. In script.google.com, make a project, paste this file, run
 *      buildAllForms(), and grant permissions.
 *   3. Read the execution log: it prints every form's edit + share URL,
 *      and the short MANUAL FINISH list (things Google's API can't do).
 *
 * MANUAL FINISH after every run:
 *   - Each form: Settings -> Responses -> Collect email addresses ->
 *     "Verified" (the script requests email collection, but the Verified
 *     mode may need the toggle confirmed by hand).
 *   - "File a Position Letter": add the file-upload question by hand
 *     (Add question -> File upload; PDF only; 10 MB), titled exactly
 *     "Letter PDF". Scripts cannot create upload questions.
 *   - Response tabs land in the intake workbook already renamed; drag
 *     them into a sensible order if you like.
 *
 * Dropdowns that must track live data (senators, bills) are seeded with a
 * placeholder — the dropdown-sync script (or a quick paste) fills them
 * once the roster and bills exist.
 */

var INTAKE_SPREADSHEET_ID = 'PUT-INTAKE-WORKBOOK-ID-HERE';

var PLACEHOLDER = '(choices sync once data exists)';

// The policy topic list for bills. Update here when the instructor
// finalizes the tag list.
var POLICY_TOPICS = [
  'Housing', 'Crime & Public Safety', 'Environment', 'Education',
  'Health Care', 'Labor & Employment', 'Agriculture', 'Budget & Taxes',
  'Transportation', 'Technology', 'Local Government', 'Civil Rights'
];

function buildAllForms() {
  var results = [];

  results.push(buildRegistration());
  results.push(buildBills());
  results.push(buildLetters());
  results.push(buildSpending());
  ['LGL', 'ANR', 'BLH', 'APP', 'Floor'].forEach(function (body) {
    results.push(buildAgenda(body));
  });
  results.push(buildAssignments());
  results.push(buildReferrals());
  results.push(buildPosts());
  results.push(buildEditions());

  renameResponseTabs();

  Logger.log('==== ALL FORMS CREATED ====');
  results.forEach(function (r) {
    Logger.log(r.tab + '\n  edit:  ' + r.editUrl + '\n  share: ' + r.shareUrl);
  });
  Logger.log('==== NOW DO THE MANUAL FINISH LIST (see file header) ====');
}

/**
 * Run this once after buildAllForms(): adds the two hand-maintained tabs
 * (Roster, Budgets) with their header rows, per intake/schemas.md.
 */
function addAdminTabs() {
  var ss = SpreadsheetApp.openById(INTAKE_SPREADSHEET_ID);

  var tabs = {
    'Roster': ['Email', 'Role', 'District', 'First Name', 'Last Name',
               'Org Code', 'Outlet', 'Chair', 'Vice Chair',
               'Leadership', 'Bill Doc 1', 'Bill Doc 2'],
    'Budgets': ['Org Code', 'Budget', 'Spent', 'Remaining']
  };

  Object.keys(tabs).forEach(function (name) {
    var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    sheet.getRange(1, 1, 1, tabs[name].length).setValues([tabs[name]])
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
  });

  Logger.log('Roster and Budgets tabs are ready.');
}

// --- Shared plumbing --------------------------------------------------------

/** Create a form, point its responses at the intake workbook, and ask for
 *  email collection. The response tab is renamed IMMEDIATELY: right after
 *  linking, exactly one tab still matches "Form Responses N" (all earlier
 *  ones are already renamed), so no fragile URL/title matching is needed. */
function newForm(title, tabName) {
  var form = FormApp.create(title);
  form.setDescription('UC Merced California Legislative Simulation');
  try { form.setCollectEmail(true); } catch (e) {
    Logger.log(title + ': setCollectEmail not available — set it by hand.');
  }
  form.setDestination(FormApp.DestinationType.SPREADSHEET, INTAKE_SPREADSHEET_ID);

  SpreadsheetApp.flush();
  var sheets = SpreadsheetApp.openById(INTAKE_SPREADSHEET_ID).getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (/^Form Responses/i.test(sheets[i].getName())) {
      sheets[i].setName(tabName);
      break;
    }
  }
  return form;
}

/**
 * Rename the "Form Responses N" tabs to their schema names by looking up
 * each linked form's title. Safe to rerun anytime. (Called automatically
 * at the end of buildAllForms; run it alone if tabs ever lose their names.)
 */
function renameResponseTabs() {
  var titleToTab = {
    'Register for the Simulation': 'Registration',
    'File a Bill': 'Bills',
    'File a Position Letter': 'Letters',
    'Report a Contribution': 'Spending',
    'Committee Assignments & Leadership': 'Assignments',
    'Refer Bills to Committee': 'Referrals',
    'Post to the Wire': 'Posts',
    'Publish a Newspaper Edition': 'Editions'
  };
  ['LGL', 'ANR', 'BLH', 'APP', 'Floor'].forEach(function (body) {
    titleToTab['File an Agenda — ' + body] = 'Agenda ' + body;
  });

  var ss = SpreadsheetApp.openById(INTAKE_SPREADSHEET_ID);
  ss.getSheets().forEach(function (sheet) {
    var url = sheet.getFormUrl();
    if (!url) return;
    var title = FormApp.openByUrl(url).getTitle();
    if (titleToTab[title] && sheet.getName() !== titleToTab[title]) {
      sheet.setName(titleToTab[title]);
      Logger.log('Renamed to: ' + titleToTab[title]);
    }
  });
  Logger.log('Tab renaming done.');
}

function finish(form, tabName) {
  return { tab: tabName, editUrl: form.getEditUrl(), shareUrl: form.getPublishedUrl() };
}

// --- The forms, per intake/schemas.md ---------------------------------------

function buildRegistration() {
  // Registration is purely the account -> identity binding: the verified
  // email does the real work; the name is for the admin's eyes.
  var f = newForm('Register for the Simulation', 'Registration');
  f.addTextItem().setTitle('Your full name').setRequired(true);
  return finish(f, 'Registration');
}

function buildBills() {
  var f = newForm('File a Bill', 'Bills');

  // Items are added in their FINAL on-form order — no repositioning.
  // Page 1: the fork. Page 2 ("Amendment details"): the amending
  // dropdown, amendments only. Page 3 ("The bill"): everything else.
  var filing = f.addMultipleChoiceItem()
    .setTitle('Is this a new bill or an amended version of one of your bills?')
    .setRequired(true);

  var amendSection = f.addPageBreakItem().setTitle('Amendment details');
  f.addListItem()
    .setTitle('Which of your bills does this amend?')
    .setChoiceValues([PLACEHOLDER]);

  var mainSection = f.addPageBreakItem().setTitle('The bill');

  // Now that both sections exist, wire the fork: "New bill" skips the
  // amendment page entirely.
  filing.setChoices([
    filing.createChoice('New bill', mainSection),
    filing.createChoice('Amendment', amendSection)
  ]);

  f.addTextItem()
    .setTitle('Short subject for the bill tables — a few concise words (e.g. Clean Air Near Schools Act)')
    .setRequired(true);
  f.addParagraphTextItem()
    .setTitle('Digest: one paragraph summarizing what the bill does')
    .setRequired(true);
  f.addCheckboxItem()
    .setTitle('Flags')
    .setChoiceValues(['Appropriation', 'Fiscal committee', 'Local program', 'Urgency']);
  f.addListItem()
    .setTitle('Primary Topic').setChoiceValues(POLICY_TOPICS).setRequired(true);
  f.addListItem()
    .setTitle('Secondary Topic').setChoiceValues(POLICY_TOPICS);
  f.addCheckboxItem()
    .setTitle('Body Ready')
    .setChoiceValues(['I confirm the legal text in my bill doc is final'])
    .setRequired(true);
  return finish(f, 'Bills');
}

function buildLetters() {
  var f = newForm('File a Position Letter', 'Letters');
  f.addListItem().setTitle('Which bill?')
    .setChoiceValues([PLACEHOLDER]).setRequired(true);
  f.addMultipleChoiceItem().setTitle('Position')
    .setChoiceValues(['Support', 'Support If Amended', 'Oppose Unless Amended', 'Oppose'])
    .setRequired(true);
  f.addSectionHeaderItem()
    .setTitle('REMINDER FOR THE ADMIN BUILDING THIS FORM')
    .setHelpText('Add a File upload question here by hand, titled exactly ' +
                 '"Letter PDF" (PDF only, 10 MB) — then delete this reminder.');
  return finish(f, 'Letters');
}

function buildSpending() {
  var f = newForm('Report a Contribution', 'Spending');
  f.addListItem().setTitle('Who received the contribution?')
    .setChoiceValues([PLACEHOLDER]).setRequired(true);
  var amt = f.addTextItem().setTitle('Amount (dollars)').setRequired(true);
  amt.setValidation(FormApp.createTextValidation()
    .requireNumberBetween(100, 10000)
    .setHelpText('A number between 100 and 10000, digits only.')
    .build());
  return finish(f, 'Spending');
}

function buildAgenda(body) {
  // Meeting date + ONE paragraph box: bills one per line, in file order.
  // Handles any agenda length (up to 30) without thirty dropdowns; typos
  // surface immediately in the receipt email's rendered agenda, and a
  // resubmission is just a revision. No time/room questions — chairs
  // control those day-of; the template prints the standing defaults.
  var tab = 'Agenda ' + body;
  var f = newForm('File an Agenda — ' + body, tab);
  f.addDateItem().setTitle('Meeting Date').setRequired(true);
  f.addParagraphTextItem()
    .setTitle('Bills in file order — one per line')
    .setHelpText('One bill per line, e.g. SB-12. Up to 30 items; the order you list is the file order.')
    .setRequired(true);
  return finish(f, tab);
}

function buildAssignments() {
  var f = newForm('Committee Assignments & Leadership', 'Assignments');
  ['LGL', 'ANR', 'BLH', 'APP'].forEach(function (c) {
    f.addSectionHeaderItem().setTitle(c);
    f.addListItem().setTitle(c + ' Chair').setChoiceValues([PLACEHOLDER]);
    f.addListItem().setTitle(c + ' Vice Chair').setChoiceValues([PLACEHOLDER]);
    f.addCheckboxItem().setTitle(c + ' Members').setChoiceValues([PLACEHOLDER]);
  });
  f.addSectionHeaderItem().setTitle('Leadership');
  f.addListItem().setTitle('Pro Tem').setChoiceValues([PLACEHOLDER]);
  f.addListItem().setTitle('Majority Leader').setChoiceValues([PLACEHOLDER]);
  f.addListItem().setTitle('Minority Leader').setChoiceValues([PLACEHOLDER]);
  return finish(f, 'Assignments');
}

function buildReferrals() {
  // Leadership refers everything in one sitting, so: one paragraph box
  // per policy committee, bills one per line, no count limit.
  var f = newForm('Refer Bills to Committee', 'Referrals');
  ['LGL', 'ANR', 'BLH'].forEach(function (c) {
    f.addParagraphTextItem()
      .setTitle(c + ' referrals — one bill per line')
      .setHelpText('One bill per line, e.g. SB-12. Leave empty if none.');
  });
  return finish(f, 'Referrals');
}

function buildPosts() {
  var f = newForm('Post to the Wire', 'Posts');
  var head = f.addTextItem().setTitle('Headline (max 100 characters)').setRequired(true);
  head.setValidation(FormApp.createTextValidation()
    .requireTextLengthLessThanOrEqualTo(100).build());
  var dek = f.addTextItem().setTitle('Description line (max 250 characters)').setRequired(true);
  dek.setValidation(FormApp.createTextValidation()
    .requireTextLengthLessThanOrEqualTo(250).build());
  var link = f.addTextItem().setTitle('Link to the full story (optional)');
  link.setValidation(FormApp.createTextValidation().requireTextIsUrl()
    .setHelpText('A full link starting with http:// or https://').build());
  return finish(f, 'Posts');
}

function buildEditions() {
  var f = newForm('Publish a Newspaper Edition', 'Editions');
  f.addTextItem().setTitle('Edition name/number').setRequired(true);
  var link = f.addTextItem().setTitle('Link to the edition').setRequired(true);
  link.setValidation(FormApp.createTextValidation().requireTextIsUrl().build());
  return finish(f, 'Editions');
}
