/**
 * agenda_builder.gs — turns an agenda-form submission into a formatted,
 * Senate-letterhead agenda PDF, with revision handling.
 *
 * Revision rule: committee + meeting date is the key. A resubmission for
 * the same meeting becomes Revision N: the previous PDF is renamed
 * *_prev1, *_prev2, … and the new one takes the canonical name, so the
 * site always links the current agenda while the paper trail remains.
 *
 * The agenda template is a Google Doc modeled on the real CA Senate
 * agenda layout, with placeholders:
 *   {{COMMITTEE}} {{CHAIR}} {{VICE}} {{MEMBERS}} {{DATE}} {{REVISED}}
 *   {{ITEMS}}  — replaced by a four-column table of bills (number, bill,
 *                author, subject) in that paragraph's font
 * Agendas carry only the meeting DATE — no time or room, by the
 * instructor's call: chairs handle those in class. repairAgendaBody_()
 * runs on every agenda's working copy: it drops time/room lines, keeps
 * the date when it shares a line with them, puts a date line back if
 * the template has none, and keeps the heading, table and footer out of
 * the REVISED notice's red.
 *
 * Bill lines: the number after "SB" is the bill ("3. SB 68 …" is SB 68).
 *
 * Admin one-clicks:
 *   previewAgendaTemplate()  logs the template's paragraphs and what
 *                            fixAgendaTemplate() would do to each
 *   fixAgendaTemplate()      applies the same repair to the template
 *   rebuildAgendas()         regenerates every filed agenda from its
 *                            sheet row (current template, current
 *                            membership), keeping the revision trail;
 *                            no emails; then asks for a site rebuild
 */

var AGENDA_TEMPLATE_DOC_ID = 'PUT-TEMPLATE-DOC-ID-HERE-AT-DEPLOY';

// Response tab name -> committee code + display name
var AGENDA_TABS = {
  'Agenda LGL':   { code: 'lgl',   name: 'Local Government and Labor' },
  'Agenda ANR':   { code: 'anr',   name: 'Agriculture and Natural Resources' },
  'Agenda BLH':   { code: 'blh',   name: 'Business, Law, and Health' },
  'Agenda APP':   { code: 'app',   name: 'Appropriations' },
  'Agenda Floor': { code: 'floor', name: 'Senate Floor' }
};

function handleAgendaSubmit(e) {
  var sheet = e.range.getSheet();
  var committee = AGENDA_TABS[sheet.getName()];
  if (!committee) return;

  var vals = sheet.getDataRange().getValues();
  var head = vals[0];
  var r = e.range.getRow() - 1;            // index into vals
  var built = buildAgendaRow_(sheet, committee, head, vals, r);

  GmailApp.sendEmail(
    built.email,
    'Agenda filed: ' + committee.name + ', ' + built.meetingDateText +
      (built.revision > 1 ? ' (Revision ' + built.revision + ')' : ''),
    'Your agenda is attached and will appear on the site shortly.',
    { attachments: [built.pdf] }
  );
}

/**
 * Builds (or rebuilds) the agenda for one sheet row: works out the
 * revision number from the earlier rows for the same meeting, writes it
 * to the Revision column, assembles the PDF, and returns what the caller
 * needs for the receipt. Shared by the form handler and rebuildAgendas().
 */
function buildAgendaRow_(sheet, committee, head, vals, r) {
  var row = {};
  for (var c = 0; c < head.length; c++) row[head[c]] = vals[r][c];

  var meetingDate = new Date(row['Meeting Date']);
  // Zero-padded to match the site's filename convention (anr_10_07_25.pdf)
  var p2 = function (n) { return ('0' + n).slice(-2); };
  var dateSlug = p2(meetingDate.getMonth() + 1) + '_' + p2(meetingDate.getDate()) + '_' +
                 String(meetingDate.getFullYear()).slice(-2);
  var fileName = committee.code + '_' + dateSlug + '.pdf';

  // Revision number = 1 + how many EARLIER live submissions exist for
  // this meeting (rows above this one; voided rows don't count)
  var cDate = head.indexOf('Meeting Date');
  var cStatus = head.indexOf('Status');
  var revision = 1;
  for (var i = 1; i < r; i++) {
    if (cStatus !== -1 && vals[i][cStatus]) continue;
    var d = new Date(vals[i][cDate]);
    if (d.toDateString() === meetingDate.toDateString()) revision++;
  }
  var revCol = head.indexOf('Revision');
  if (revCol !== -1) sheet.getRange(r + 1, revCol + 1).setValue(revision);

  // Bills come as one paragraph, one per line, in file order (cap 30).
  // Find the column by prefix — its header is the full question title.
  var fileOrderKey = Object.keys(row).filter(function (k) {
    return k.indexOf('Bills in file order') === 0;
  })[0];
  var items = String(row[fileOrderKey] || '')
    .split(/\r?\n/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; })
    .slice(0, 30)
    .map(function (v, idx) {
      var p = itemParts(v);
      return [(idx + 1) + '.', p.bill, p.author, p.subject];   // one table row
    });

  var membership = latestAssignments(committee.code);
  var tz = Session.getScriptTimeZone();
  // "Issued" is the submission's own timestamp, so a rebuild reproduces
  // the original notice instead of stamping today's time on it
  var issued = row['Timestamp'] ? new Date(row['Timestamp']) : new Date();

  var pdf = assembleAgendaPdf({
    // Composed here so empty pieces vanish cleanly (a floor agenda has
    // no chair/vice/members lines, and is a session, not a committee)
    committeeName: committee.code === 'floor'
      ? 'SESSION OF THE SENATE'
      : 'SENATE COMMITTEE ON ' + committee.name.toUpperCase(),
    chair:   membership.chair ? membership.chair + ', Chair' : '',
    vice:    membership.vice ? membership.vice + ', Vice Chair' : '',
    members: membership.members ? 'Members: ' + membership.members : '',
    date: Utilities.formatDate(meetingDate, tz, 'EEEE, MMMM d, yyyy'),
    revised: revision > 1
      ? 'REVISED — Revision ' + revision + ', issued ' +
        Utilities.formatDate(issued, tz, 'M/d h:mm a') +
        '. Supersedes all prior agendas for this meeting.'
      : '',
    items: items,
    fileName: fileName
  });

  return {
    pdf: pdf,
    revision: revision,
    fileName: fileName,
    email: row['Email Address'],
    meetingDateText: String(row['Meeting Date'])
  };
}

/**
 * Regenerates every filed agenda from the five Agenda tabs, in filing
 * order, with the current template and the current committee
 * membership. For each meeting touched, the existing PDF and its
 * *_prevN trail are trashed first and then rebuilt row by row, so the
 * revision trail comes out exactly as it was filed. Rows with anything
 * in a Status column are skipped (and their files removed). No emails.
 * Run after changing the template or fixing a membership mistake.
 */
function rebuildAgendas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var agendas = filesSubfolder('agendas');
  var log = [];
  var built = 0;

  Object.keys(AGENDA_TABS).forEach(function (tab) {
    var sheet = ss.getSheetByName(tab);
    if (!sheet || sheet.getLastRow() < 2) return;
    var committee = AGENDA_TABS[tab];
    var vals = sheet.getDataRange().getValues();
    var head = vals[0];
    var cDate = head.indexOf('Meeting Date');
    var cStatus = head.indexOf('Status');

    // Clear every meeting this tab has filed, trail included
    var seen = {};
    for (var i = 1; i < vals.length; i++) {
      var d = new Date(vals[i][cDate]);
      if (isNaN(d.getTime())) continue;
      var p2 = function (n) { return ('0' + n).slice(-2); };
      var stem = committee.code + '_' + p2(d.getMonth() + 1) + '_' + p2(d.getDate()) + '_' +
                 String(d.getFullYear()).slice(-2);
      if (seen[stem]) continue;
      seen[stem] = true;
      var files = agendas.getFiles();
      while (files.hasNext()) {
        var f = files.next();
        if (f.getName() === stem + '.pdf' || f.getName().indexOf(stem + '_prev') === 0) f.setTrashed(true);
      }
    }

    for (var r = 1; r < vals.length; r++) {
      if (cStatus !== -1 && vals[r][cStatus]) { log.push(tab + ' row ' + (r + 1) + ': skipped (Status set)'); continue; }
      if (!vals[r][cDate]) { log.push(tab + ' row ' + (r + 1) + ': skipped (no meeting date)'); continue; }
      try {
        var b = buildAgendaRow_(sheet, committee, head, vals, r);
        built++;
        log.push(tab + ' row ' + (r + 1) + ': ' + b.fileName + ' (revision ' + b.revision + ')');
      } catch (err) {
        log.push(tab + ' row ' + (r + 1) + ': FAILED — ' + err.message);
      }
    }
  });

  Logger.log('Rebuilt ' + built + ' agenda(s).\n' + log.join('\n'));
  if (built > 0) requestSiteRebuild();
}

/**
 * The bill number on one typed agenda line. The number after "SB" wins,
 * so a pasted numbered list ("3. SB 68 McGuire Rural Broadband …") files
 * SB 68, not SB 3. A line with no "SB" falls back to its first number
 * ("68" or "#68").
 */
function agendaBillNumber_(line) {
  var s = String(line || '');
  var m = s.match(/\bS\.?\s*B\.?\s*[-#]?\s*(\d+)/i);
  if (m) return parseInt(m[1], 10);
  return billNumberFrom(s);
}

/** A typed line ("SB-12", "sb 12", …) -> the agenda row's bill, author and subject. */
function itemParts(value) {
  var no = agendaBillNumber_(value);
  var bills = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Bills');
  var vals = bills.getDataRange().getValues();
  var head = vals[0];
  // Bills columns carry the full form questions ("Short subject for the
  // bill tables — …"), so match by prefix exactly as the gateway does;
  // an exact-name lookup finds nothing and prints "undefined"
  var cSb     = head.indexOf('SB Number');
  var cStat   = head.indexOf('Status');
  var cMail   = headIndexByPrefix(head, 'Email Address');
  var cSubj   = headIndexByPrefix(head, 'Short subject');
  var cUpSubj = headIndexByPrefix(head, 'Updated short subject');

  var author = null, subject = '';
  for (var i = 1; i < vals.length; i++) {
    if (cStat >= 0 && vals[i][cStat]) continue;            // void rows
    if (parseInt(vals[i][cSb], 10) !== no) continue;
    if (author === null) {
      var who = rosterLookup(vals[i][cMail]);
      author = who ? who['Last Name'] : '';
    }
    // An amendment's "Updated short subject" replaces the title; blank keeps it
    var updated = cUpSubj >= 0 ? String(vals[i][cUpSubj] || '').trim() : '';
    var base    = cSubj   >= 0 ? String(vals[i][cSubj]   || '').trim() : '';
    subject = updated || base || subject;
  }
  if (author === null) {
    return { bill: String(value), author: '', subject: '[not found among filed bills — check the number]' };
  }
  // Bills filed before the form enforced SUBJECT_MAX_CHARS (forms_builder.gs)
  // can carry a paragraph-length subject; keep agenda lines to two lines
  if (subject.length > SUBJECT_MAX_CHARS) subject = subject.slice(0, SUBJECT_MAX_CHARS - 1).replace(/\s+\S*$/, '') + '…';
  return { bill: 'SB ' + no, author: author, subject: subject };
}

/**
 * Puts the bills in as a borderless four-column table (number, bill,
 * author, subject) where the template's {{ITEMS}} paragraph sits. A
 * table keeps every column aligned whatever the author's name length,
 * and a long subject wraps inside its own cell instead of back to the
 * left margin. The font follows the placeholder paragraph, so the
 * template can be restyled freely.
 */
function insertItemsTable_(body, rows) {
  var hit = body.findText('{{ITEMS}}');
  var anchor = hit ? hit.getElement().getParent() : null;
  var idx = anchor ? body.getChildIndex(anchor) : body.getNumChildren() - 1;
  var family = anchor ? anchor.editAsText().getFontFamily(0) : null;
  var size   = anchor ? anchor.editAsText().getFontSize(0) : null;

  if (!rows || !rows.length) rows = [['', '', '', 'No bills listed.']];
  var table = body.insertTable(idx + 1, rows);
  table.setBorderWidth(0);

  // Column widths from the page's text width: number, bill, author, subject
  var textWidth = body.getPageWidth() - body.getMarginLeft() - body.getMarginRight();
  var widths = [26, 52, 120, textWidth - 26 - 52 - 120];
  for (var c = 0; c < widths.length; c++) table.setColumnWidth(c, widths[c]);

  for (var r = 0; r < table.getNumRows(); r++) {
    var row = table.getRow(r);
    for (var k = 0; k < row.getNumCells(); k++) {
      var cell = row.getCell(k);
      cell.setPaddingTop(2).setPaddingBottom(2).setPaddingLeft(0).setPaddingRight(6);
      // Explicit color and weight: a new table otherwise inherits the
      // paragraph above it (in the template, the red REVISED notice's style)
      var t = cell.editAsText();
      if (family) t.setFontFamily(family);
      if (size)   t.setFontSize(size);
      t.setForegroundColor(AGENDA_INK).setItalic(false).setBold(k === 1);
    }
  }
  if (anchor) body.removeChild(anchor);
}

/** Chair/vice/member names for a committee, from the merged Assignments state. */
function latestAssignments(code) {
  // Merged state across submissions (newest non-blank answer per question,
  // via currentAssignments), so a partial filing such as leadership-only
  // never blanks a committee header on the next agenda
  var out = { chair: '', vice: '', members: '' };
  var current = currentAssignments();
  if (!current || code === 'floor') return out;
  var up = code.toUpperCase();
  var get = function (title) {
    var c = current.head.indexOf(title);
    return c < 0 ? '' : String(current.row[c] || '');
  };
  out.chair   = get(up + ' Chair');
  out.vice    = get(up + ' Vice Chair');
  out.members = get(up + ' Members');
  return out;
}

// --- Template repair: date kept, time/room dropped, plain colors -----------
//
// Agendas carry the meeting DATE and nothing about time or room. The
// template has drifted twice: a hand-added time/room line, and the date
// sharing a line with it (so the first cleanup took the date with it).
// repairAgendaBody_() fixes all of that on whatever body it is given — the
// working copy of every agenda (so a bad template can never reach a PDF)
// and, through fixAgendaTemplate(), the template itself.

var AGENDA_INK  = '#1c1c1c';   // body text: the bill table
var AGENDA_NAVY = '#17345a';   // the AGENDA heading, as in the letterhead
var AGENDA_GREY = '#555555';   // the "heard in file order" footer

var DATE_TOKEN_RE = /\{\{\s*DATE\s*\}\}/i;

/** True when a line mentions a time, room or location in any form. */
function hasTimeRoom_(text) {
  var t = String(text || '');
  return /\{\{\s*(TIME|ROOM|LOCATION|PLACE)\s*\}\}/i.test(t) ||
         /(^|\s)(time|room|location|place|where|when)\s*[:\-–—]/i.test(t) ||
         /\b\d{1,2}:\d{2}\s*(a\.?m\.?|p\.?m\.?)?/i.test(t) ||
         /\b\d{1,2}\s*(a\.?m\.?|p\.?m\.?)(\s|$|[.,;·])/i.test(t) ||
         /\bCOB\s*2?\b|\bROOM\s+\d/i.test(t);
}

/** A placeholder this script fills (anything but time/room). */
function hasKeptPlaceholder_(text) {
  return /\{\{\s*(COMMITTEE|CHAIR|VICE|MEMBERS|DATE|REVISED|ITEMS)\s*\}\}/i.test(String(text || ''));
}

/** What repairAgendaBody_ does with one paragraph: keep / date-only / remove. */
function timeRoomAction_(text) {
  if (!hasTimeRoom_(text)) return 'keep';
  if (DATE_TOKEN_RE.test(text)) return 'date-only';
  if (hasKeptPlaceholder_(text)) return 'keep';   // never drop the committee, items, …
  return 'remove';
}

function paragraphsOf_(body) {
  var out = [];
  for (var i = 0; i < body.getNumChildren(); i++) {
    var c = body.getChild(i);
    if (c.getType() === DocumentApp.ElementType.PARAGRAPH) out.push(c.asParagraph());
  }
  return out;
}

function findParagraph_(body, test) {
  var ps = paragraphsOf_(body);
  for (var i = 0; i < ps.length; i++) if (test(ps[i].getText())) return ps[i];
  return null;
}

/**
 * Repairs an agenda body in place and returns a list of what changed.
 *  1. A line that is only time/room is removed.
 *  2. A line that holds the date AND a time/room keeps just {{DATE}}
 *     (the token keeps its own formatting).
 *  3. If no {{DATE}} is left anywhere, a centered, bold date line goes
 *     back in above the REVISED notice (or above AGENDA).
 *  4. The AGENDA heading prints navy and the footer grey, never red.
 */
function repairAgendaBody_(body) {
  var log = [];

  // 1 + 2 — walk bottom-up so removals don't shift what's left to visit
  var ps = paragraphsOf_(body);
  for (var i = ps.length - 1; i >= 0; i--) {
    var p = ps[i];
    var t = p.getText();
    var act = timeRoomAction_(t);
    if (act === 'remove' && body.getNumChildren() > 1) {
      body.removeChild(p);
      log.push('removed time/room line ' + JSON.stringify(t));
    } else if (act === 'date-only') {
      var m = t.match(DATE_TOKEN_RE);
      var start = m.index, end = m.index + m[0].length;   // keep [start, end)
      var text = p.editAsText();
      if (end < t.length) text.deleteText(end, t.length - 1);
      if (start > 0) text.deleteText(0, start - 1);
      log.push('kept only the date from ' + JSON.stringify(t));
    }
  }

  // 3 — the date line, if it is gone
  if (!body.findText('{{DATE}}')) {
    var before = findParagraph_(body, function (x) { return /\{\{\s*REVISED\s*\}\}/i.test(x); }) ||
                 findParagraph_(body, function (x) { return /^\s*AGENDA\s*$/i.test(x); });
    var at = before ? body.getChildIndex(before) : 0;
    var dateP = body.insertParagraph(at, '{{DATE}}');
    dateP.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingAfter(8);
    var family = before ? before.editAsText().getFontFamily(0) : null;
    var dt = dateP.editAsText();
    if (family) dt.setFontFamily(family);
    dt.setFontSize(11).setBold(true).setItalic(false).setForegroundColor(AGENDA_INK);
    log.push('restored the {{DATE}} line');
  }

  // 4 — colors below the red REVISED notice
  var heading = findParagraph_(body, function (x) { return /^\s*AGENDA\s*$/i.test(x); });
  if (heading) heading.editAsText().setForegroundColor(AGENDA_NAVY).setBold(true);
  var footer = findParagraph_(body, function (x) { return /^\s*Bills will be heard/i.test(x); });
  if (footer) footer.editAsText().setForegroundColor(AGENDA_GREY).setBold(false).setItalic(true);
  var items = findParagraph_(body, function (x) { return /\{\{\s*ITEMS\s*\}\}/i.test(x); });
  if (items) items.editAsText().setForegroundColor(AGENDA_INK).setBold(false);

  return log;
}

/** Logs every paragraph of the agenda template and what a fix would do to it. */
function previewAgendaTemplate() {
  var body = DocumentApp.openById(deployProp('AGENDA_TEMPLATE_DOC_ID', AGENDA_TEMPLATE_DOC_ID)).getBody();
  var label = { keep: '          ', 'date-only': 'DATE ONLY ', remove: 'REMOVE    ' };
  var lines = [];
  for (var i = 0; i < body.getNumChildren(); i++) {
    var child = body.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) { lines.push(i + ': [' + child.getType() + ']'); continue; }
    var t = child.asParagraph().getText();
    lines.push(i + ': ' + label[timeRoomAction_(t)] + JSON.stringify(t));
  }
  if (!body.findText('{{DATE}}')) lines.push('(no {{DATE}} line: fixAgendaTemplate will put one back)');
  Logger.log(lines.join('\n'));
}

/** Repairs the agenda template itself (see repairAgendaBody_). Preview first. */
function fixAgendaTemplate() {
  var doc = DocumentApp.openById(deployProp('AGENDA_TEMPLATE_DOC_ID', AGENDA_TEMPLATE_DOC_ID));
  var log = repairAgendaBody_(doc.getBody());
  doc.saveAndClose();
  Logger.log((log.length ? log.join('\n') : 'Template already clean.') +
             '\nRun rebuildAgendas() to regenerate the filed agendas.');
}

function assembleAgendaPdf(spec) {
  var working = DriveApp.getFileById(
      deployProp('AGENDA_TEMPLATE_DOC_ID', AGENDA_TEMPLATE_DOC_ID))
    .makeCopy('assembling-' + spec.fileName);
  var doc = DocumentApp.openById(working.getId());
  var body = doc.getBody();

  // Belt and braces: whatever state the template is in, every agenda
  // gets its date line, no time or room, and plain colors (done before
  // the items go in, so only template lines are touched)
  repairAgendaBody_(body);

  body.replaceText('{{COMMITTEE}}', spec.committeeName);
  body.replaceText('{{CHAIR}}', spec.chair);
  body.replaceText('{{VICE}}', spec.vice);
  body.replaceText('{{MEMBERS}}', spec.members);
  body.replaceText('{{DATE}}', spec.date);
  body.replaceText('{{REVISED}}', spec.revised);
  insertItemsTable_(body, spec.items);
  doc.saveAndClose();

  var agendas = filesSubfolder('agendas');

  // A resubmission takes the canonical name; the old file keeps the trail
  var existing = agendas.getFilesByName(spec.fileName);
  var prev = 1;
  while (existing.hasNext()) {
    var f = existing.next();
    while (agendas.getFilesByName(spec.fileName.replace('.pdf', '_prev' + prev + '.pdf')).hasNext()) prev++;
    f.setName(spec.fileName.replace('.pdf', '_prev' + prev + '.pdf'));
  }

  var pdf = working.getAs(MimeType.PDF).setName(spec.fileName);
  var filed = agendas.createFile(pdf);
  // Agendas are public documents on the site; link-view sharing lets the
  // build download them by file id
  try { filed.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  working.setTrashed(true);
  return pdf;
}
