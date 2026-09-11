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
 *   - Two forms need their file-upload question added by hand (Add
 *     question -> File upload; PDF only; 10 MB) — scripts cannot create
 *     upload questions. Titles must be exact:
 *       "File a Position Letter"    -> "Letter PDF"
 *       "Upload Your Role Profile"  -> "Profile PDF"
 *   - Response tabs land in the intake workbook already renamed; drag
 *     them into a sensible order if you like.
 *
 * Dropdowns that must track live data are seeded with a placeholder.
 * The two BILL dropdowns (amend picker, letters picker) then maintain
 * themselves: every newly numbered bill is appended by the submit
 * handler (addBillToFormDropdowns in bills_assembler.gs, via the
 * FORM_ID_* Script Properties that finish() stores). Roster-driven
 * dropdowns (recipients, leadership) still get a sync run / quick paste
 * once the roster exists.
 */

var INTAKE_SPREADSHEET_ID = 'PUT-INTAKE-WORKBOOK-ID-HERE';

// All form FILES are prefixed "LegSim — " and collected in this Drive
// folder (created if missing). Respondents still see the clean titles.
var FORMS_FOLDER_NAME = 'LegSim Forms';

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
  results.push(buildProfiles());
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
               'Party', 'Org Code', 'Outlet', 'Chair', 'Vice Chair',
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
function formsFolder() {
  // The forms folder lives NEXT TO the LegSim Files folder — i.e. inside
  // the same per-year container folder (see "Yearly turnover" in
  // intake/README.md). Scoping the by-name lookup to that parent is what
  // lets every year have its own "LegSim Forms" without collisions.
  var parent;
  try {
    var parents = DriveApp.getFolderById(
      deployProp('FILES_FOLDER_ID', FILES_FOLDER_ID)).getParents();
    parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  } catch (e) {
    parent = DriveApp.getRootFolder();  // FILES_FOLDER_ID not set yet
  }
  var it = parent.getFoldersByName(FORMS_FOLDER_NAME);
  return it.hasNext() ? it.next() : parent.createFolder(FORMS_FOLDER_NAME);
}

function newForm(title, tabName) {
  // File name carries the LegSim prefix (Drive organization); the form's
  // displayed title stays clean for respondents.
  var form = FormApp.create('LegSim — ' + title);
  form.setTitle(title);
  DriveApp.getFileById(form.getId()).moveTo(formsFolder());
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
    'Upload Your Role Profile': 'Profiles',
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
  // Remember the form's id so submit handlers can push live choices into
  // its dropdowns later (each new SB lands in the amend + letter lists;
  // see addBillToFormDropdowns in bills_assembler.gs).
  PropertiesService.getScriptProperties().setProperty('FORM_ID_' + tabName, form.getId());
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
  //   Page 1  the fork
  //   Page 2  "Amendment details" (amendments only): which bill, plus an
  //           optional "Updated …" override for every metadata field.
  //           Blank = keep the current value (the scripts pull it forward
  //           from the bill's earlier rows), so an amendment can change
  //           anything but can't wipe anything by accident.
  //   Page 3  "New bill details" (new bills only): the full metadata.
  //   Page 4  "File the text" (both): which draft doc, confirmation.
  var filing = f.addMultipleChoiceItem()
    .setTitle('Is this a new bill or an amended version of one of your bills?')
    .setRequired(true);

  var amendSection = f.addPageBreakItem().setTitle('Amendment details');
  amendSection.setHelpText(
    'Submitting replaces the bill\'s text on the site right away (the old ' +
    'version is kept under Previous Text). Only fill in what changes — ' +
    'anything left blank keeps its current value.');
  f.addListItem()
    .setTitle('Which of your bills does this amend?')
    .setChoiceValues([PLACEHOLDER])
    .setRequired(true);
  f.addTextItem()
    .setTitle('Updated short subject')
    .setHelpText('Leave blank to keep the current subject.');
  f.addParagraphTextItem()
    .setTitle('Updated digest')
    .setHelpText('Leave blank to keep the current digest.');
  f.addCheckboxItem()
    .setTitle('Updated flags')
    .setHelpText('Leave blank to keep the current flags. Otherwise check the ' +
                 'COMPLETE new set — what you check replaces all current flags. ' +
                 'Example: a bill flagged Appropriation + Local program that ' +
                 'should lose Local program means checking only Appropriation. ' +
                 'To end up with no flags at all, check the None choice.')
    .setChoiceValues(['Appropriation', 'Fiscal committee', 'Local program',
                      'Urgency', NO_FLAGS_CHOICE]);
  f.addListItem()
    .setTitle('Updated primary topic')
    .setHelpText('Leave blank to keep the current topic.')
    .setChoiceValues(POLICY_TOPICS);
  f.addListItem()
    .setTitle('Updated secondary topic')
    .setHelpText('Leave blank to keep it; the None choice removes it.')
    .setChoiceValues([NO_TOPIC2_CHOICE].concat(POLICY_TOPICS));

  var newSection = f.addPageBreakItem().setTitle('New bill details');
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

  var fileSection = f.addPageBreakItem().setTitle('File the text');
  f.addMultipleChoiceItem()
    .setTitle('Which of your two draft docs holds this bill’s text?')
    .setChoiceValues(['Draft A', 'Draft B'])
    .setRequired(true);
  f.addCheckboxItem()
    .setTitle('Body Ready')
    .setChoiceValues(['I confirm the legal text in my bill doc is final'])
    .setRequired(true);

  // Wire navigation now that every section exists. The fork picks the
  // page; a goto on a page break fires when the PREVIOUS page finishes,
  // so the goto that skips "New bill details" for amendments lives on
  // newSection (reached linearly only from the amendment page).
  filing.setChoices([
    filing.createChoice('New bill', newSection),
    filing.createChoice('Amendment', amendSection)
  ]);
  newSection.setGoToPage(fileSection);

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

function buildProfiles() {
  // One form for every role: the verified email finds the person on the
  // Roster, which decides the folder and canonical file name (senators ->
  // their senator page, lobbyists -> their org page, journalists -> held
  // for when journalist pages exist). Resubmitting replaces the old one.
  var f = newForm('Upload Your Role Profile', 'Profiles');
  f.addSectionHeaderItem()
    .setTitle('REMINDER FOR THE ADMIN BUILDING THIS FORM')
    .setHelpText('Add a File upload question here by hand, titled exactly ' +
                 '"Profile PDF" (PDF only, 10 MB) — then delete this reminder.');
  return finish(f, 'Profiles');
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
  // Paragraph boxes (not one-line short answers) so writers can actually
  // see and edit what they're composing; the character caps still apply.
  var f = newForm('Post to the Wire', 'Posts');
  var head = f.addParagraphTextItem().setTitle('Headline (max 100 characters)').setRequired(true);
  head.setValidation(FormApp.createParagraphTextValidation()
    .requireTextLengthLessThanOrEqualTo(100).build());
  var dek = f.addParagraphTextItem().setTitle('Description line (max 250 characters)').setRequired(true);
  dek.setValidation(FormApp.createParagraphTextValidation()
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
