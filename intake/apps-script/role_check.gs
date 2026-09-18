/**
 * role_check.gs — the "Check My Role" self-service receipt.
 *
 * A student submits the (question-free) check form; the router looks
 * their verified email up on the Roster and EMAILS THEM BACK what the
 * system believes they are. Passing the check proves the exact
 * email -> Roster join every other form relies on. Submissions write
 * nothing to the site and request no rebuild.
 *
 * Install (additive — disturbs nothing existing):
 *   1. Add this file to the intake workbook's Apps Script project.
 *   2. Re-paste intake_workbook.gs (its router gained the 'Role Check'
 *      branch and skips the rebuild for it). Script properties survive.
 *   3. Run buildRoleCheckForm() once. It creates the form, links it to
 *      this workbook as the 'Role Check' tab, and logs the URL to share.
 *   4. As with every form: confirm Settings -> Responses -> Collect
 *      email addresses -> "Verified" by hand.
 *   5. Test: submit the form from any account and read the reply.
 */

function buildRoleCheckForm() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var before = ss.getSheets().map(function (s) { return s.getName(); });

  var form = FormApp.create('LegSim — Check My Role');
  form.setDescription(
    'Press Submit and the simulation emails this account what role it ' +
    'has you down as. Nothing to fill in; check as often as you like.');
  try { form.setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED); }
  catch (err) { form.setCollectEmail(true); } // older API: verify by hand
  form.addCheckboxItem().setTitle('Email me my role')
      .setChoiceValues(['Yes']).setRequired(true);

  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();

  // Rename the tab the link just created (retry: creation can lag)
  for (var tries = 0; tries < 10; tries++) {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (before.indexOf(sheets[i].getName()) === -1) {
        sheets[i].setName('Role Check');
        PropertiesService.getScriptProperties()
          .setProperty('FORM_ID_ROLECHECK', form.getId());
        Logger.log('Role Check form ready. Share this URL:');
        Logger.log(form.getPublishedUrl());
        return;
      }
    }
    Utilities.sleep(1000);
  }
  Logger.log('Form created but its response tab was not found — link it ' +
             'by hand (Responses -> link icon) and name the tab "Role Check".');
}

/** Router target for the 'Role Check' tab (see intake_workbook.gs). */
function handleRoleCheckSubmit(e) {
  var row = rowAsObject(e);
  var email = String(row['Email Address'] || '').trim();
  if (!email) return;

  var who = rosterLookup(email);
  var summary, body;

  if (!who) {
    summary = 'not registered';
    body = 'This Google account (' + email + ') is not on the simulation ' +
           'roster yet.\n\nIf you have not registered, submit the ' +
           'Registration form first. If you registered with a DIFFERENT ' +
           'Google account, sign in with that one — your role follows ' +
           'the account, not the person. If you believe this is wrong, ' +
           'tell your instructor.';
  } else {
    var role = String(who['Role'] || '').toLowerCase().trim();
    if (role === 'senator') {
      summary = 'Senator ' + who['First Name'] + ' ' + who['Last Name'] +
                ' (' + (who['Party'] || '?') + '-SD' + who['District'] + ')';
      body = 'You are ' + summary + '.\n\n' +
             (who['Bill Doc 1']
               ? 'Your two bill draft docs (Draft A and Draft B) are shared ' +
                 'to this address — look for "LegSim — SB Draft" in your ' +
                 'Drive ("Shared with me").'
               : 'Your bill draft docs are not provisioned yet — mention ' +
                 'it to your instructor.');
    } else if (role === 'lobbyist') {
      summary = 'the lobbyist for org code ' + String(who['Org Code'] || '?').toUpperCase();
      body = 'You are ' + summary + ' — your organization\'s page is on ' +
             'the site\'s Lobbyists tab. Letters and contributions you ' +
             'file from this account are credited to that organization.';
    } else if (role === 'journalist') {
      summary = 'a journalist writing for the ' + (who['Outlet'] || '?');
      body = 'You are ' + summary + '. Wire posts from this account run ' +
             'under that nameplate.';
    } else {
      summary = 'registered, role pending';
      body = 'You are registered, but your role has not been assigned ' +
             'yet. Check back after your instructor hooks you up.';
    }
    body += '\n\nEvery simulation form identifies you exactly this way, ' +
            'so if the above is right, you are fully hooked up. If it is ' +
            'wrong, tell your instructor.';
  }

  MailApp.sendEmail(email, 'LegSim role check: ' + summary, body);

  // Audit trail for the admin, in a script column right of the responses
  var sheet = e.range.getSheet();
  var head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = headIndexByPrefix(head, 'Result');
  if (col === -1) {
    col = head.length;
    sheet.getRange(1, col + 1).setValue('Result');
  }
  sheet.getRange(e.range.getRow(), col + 1).setValue(summary);
}
