/**
 * Backend "Liste de courses" - Google Apps Script lié à un Google Sheet.
 * Deploiement : Extensions > Apps Script > coller ce fichier > Déployer > Nouveau déploiement > Application Web
 * (Exécuter en tant que : Moi ; Qui a accès : Tout le monde).
 */

const SHEET_LISTE = 'Liste';
const SHEET_ARCHIVES = 'Archives';
const SHEET_RECURRENTS = 'Recurrents';

const HEADERS = {
  [SHEET_LISTE]: ['id', 'nom', 'categorie', 'statut', 'dateAjout', 'dateMaj'],
  [SHEET_ARCHIVES]: ['id', 'nom', 'categorie', 'dateAjout', 'dateArchive'],
  [SHEET_RECURRENTS]: ['id', 'modele', 'nom', 'categorie'],
};

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(HEADERS[name]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureSetup() {
  Object.keys(HEADERS).forEach(getSheet_);
  const defaultSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Feuille 1') ||
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
  if (defaultSheet && defaultSheet.getLastRow() === 0 && defaultSheet.getLastColumn() <= 1) {
    SpreadsheetApp.getActiveSpreadsheet().deleteSheet(defaultSheet);
  }
}

function rowsToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1)
    .filter(row => row[0] !== '')
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
}

function findRowIndexById_(sheet, id) {
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

function newId_() {
  return Utilities.getUuid();
}

function nowIso_() {
  return new Date().toISOString();
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  ensureSetup();
  const action = e.parameter.action;
  try {
    let result;
    switch (action) {
      case 'getListe':
        result = actionGetListe();
        break;
      case 'getArchives':
        result = actionGetArchives();
        break;
      case 'getModeles':
        result = actionGetModeles();
        break;
      case 'getSuggestions':
        result = actionGetSuggestions(e.parameter.q || '');
        break;
      default:
        return jsonOut_({ ok: false, error: 'Action GET inconnue: ' + action });
    }
    return jsonOut_({ ok: true, data: result });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  ensureSetup();
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Corps de requête invalide' });
  }
  const action = payload.action;
  try {
    let result;
    switch (action) {
      case 'ajouterArticle':
        result = withLock_(() => actionAjouterArticle(payload));
        break;
      case 'toggleAchete':
        result = withLock_(() => actionToggleAchete(payload));
        break;
      case 'archiver':
        result = withLock_(() => actionArchiver(payload));
        break;
      case 'restaurerDepuisArchive':
        result = withLock_(() => actionRestaurerDepuisArchive(payload));
        break;
      case 'supprimer':
        result = withLock_(() => actionSupprimer(payload));
        break;
      case 'ajouterAuModele':
        result = withLock_(() => actionAjouterAuModele(payload));
        break;
      case 'ajouterDepuisModele':
        result = withLock_(() => actionAjouterDepuisModele(payload));
        break;
      case 'supprimerDuModele':
        result = withLock_(() => actionSupprimerDuModele(payload));
        break;
      default:
        return jsonOut_({ ok: false, error: 'Action POST inconnue: ' + action });
    }
    return jsonOut_({ ok: true, data: result });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

// ---- Liste active ----

function actionGetListe() {
  return rowsToObjects_(getSheet_(SHEET_LISTE));
}

function actionAjouterArticle(payload) {
  const sheet = getSheet_(SHEET_LISTE);
  const id = payload.id || newId_();
  const existing = findRowIndexById_(sheet, id);
  if (existing === -1) {
    sheet.appendRow([id, payload.nom, payload.categorie || 'Autre', 'actif', nowIso_(), nowIso_()]);
  }
  return { id };
}

function actionToggleAchete(payload) {
  const sheet = getSheet_(SHEET_LISTE);
  const row = findRowIndexById_(sheet, payload.id);
  if (row === -1) throw new Error('Article introuvable');
  const statutCol = HEADERS[SHEET_LISTE].indexOf('statut') + 1;
  const majCol = HEADERS[SHEET_LISTE].indexOf('dateMaj') + 1;
  const nouveauStatut = payload.statut || (sheet.getRange(row, statutCol).getValue() === 'achete' ? 'actif' : 'achete');
  sheet.getRange(row, statutCol).setValue(nouveauStatut);
  sheet.getRange(row, majCol).setValue(nowIso_());
  return { id: payload.id, statut: nouveauStatut };
}

function actionArchiver(payload) {
  const liste = getSheet_(SHEET_LISTE);
  const archives = getSheet_(SHEET_ARCHIVES);
  const row = findRowIndexById_(liste, payload.id);
  if (row === -1) throw new Error('Article introuvable');
  const values = liste.getRange(row, 1, 1, HEADERS[SHEET_LISTE].length).getValues()[0];
  const obj = {};
  HEADERS[SHEET_LISTE].forEach((h, i) => { obj[h] = values[i]; });
  archives.appendRow([obj.id, obj.nom, obj.categorie, obj.dateAjout, nowIso_()]);
  liste.deleteRow(row);
  return { id: payload.id };
}

function actionRestaurerDepuisArchive(payload) {
  const liste = getSheet_(SHEET_LISTE);
  const archives = getSheet_(SHEET_ARCHIVES);
  const row = findRowIndexById_(archives, payload.id);
  if (row === -1) throw new Error('Article introuvable dans les archives');
  const values = archives.getRange(row, 1, 1, HEADERS[SHEET_ARCHIVES].length).getValues()[0];
  const obj = {};
  HEADERS[SHEET_ARCHIVES].forEach((h, i) => { obj[h] = values[i]; });
  liste.appendRow([obj.id, obj.nom, obj.categorie, 'actif', obj.dateAjout, nowIso_()]);
  archives.deleteRow(row);
  return { id: payload.id };
}

function actionSupprimer(payload) {
  const sheet = getSheet_(payload.source === 'archives' ? SHEET_ARCHIVES : SHEET_LISTE);
  const row = findRowIndexById_(sheet, payload.id);
  if (row === -1) return { id: payload.id };
  sheet.deleteRow(row);
  return { id: payload.id };
}

// ---- Archives ----

function actionGetArchives() {
  return rowsToObjects_(getSheet_(SHEET_ARCHIVES));
}

// ---- Modèles récurrents ----

function actionGetModeles() {
  const items = rowsToObjects_(getSheet_(SHEET_RECURRENTS));
  const modeles = {};
  items.forEach(item => {
    if (!modeles[item.modele]) modeles[item.modele] = [];
    modeles[item.modele].push(item);
  });
  return modeles;
}

function actionAjouterAuModele(payload) {
  const sheet = getSheet_(SHEET_RECURRENTS);
  const items = rowsToObjects_(sheet);
  const doublon = items.find(it => it.modele === payload.modele &&
    String(it.nom).toLowerCase() === String(payload.nom).toLowerCase());
  if (doublon) return { id: doublon.id };
  const id = newId_();
  sheet.appendRow([id, payload.modele, payload.nom, payload.categorie || 'Autre']);
  return { id };
}

function actionSupprimerDuModele(payload) {
  const sheet = getSheet_(SHEET_RECURRENTS);
  const row = findRowIndexById_(sheet, payload.id);
  if (row === -1) return { id: payload.id };
  sheet.deleteRow(row);
  return { id: payload.id };
}

function actionAjouterDepuisModele(payload) {
  const recurrents = rowsToObjects_(getSheet_(SHEET_RECURRENTS)).filter(it => it.modele === payload.modele);
  const liste = getSheet_(SHEET_LISTE);
  const actifs = rowsToObjects_(liste).map(it => String(it.nom).toLowerCase());
  const ajoutes = [];
  recurrents.forEach(item => {
    if (actifs.indexOf(String(item.nom).toLowerCase()) !== -1) return;
    const id = newId_();
    liste.appendRow([id, item.nom, item.categorie, 'actif', nowIso_(), nowIso_()]);
    ajoutes.push({ id, nom: item.nom, categorie: item.categorie });
  });
  return { ajoutes };
}

// ---- Suggestions / autocomplétion ----

function actionGetSuggestions(query) {
  const q = String(query).toLowerCase();
  if (!q) return [];
  const seen = {};
  const all = []
    .concat(rowsToObjects_(getSheet_(SHEET_LISTE)))
    .concat(rowsToObjects_(getSheet_(SHEET_ARCHIVES)))
    .concat(rowsToObjects_(getSheet_(SHEET_RECURRENTS)));
  all.forEach(item => {
    const nom = String(item.nom || '');
    if (nom.toLowerCase().indexOf(q) === -1) return;
    const key = nom.toLowerCase();
    if (!seen[key]) seen[key] = { nom, categorie: item.categorie || 'Autre' };
  });
  return Object.values(seen).slice(0, 8);
}
