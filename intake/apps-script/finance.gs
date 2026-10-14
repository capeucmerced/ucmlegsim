/**
 * finance.gs — campaign finance: PAC budgets, the contribution limit, and
 * the ledger.
 *
 * Rules (classroom rules, loosely modeled on California's):
 *   - Each lobbying organization has one PAC budget for the session,
 *     set by its tier (High / Medium / Low).
 *   - An organization may give at most CONTRIBUTION_LIMIT to any one
 *     senator over the whole session.
 *   - A contribution that would break either rule is refused WHOLE —
 *     the row is voided, the lobbyist is emailed why — and must be
 *     refiled with a legal amount. Accepted contributions get a receipt.
 *   - The Budgets tab is the ledger: Budget, Spent, Remaining per org,
 *     kept current by the handler. The site shows the same numbers.
 *
 * Install: add this file to the intake workbook's Apps Script project
 * (the router in intake_workbook.gs already dispatches Spending rows
 * here). Run setupBudgets() once to fill the Budgets tab, and
 * patchSpendingForm() once to put the rules on the live form. The
 * tiers below must match the Spending Power column of the site's
 * files/csvs/lobbyist_list.csv.
 */

var CONTRIBUTION_LIMIT = 11800;   // per organization, per senator, whole session
var TIER_BUDGETS = { High: 225000, Medium: 125000, Low: 75000 };
var ORG_TIERS = {
  COM: 'High', LABOR: 'High', ELEC: 'High', OIL: 'High', CTA: 'High', TRIBE: 'High', TECH: 'High',
  MED: 'Medium', LAW: 'Medium', BUILD: 'Medium', ATTY: 'Medium', BANK: 'Medium',
  FARM: 'Low', ENV: 'Low', LOCAL: 'Low'
};

/** "$12,345" */
function dollars_(n) {
  return '$' + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Totals from the Spending tab's non-void rows, by org and by org+senator.
 *  skipRow (sheet row number) leaves out the row being handled. */
function contributionTotals_(skipRow) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Spending');
  var byOrg = {}, byPair = {};
  if (!sheet || sheet.getLastRow() < 2) return { byOrg: byOrg, byPair: byPair };
  var rows = sheet.getDataRange().getValues();
  var head = rows[0];
  var cMail = colStartingWith(head, 'Email Address');
  var cRecip = colStartingWith(head, 'Who received');
  var cAmt = colStartingWith(head, 'Amount');
  var cStat = head.indexOf('Status');
  var orgByEmail = rosterOrgMap();
  for (var i = 1; i < rows.length; i++) {
    if (i + 1 === skipRow) continue;
    if (cStat >= 0 && rows[i][cStat]) continue;
    var org = orgByEmail[String(rows[i][cMail]).toLowerCase().trim()];
    var d = String(rows[i][cRecip] || '').match(/^SD-(\d+)/);
    var amt = Number(rows[i][cAmt]);
    if (!org || !d || isNaN(amt)) continue;
    byOrg[org] = (byOrg[org] || 0) + amt;
    byPair[org + '|' + d[1]] = (byPair[org + '|' + d[1]] || 0) + amt;
  }
  return { byOrg: byOrg, byPair: byPair };
}

/** An org's budget: the Budgets tab if it has a row, else its tier. */
function orgBudget_(code) {
  var tab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Budgets');
  if (tab && tab.getLastRow() > 1) {
    var rows = tab.getDataRange().getValues();
    var cCode = rows[0].indexOf('Org Code'), cBud = rows[0].indexOf('Budget');
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][cCode]).toUpperCase().trim() === code && rows[i][cBud] !== '') {
        return Number(rows[i][cBud]);
      }
    }
  }
  return TIER_BUDGETS[ORG_TIERS[code]] || 0;
}

/** Rewrites the Budgets tab from the tiers and the current Spending rows. */
function setupBudgets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName('Budgets') || ss.insertSheet('Budgets');
  var totals = contributionTotals_(-1);
  var codes = Object.keys(ORG_TIERS).sort();
  var rows = [['Org Code', 'Budget', 'Spent', 'Remaining']];
  codes.forEach(function (code) {
    var budget = TIER_BUDGETS[ORG_TIERS[code]];
    var spent = totals.byOrg[code] || 0;
    rows.push([code, budget, spent, budget - spent]);
  });
  tab.clearContents();
  tab.getRange(1, 1, rows.length, 4).setValues(rows);
  tab.getRange(1, 1, 1, 4).setFontWeight('bold');
  tab.getRange(2, 2, rows.length - 1, 3).setNumberFormat('$#,##0');
  Logger.log('Budgets tab written for ' + codes.length + ' organizations.');
}

/** Updates one org's Spent/Remaining on the Budgets tab (adds its row if
 *  missing). */
function updateBudgetRow_(code) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName('Budgets') || ss.insertSheet('Budgets');
  if (tab.getLastRow() < 1) {
    tab.getRange(1, 1, 1, 4).setValues([['Org Code', 'Budget', 'Spent', 'Remaining']]);
  }
  var rows = tab.getDataRange().getValues();
  var head = rows[0];
  var cCode = head.indexOf('Org Code'), cBud = head.indexOf('Budget');
  var cSpent = head.indexOf('Spent'), cRem = head.indexOf('Remaining');
  var spent = contributionTotals_(-1).byOrg[code] || 0;
  var budget = orgBudget_(code);
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][cCode]).toUpperCase().trim() === code) {
      tab.getRange(i + 1, cSpent + 1).setValue(spent);
      tab.getRange(i + 1, cRem + 1).setValue(budget - spent);
      return;
    }
  }
  tab.appendRow([code, budget, spent, budget - spent]);
}

function handleSpendingSubmit(e) {
  var row = rowAsObject(e);
  var who = rosterLookup(row['Email Address']);
  if (!who || !who['Org Code']) {
    throw new Error('Contribution from ' + row['Email Address'] + ', which has no ' +
                    'Org Code on the Roster. Fix the Roster, then have them resubmit.');
  }
  var code = String(who['Org Code']).toUpperCase().trim();
  var recipient = String(valueByPrefix(row, 'Who received') || '');
  var dm = recipient.match(/^SD-(\d+)/);
  var amount = Number(valueByPrefix(row, 'Amount'));
  if (!dm || isNaN(amount) || amount <= 0) {
    throw new Error('Contribution row ' + e.range.getRow() + ' has no recipient district ' +
                    'or no amount — check the form questions.');
  }
  var district = dm[1];
  var senator = recipient.replace(/^SD-\d+\s*·\s*/, '');

  var totals = contributionTotals_(e.range.getRow());
  var budget = orgBudget_(code);
  var spent = totals.byOrg[code] || 0;
  var toSenator = totals.byPair[code + '|' + district] || 0;

  var refusal = null;
  if (toSenator + amount > CONTRIBUTION_LIMIT) {
    refusal = 'it would bring your total to Senator ' + senator + ' to ' +
      dollars_(toSenator + amount) + ', over the ' + dollars_(CONTRIBUTION_LIMIT) +
      ' limit per senator. You have given this senator ' + dollars_(toSenator) +
      ' so far, so the most you can still give is ' +
      dollars_(Math.max(0, CONTRIBUTION_LIMIT - toSenator)) + '.';
  } else if (spent + amount > budget) {
    refusal = 'your organization has ' + dollars_(budget - spent) + ' left of its ' +
      dollars_(budget) + ' budget, and this contribution is ' + dollars_(amount) + '.';
  }

  if (refusal) {
    setScriptColumn_(e, 'Status', 'void: refused — ' + refusal.split(',')[0]);
    GmailApp.sendEmail(
      row['Email Address'],
      'Not recorded: ' + dollars_(amount) + ' to Senator ' + senator,
      'Your contribution of ' + dollars_(amount) + ' to Senator ' + senator +
      ' was NOT recorded, because ' + refusal + '\n\nNothing was deducted. ' +
      'If you still want to contribute, file it again with an amount that fits.'
    );
    return;
  }

  updateBudgetRow_(code);
  GmailApp.sendEmail(
    row['Email Address'],
    'Recorded: ' + dollars_(amount) + ' to Senator ' + senator,
    'Your contribution of ' + dollars_(amount) + ' to Senator ' + senator +
    ' is recorded and will appear on the site after its next build.\n\n' +
    'To this senator so far: ' + dollars_(toSenator + amount) + ' of the ' +
    dollars_(CONTRIBUTION_LIMIT) + ' limit.\n' +
    'Your organization\'s budget: ' + dollars_(budget - spent - amount) + ' left of ' +
    dollars_(budget) + '.'
  );
}

/**
 * Brings the LIVE contribution form up to the rules: the amount must be
 * between 100 and the per-senator limit, and the description states the
 * limit and the budget rule. Same form, same URL. Safe to rerun.
 */
function patchSpendingForm() {
  var form = FormApp.openById(deployProp('FORM_ID_Spending', ''));
  form.setDescription(
    'Each organization has one PAC budget for the session and may give at ' +
    'most ' + dollars_(CONTRIBUTION_LIMIT) + ' in total to any one senator. A ' +
    'contribution that would go over either is refused in full — you get an ' +
    'email saying why, and nothing is deducted — so refile it with an amount ' +
    'that fits. Every recorded contribution gets a receipt with your ' +
    'remaining balance.');
  form.getItems(FormApp.ItemType.TEXT).forEach(function (it) {
    if (it.getTitle().indexOf('Amount') !== 0) return;
    it.asTextItem().setValidation(FormApp.createTextValidation()
      .requireNumberBetween(100, CONTRIBUTION_LIMIT)
      .setHelpText('A number between 100 and ' + CONTRIBUTION_LIMIT + ', digits only.')
      .build());
  });
  Logger.log('Contribution form patched: ' + form.getPublishedUrl());
}
