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
 *   {{ITEMS}}
 * Agendas carry only the meeting DATE — no time or room, by the
 * instructor's call: chairs handle those in class. Any "Time:" / "Room:"
 * line that finds its way into the template is dropped at assembly
 * (stripTimeRoom_), and fixAgendaTemplate() removes it from the template
 * itself.
 *
 * Admin one-clicks:
 *   previewAgendaTemplate()  logs the template's paragraphs and flags
 *                            the ones fixAgendaTemplate() would remove
 *   fixAgendaTemplate()      removes the flagged time/room lines
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
    .map(function (v, idx) { return (idx + 1) + '.\t' + itemLine(v); });

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
    items: items.join('\n'),
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

/** Dropdown value "SB-12 — Affordable Housing" -> agenda line with author. */
function itemLine(value) {
  var no = billNumberFrom(value);
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
  if (author === null) return String(value) + '\t\t[not found among filed bills — check the number]';
  return 'SB ' + no + '\t' + author + '\t' + subject;
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

// --- Time / room lines: never on an agenda ---------------------------------

/** True for a template paragraph that announces a time, room or location. */
function isTimeRoomLine_(text) {
  var t = String(text || '').trim();
  if (!t) return false;
  if (/\{\{\s*(TIME|ROOM|LOCATION|PLACE)\s*\}\}/i.test(t)) return true;
  if (/^(time|room|location|place|where|when)\s*[:\-–—]/i.test(t)) return true;
  if (/\b\d{1,2}:\d{2}\s*(a\.?m\.?|p\.?m\.?)\b/i.test(t) && !/\{\{/.test(t)) return true;
  return /\bCOB2?\b|\bROOM\s+\d/i.test(t);
}

/** Drops time/room paragraphs from a document body (used on the working copy). */
function stripTimeRoom_(body) {
  var removed = 0;
  var n = body.getNumChildren();
  for (var i = n - 1; i >= 0; i--) {
    var child = body.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
    if (!isTimeRoomLine_(child.asParagraph().getText())) continue;
    if (body.getNumChildren() > 1) { body.removeChild(child); removed++; }
  }
  return removed;
}

/** Logs every paragraph of the agenda template, marking the ones a fix would remove. */
function previewAgendaTemplate() {
  var body = DocumentApp.openById(deployProp('AGENDA_TEMPLATE_DOC_ID', AGENDA_TEMPLATE_DOC_ID)).getBody();
  var lines = [];
  for (var i = 0; i < body.getNumChildren(); i++) {
    var child = body.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) { lines.push(i + ': [' + child.getType() + ']'); continue; }
    var t = child.asParagraph().getText();
    lines.push(i + ': ' + (isTimeRoomLine_(t) ? 'REMOVE  ' : '        ') + JSON.stringify(t));
  }
  Logger.log(lines.join('\n'));
}

/** Removes the time/room lines from the agenda template itself. Preview first. */
function fixAgendaTemplate() {
  var doc = DocumentApp.openById(deployProp('AGENDA_TEMPLATE_DOC_ID', AGENDA_TEMPLATE_DOC_ID));
  var removed = stripTimeRoom_(doc.getBody());
  doc.saveAndClose();
  Logger.log('Removed ' + removed + ' time/room line(s) from the agenda template. ' +
             'Run rebuildAgendas() to regenerate the filed agendas.');
}

function assembleAgendaPdf(spec) {
  var working = DriveApp.getFileById(
      deployProp('AGENDA_TEMPLATE_DOC_ID', AGENDA_TEMPLATE_DOC_ID))
    .makeCopy('assembling-' + spec.fileName);
  var doc = DocumentApp.openById(working.getId());
  var body = doc.getBody();

  // Belt and braces: whatever the template says, no agenda prints a
  // time or room (stripped before the items go in, so only template
  // lines can match)
  stripTimeRoom_(body);

  body.replaceText('{{COMMITTEE}}', spec.committeeName);
  body.replaceText('{{CHAIR}}', spec.chair);
  body.replaceText('{{VICE}}', spec.vice);
  body.replaceText('{{MEMBERS}}', spec.members);
  body.replaceText('{{DATE}}', spec.date);
  body.replaceText('{{REVISED}}', spec.revised);
  body.replaceText('{{ITEMS}}', spec.items);
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
