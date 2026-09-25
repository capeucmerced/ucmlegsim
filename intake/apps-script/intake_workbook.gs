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
    if (tab === 'Assignments')  handleAssignmentsSubmit(e);
    if (tab === 'Referrals')    handleReferralsSubmit(e);
    if (tab === 'Role Check')   handleRoleCheckSubmit(e);  // role_check.gs
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

  // Wire posts are rendered client-side (js/feed.js polls the gateway),
  // so the most frequent submission type never needs a site rebuild.
  // Role checks change nothing on the site at all.
  if (tab !== 'Posts' && tab !== 'Role Check') requestSiteRebuild();
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

/** The Drive-upload URL in a submission row, found by VALUE — uploads are
 *  the only cells holding Drive links — never by column title, so the
 *  upload question's wording can't break filing (it once did: a form
 *  built with "Attach letter PDF here" silently filed nothing). */
function uploadUrlFrom(row) {
  var keys = Object.keys(row);
  for (var i = 0; i < keys.length; i++) {
    var v = String(row[keys[i]] || '');
    if (/https:\/\/(drive|docs)\.google\.com\/\S+/.test(v) && /[-\w]{25,}/.test(v)) return v;
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

// The bill's flags, printed as a real bill's digest line ("Vote: 2/3rds.
// Appropriations/fiscal: yes. Local program: no."). 2/3rds is rare, so
// it's a checkbox: unchecked means a majority-vote bill. The site treats
// any flag containing "Appropriation" as fiscal (routes it through the
// Appropriations/Rules Committee), so keep that word in the label.
var FLAG_CHOICES = ['Appropriations/fiscal', 'Local program', '2/3rds vote'];

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
  // Throw, don't return: thrown errors email the admin (see the router),
  // and silent skips cost a beta afternoon once.
  if (!who || !who['Org Code']) {
    throw new Error('Letter from ' + row['Email Address'] + ', which has no ' +
                    'Org Code on the Roster. Add the code (letters and ' +
                    'spending are attributed by it), then have them resubmit.');
  }

  var org = String(who['Org Code']).toUpperCase();
  var billNo = billNumberFrom(valueByPrefix(row, 'Which bill'));
  var token = POSITION_TOKENS[valueByPrefix(row, 'Position')] || 'support';

  var url = uploadUrlFrom(row);
  var idMatch = url.match(/[-\w]{25,}/);
  if (!idMatch) {
    throw new Error('No Drive upload link found in the Letters row — ' +
                    'is the file-upload question missing from the form?');
  }

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
  fileProfile(rowAsObject(e));
}

/**
 * Admin: files every profile in the Profiles tab that never got filed —
 * the case of a student who uploaded BEFORE their Roster row was hooked
 * up (the submit handler can't file those; it emails you instead). Run
 * it after hooking up stragglers. Rerunning is harmless: an already-
 * filed profile is left exactly where it is. Only each account's newest
 * upload is considered. Accounts still lacking a Role are listed in the
 * log for you to hook up first.
 */
function refileProfiles() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Profiles');
  var vals = sheet.getDataRange().getValues();
  var head = vals[0];
  var cMail = colStartingWith(head, 'Email Address');

  var newest = {};                       // email -> its latest row object
  for (var i = 1; i < vals.length; i++) {
    var email = String(vals[i][cMail] || '').toLowerCase().trim();
    if (!email) continue;
    var row = {};
    for (var j = 0; j < head.length; j++) row[head[j]] = vals[i][j];
    row._sheetRow = i + 1;
    newest[email] = row;
  }

  var filed = 0, skipped = [];
  Object.keys(newest).forEach(function (email) {
    try { fileProfile(newest[email]); filed++; }
    catch (err) { skipped.push('row ' + newest[email]._sheetRow + ': ' + err.message); }
  });
  Logger.log('Checked ' + filed + ' profile(s).' +
             (skipped.length ? '\nNOT filed:\n' + skipped.join('\n') : ''));
  if (filed > 0) requestSiteRebuild();
}

/** Files one Profiles-tab row (a {header: value} object) under its
 *  canonical name. Idempotent: a row whose upload is already filed is
 *  left untouched, so refileProfiles() can sweep every row safely. */
function fileProfile(row) {
  var who = rosterLookup(row['Email Address']);
  if (!who) {
    throw new Error('Profile from ' + row['Email Address'] + ', which is not ' +
                    'on the Roster yet. Add the row (or fix the email), then ' +
                    'have them resubmit.');
  }
  var target = profileTarget(who);
  if (!target) {
    throw new Error('Profile from ' + row['Email Address'] + ', whose Roster ' +
                    'row has no Role assigned yet. Set the Role, then have ' +
                    'them resubmit.');
  }

  var url = uploadUrlFrom(row);
  var idMatch = url.match(/[-\w]{25,}/);
  if (!idMatch) {
    throw new Error('No Drive upload link found in the Profiles row — ' +
                    'is the file-upload question missing from the form?');
  }

  // role_profiles/<role>/ under the LegSim Files folder
  var parent = filesSubfolder('role_profiles');
  var it = parent.getFoldersByName(target.sub);
  var folder = it.hasNext() ? it.next() : parent.createFolder(target.sub);

  var file = DriveApp.getFileById(idMatch[0]);

  // A resubmission replaces the old profile outright — same canonical
  // name, previous file trashed. (No paper trail needed, unlike letters.)
  // The upload itself is never trashed: on a re-run it IS the filed
  // file, and trashing it would delete a good profile.
  var old = folder.getFilesByName(target.name);
  while (old.hasNext()) {
    var prev = old.next();
    if (prev.getId() !== file.getId()) prev.setTrashed(true);
  }

  file.setName(target.name);
  file.moveTo(folder);
  // Profiles are public pages on the site; link-view sharing lets the
  // build download them by file id
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
}

// --- Assignments & referrals -------------------------------------------------

/** A submitted assignments row becomes the current committee state: the
 *  site reads it through ?view=assignments, and the vote workbook's
 *  senator columns are rewritten to match. Any senator may submit
 *  (leadership is DEFINED by this form, so it can't gate on leadership);
 *  the receipt email keeps it visible and reversible. */
function handleAssignmentsSubmit(e) {
  var row = rowAsObject(e);
  var who = rosterLookup(row['Email Address']);
  if (!who || String(who['Role']).toLowerCase().trim() !== 'senator') {
    throw new Error('Assignments submitted from ' + row['Email Address'] +
                    ', which is not a senator account. Nothing was applied.');
  }

  var notes = syncVoteSheetColumns();

  GmailApp.sendEmail(
    row['Email Address'],
    'Committee assignments updated',
    'Your assignments submission is now the current state of the Senate: ' +
    'the site updates on its next build, and the vote sheets\' senator ' +
    'columns were rewritten to match.\n\n' + notes +
    '\nSubmitting the form again replaces this state entirely.'
  );
}

// Committee code -> how its tab is recognized in the votes workbook
// (tab named with the code OR the committee's full name, any case).
var VOTE_TAB_WORDS = {
  lgl:   ['lgl', 'local government'],
  anr:   ['anr', 'agriculture'],
  blh:   ['blh', 'business'],
  app:   ['app', 'appropriations'],
  floor: ['floor']
};

/** Rewrite each vote tab's senator header columns (everything after the
 *  'Result' column) from the NEWEST assignments row — floor gets every
 *  senator. Headers are "First Last", exactly what the site's vote
 *  parser expects. Data rows are never touched; if a tab already holds
 *  votes, the returned notes say to eyeball the alignment. */
function syncVoteSheetColumns() {
  var votesId = deployProp('VOTES_WORKBOOK_ID', '');
  if (!votesId) return 'NOTE: VOTES_WORKBOOK_ID is not set in Script ' +
                       'Properties — vote-sheet columns were NOT updated.\n';
  var votesSs = SpreadsheetApp.openById(votesId);

  // District -> "First Last" from the Roster
  var roster = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Roster')
    .getDataRange().getValues();
  var rHead = roster[0];
  var nameByDistrict = {};
  var allDistricts = [];
  for (var i = 1; i < roster.length; i++) {
    if (String(roster[i][rHead.indexOf('Role')]).toLowerCase().trim() !== 'senator') continue;
    var d = parseInt(roster[i][rHead.indexOf('District')], 10);
    if (isNaN(d)) continue;
    nameByDistrict[d] = (roster[i][rHead.indexOf('First Name')] + ' ' +
                         roster[i][rHead.indexOf('Last Name')]).trim();
    allDistricts.push(d);
  }
  allDistricts.sort(function (a, b) { return a - b; });

  // Newest assignments row -> member districts per committee
  var districtsFor = { floor: allDistricts };
  var aSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Assignments');
  if (aSheet && aSheet.getLastRow() > 1) {
    var aRows = aSheet.getDataRange().getValues();
    var aHead = aRows[0];
    var last = aRows[aRows.length - 1];
    ['LGL', 'ANR', 'BLH', 'APP'].forEach(function (up) {
      var seen = {};
      var ds = [];
      [' Chair', ' Vice Chair', ' Members'].forEach(function (suffix) {
        var c = headIndexByPrefix(aHead, up + suffix);
        if (c < 0) return;
        var re = /SD-(\d+)/g, s = String(last[c] || ''), m;
        while ((m = re.exec(s)) !== null) {
          var d = parseInt(m[1], 10);
          if (!seen[d]) { seen[d] = true; ds.push(d); }
        }
      });
      ds.sort(function (a, b) { return a - b; });
      districtsFor[up.toLowerCase()] = ds;
    });
  }

  var notes = '';
  votesSs.getSheets().forEach(function (sheet) {
    var norm = sheet.getName().toLowerCase();
    var code = null;
    Object.keys(VOTE_TAB_WORDS).forEach(function (k) {
      if (code) return;
      for (var w = 0; w < VOTE_TAB_WORDS[k].length; w++) {
        if (norm.indexOf(VOTE_TAB_WORDS[k][w]) !== -1) { code = k; return; }
      }
    });
    if (!code || !(code in districtsFor)) return;

    var head = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    var resultCol = head.indexOf('Result') + 1;
    if (resultCol === 0) {
      notes += 'SKIPPED tab "' + sheet.getName() + '": no Result column found.\n';
      return;
    }

    var names = districtsFor[code].map(function (d) {
      return nameByDistrict[d] || ('SD-' + d + ' (not on roster)');
    });

    // Clear old senator headers, write the new set. Data rows untouched.
    if (sheet.getLastColumn() > resultCol) {
      sheet.getRange(1, resultCol + 1, 1, sheet.getLastColumn() - resultCol).clearContent();
    }
    if (names.length > 0) {
      sheet.getRange(1, resultCol + 1, 1, names.length).setValues([names])
        .setFontWeight('bold');
    }
    notes += 'Tab "' + sheet.getName() + '": ' + names.length + ' senator column(s) written.' +
             (sheet.getLastRow() > 1
               ? ' CAUTION: this tab already holds vote rows — check they still align.'
               : '') + '\n';
  });
  return notes || 'NOTE: no vote tabs matched — check the votes workbook tab names.\n';
}

/** Referrals need no filing — the gateway reads the rows directly. The
 *  handler just validates and reports, so typos surface immediately. */
function handleReferralsSubmit(e) {
  var row = rowAsObject(e);
  var who = rosterLookup(row['Email Address']);
  if (!who || String(who['Role']).toLowerCase().trim() !== 'senator') {
    throw new Error('Referrals submitted from ' + row['Email Address'] +
                    ', which is not a senator account.');
  }

  var bills = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Bills');
  var known = {};
  if (bills && bills.getLastRow() > 1) {
    var bRows = bills.getDataRange().getValues();
    var bHead = bRows[0];
    var cSb = bHead.indexOf('SB Number');
    var cStat = bHead.indexOf('Status');
    for (var i = 1; i < bRows.length; i++) {
      if (cStat >= 0 && bRows[i][cStat]) continue;
      var n = parseInt(bRows[i][cSb], 10);
      if (!isNaN(n)) known[n] = true;
    }
  }

  var report = '';
  ['LGL', 'ANR', 'BLH'].forEach(function (up) {
    var cell = String(valueByPrefix(row, up + ' referrals') || '');
    var good = [], bad = [];
    cell.split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var no = billNumberFrom(line);
      if (no !== null && known[no]) good.push('SB-' + no);
      else bad.push(line.trim());
    });
    if (good.length || bad.length) {
      report += up + ': ' + (good.join(', ') || '(none)') +
                (bad.length ? '  —  NOT RECOGNIZED: ' + bad.join(' | ') : '') + '\n';
    }
  });

  GmailApp.sendEmail(
    row['Email Address'],
    'Bill referrals recorded',
    'Referrals as parsed (the site updates on its next build):\n\n' +
    (report || '(no bills listed)\n') +
    '\nLines marked NOT RECOGNIZED matched no filed bill — resubmit the ' +
    'form with those corrected; later referrals of the same bill simply ' +
    'override earlier ones.'
  );
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
