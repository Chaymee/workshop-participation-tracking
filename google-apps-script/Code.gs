// ============================================================
// Workshop Tracker — Google Apps Script Web App
// Deploy as: Execute as ME, Access: ANYONE (even anonymous)
// ============================================================

const SHEET_NAME = "Completions";
const FEEDBACK_SHEET_NAME = "Feedback";
const FEEDBACK_HEADERS = [
  "Timestamp",
  "Workshop",
  "Codespace",
  "Git User Name",
  "Git Email",
  "GitHub User",
  "Name",
  "Email",
  "Section ID",
  "Section Title",
  "Feedback"
];
const HEADERS = [
  "Timestamp",
  "Workshop",
  "Codespace",
  "Git User Name",
  "Git Email",
  "GitHub User",
  "Name",
  "Email",
  "Section ID",
  "Section Title",
  "Action"   // "started", "completed", or "unchecked"
];

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const sheet = getOrCreateSheet();
    
    // Handle feedback: write to separate Feedback sheet
    if (payload.action === "feedback") {
      const fbSheet = getOrCreateFeedbackSheet();
      fbSheet.appendRow([
        new Date().toISOString(),
        payload.workshop     || "",
        payload.codespace    || "",
        payload.gitName      || "",
        payload.gitEmail     || "",
        payload.githubUser   || "",
        payload.name         || "",
        payload.email        || "",
        payload.sectionId    || "",
        payload.sectionTitle || "",
        payload.feedback     || ""
      ]);
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, action: "feedback" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Handle deleteSections: remove specific section rows from both sheets
    if (payload.action === "deleteSections") {
      deleteSectionRows(sheet, payload);
      var fbSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEEDBACK_SHEET_NAME);
      if (fbSheet) deleteSectionRows(fbSheet, payload);
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, action: "deleteSections" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Handle reset: delete all rows for this participant from both sheets
    if (payload.action === "reset") {
      deleteRowsForParticipant(sheet, payload);
      var fbSheetReset = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEEDBACK_SHEET_NAME);
      if (fbSheetReset) deleteRowsForParticipant(fbSheetReset, payload);
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, action: "reset" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    sheet.appendRow([
      new Date().toISOString(),
      payload.workshop     || "",
      payload.codespace    || "",
      payload.gitName      || "",
      payload.gitEmail     || "",
      payload.githubUser   || "",
      payload.name         || "",
      payload.email        || "",
      payload.sectionId    || "",
      payload.sectionTitle || "",
      payload.action       || "completed"
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Handles preflight / health check from the extension
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, status: "Workshop Tracker active" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);

    // Style header row
    const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setBackground("#4a86e8");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");
    sheet.setFrozenRows(1);

    // Set column widths
    sheet.setColumnWidth(1, 200);  // Timestamp
    sheet.setColumnWidth(2, 160);  // Workshop
    sheet.setColumnWidth(3, 180);  // Codespace
    sheet.setColumnWidth(4, 160);  // Git User Name
    sheet.setColumnWidth(5, 200);  // Git Email
    sheet.setColumnWidth(6, 140);  // GitHub User
    sheet.setColumnWidth(7, 140);  // Name
    sheet.setColumnWidth(8, 200);  // Email
    sheet.setColumnWidth(9, 80);   // Section ID
    sheet.setColumnWidth(10, 260); // Section Title
    sheet.setColumnWidth(11, 100); // Action
  }

  return sheet;
}

function getOrCreateFeedbackSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(FEEDBACK_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(FEEDBACK_SHEET_NAME);
    sheet.appendRow(FEEDBACK_HEADERS);

    const headerRange = sheet.getRange(1, 1, 1, FEEDBACK_HEADERS.length);
    headerRange.setBackground("#34a853");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");
    sheet.setFrozenRows(1);

    sheet.setColumnWidth(1, 200);  // Timestamp
    sheet.setColumnWidth(2, 160);  // Workshop
    sheet.setColumnWidth(3, 180);  // Codespace
    sheet.setColumnWidth(4, 160);  // Git User Name
    sheet.setColumnWidth(5, 200);  // Git Email
    sheet.setColumnWidth(6, 140);  // GitHub User
    sheet.setColumnWidth(7, 140);  // Name
    sheet.setColumnWidth(8, 200);  // Email
    sheet.setColumnWidth(9, 80);   // Section ID
    sheet.setColumnWidth(10, 260); // Section Title
    sheet.setColumnWidth(11, 400); // Feedback
  }

  return sheet;
}

function deleteSectionRows(sheet, payload) {
  const sectionIds = (payload.sectionIds || []).map(function(id) { return id.toLowerCase().trim(); });
  if (sectionIds.length === 0) return;

  const data = sheet.getDataRange().getValues();
  const pGitName    = (payload.gitName    || "").toLowerCase().trim();
  const pGitEmail   = (payload.gitEmail   || "").toLowerCase().trim();
  const pGithubUser = (payload.githubUser || "").toLowerCase().trim();
  const pName       = (payload.name       || "").toLowerCase().trim();
  const pEmail      = (payload.email      || "").toLowerCase().trim();
  const pCodespace  = (payload.codespace  || "").toLowerCase().trim();
  const IGNORED = ["unknown", ""];

  const hasIdentifier =
    (!IGNORED.includes(pGitName))    ||
    (!IGNORED.includes(pGitEmail))   ||
    (!IGNORED.includes(pGithubUser)) ||
    (!IGNORED.includes(pName))       ||
    (!IGNORED.includes(pEmail));

  for (let i = data.length - 1; i >= 1; i--) {
    const rowSectionId  = (data[i][8]  || "").toString().toLowerCase().trim();  // column I
    if (!sectionIds.includes(rowSectionId)) continue;

    const rowCodespace  = (data[i][2]  || "").toString().toLowerCase().trim();
    const rowGitName    = (data[i][3]  || "").toString().toLowerCase().trim();
    const rowGitEmail   = (data[i][4]  || "").toString().toLowerCase().trim();
    const rowGithubUser = (data[i][5]  || "").toString().toLowerCase().trim();
    const rowName       = (data[i][6]  || "").toString().toLowerCase().trim();
    const rowEmail      = (data[i][7]  || "").toString().toLowerCase().trim();

    let match = false;
    if (hasIdentifier) {
      match =
        (!IGNORED.includes(pGitName)    && rowGitName    === pGitName)    ||
        (!IGNORED.includes(pGitEmail)   && rowGitEmail   === pGitEmail)   ||
        (!IGNORED.includes(pGithubUser) && rowGithubUser === pGithubUser) ||
        (!IGNORED.includes(pEmail)      && rowEmail      === pEmail)      ||
        (!IGNORED.includes(pName)       && rowName       === pName);
    } else if (pCodespace) {
      match = (rowCodespace === pCodespace);
    }

    if (match) {
      sheet.deleteRow(i + 1);
    }
  }
}

function deleteRowsForParticipant(sheet, payload) {
  const data = sheet.getDataRange().getValues();
  const pCodespace  = (payload.codespace  || "").toLowerCase().trim();
  const pGitName    = (payload.gitName    || "").toLowerCase().trim();
  const pGitEmail   = (payload.gitEmail   || "").toLowerCase().trim();
  const pGithubUser = (payload.githubUser || "").toLowerCase().trim();
  const pName       = (payload.name       || "").toLowerCase().trim();
  const pEmail      = (payload.email      || "").toLowerCase().trim();

  const IGNORED = ["unknown", ""];

  const hasIdentifier =
    (!IGNORED.includes(pGitName))    ||
    (!IGNORED.includes(pGitEmail))   ||
    (!IGNORED.includes(pGithubUser)) ||
    (!IGNORED.includes(pName))       ||
    (!IGNORED.includes(pEmail));

  // Walk rows bottom-up so deletions don't shift indices
  for (let i = data.length - 1; i >= 1; i--) {  // skip header row
    const rowCodespace  = (data[i][2]  || "").toString().toLowerCase().trim();  // column C
    const rowGitName    = (data[i][3]  || "").toString().toLowerCase().trim();  // column D
    const rowGitEmail   = (data[i][4]  || "").toString().toLowerCase().trim();  // column E
    const rowGithubUser = (data[i][5]  || "").toString().toLowerCase().trim();  // column F
    const rowName       = (data[i][6]  || "").toString().toLowerCase().trim();  // column G
    const rowEmail      = (data[i][7]  || "").toString().toLowerCase().trim();  // column H

    let match = false;

    if (hasIdentifier) {
      match =
        (!IGNORED.includes(pGitName)    && rowGitName    === pGitName)    ||
        (!IGNORED.includes(pGitEmail)   && rowGitEmail   === pGitEmail)   ||
        (!IGNORED.includes(pGithubUser) && rowGithubUser === pGithubUser) ||
        (!IGNORED.includes(pEmail)      && rowEmail      === pEmail)      ||
        (!IGNORED.includes(pName)       && rowName       === pName);
    } else if (pCodespace) {
      match = (rowCodespace === pCodespace);
    }

    if (match) {
      sheet.deleteRow(i + 1);  // Sheets rows are 1-indexed
    }
  }
}
