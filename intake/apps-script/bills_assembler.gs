/**
 * bills_assembler.gs — turns a "File a Bill" submission into a formatted
 * bill PDF, with automatic SB numbering and amendment versioning.
 *
 * *** DRAFT: written before the course account existed. Must be walked
 * *** through live at deploy (see intake/README.md step 7) before students
 * *** use it. The logic is complete; Drive/Docs quirks may need touch-ups.
 *
 * Flow on submission (called from intake_workbook.gs):
 *   new bill    -> assign next SB number -> assemble PDF -> email author
 *   amendment   -> archive current PDF as _vN -> assemble replacement ->
 *                  email author
 *
 * The bill template is a Google Doc with these placeholders:
 *   {{SB}} {{AUTHOR}} {{TITLE}} {{DIGEST}} {{FLAGS}} {{BODY}}
 * The student's legal text lives in their pre-provisioned body doc
 * (Roster columns "Bill Doc 1"/"Bill Doc 2"), written with normal Docs
 * formatting including italics/strikethrough.
 */

var BILL_TEMPLATE_DOC_ID = 'PUT-TEMPLATE-DOC-ID-HERE-AT-DEPLOY';

// New bills are numbered above this floor. BETA (2025 fixtures still on
// the site, occupying SB-1..75): set to 75. At the real launch: 0.
var SB_NUMBER_FLOOR = 0;

function handleBillSubmit(e) {
  var row = rowAsObject(e);
  var who = rosterLookup(row['Email Address']);
  if (!who || who['Role'] !== 'senator') {
    console.error('Bill filed by non-senator account: ' + row['Email Address']);
    return;
  }

  var sheet = e.range.getSheet();
  var head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var lastNameSlug = String(who['Last Name']).toUpperCase().replace(/ /g, '_');

  var isAmendment = valueByPrefix(row, 'Is this a new bill') === 'Amendment';
  var sbNumber;

  if (isAmendment) {
    sbNumber = billNumberFrom(valueByPrefix(row, 'Which of your bills'));
    archiveCurrentVersion(lastNameSlug, sbNumber);
  } else {
    sbNumber = nextSbNumber(sheet, head);
  }

  // Record the assigned number on the row so the site and later
  // amendments can find it
  sheet.getRange(e.range.getRow(), head.indexOf('SB Number') + 1).setValue(sbNumber);

  // Which body doc: their first live bill uses Doc 1, the second Doc 2.
  // For amendments, match by the order of their filed bills.
  var docId = bodyDocFor(who, sheet, head, row['Email Address'], sbNumber, isAmendment);
  if (!docId) { console.error('No body doc found for ' + row['Email Address']); return; }

  var subject = String(valueByPrefix(row, 'Short subject'));
  var pdf = assembleBillPdf({
    sb: sbNumber,
    author: who['First Name'] + ' ' + who['Last Name'] +
            ' (' + (who['Party'] || 'D') + '-' + who['District'] + ')',
    title: subject,
    digest: String(valueByPrefix(row, 'Digest')),
    flags: flagsLine(valueByPrefix(row, 'Flags')),
    bodyDocId: docId,
    fileName: lastNameSlug + '_SB' + sbNumber + '.pdf'
  });

  GmailApp.sendEmail(
    row['Email Address'],
    'Filed: SB-' + sbNumber + ' — ' + subject,
    'Your bill has been filed and will appear on the site shortly. ' +
    'The formatted text is attached — if anything looks wrong, fix your ' +
    'bill doc and submit an amendment.',
    { attachments: [pdf] }
  );
}

/** Highest assigned SB number so far (or the floor) + 1. */
function nextSbNumber(sheet, head) {
  var col = head.indexOf('SB Number');
  var max = SB_NUMBER_FLOOR;
  var vals = sheet.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    var n = parseInt(vals[i][col], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

/** Copy the current PDF into previous_bills as the next _vN. */
function archiveCurrentVersion(lastNameSlug, sbNumber) {
  var bills = filesSubfolder('bills');
  var prev  = filesSubfolder('previous_bills');
  var name  = lastNameSlug + '_SB' + sbNumber + '.pdf';

  var existing = bills.getFilesByName(name);
  if (!existing.hasNext()) return; // nothing filed yet, nothing to archive
  var current = existing.next();

  var v = 1;
  while (prev.getFilesByName(lastNameSlug + '_SB' + sbNumber + '_v' + v + '.pdf').hasNext()) v++;
  current.makeCopy(lastNameSlug + '_SB' + sbNumber + '_v' + v + '.pdf', prev);
  current.setTrashed(true); // replaced by the newly assembled PDF
}

/** "Appropriation, Urgency" (Forms checkbox join) -> the metadata line. */
function flagsLine(flagsAnswer) {
  var picked = String(flagsAnswer || '').split(/,\s*/);
  var has = function (f) { return picked.indexOf(f) !== -1 ? 'yes' : 'no'; };
  return 'Appropriation: ' + has('Appropriation') +
         '. Fiscal committee: ' + has('Fiscal committee') +
         '. Local program: ' + has('Local program') +
         '. Urgency: ' + has('Urgency') + '.';
}

/** The Doc ID holding this filing's legal text. */
function bodyDocFor(who, sheet, head, email, sbNumber, isAmendment) {
  var cMail   = headIndexByPrefix(head, 'Email Address');
  var cFiling = headIndexByPrefix(head, 'Is this a new bill');
  var cSb     = head.indexOf('SB Number');
  var cStatus = head.indexOf('Status');

  // Their bills in filing order
  var mine = [];
  var vals = sheet.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][cMail]).toLowerCase().trim() ===
        String(email).toLowerCase().trim() &&
        vals[i][cFiling] === 'New bill' &&
        (cStatus < 0 || !vals[i][cStatus])) {
      mine.push(parseInt(vals[i][cSb], 10));
    }
  }
  var position = isAmendment ? (mine.indexOf(sbNumber) + 1) : mine.length; // 1-based
  if (position <= 1) return who['Bill Doc 1'];
  return who['Bill Doc 2'];
}

/** Fill the template, append the body doc's content, export a named PDF. */
function assembleBillPdf(spec) {
  var working = DriveApp.getFileById(BILL_TEMPLATE_DOC_ID)
    .makeCopy('assembling-' + spec.fileName);
  var doc = DocumentApp.openById(working.getId());
  var body = doc.getBody();

  body.replaceText('{{SB}}', 'SB-' + spec.sb);
  body.replaceText('{{AUTHOR}}', spec.author);
  body.replaceText('{{TITLE}}', spec.title);
  body.replaceText('{{DIGEST}}', spec.digest);
  body.replaceText('{{FLAGS}}', spec.flags);

  // Replace the {{BODY}} placeholder paragraph with the student's legal
  // text, copied element by element so italics/strikethrough survive.
  var marker = body.findText('{{BODY}}').getElement().getParent();
  var markerIndex = body.getChildIndex(marker);
  var source = DocumentApp.openById(spec.bodyDocId).getBody();
  for (var i = 0; i < source.getNumChildren(); i++) {
    var el = source.getChild(i).copy();
    var t = el.getType();
    if (t === DocumentApp.ElementType.PARAGRAPH) {
      body.insertParagraph(markerIndex + 1 + i, el);
    } else if (t === DocumentApp.ElementType.LIST_ITEM) {
      body.insertListItem(markerIndex + 1 + i, el);
    } else if (t === DocumentApp.ElementType.TABLE) {
      body.insertTable(markerIndex + 1 + i, el);
    }
  }
  body.removeChild(marker);
  doc.saveAndClose();

  var pdf = working.getAs(MimeType.PDF).setName(spec.fileName);
  var bills = filesSubfolder('bills');
  // Replace any same-named PDF (amendment case)
  var dupes = bills.getFilesByName(spec.fileName);
  while (dupes.hasNext()) dupes.next().setTrashed(true);
  bills.createFile(pdf);

  working.setTrashed(true); // the working Doc copy is no longer needed
  return pdf;
}
