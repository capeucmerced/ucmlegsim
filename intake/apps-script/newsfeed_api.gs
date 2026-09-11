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
 *   .../exec?view=letters    -> position letters: date, org, bill,
 *                               position, Drive file id — never the email
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

  var json = view === 'spending' ? buildSpendingJson()
           : view === 'letters'  ? buildLettersJson()
           : view === 'bills'    ? buildBillsJson()
           : view === 'profiles' ? buildProfilesJson()
           : view === 'editions' ? buildEditionsJson()
           : view === 'agendas'  ? buildAgendasJson()
           : buildPostsJson();

  try { cache.put('json-' + view, json, 30); } catch (err) {}
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/** email -> org code, from the Roster tab */
function rosterOrgMap() {
  var rosterRows = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName('Roster').getDataRange().getValues();
  var rHead = rosterRows[0];
  var orgByEmail = {};
  for (var i = 1; i < rosterRows.length; i++) {
    var email = String(rosterRows[i][rHead.indexOf('Email')]).toLowerCase().trim();
    var org   = String(rosterRows[i][rHead.indexOf('Org Code')] || '').toUpperCase().trim();
    if (email && org) orgByEmail[email] = org;
  }
  return orgByEmail;
}

/** Filed bills: one entry per SB number. Per FIELD, the latest non-empty
 *  value across the bill's non-void rows wins: an amendment row only
 *  carries the "Updated …" fields the student filled in, and inherits
 *  everything it left blank (the "None —" choices clear flags/secondary
 *  topic explicitly). Author identity comes from the Roster; emails
 *  never leave. */
function buildBillsJson() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // email -> senator identity
  var senByEmail = {};
  var rosterRows = ss.getSheetByName('Roster').getDataRange().getValues();
  var rHead = rosterRows[0];
  for (var i = 1; i < rosterRows.length; i++) {
    var em = String(rosterRows[i][rHead.indexOf('Email')]).toLowerCase().trim();
    if (em && String(rosterRows[i][rHead.indexOf('Role')]).toLowerCase().trim() === 'senator') {
      senByEmail[em] = {
        first:    rosterRows[i][rHead.indexOf('First Name')],
        last:     rosterRows[i][rHead.indexOf('Last Name')],
        district: rosterRows[i][rHead.indexOf('District')],
        party:    rosterRows[i][rHead.indexOf('Party')] || 'D'
      };
    }
  }

  var bySb = {};
  var sheet = ss.getSheetByName('Bills');
  if (sheet && sheet.getLastRow() > 1) {
    var rows = sheet.getDataRange().getValues();
    var head = rows[0];
    var cTime   = colStartingWith(head, 'Timestamp');
    var cMail   = colStartingWith(head, 'Email Address');
    var cSubj   = colStartingWith(head, 'Short subject');
    var cDig    = colStartingWith(head, 'Digest');
    var cFlags  = colStartingWith(head, 'Flags');
    var cTopic  = colStartingWith(head, 'Primary Topic');
    var cTop2   = colStartingWith(head, 'Secondary Topic');
    var cUpSubj = colStartingWith(head, 'Updated short subject');
    var cUpDig  = colStartingWith(head, 'Updated digest');
    var cUpFlag = colStartingWith(head, 'Updated flags');
    var cUpTop  = colStartingWith(head, 'Updated primary topic');
    var cUpTop2 = colStartingWith(head, 'Updated secondary topic');
    var cSb     = head.indexOf('SB Number');
    var cStat   = head.indexOf('Status');

    var billsFolder = filesSubfolder('bills');
    for (var j = 1; j < rows.length; j++) {
      var r = rows[j];
      if (cStat >= 0 && r[cStat]) continue;          // void rows are ignored
      var sb = parseInt(r[cSb], 10);
      if (isNaN(sb)) continue;                       // never got a number
      var who = senByEmail[String(r[cMail]).toLowerCase().trim()];
      if (!who) continue;

      var slug = String(who.last).toUpperCase().replace(/ /g, '_');
      var cellv = function (c) { return c >= 0 ? String(r[c] || '') : ''; };
      var earlier = bySb[sb] || { subject: '', digest: '', flags: '', topic: '', topic2: '' };

      var flags = cellv(cUpFlag) ? withoutNoFlags(cellv(cUpFlag))
                : cellv(cFlags) || earlier.flags;
      var topic2 = cellv(cUpTop2) === NO_TOPIC2_CHOICE ? ''
                 : cellv(cUpTop2) || cellv(cTop2) || earlier.topic2;

      var entry = {
        time:     new Date(r[cTime]).toISOString(),
        sb:       sb,
        subject:  cellv(cUpSubj) || cellv(cSubj) || earlier.subject,
        digest:   cellv(cUpDig)  || cellv(cDig)  || earlier.digest,
        flags:    flags,
        topic:    cellv(cUpTop)  || cellv(cTopic) || earlier.topic,
        topic2:   topic2,
        first:    String(who.first),
        last:     String(who.last),
        district: parseInt(who.district, 10),
        party:    String(who.party),
        fileId:   ''
      };
      var pdfs = billsFolder.getFilesByName(slug + '_SB' + sb + '.pdf');
      if (pdfs.hasNext()) entry.fileId = pdfs.next().getId();

      // rows are in submission order, so later rows overwrite earlier
      bySb[sb] = entry;
    }
  }

  var out = Object.keys(bySb).map(function (k) { return bySb[k]; });

  // Archived pre-amendment versions (previous_bills/SLUG_SBn_vN.pdf, created
  // by archiveCurrentVersion): matched back to their bill so the site can
  // build each page's Previous Text tab. One folder scan covers all bills.
  var entryByName = {};
  out.forEach(function (b) {
    b.prev = [];
    entryByName[String(b.last).toUpperCase().replace(/ /g, '_') + '_SB' + b.sb] = b;
  });
  var prevFiles = filesSubfolder('previous_bills').getFiles();
  while (prevFiles.hasNext()) {
    var pf = prevFiles.next();
    var m = pf.getName().match(/^(.+_SB\d+)_v(\d+)\.pdf$/);
    if (m && entryByName[m[1]]) {
      entryByName[m[1]].prev.push({ v: parseInt(m[2], 10), id: pf.getId() });
    }
  }

  return JSON.stringify({ bills: out });
}

/** Current committee agendas: the canonical-named PDFs in agendas/
 *  (code_MM_DD_YY.pdf). Superseded revisions (_prevN) stay in Drive as
 *  the paper trail and are not served. Filenames only — no emails. */
function buildAgendasJson() {
  var out = [];
  var files = filesSubfolder('agendas').getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (!/^[a-z]+_\d{2}_\d{2}_\d{2}\.pdf$/i.test(f.getName())) continue;
    out.push({ name: f.getName(), id: f.getId() });
  }
  return JSON.stringify({ agendas: out });
}

/** Newspaper editions, in submission order: name, link, submission time,
 *  and the outlet joined from the Roster — never the email. */
function buildEditionsJson() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var outletByEmail = {};
  var rosterRows = ss.getSheetByName('Roster').getDataRange().getValues();
  var rHead = rosterRows[0];
  for (var i = 1; i < rosterRows.length; i++) {
    var em = String(rosterRows[i][rHead.indexOf('Email')]).toLowerCase().trim();
    var outlet = String(rosterRows[i][rHead.indexOf('Outlet')] || '').trim();
    if (em && outlet) outletByEmail[em] = outlet;
  }

  var out = [];
  var sheet = ss.getSheetByName('Editions');
  if (sheet && sheet.getLastRow() > 1) {
    var rows = sheet.getDataRange().getValues();
    var head = rows[0];
    var cTime = colStartingWith(head, 'Timestamp');
    var cMail = colStartingWith(head, 'Email Address');
    var cEd   = colStartingWith(head, 'Edition name');
    var cLink = colStartingWith(head, 'Link to the edition');
    for (var j = 1; j < rows.length; j++) {
      var r = rows[j];
      if (!r[cEd] && !r[cLink]) continue;
      out.push({
        time:    new Date(r[cTime]).toISOString(),
        edition: String(r[cEd] || ''),
        link:    String(r[cLink] || ''),
        outlet:  outletByEmail[String(r[cMail]).toLowerCase().trim()] || ''
      });
    }
  }
  return JSON.stringify({ editions: out });
}

/** Role-profile PDFs, straight from the role_profiles/ folder tree:
 *  role subfolder + canonical filename + id, nothing else (the filenames
 *  are script-made and carry no emails). The build downloads by id. */
function buildProfilesJson() {
  var out = [];
  var parent = filesSubfolder('role_profiles');
  ['senators', 'lobbyists', 'journalists'].forEach(function (sub) {
    var it = parent.getFoldersByName(sub);
    if (!it.hasNext()) return;
    var files = it.next().getFiles();
    while (files.hasNext()) {
      var f = files.next();
      if (!/_profile\.pdf$/i.test(f.getName())) continue;
      out.push({ role: sub, name: f.getName(), id: f.getId() });
    }
  });
  return JSON.stringify({ profiles: out });
}

/** Current position letters; the build downloads the PDFs by file id. */
function buildLettersJson() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var orgByEmail = rosterOrgMap();

  var out = [];
  var sheet = ss.getSheetByName('Letters');
  if (sheet && sheet.getLastRow() > 1) {
    var rows = sheet.getDataRange().getValues();
    var head = rows[0];
    var cTime   = colStartingWith(head, 'Timestamp');
    var cMail   = colStartingWith(head, 'Email Address');
    var cBill   = colStartingWith(head, 'Which bill');
    var cPos    = colStartingWith(head, 'Position');
    var cStatus = colStartingWith(head, 'Status');

    for (var j = 1; j < rows.length; j++) {
      var r = rows[j];
      if (cStatus >= 0 && r[cStatus]) continue; // superseded/void rows stay private history
      var who = orgByEmail[String(r[cMail]).toLowerCase().trim()];
      if (!who || !r[cBill]) continue;
      // The upload is found by VALUE (the one cell holding a Drive link),
      // never by its column title — titles are whatever the form said
      var idMatch = null;
      for (var c = 0; c < r.length; c++) {
        var v = String(r[c] || '');
        if (/https:\/\/(drive|docs)\.google\.com\//.test(v)) {
          idMatch = v.match(/[-\w]{25,}/);
          if (idMatch) break;
        }
      }
      var billMatch = String(r[cBill]).match(/(\d+)/);
      if (!billMatch || !idMatch) continue;
      out.push({
        time:     new Date(r[cTime]).toISOString(),
        org:      who,
        bill:     parseInt(billMatch[1], 10),
        position: String(r[cPos]),
        fileId:   idMatch[0]
      });
    }
  }
  return JSON.stringify({ letters: out });
}

/** Contributions with the org resolved from the Roster; emails stripped. */
function buildSpendingJson() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var orgByEmail = rosterOrgMap();

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
