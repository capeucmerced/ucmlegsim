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

/**
 * This web app is the ONLY way intake data leaves Google — the site never
 * uses publish-to-web on intake tabs, because every response tab carries
 * the submitter's email. Each view joins the Roster server-side and emits
 * de-identified fields only, so this URL is safe to sit in public code.
 *
 *   .../exec                 -> the newsfeed (posts view, default)
 *   .../exec?view=spending   -> contributions: date, district, recipient,
 *                               amount, org — never the email
 */
function doGet(e) {
  var view = (e && e.parameter && e.parameter.view) || 'posts';

  // Serve from a 30-second cache: a classroom of simultaneous page loads
  // becomes one spreadsheet read, and warm responses return much faster.
  var cache = CacheService.getScriptCache();
  var hit = cache.get('json-' + view);
  if (hit) {
    return ContentService.createTextOutput(hit)
      .setMimeType(ContentService.MimeType.JSON);
  }

  var json = view === 'spending' ? buildSpendingJson() : buildPostsJson();

  try { cache.put('json-' + view, json, 30); } catch (err) {}
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/** Contributions with the org resolved from the Roster; emails stripped. */
function buildSpendingJson() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // email -> org code
  var orgByEmail = {};
  var rosterRows = ss.getSheetByName('Roster').getDataRange().getValues();
  var rHead = rosterRows[0];
  for (var i = 1; i < rosterRows.length; i++) {
    var email = String(rosterRows[i][rHead.indexOf('Email')]).toLowerCase().trim();
    var org   = String(rosterRows[i][rHead.indexOf('Org Code')] || '').toUpperCase().trim();
    if (email && org) orgByEmail[email] = org;
  }

  var out = [];
  var sheet = ss.getSheetByName('Spending');
  if (sheet && sheet.getLastRow() > 1) {
    var rows = sheet.getDataRange().getValues();
    var head = rows[0];
    var cTime  = colStartingWith(head, 'Timestamp');
    var cMail  = colStartingWith(head, 'Email Address');
    var cRecip = colStartingWith(head, 'Who received');
    var cAmt   = colStartingWith(head, 'Amount');

    for (var j = 1; j < rows.length; j++) {
      var r = rows[j];
      var who = orgByEmail[String(r[cMail]).toLowerCase().trim()];
      if (!who || !r[cRecip]) continue; // no org registered -> not a contribution
      // Recipient format: "SD-16 · Hurtado, Melissa (D)"
      var recip = String(r[cRecip]);
      var dm = recip.match(/^SD-(\d+)/);
      out.push({
        time:      new Date(r[cTime]).toISOString(),
        org:       who,
        district:  dm ? parseInt(dm[1], 10) : null,
        recipient: recip.replace(/^SD-\d+\s*·\s*/, '').replace(/\s*\([DR]\)\s*$/, ''),
        amount:    Number(r[cAmt])
      });
    }
  }
  return JSON.stringify({ contributions: out });
}

/** Column lookup by prefix — response columns carry full question titles. */
function colStartingWith(head, prefix) {
  for (var i = 0; i < head.length; i++) {
    if (String(head[i]).toLowerCase().indexOf(prefix.toLowerCase()) === 0) return i;
  }
  return -1;
}

function buildPostsJson() {
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
        outlet: row[rHead.indexOf('Outlet')]
      };
    }
  }

  var posts = [];
  var sheet = ss.getSheetByName('Posts');
  if (sheet && sheet.getLastRow() > 1) {
    var rows = sheet.getDataRange().getValues();
    var head = rows[0];
    var cTime = colStartingWith(head, 'Timestamp');
    var cMail = colStartingWith(head, 'Email Address');
    var cHead = colStartingWith(head, 'Headline');
    var cDesc = colStartingWith(head, 'Description');
    var cLink = colStartingWith(head, 'Link');

    for (var j = 1; j < rows.length; j++) {
      var r = rows[j];
      var who = roster[String(r[cMail]).toLowerCase().trim()];
      if (!who || !r[cHead]) continue;  // unregistered account or empty row -> skip
      posts.push({
        time:     new Date(r[cTime]).toISOString(),
        // A roster row with no First/Last name falls back to the outlet
        name:     String(who.name || '').trim() || who.outlet || 'Staff',
        outlet:   who.outlet || '',
        headline: String(r[cHead]),
        dek:      cDesc >= 0 ? String(r[cDesc] || '') : '',
        link:     cLink >= 0 ? String(r[cLink] || '') : ''
      });
    }
  }

  // Newest first, capped so the payload stays small
  posts.sort(function (a, b) { return a.time < b.time ? 1 : -1; });
  posts = posts.slice(0, 200);

  return JSON.stringify({ posts: posts });
}
