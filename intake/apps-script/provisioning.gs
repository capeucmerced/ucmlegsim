/**
 * provisioning.gs — one-time setup runs for the bills machinery.
 *
 * createBillTemplate()  builds the official bill-format Google Doc with
 *   all the {{PLACEHOLDERS}} the assembler fills. Run once, copy the ID
 *   it logs into BILL_TEMPLATE_DOC_ID (bills_assembler.gs). The styling
 *   is a solid starting point — refine fonts/spacing in Docs by hand
 *   afterward; placeholders just have to survive intact.
 *
 * provisionBillDocs()  creates the two bill-body docs for every roster
 *   row with Role = senator whose "Bill Doc 1" is empty, shares them with
 *   the senator's account, and writes the doc IDs into the Roster. Safe
 *   to rerun any time (skips already-provisioned rows) — run it again
 *   whenever new senators join the roster.
 */

function createBillTemplate() {
  var doc = DocumentApp.create('LegSim — Bill Template');
  var b = doc.getBody();
  b.setAttributes(styled({}, { FONT_FAMILY: 'Georgia', FONT_SIZE: 10 }));

  function para(text, opts) {
    var p = b.appendParagraph(text);
    p.setAttributes(styled(opts || {}, {}));
    return p;
  }

  para('CALIFORNIA LEGISLATURE — UC MERCED LEGISLATIVE SIMULATION',
       { align: 'center', size: 8, bold: true, spacingAfter: 14 });
  para('SENATE BILL {{SB}}',
       { align: 'center', size: 18, bold: true, spacingAfter: 10 });
  para('Introduced by Senator {{AUTHOR}}',
       { align: 'center', size: 11, spacingAfter: 16 });
  para('An act relating to {{TITLE}}.',
       { align: 'center', size: 11, italic: true, spacingAfter: 16 });
  para("LEGISLATIVE COUNSEL'S DIGEST",
       { align: 'center', size: 9, bold: true, spacingAfter: 6 });
  para('{{SB}}, {{AUTHOR}}. {{TITLE}}.',
       { size: 9, bold: true, spacingAfter: 4 });
  para('{{DIGEST}}', { size: 9, spacingAfter: 6 });
  para('{{FLAGS}}', { size: 8, italic: true, spacingAfter: 18 });
  para('THE PEOPLE OF THE STATE OF CALIFORNIA DO ENACT AS FOLLOWS:',
       { align: 'center', size: 11, bold: true, spacingAfter: 14 });
  para('{{BODY}}', { size: 10 });

  // Remove the empty first paragraph Docs starts with
  if (b.getChild(0).asText().getText() === '') b.removeChild(b.getChild(0));

  doc.saveAndClose();
  Logger.log('Bill template created. PASTE THIS ID into BILL_TEMPLATE_DOC_ID:');
  Logger.log(doc.getId());
}

function styled(opts, base) {
  var a = {};
  for (var k in base) a[DocumentApp.Attribute[k]] = base[k];
  if (opts.align === 'center') a[DocumentApp.Attribute.HORIZONTAL_ALIGNMENT] = DocumentApp.HorizontalAlignment.CENTER;
  if (opts.size)   a[DocumentApp.Attribute.FONT_SIZE] = opts.size;
  if (opts.bold)   a[DocumentApp.Attribute.BOLD] = true;
  if (opts.italic) a[DocumentApp.Attribute.ITALIC] = true;
  if (opts.spacingAfter) a[DocumentApp.Attribute.SPACING_AFTER] = opts.spacingAfter;
  return a;
}

function provisionBillDocs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var roster = ss.getSheetByName('Roster');
  var vals = roster.getDataRange().getValues();
  var head = vals[0];
  var cRole  = head.indexOf('Role');
  var cMail  = head.indexOf('Email');
  var cFirst = head.indexOf('First Name');
  var cLast  = head.indexOf('Last Name');
  var cDoc1  = head.indexOf('Bill Doc 1');
  var cDoc2  = head.indexOf('Bill Doc 2');

  var made = 0;
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][cRole]).toLowerCase().trim() !== 'senator') continue;
    if (vals[i][cDoc1]) continue; // already provisioned

    var name  = (vals[i][cFirst] + ' ' + vals[i][cLast]).trim();
    var email = String(vals[i][cMail]).trim();

    for (var n = 1; n <= 2; n++) {
      var doc = DocumentApp.create('LegSim — SB Draft ' + n + ' — Sen. ' + name);
      var body = doc.getBody();
      body.appendParagraph('Write the legal text of your bill in this document, ' +
        'using normal formatting — italics for added language, strikethrough ' +
        'for deleted language. Delete this instruction paragraph when you start.')
        .setItalic(true).setFontSize(9);
      body.appendParagraph('SECTION 1. ');
      doc.saveAndClose();

      try { DriveApp.getFileById(doc.getId()).addEditor(email); }
      catch (err) { /* provisioning under the student's own account (beta) */ }

      roster.getRange(i + 1, (n === 1 ? cDoc1 : cDoc2) + 1).setValue(doc.getId());
    }
    made++;
    Logger.log('Provisioned 2 bill docs for ' + name + ' (' + email + ')');
  }
  Logger.log(made === 0 ? 'Nothing to do — all senators already provisioned.'
                        : 'Done: ' + made + ' senator(s) provisioned.');
}
