/**
 * agenda_builder.gs — turns an agenda-form submission into a formatted,
 * Senate-letterhead agenda PDF, with revision handling.
 *
 * *** DRAFT: written before the course account existed. Must be walked
 * *** through live at deploy (see intake/README.md step 7).
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
 * instructor's call: chairs handle those in class.
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
  var tab = e.range.getSheet().getName();
  var committee = AGENDA_TABS[tab];
  if (!committee) return;

  var sheet = e.range.getSheet();
  var head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = rowAsObject(e);

  var meetingDate = new Date(row['Meeting Date']);
  // Zero-padded to match the site's filename convention (anr_10_07_25.pdf)
  var p2 = function (n) { return ('0' + n).slice(-2); };
  var dateSlug = p2(meetingDate.getMonth() + 1) + '_' + p2(meetingDate.getDate()) + '_' +
                 String(meetingDate.getFullYear()).slice(-2);
  var fileName = committee.code + '_' + dateSlug + '.pdf';

  // Revision number = how many earlier submissions exist for this meeting
  var revision = 1;
  var vals = sheet.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (i + 1 === e.range.getRow()) continue;
    var d = new Date(vals[i][head.indexOf('Meeting Date')]);
    if (d.toDateString() === meetingDate.toDateString()) revision++;
  }
  var revCol = head.indexOf('Revision');
  if (revCol !== -1) sheet.getRange(e.range.getRow(), revCol + 1).setValue(revision);

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

  var pdf = assembleAgendaPdf({
    // Composed here so empty pieces vanish cleanly (a floor agenda has
    // no chair/vice/members lines, and is a session, not a committee)
    committeeName: committee.code === 'floor'
      ? 'SESSION OF THE SENATE'
      : 'SENATE COMMITTEE ON ' + committee.name.toUpperCase(),
    chair:   membership.chair ? membership.chair + ', Chair' : '',
    vice:    membership.vice ? membership.vice + ', Vice Chair' : '',
    members: membership.members ? 'Members: ' + membership.members : '',
    date: Utilities.formatDate(meetingDate, Session.getScriptTimeZone(), 'EEEE, MMMM d, yyyy'),
    revised: revision > 1
      ? 'REVISED — Revision ' + revision + ', issued ' +
        Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d h:mm a') +
        '. Supersedes all prior agendas for this meeting.'
      : '',
    items: items.join('\n'),
    fileName: fileName
  });

  GmailApp.sendEmail(
    row['Email Address'],
    'Agenda filed: ' + committee.name + ', ' + row['Meeting Date'] +
      (revision > 1 ? ' (Revision ' + revision + ')' : ''),
    'Your agenda is attached and will appear on the site shortly.',
    { attachments: [pdf] }
  );
}

/** Dropdown value "SB-12 — Affordable Housing" -> agenda line with author. */
function itemLine(value) {
  var no = billNumberFrom(value);
  var bills = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Bills');
  var vals = bills.getDataRange().getValues();
  var head = vals[0];
  for (var i = 1; i < vals.length; i++) {
    if (parseInt(vals[i][head.indexOf('SB Number')], 10) === no) {
      var who = rosterLookup(vals[i][head.indexOf('Email Address')]);
      var author = who ? who['Last Name'] : '';
      return 'SB ' + no + '\t' + author + '\t' + vals[i][head.indexOf('Short Subject')];
    }
  }
  return String(value) + '\t\t[not found among filed bills — check the number]';
}

/** Chair/vice/member names for a committee, from the newest Assignments row. */
function latestAssignments(code) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Assignments');
  var out = { chair: '', vice: '', members: '' };
  if (!sheet || sheet.getLastRow() < 2) return out;
  var vals = sheet.getDataRange().getValues();
  var head = vals[0];
  var last = vals[vals.length - 1];
  var up = code.toUpperCase();
  if (code !== 'floor') {
    out.chair   = String(last[head.indexOf(up + ' Chair')] || '');
    out.vice    = String(last[head.indexOf(up + ' Vice Chair')] || '');
    out.members = String(last[head.indexOf(up + ' Members')] || '');
  }
  return out;
}

/** Fill the agenda template and export the named PDF into agendas/. */
function assembleAgendaPdf(spec) {
  var working = DriveApp.getFileById(
      deployProp('AGENDA_TEMPLATE_DOC_ID', AGENDA_TEMPLATE_DOC_ID))
    .makeCopy('assembling-' + spec.fileName);
  var doc = DocumentApp.openById(working.getId());
  var body = doc.getBody();

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
