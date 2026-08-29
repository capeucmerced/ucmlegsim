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

// Drive folder that holds the filed PDFs (set at deploy: the ID of the
// "LegSim Files" folder; subfolders are created/found by name).
var FILES_FOLDER_ID = 'PUT-FOLDER-ID-HERE-AT-DEPLOY';

function onAnyFormSubmit(e) {
  var tab = e.range.getSheet().getName();

  try {
    if (tab === 'Letters')      handleLetterSubmit(e);
    if (tab === 'Registration') handleRegistrationSubmit(e);
    if (tab === 'Bills')        handleBillSubmit(e);      // bills_assembler.gs
    if (tab.indexOf('Agenda') === 0) handleAgendaSubmit(e); // agenda_builder.gs
  } catch (err) {
    // A handler problem should never stop the rebuild (the row is still
    // in the sheet; the admin can fix and re-run by editing it).
    console.error('Handler error on tab ' + tab + ': ' + err);
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
  var parent = DriveApp.getFolderById(FILES_FOLDER_ID);
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** "SB-12" -> 12 */
function billNumberFrom(text) {
  var m = String(text).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
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
  var billNo = billNumberFrom(row['Bill']);
  var token = POSITION_TOKENS[row['Position']] || 'support';

  // The upload question stores a Drive URL like .../d/FILE_ID/view or ?id=FILE_ID
  var url = String(row['Letter PDF']);
  var idMatch = url.match(/[-\w]{25,}/);
  if (!idMatch) { console.error('Could not parse Drive file ID from: ' + url); return; }

  var file = DriveApp.getFileById(idMatch[0]);
  file.setName(org + '_SB' + billNo + '_' + token + '.pdf');
  file.moveTo(filesSubfolder('lobbyist_letters'));

  // Mark older letters by this org on this bill as superseded (paper trail:
  // the rows stay; the site shows the current one and lists priors).
  var sheet = e.range.getSheet();
  var head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var statusCol = head.indexOf('Status') + 1;
  if (statusCol === 0) return;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var r = i + 1;
    if (r === e.range.getRow()) continue;
    var sameOrg = rosterLookup(data[i][head.indexOf('Email Address')]);
    if (sameOrg && String(sameOrg['Org Code']).toUpperCase() === org &&
        billNumberFrom(data[i][head.indexOf('Bill')]) === billNo &&
        !data[i][head.indexOf('Status')]) {
      sheet.getRange(r, statusCol).setValue('superseded');
    }
  }
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
  var parts = String(row['Full Name']).trim().split(/\s+/);
  newRow[head.indexOf('First Name')] = parts.slice(0, -1).join(' ') || parts[0];
  newRow[head.indexOf('Last Name')]  = parts.length > 1 ? parts[parts.length - 1] : '';
  roster.appendRow(newRow);
}
