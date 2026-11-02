/**
 * transfers.gs — senator-to-senator transfers of campaign funds.
 *
 * Rules (classroom):
 *   - A senator may transfer any amount up to what their coffer holds:
 *     lobby contributions received + transfers received − transfers sent.
 *     Nothing else limits it. The fundraising goal is judged on the
 *     balance at the END of the session, so giving money away is the
 *     senator's own call.
 *   - A transfer over the balance, or to the sender themself, is refused
 *     WHOLE: the row is voided and the sender is emailed why.
 *   - An accepted transfer emails a receipt (with the new balance) to the
 *     sender and a notice to the recipient. The site shows transfers in
 *     both senators' ledgers, in Money Watch, and in the Stats folds.
 *
 * Install: add this file to the intake project (the router in
 * intake_workbook.gs dispatches Transfers rows here). Then, in order:
 * buildTransfers() in forms_builder.gs creates the form and its tab;
 * syncRosterDropdowns() fills the recipient list; redeploy the gateway
 * web app as a NEW VERSION so the site can read ?view=transfers.
 * The site reads the same numbers in scripts/shared.R (senator_finance).
 */

/** Senator roster rows by district: { "16": {email, first, last} }. */
function senatorsByDistrict_() {
  var rows = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Roster')
    .getDataRange().getValues();
  var head = rows[0], out = {};
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][head.indexOf('Role')]).toLowerCase().trim() !== 'senator') continue;
    var d = parseInt(rows[i][head.indexOf('District')], 10);
    if (isNaN(d)) continue;
    out[String(d)] = {
      email: String(rows[i][head.indexOf('Email')]).toLowerCase().trim(),
      first: String(rows[i][head.indexOf('First Name')]),
      last:  String(rows[i][head.indexOf('Last Name')])
    };
  }
  return out;
}

/** email -> district (as a string) for every senator on the Roster. */
function senatorDistrictMap_() {
  var by = senatorsByDistrict_(), out = {};
  Object.keys(by).forEach(function (d) { if (by[d].email) out[by[d].email] = d; });
  return out;
}

/**
 * What a senator's coffer holds right now, from non-void rows: lobby
 * contributions received (Spending tab) + transfers received − transfers
 * sent (Transfers tab). skipRow (sheet row number on Transfers) leaves
 * out the row being handled.
 */
function senatorBalance_(district, skipRow) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var d = String(parseInt(district, 10));
  var total = 0;

  var sp = ss.getSheetByName('Spending');
  if (sp && sp.getLastRow() > 1) {
    var rows = sp.getDataRange().getValues(), head = rows[0];
    var cMail  = colStartingWith(head, 'Email Address');
    var cRecip = colStartingWith(head, 'Who received');
    var cAmt   = colStartingWith(head, 'Amount');
    var cStat  = head.indexOf('Status');
    var orgByEmail = rosterOrgMap();   // same test the gateway applies
    for (var i = 1; i < rows.length; i++) {
      if (cStat >= 0 && rows[i][cStat]) continue;
      if (!orgByEmail[String(rows[i][cMail]).toLowerCase().trim()]) continue;
      var m = String(rows[i][cRecip] || '').match(/^SD-(\d+)/);
      if (m && m[1] === d) total += Number(rows[i][cAmt]) || 0;
    }
  }

  var tr = ss.getSheetByName('Transfers');
  if (tr && tr.getLastRow() > 1) {
    var trows = tr.getDataRange().getValues(), thead = trows[0];
    var tMail  = colStartingWith(thead, 'Email Address');
    var tRecip = colStartingWith(thead, 'Who receives');
    var tAmt   = colStartingWith(thead, 'Amount');
    var tStat  = thead.indexOf('Status');
    var districtByEmail = senatorDistrictMap_();
    for (var j = 1; j < trows.length; j++) {
      if (j + 1 === skipRow) continue;
      if (tStat >= 0 && trows[j][tStat]) continue;
      var amt  = Number(trows[j][tAmt]) || 0;
      var from = districtByEmail[String(trows[j][tMail]).toLowerCase().trim()];
      var to   = String(trows[j][tRecip] || '').match(/^SD-(\d+)/);
      if (from === d) total -= amt;
      if (to && to[1] === d) total += amt;
    }
  }
  return total;
}

function handleTransfersSubmit(e) {
  var row = rowAsObject(e);
  var who = rosterLookup(row['Email Address']);
  if (!who || String(who['Role']).toLowerCase().trim() !== 'senator' || !who['District']) {
    throw new Error('Transfer from ' + row['Email Address'] + ', which is not a ' +
                    'senator on the Roster. Fix the Roster, then have them resubmit.');
  }
  var from = String(parseInt(who['District'], 10));
  var fromName = who['Last Name'] + ', ' + who['First Name'];
  var recipient = String(valueByPrefix(row, 'Who receives') || '');
  var dm = recipient.match(/^SD-(\d+)/);
  var amount = Number(valueByPrefix(row, 'Amount'));
  if (!dm || isNaN(amount) || amount <= 0) {
    throw new Error('Transfer row ' + e.range.getRow() + ' has no recipient district ' +
                    'or no amount — check the form questions.');
  }
  var to = dm[1];
  var toName = recipient.replace(/^SD-\d+\s*·\s*/, '');

  // One transfer at a time: two filed seconds apart must not both pass
  // the balance check.
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var balance = senatorBalance_(from, e.range.getRow());
    var refusal = null;
    if (to === from) {
      refusal = 'you cannot transfer money to yourself.';
    } else if (amount > balance) {
      refusal = 'your coffer holds ' + dollars_(balance) + ' and this transfer is ' +
        dollars_(amount) + '.';
    }

    if (refusal) {
      setScriptColumn_(e, 'Status', 'void: refused — ' + refusal);
      GmailApp.sendEmail(
        row['Email Address'],
        'Not recorded: ' + dollars_(amount) + ' to Senator ' + toName,
        'Your transfer of ' + dollars_(amount) + ' to Senator ' + toName +
        ' was NOT recorded, because ' + refusal + '\n\nNothing moved. If you ' +
        'still want to transfer, file it again with an amount that fits.'
      );
      return;
    }

    GmailApp.sendEmail(
      row['Email Address'],
      'Recorded: ' + dollars_(amount) + ' to Senator ' + toName,
      'Your transfer of ' + dollars_(amount) + ' to Senator ' + toName +
      ' is recorded and will appear on the site after its next build.\n\n' +
      'Your coffer now holds ' + dollars_(balance - amount) + '. Your fundraising ' +
      'goal is judged on your balance at the end of the session.'
    );
    var rec = senatorsByDistrict_()[to];
    if (rec && rec.email) {
      GmailApp.sendEmail(
        rec.email,
        'Received: ' + dollars_(amount) + ' from Senator ' + fromName,
        'Senator ' + fromName + ' transferred ' + dollars_(amount) + ' to your ' +
        'campaign. It will show in your ledger on the site after its next build.'
      );
    }
  } finally {
    lock.releaseLock();
  }
}
