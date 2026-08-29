/**
 * newsfeed_api.gs — serves newsfeed posts as JSON, fresh within seconds.
 *
 * The website's feed pages fetch this endpoint in the reader's browser, so
 * new posts appear on refresh without any site rebuild.
 *
 * Install: in the "LegSim Intake" workbook's Apps Script project.
 * Deploy (one time): Deploy → New deployment → Web app →
 *   Execute as: Me · Who has access: Anyone → copy the /exec URL into
 *   the site's feed JavaScript.
 * After editing this file, use Deploy → Manage deployments → edit →
 * New version (the URL stays the same).
 *
 * PRIVACY: student emails exist in the Posts tab but are joined to the
 * Roster here and never leave this script — the JSON contains display
 * fields only.
 */

function doGet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // email -> {name, outlet, handle} from the Roster tab
  var roster = {};
  var rosterRows = ss.getSheetByName('Roster').getDataRange().getValues();
  var rHead = rosterRows[0];
  for (var i = 1; i < rosterRows.length; i++) {
    var row = rosterRows[i];
    var email = String(row[rHead.indexOf('Email')]).toLowerCase().trim();
    if (email) {
      roster[email] = {
        name:   row[rHead.indexOf('First Name')] + ' ' + row[rHead.indexOf('Last Name')],
        outlet: row[rHead.indexOf('Outlet')],
        handle: row[rHead.indexOf('Handle')]
      };
    }
  }

  var posts = [];
  var sheet = ss.getSheetByName('Posts');
  if (sheet && sheet.getLastRow() > 1) {
    var rows = sheet.getDataRange().getValues();
    var head = rows[0];
    var cTime = head.indexOf('Timestamp');
    var cMail = head.indexOf('Email Address');
    var cHead = head.indexOf('Headline');
    var cDesc = head.indexOf('Description');
    var cLink = head.indexOf('Link');

    for (var j = 1; j < rows.length; j++) {
      var r = rows[j];
      var who = roster[String(r[cMail]).toLowerCase().trim()];
      if (!who || !r[cHead]) continue;  // unregistered account or empty row -> skip
      posts.push({
        time:     new Date(r[cTime]).toISOString(),
        name:     who.name,
        outlet:   who.outlet || '',
        handle:   who.handle || '',
        headline: String(r[cHead]),
        dek:      String(r[cDesc] || ''),
        link:     String(r[cLink] || '')
      });
    }
  }

  // Newest first, capped so the payload stays small
  posts.sort(function (a, b) { return a.time < b.time ? 1 : -1; });
  posts = posts.slice(0, 200);

  return ContentService
    .createTextOutput(JSON.stringify({ posts: posts }))
    .setMimeType(ContentService.MimeType.JSON);
}
