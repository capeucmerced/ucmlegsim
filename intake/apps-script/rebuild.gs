/**
 * rebuild.gs — asks GitHub to rebuild and redeploy the site right now.
 *
 * Install: part of the "LegSim Intake" workbook's Apps Script project
 * (Extensions → Apps Script). One-time setup:
 *   1. Create a GitHub fine-grained token (resource owner: capeucmerced,
 *      only the ucmlegsim repo) with "Contents: Read and write" — the
 *      /dispatches endpoint requires contents write; no other permission
 *      is needed.
 *   2. In the Apps Script editor: Project Settings → Script properties →
 *      add property GITHUB_TOKEN with the token as its value.
 *
 * After that, every form submission triggers a rebuild automatically
 * (see intake_workbook.gs), and the admin gets a "LegSim → Rebuild site now"
 * menu item in the workbook.
 */

var GITHUB_REPO = 'capeucmerced/ucmlegsim';

function requestSiteRebuild() {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) {
    console.error('GITHUB_TOKEN script property is not set — cannot trigger rebuild.');
    return;
  }
  var response = UrlFetchApp.fetch(
    'https://api.github.com/repos/' + GITHUB_REPO + '/dispatches',
    {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json'
      },
      payload: JSON.stringify({ event_type: 'rebuild-site' }),
      muteHttpExceptions: true
    }
  );
  // GitHub answers 204 on success
  if (response.getResponseCode() !== 204) {
    console.error('Rebuild request failed: ' + response.getResponseCode() + ' ' + response.getContentText());
  }
}

/** Adds a "LegSim" menu to the workbook with a manual rebuild button. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('LegSim')
    .addItem('Rebuild site now', 'requestSiteRebuild')
    .addToUi();
}
