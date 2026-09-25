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

// Both settings live in Script Properties (see intake_workbook.gs), so
// re-pasting this file never loses them; these are only fallbacks.
var BILL_TEMPLATE_DOC_ID = 'PUT-TEMPLATE-DOC-ID-HERE-AT-DEPLOY';

// New bills are numbered above this floor. BETA (2025 fixtures still on
// the site, occupying SB-1..75): 75. At the real launch: 0.
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

  var templateId = deployProp('BILL_TEMPLATE_DOC_ID', BILL_TEMPLATE_DOC_ID);

  // The bill's metadata: what this row answers, otherwise pulled forward
  // from the bill's earlier rows. Amendment rows carry optional
  // "Updated …" overrides — blank means keep, so nothing gets wiped by
  // an amendment that only changes the text. (Old-layout rows carried
  // the plain columns instead; both work.)
  var upFlags = String(valueByPrefix(row, 'Updated flags') || '');
  var meta = {
    subject: String(valueByPrefix(row, 'Updated short subject') ||
                    valueByPrefix(row, 'Short subject') || ''),
    digest:  String(valueByPrefix(row, 'Updated digest') ||
                    valueByPrefix(row, 'Digest') || '')
  };
  meta.flags = upFlags ? withoutNoFlags(upFlags)
                       : String(valueByPrefix(row, 'Flags') || '');
  var flagsAnswered = upFlags !== '' || meta.flags !== '';

  if (isAmendment) {
    sbNumber = billNumberFrom(valueByPrefix(row, 'Which of your bills'));
    var prior = latestBillMeta(sheet, head, sbNumber, e.range.getRow());

    // A wrong pick bounces instead of touching someone else's bill —
    // the dropdown lists every filed bill, so this is the likely slip.
    if (!prior.found || (prior.email &&
        prior.email !== String(row['Email Address']).toLowerCase().trim())) {
      sheet.getRange(e.range.getRow(), head.indexOf('Status') + 1).setValue('void');
      GmailApp.sendEmail(
        row['Email Address'],
        'Not filed: SB-' + sbNumber + ' is not one of your bills',
        'Your amendment was not filed: SB-' + sbNumber + ' was not introduced ' +
        'from this account. Nothing was changed. Pick one of your own bills ' +
        'in the amendment dropdown and submit again.'
      );
      return;
    }

    if (!meta.subject)  meta.subject = prior.subject;
    if (!meta.digest)   meta.digest  = prior.digest;
    if (!flagsAnswered) meta.flags   = prior.flags;

    archiveCurrentVersion(lastNameSlug, sbNumber);
  } else {
    sbNumber = nextSbNumber(sheet, head);
  }

  // Record the assigned number on the row so the site and later
  // amendments can find it
  sheet.getRange(e.range.getRow(), head.indexOf('SB Number') + 1).setValue(sbNumber);

  // Which body doc: the form asks outright ("Draft 1" / "Draft 2") —
  // explicit beats inferring it from filing order.
  // "Draft A"/"Draft B" (accepts legacy "Draft 1"/"Draft 2"): A = Doc 1
  var draftChoice = String(valueByPrefix(row, 'Which of your two draft docs'));
  var docId = /[B2]/.test(draftChoice) ? who['Bill Doc 2'] : who['Bill Doc 1'];
  if (!docId) { console.error('No body doc on the roster for ' + row['Email Address']); return; }

  var pdf = assembleBillPdf({
    sb: sbNumber,
    author: who['First Name'] + ' ' + who['Last Name'] +
            ' (' + (who['Party'] || 'D') + '-' + who['District'] + ')',
    title: meta.subject,
    digest: meta.digest,
    flags: flagsLine(meta.flags),
    bodyDocId: docId,
    templateId: templateId,
    fileName: lastNameSlug + '_SB' + sbNumber + '.pdf'
  });

  GmailApp.sendEmail(
    row['Email Address'],
    'Filed: SB-' + sbNumber + ' — ' + meta.subject,
    'Your bill has been filed and will appear on the site shortly. ' +
    'The formatted text is attached — if anything looks wrong, fix your ' +
    'bill doc and submit an amendment.',
    { attachments: [pdf] }
  );

  // Every dropdown that lists filed bills learns the new one immediately
  if (!isAmendment) addBillToFormDropdowns(sbNumber, meta.subject);
}

/** Newest non-empty metadata (and owner email) across a bill's earlier
 *  non-void rows. Rows are in submission order; skipRow is the sheet row
 *  being handled right now. Applies the same override rules per row, so
 *  chains of amendments resolve correctly. */
function latestBillMeta(sheet, head, sbNumber, skipRow) {
  var vals    = sheet.getDataRange().getValues();
  var cSb     = head.indexOf('SB Number');
  var cStat   = head.indexOf('Status');
  var cMail   = colStartingWith(head, 'Email Address');
  var cSubj   = colStartingWith(head, 'Short subject');
  var cUpSubj = colStartingWith(head, 'Updated short subject');
  var cDig    = colStartingWith(head, 'Digest');
  var cUpDig  = colStartingWith(head, 'Updated digest');
  var cFlag   = colStartingWith(head, 'Flags');
  var cUpFlag = colStartingWith(head, 'Updated flags');

  var cell = function (r, c) { return c >= 0 ? String(vals[r][c] || '') : ''; };
  var meta = { found: false, email: '', subject: '', digest: '', flags: '' };
  for (var i = 1; i < vals.length; i++) {
    if (i === skipRow - 1) continue;               // the row being handled
    if (cell(i, cStat)) continue;                  // void rows are ignored
    if (parseInt(vals[i][cSb], 10) !== sbNumber) continue;
    meta.found = true;
    if (cell(i, cMail)) meta.email = cell(i, cMail).toLowerCase().trim();
    var s = cell(i, cUpSubj) || cell(i, cSubj); if (s) meta.subject = s;
    var d = cell(i, cUpDig)  || cell(i, cDig);  if (d) meta.digest  = d;
    if (cell(i, cUpFlag))      meta.flags = withoutNoFlags(cell(i, cUpFlag));
    else if (cell(i, cFlag))   meta.flags = cell(i, cFlag);
  }
  return meta;
}

/** Push "SB-n — Subject" into every dropdown that lists filed bills: the
 *  Bills form's amend picker and the Letters form's bill picker. Form ids
 *  come from Script Properties (stored by forms_builder's finish());
 *  forms built before that existed are skipped harmlessly. */
function addBillToFormDropdowns(sbNumber, subject) {
  [['Bills', 'Which of your bills'], ['Letters', 'Which bill']].forEach(function (t) {
    try {
      var fid = deployProp('FORM_ID_' + t[0], '');
      if (!fid) return;
      var items = FormApp.openById(fid).getItems(FormApp.ItemType.LIST);
      for (var i = 0; i < items.length; i++) {
        var li = items[i].asListItem();
        if (li.getTitle().indexOf(t[1]) !== 0) continue;
        var vals = li.getChoices().map(function (c) { return c.getValue(); })
          .filter(function (v) {
            return v.indexOf('(choices sync') !== 0 &&      // builder placeholder
                   v.indexOf('SB-' + sbNumber + ' ') !== 0; // re-added fresh below
          });
        vals.push('SB-' + sbNumber + ' — ' + subject);
        li.setChoiceValues(vals);
      }
    } catch (err) {
      console.error('Could not update the ' + t[0] + ' form dropdown: ' + err);
    }
  });
}

/** Highest assigned SB number so far (or the floor) + 1. */
function nextSbNumber(sheet, head) {
  var col = head.indexOf('SB Number');
  var max = parseInt(deployProp('SB_NUMBER_FLOOR', SB_NUMBER_FLOOR), 10) || 0;
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
  var archived = current.makeCopy(lastNameSlug + '_SB' + sbNumber + '_v' + v + '.pdf', prev);
  try { archived.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  current.setTrashed(true); // replaced by the newly assembled PDF
}

/** Flags checkbox join ("Appropriations/fiscal, 2/3rds vote") -> the
 *  digest's metadata line, as on a real bill: "Vote: 2/3rds.
 *  Appropriations/fiscal: yes. Local program: no." Matches by keyword,
 *  so rows filed under the older flag labels still read. */
function flagsLine(flagsAnswer) {
  var flags = String(flagsAnswer || '');
  var has = function (word) { return flags.indexOf(word) !== -1 ? 'yes' : 'no'; };
  return 'Vote: ' + (flags.indexOf('2/3') !== -1 ? '2/3rds' : 'Majority') +
         '. Appropriations/fiscal: ' + has('Appropriation') +
         '. Local program: ' + has('Local program') + '.';
}

/** The digest may run several paragraphs: each line of the answer
 *  becomes its own paragraph, styled like the template's {{DIGEST}}. */
function fillDigest(body, digest) {
  var parts = String(digest || '').split(/\s*\n\s*/)
    .filter(function (p) { return p !== ''; });
  if (parts.length === 0) parts = [''];
  var para = body.findText('{{DIGEST}}').getElement().getParent();
  var at = body.getChildIndex(para);
  var paras = [para];
  for (var k = 1; k < parts.length; k++) {
    paras.push(body.insertParagraph(at + k, para.copy()));
  }
  paras.forEach(function (p, i) { putLiteral(p, '{{DIGEST}}', parts[i]); });
}

/** Swap every occurrence of a placeholder for text, keeping the
 *  placeholder's formatting. Unlike replaceText, the text is inserted
 *  literally: a "$" or "\" a student typed is never read as regex. */
function putLiteral(container, placeholder, text) {
  text = String(text || '');
  var hit;
  while ((hit = container.findText(placeholder))) {
    var t = hit.getElement().asText();
    var s = hit.getStartOffset(), e = hit.getEndOffsetInclusive();
    if (text) t.insertText(s, text);
    t.deleteText(s + text.length, e + text.length);
  }
}

/** Struck text -> red, italic text -> blue, from fromIndex to the end of
 *  the body (the region the student's legal text was imported into). */
function colorizeAmendmentMarks(body, fromIndex) {
  for (var i = fromIndex; i < body.getNumChildren(); i++) {
    var el = body.getChild(i);
    if (el.getType() !== DocumentApp.ElementType.PARAGRAPH &&
        el.getType() !== DocumentApp.ElementType.LIST_ITEM) continue;
    var t = el.asText();
    var txt = t.getText();
    if (!txt) continue;
    var idx = t.getTextAttributeIndices();
    for (var j = 0; j < idx.length; j++) {
      var start = idx[j];
      var end = (j + 1 < idx.length ? idx[j + 1] : txt.length) - 1;
      if (end < start) continue;
      if (t.isStrikethrough(start)) t.setForegroundColor(start, end, '#c00000');
      else if (t.isItalic(start))   t.setForegroundColor(start, end, '#1155cc');
    }
  }
}

/** Fill the template, append the body doc's content, export a named PDF. */
function assembleBillPdf(spec) {
  var working = DriveApp.getFileById(spec.templateId)
    .makeCopy('assembling-' + spec.fileName);
  var doc = DocumentApp.openById(working.getId());
  var body = doc.getBody();

  body.replaceText('{{SB}}', 'SB-' + spec.sb);
  body.replaceText('{{AUTHOR}}', spec.author);
  putLiteral(body, '{{TITLE}}', spec.title);
  fillDigest(body, spec.digest);
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

  // leginfo-style amendment colors, applied to the imported legal text
  // only (the template's own italics stay black): struck = red,
  // italic (added language) = blue. Students never color by hand.
  colorizeAmendmentMarks(body, markerIndex);

  doc.saveAndClose();

  var pdf = working.getAs(MimeType.PDF).setName(spec.fileName);
  var bills = filesSubfolder('bills');
  // Replace any same-named PDF (amendment case)
  var dupes = bills.getFilesByName(spec.fileName);
  while (dupes.hasNext()) dupes.next().setTrashed(true);
  var created = bills.createFile(pdf);
  // Bill PDFs are public site documents; link-view lets the build fetch them
  try { created.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}

  working.setTrashed(true); // the working Doc copy is no longer needed
  return pdf;
}
