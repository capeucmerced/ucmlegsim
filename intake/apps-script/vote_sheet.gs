/**
 * vote_sheet.gs — quality-of-life automation for the "LegSim Votes" workbook.
 *
 * Install: in the VOTES workbook's own Apps Script project (Extensions →
 * Apps Script in that spreadsheet). The simple onEdit trigger below works
 * with no further setup.
 *
 * What it does: when a chair picks a Bill in a row whose Date cell is
 * empty, today's date is stamped in automatically. (Chairs can still
 * overwrite the date by hand — the stamp only fills blanks.)
 *
 * The bill DROPDOWNS need no code: each committee tab's Bill column uses
 * Data validation → "Dropdown (from a range)" pointing at that committee's
 * column on a hidden "BillLists" tab, which pulls filed bills from the
 * intake workbook with IMPORTRANGE + FILTER. Set up once by hand; it stays
 * current by itself. Tally columns should use ARRAYFORMULA in the header
 * row so they extend to new rows without copying formulas down.
 *
 * openToEveryone(): one click that makes this workbook open to anyone
 * with the link as an editor (Google creates files "Restricted", which
 * shows students a request-access screen instead of the sheet). The
 * intake project's setupVoteSheets() does the same from its side.
 */

function openToEveryone() {
  var file = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
  Logger.log('"' + file.getName() + '": anyone with the link can edit. ' +
             'Test it in an incognito window: the sheet should open with no sign-in.');
}

function onEdit(e) {
  if (!e || !e.range) return;

  var sheet = e.range.getSheet();
  var row = e.range.getRow();
  if (row < 2) return; // ignore header edits

  // Find this tab's "Bill" and "Date" columns by their header names,
  // so column order never matters.
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var billCol = headers.indexOf('Bill') + 1;
  var dateCol = headers.indexOf('Date') + 1;
  if (billCol === 0 || dateCol === 0) return;

  // Only act when the edited cell is the Bill cell and it now has a value
  if (e.range.getColumn() !== billCol) return;
  if (!e.range.getValue()) return;

  var dateCell = sheet.getRange(row, dateCol);
  if (!dateCell.getValue()) {
    var today = new Date();
    dateCell.setValue(
      (today.getMonth() + 1) + '/' + today.getDate() + '/' + String(today.getFullYear()).slice(-2)
    );
  }
}
