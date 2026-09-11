/**
 * intake_workbook.gs — the "LegSim Intake" workbook's submission router.
 *
 * Install: in the intake workbook's Apps Script project, then add ONE
 * installable trigger: Triggers → Add Trigger → onAnyFormSubmit →
 * From spreadsheet → On form submit. Every intake form files into this
 * workbook, so this single trigger covers all of them.
 *
 * What happens on each submission:
 *   - Letters: uploaded PDF is renamed to convention and filed; older
 *     letters by the same org on the same bill are marked superseded.
 *   - Registration: the student is added to the Roster (role left blank
 *     for the admin to fill in).
 *   - Bills / Agendas: handled in bills_assembler.gs / agenda_builder.gs.
 *   - Everything: the site rebuild is requested (rebuild.gs).
 */

// Deploy settings live in SCRIPT PROPERTIES (Project Settings -> Script
// properties), so re-pasting code never wipes them. Set once per account:
//   FILES_FOLDER_ID       id of the "LegSim Files" Drive folder
//   BILL_TEMPLATE_DOC_ID  id of the bill-template Doc
//   SB_NUMBER_FLOOR       e.g. 75 during the beta, 0 at launch
// (GITHUB_TOKEN already lives there.) The constants below are only
// fallbacks for anything not yet set as a property.
function deployProp(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return v !== null && v !== '' ? v : fallback;
}

var FILES_FOLDER_ID = 'PUT-FOLDER-ID-HERE-AT-DEPLOY';

function onAnyFormSubmit(e) {
  var tab = e.range.getSheet().getName();

  try {
    if (tab === 'Letters')      handleLetterSubmit(e);
    if (tab === 'Registration') handleRegistrationSubmit(e);
    if (tab === 'Bills')        handleBillSubmit(e);      // bills_assembler.gs
    if (tab === 'Profiles')     handleProfileSubmit(e);
    if (tab.indexOf('Agenda') === 0) handleAgendaSubmit(e); // agenda_builder.gs
  } catch (err) {
    // A handler problem should never stop the rebuild (the row is still
    // in the sheet) — but it must not be silent either: the Executions
    // list shows these runs as successful, so email the admin.
    console.error('Handler error on tab ' + tab + ': ' + err);
    try {
      MailApp.sendEmail(
        Session.getEffectiveUser().getEmail(),
        'LegSim intake: handler error on ' + tab,
        'A form submission on tab "' + tab + '" was recorded in the sheet, ' +
        'but its follow-up processing failed:\n\n' + err + '\n\n' +
        'Fix the cause, then resubmit or re-process the row.'
      );
    } catch (mailErr) {}
  }

  requestSiteRebuild();
}

// --- Small shared helpers ---------------------------------------------------

/** Row values as {header: value} for the just-submitted row. */
function rowAsObject(e) {
  var sheet = e.range.getSheet();
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var values = sheet.getRange(e.range.getRow(), 1, 1, sheet.getLastColumn()).getValues()[0];
  var out = {};
  for (var i = 0; i < headers.length; i++) out[headers[i]] = values[i];
  return out;
}

/** Row value looked up by question-title PREFIX — response columns carry
 *  the full question text ("Which bill?"), so exact keys don't match. */
function valueByPrefix(row, prefix) {
  var keys = Object.keys(row);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase().indexOf(prefix.toLowerCase()) === 0) return row[keys[i]];
  }
  return '';
}

/** Same idea for a header ARRAY: column index by title prefix, or -1. */
function headIndexByPrefix(head, prefix) {
  for (var i = 0; i < head.length; i++) {
    if (String(head[i]).toLowerCase().indexOf(prefix.toLowerCase()) === 0) return i;
  }
  return -1;
}

/** Roster row for an email (lowercased match), or null. */
function rosterLookup(email) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Roster');
  var rows = sheet.getDataRange().getValues();
  var head = rows[0];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][head.indexOf('Email')]).toLowerCase().trim() ===
        String(email).toLowerCase().trim()) {
      var out = {};
      for (var j = 0; j < head.length; j++) out[head[j]] = rows[i][j];
      return out;
    }
  }
  return null;
}

/** Get (or create) a subfolder of the LegSim Files folder by name. */
function filesSubfolder(name) {
  var parent = DriveApp.getFolderById(deployProp('FILES_FOLDER_ID', FILES_FOLDER_ID));
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** "SB-12" -> 12 */
function billNumberFrom(text) {
  var m = String(text).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// --- Amendment "Updated …" override choices ---------------------------------
// A blank override means "keep the current value", so clearing a field
// needs an explicit choice. These strings appear in the form (built by
// forms_builder.gs) and are parsed by bills_assembler.gs + newsfeed_api.gs.
var NO_FLAGS_CHOICE  = 'None — clear every flag';
var NO_TOPIC2_CHOICE = 'None — remove the secondary topic';

/** A flags checkbox answer with the "clear" choice removed ("" if that
 *  was the only thing checked — i.e. the student cleared the flags). */
function withoutNoFlags(answer) {
  return String(answer || '').split(/,\s*/)
    .filter(function (x) { return x && x !== NO_FLAGS_CHOICE; })
    .join(', ');
}

// --- Letters ----------------------------------------------------------------

// Position label -> filename token (the site reads these from filenames)
var POSITION_TOKENS = {
  'Support': 'support',
  'Support If Amended': 'sia',
  'Oppose Unless Amended': 'oua',
  'Oppose': 'oppose'
};

function handleLetterSubmit(e) {
  var row = rowAsObject(e);
  var who = rosterLookup(row['Email Address']);
  if (!who || !who['Org Code']) {
    console.error('Letter from unregistered or non-lobbyist account: ' + row['Email Address']);
    return;
  }

  var org = String(who['Org Code']).toUpperCase();
  var billNo = billNumberFrom(valueByPrefix(row, 'Which bill'));
  var token = POSITION_TOKENS[valueByPrefix(row, 'Position')] || 'support';

  // The upload question stores a Drive URL like .../d/FILE_ID/view or ?id=FILE_ID
  var url = String(valueByPrefix(row, 'Letter PDF'));
  var idMatch = url.match(/[-\w]{25,}/);
  if (!idMatch) { console.error('Could not parse Drive file ID from: ' + url); return; }

  var file = DriveApp.getFileById(idMatch[0]);
  file.setName(org + '_SB' + billNo + '_' + token + '.pdf');
  file.moveTo(filesSubfolder('lobbyist_letters'));
  // Letters are public documents on the site; link-view sharing lets the
  // build download them by file id
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // Mark older letters by this org on this bill as superseded (paper trail:
  // the rows stay; the site shows the current one and lists priors).
  var sheet = e.range.getSheet();
  var head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var cStatus = headIndexByPrefix(head, 'Status');
  var cMail   = headIndexByPrefix(head, 'Email Address');
  var cBill   = headIndexByPrefix(head, 'Which bill');
  if (cStatus < 0 || cMail < 0 || cBill < 0) return;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var r = i + 1;
    if (r === e.range.getRow()) continue;
    var sameOrg = rosterLookup(data[i][cMail]);
    if (sameOrg && String(sameOrg['Org Code']).toUpperCase() === org &&
        billNumberFrom(data[i][cBill]) === billNo &&
        !data[i][cStatus]) {
      sheet.getRange(r, cStatus + 1).setValue('superseded');
    }
  }
}

// --- Role profiles -----------------------------------------------------------

/** Which role_profiles/ subfolder a person's profile goes in, and its
 *  canonical file name. The site reads these exact paths (see
 *  SEN_PROFILE_DIR / LOBBY_PROFILE_DIR in scripts/shared.R), so change
 *  them in both places or not at all. */
function profileTarget(who) {
  var role = String(who['Role'] || '').toLowerCase().trim();
  if (role === 'senator') {
    // name part mirrors name_link in scripts/shared.R: lowercase, spaces -> _
    return { sub: 'senators',
             name: String(who['Last Name']).toLowerCase().replace(/ /g, '_') +
                   '_' + who['District'] + '_profile.pdf' };
  }
  if (role === 'lobbyist') {
    return { sub: 'lobbyists',
             name: String(who['Org Code']).toUpperCase() + '_profile.pdf' };
  }
  if (role === 'journalist') {
    var base = String(who['Outlet'] || who['Last Name'] || '').toLowerCase()
      .trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return base ? { sub: 'journalists', name: base + '_profile.pdf' } : null;
  }
  return null;
}

function handleProfileSubmit(e) {
  var row = rowAsObject(e);
  var who = rosterLookup(row['Email Address']);
  if (!who) {
    console.error('Profile from unregistered account: ' + row['Email Address']);
    return;
  }
  var target = profileTarget(who);
  if (!target) {
    console.error('Profile from account with no role assigned yet: ' + row['Email Address']);
    return;
  }

  // The upload question stores a Drive URL like .../d/FILE_ID/view or ?id=FILE_ID
  var url = String(valueByPrefix(row, 'Profile PDF'));
  var idMatch = url.match(/[-\w]{25,}/);
  if (!idMatch) { console.error('Could not parse Drive file ID from: ' + url); return; }

  // role_profiles/<role>/ under the LegSim Files folder
  var parent = filesSubfolder('role_profiles');
  var it = parent.getFoldersByName(target.sub);
  var folder = it.hasNext() ? it.next() : parent.createFolder(target.sub);

  // A resubmission replaces the old profile outright — same canonical
  // name, previous file trashed. (No paper trail needed, unlike letters.)
  var old = folder.getFilesByName(target.name);
  while (old.hasNext()) old.next().setTrashed(true);

  var file = DriveApp.getFileById(idMatch[0]);
  file.setName(target.name);
  file.moveTo(folder);
  // Profiles are public pages on the site; link-view sharing lets the
  // build download them by file id
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
}

// --- Registration -----------------------------------------------------------

function handleRegistrationSubmit(e) {
  var row = rowAsObject(e);
  var email = String(row['Email Address']).toLowerCase().trim();
  if (rosterLookup(email)) return; // already registered

  var roster = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Roster');
  var head = roster.getRange(1, 1, 1, roster.getLastColumn()).getValues()[0];
  var newRow = new Array(head.length).fill('');
  newRow[head.indexOf('Email')] = email;
  // Their real name goes in First/Last for now; the admin assigns the role
  // (and for senators, replaces the name with the senator persona's name).
  var parts = String(valueByPrefix(row, 'Your full name')).trim().split(/\s+/);
  newRow[head.indexOf('First Name')] = parts.slice(0, -1).join(' ') || parts[0];
  newRow[head.indexOf('Last Name')]  = parts.length > 1 ? parts[parts.length - 1] : '';
  roster.appendRow(newRow);
}
