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
               'Org Code', 'Outlet', 'Handle', 'Chair', 'Vice Chair',
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

/** Create a form, point its responses at the intake workbook, rename the
 *  new response tab to `tabName`, and ask for email collection. */
function newForm(title, tabName) {
  var form = FormApp.create(title);
  form.setDescription('UC Merced California Legislative Simulation');
  try { form.setCollectEmail(true); } catch (e) {
    Logger.log(title + ': setCollectEmail not available — set it by hand.');
  }
  form.setDestination(FormApp.DestinationType.SPREADSHEET, INTAKE_SPREADSHEET_ID);

  // The destination call just created a "Form Responses N" tab — rename it
  SpreadsheetApp.flush();
  var ss = SpreadsheetApp.openById(INTAKE_SPREADSHEET_ID);
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getFormUrl() === form.getPublishedUrl() ||
        sheets[i].getFormUrl() === form.getEditUrl()) {
      sheets[i].setName(tabName);
      break;
    }
  }

  return form;
}

function finish(form, tabName) {
  return { tab: tabName, editUrl: form.getEditUrl(), shareUrl: form.getPublishedUrl() };
}

// --- The forms, per intake/schemas.md ---------------------------------------

function buildRegistration() {
  var f = newForm('Register for the Simulation', 'Registration');
  f.addTextItem().setTitle('Your full name').setRequired(true);
  f.addParagraphTextItem()
    .setTitle('A short bio for your role profile (2–4 sentences)').setRequired(true);
  f.addParagraphTextItem()
    .setTitle("Your role's top priorities this session (2–3 items)").setRequired(true);
  return finish(f, 'Registration');
}

function buildBills() {
  var f = newForm('File a Bill', 'Bills');

  // Branch: amendments answer one extra question
  var amendSection = f.addPageBreakItem().setTitle('Amendment details');
  var mainSection  = f.addPageBreakItem().setTitle('The bill');
  amendSection.setGoToPage(mainSection);

  var filing = f.addMultipleChoiceItem()
    .setTitle('Is this a new bill or an amended version of one of your bills?')
    .setRequired(true);
  filing.setChoices([
    filing.createChoice('New bill', mainSection),
    filing.createChoice('Amendment', amendSection)
  ]);
  // Order on the form: filing question sits before the sections
  f.moveItem(filing.getIndex(), 0);

  // Amendment section content
  var amending = f.addListItem()
    .setTitle('Which of your bills does this amend?')
    .setChoiceValues([PLACEHOLDER]);
  f.moveItem(amending.getIndex(), f.getItems().length - 1);
  // (items added after page breaks land in document order; verify in the
  // editor that "Which of your bills..." sits inside Amendment details)

  f.addTextItem()
    .setTitle('Short subject for the bill tables (2–4 words, e.g. Affordable Housing)')
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
  var tab = 'Agenda ' + body;
  var f = newForm('File an Agenda — ' + body, tab);
  f.addDateItem().setTitle('Meeting Date').setRequired(true);
  f.addTextItem().setTitle('Meeting time (blank = usual class time)');
  f.addTextItem().setTitle('Room (blank = usual room)');
  for (var i = 1; i <= 10; i++) {
    f.addListItem().setTitle('Item ' + i).setChoiceValues([PLACEHOLDER]);
  }
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
  var f = newForm('Refer Bills to Committee', 'Referrals');
  ['LGL', 'ANR', 'BLH'].forEach(function (c) {
    f.addSectionHeaderItem().setTitle(c + ' referrals');
    for (var i = 1; i <= 8; i++) {
      f.addListItem().setTitle(c + ' Referral ' + i).setChoiceValues([PLACEHOLDER]);
    }
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
