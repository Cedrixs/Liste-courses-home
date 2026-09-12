/**
 * Backend "Liste de courses" - Google Apps Script lié à un Google Sheet.
 * Deploiement : Extensions > Apps Script > coller ce fichier > Déployer > Nouveau déploiement > Application Web
 * (Exécuter en tant que : Moi ; Qui a accès : Tout le monde).
 */

const SHEET_LISTE = 'Liste';
const SHEET_ARCHIVES = 'Archives';
const SHEET_RECURRENTS = 'Recurrents';
const SHEET_REFERENCE = 'Reference';
const SHEET_LISTES = 'Listes';

const HEADERS = {
  [SHEET_LISTE]: ['id', 'nom', 'categorie', 'statut', 'dateAjout', 'dateMaj', 'quantite', 'listeId'],
  [SHEET_ARCHIVES]: ['id', 'nom', 'categorie', 'dateAjout', 'dateArchive', 'quantite', 'listeId'],
  [SHEET_RECURRENTS]: ['id', 'modele', 'nom', 'categorie', 'quantite'],
  [SHEET_REFERENCE]: ['id', 'nom', 'categorie'],
  [SHEET_LISTES]: ['id', 'nom', 'categories', 'dateCreation'],
};

// Catégories par défaut des deux listes de courses connues au moment de
// l'introduction du multi-listes (voir migrateVersListesMultiples_). Une liste
// créée plus tard depuis l'appli reçoit ses propres catégories, choisies par
// qui la crée.
const CATEGORIES_ALIMENTAIRE_DEFAUT = [
  'Fruits & Légumes', 'Laitage & Fromage', 'Viande & Poisson', 'Sec', 'Traiteur',
  'Surgelés', 'Boissons', 'Hygiène', 'Entretien', 'Autre',
];
const CATEGORIES_BRICOLAGE_DEFAUT = ['Outillage', 'Protection', 'Produits', 'Optionnel', 'Autre'];

const MODELE_BRICOLAGE_NOM = 'Portail - bricolage';
const MODELE_BRICOLAGE_SEED = [
  ['Jeu de brosses métalliques sur tige pour perceuse (kit de 3)', 'Outillage', '12-15€ (un seul suffit, on alterne)'],
  ['Papier de verre grains 80 + 120, 2 feuilles de chaque', 'Outillage', '6€'],
  ['Spatule/grattoir métallique x2', 'Outillage', '6€'],
  ['Pinceau plat 50mm x2', 'Outillage', '12€'],
  ['Pinceau rond ou "à rechampir" 20mm pour les barreaux x2', 'Outillage', '10€'],
  ['Petit rouleau laqueur mousse + manche + bac x2', 'Outillage', '24€'],
  ['Brosse dure (chiendent) pour le muret', 'Outillage', '5€ (un seul suffit)'],
  ['Ruban de masquage qualité (type Tesa précision)', 'Outillage', '6€ (un seul suffit)'],
  ['Bâche plastique 4×5m', 'Outillage', '5€ (une seule suffit)'],
  ['Lunettes de protection x2', 'Protection', '10€'],
  ['Masque FFP2 (boîte de 5)', 'Protection', '6€ (une boîte suffit pour deux)'],
  ['Gants chantier x2', 'Protection', '10€'],
  ["Peinture fer à l'eau \"direct sur rouille\" satinée, 5L gris perle (2 faces × 2 couches)", 'Produits', '~50€ (un seul stock, partagé)'],
  ['White spirit 1L', 'Produits', '4€ (un seul suffit)'],
  ["Anti-mousse prêt à l'emploi 2L", 'Produits', '12€ (un seul suffit)'],
  ['Chiffons coton (vieux t-shirts découpés)', 'Produits', '0€'],
  ['Convertisseur de rouille (si piqûres profondes)', 'Optionnel', '~15€'],
];

// Articles courants pré-remplis dans la table de référence au premier démarrage,
// répartis par rayon (la liste des rayons se personnalise dans config.js).
const REFERENCE_SEED = [
  ['Pommes', 'Fruits & Légumes'], ['Bananes', 'Fruits & Légumes'], ['Oranges', 'Fruits & Légumes'],
  ['Poires', 'Fruits & Légumes'], ['Fraises', 'Fruits & Légumes'], ['Citrons', 'Fruits & Légumes'],
  ['Citrons verts', 'Fruits & Légumes'], ['Kiwis', 'Fruits & Légumes'], ['Raisin', 'Fruits & Légumes'],
  ['Avocats', 'Fruits & Légumes'], ['Pêches', 'Fruits & Légumes'], ['Melon', 'Fruits & Légumes'],
  ['Clémentines', 'Fruits & Légumes'], ['Tomates', 'Fruits & Légumes'], ['Salade', 'Fruits & Légumes'],
  ['Concombre', 'Fruits & Légumes'], ['Carottes', 'Fruits & Légumes'], ['Pommes de terre', 'Fruits & Légumes'],
  ['Oignons', 'Fruits & Légumes'], ['Ail', 'Fruits & Légumes'], ['Échalotes', 'Fruits & Légumes'],
  ['Poivrons', 'Fruits & Légumes'], ['Courgettes', 'Fruits & Légumes'], ['Aubergines', 'Fruits & Légumes'],
  ['Champignons', 'Fruits & Légumes'], ['Brocoli', 'Fruits & Légumes'], ['Chou-fleur', 'Fruits & Légumes'],
  ['Haricots verts', 'Fruits & Légumes'], ['Radis', 'Fruits & Légumes'], ['Persil', 'Fruits & Légumes'],
  ['Basilic', 'Fruits & Légumes'],

  ['Lait', 'Laitage & Fromage'], ['Beurre', 'Laitage & Fromage'], ['Beurre demi-sel', 'Laitage & Fromage'],
  ['Crème fraîche', 'Laitage & Fromage'], ['Yaourts nature', 'Laitage & Fromage'], ['Yaourts aux fruits', 'Laitage & Fromage'],
  ['Fromage blanc', 'Laitage & Fromage'], ['Emmental râpé', 'Laitage & Fromage'], ['Camembert', 'Laitage & Fromage'],
  ['Comté', 'Laitage & Fromage'], ['Mozzarella', 'Laitage & Fromage'], ['Parmesan', 'Laitage & Fromage'],
  ['Chèvre', 'Laitage & Fromage'], ['Petits suisses', 'Laitage & Fromage'], ['Skyr', 'Laitage & Fromage'],
  ['Œufs', 'Laitage & Fromage'], ["Lait d'amande", 'Laitage & Fromage'], ['Crème dessert', 'Laitage & Fromage'],
  ['Fromage à tartiner', 'Laitage & Fromage'], ['Raclette', 'Laitage & Fromage'],

  ['Blancs de poulet', 'Viande & Poisson'], ['Escalopes de dinde', 'Viande & Poisson'], ['Steak haché', 'Viande & Poisson'],
  ['Jambon blanc', 'Viande & Poisson'], ['Jambon cru', 'Viande & Poisson'], ['Saucisses', 'Viande & Poisson'],
  ['Merguez', 'Viande & Poisson'], ['Lardons', 'Viande & Poisson'], ['Bacon', 'Viande & Poisson'],
  ['Saumon', 'Viande & Poisson'], ['Cabillaud', 'Viande & Poisson'], ['Crevettes', 'Viande & Poisson'],
  ['Thon en boîte', 'Viande & Poisson'], ["Côtelettes d'agneau", 'Viande & Poisson'], ['Rôti de porc', 'Viande & Poisson'],
  ['Chorizo', 'Viande & Poisson'], ['Pavé de bœuf', 'Viande & Poisson'], ['Truite', 'Viande & Poisson'],
  ['Filet mignon', 'Viande & Poisson'], ['Tartare', 'Viande & Poisson'],

  ['Pâtes', 'Sec'], ['Riz', 'Sec'], ['Semoule', 'Sec'], ['Farine', 'Sec'], ['Sucre', 'Sec'],
  ['Sel', 'Sec'], ['Poivre', 'Sec'], ["Huile d'olive", 'Sec'], ['Huile de tournesol', 'Sec'],
  ['Vinaigre', 'Sec'], ['Moutarde', 'Sec'], ['Ketchup', 'Sec'], ['Mayonnaise', 'Sec'],
  ['Sauce tomate', 'Sec'], ['Tomates pelées en conserve', 'Sec'], ['Lentilles', 'Sec'],
  ['Pois chiches', 'Sec'], ['Haricots rouges en boîte', 'Sec'], ['Maïs en boîte', 'Sec'],
  ['Céréales', 'Sec'], ['Biscuits', 'Sec'], ['Chocolat', 'Sec'], ['Café', 'Sec'], ['Thé', 'Sec'],
  ['Miel', 'Sec'], ['Confiture', 'Sec'], ['Pain de mie', 'Sec'], ['Levure', 'Sec'], ['Bouillon cube', 'Sec'],

  ['Quiche', 'Traiteur'], ['Pizza fraîche', 'Traiteur'], ['Taboulé', 'Traiteur'], ['Salade composée', 'Traiteur'],
  ['Houmous', 'Traiteur'], ['Tarte salée', 'Traiteur'], ['Jambon à la coupe', 'Traiteur'], ['Saucisson', 'Traiteur'],
  ['Rillettes', 'Traiteur'], ['Pâté', 'Traiteur'], ['Terrine', 'Traiteur'], ['Wraps', 'Traiteur'],

  ['Frites surgelées', 'Surgelés'], ['Légumes surgelés', 'Surgelés'], ['Épinards surgelés', 'Surgelés'],
  ['Petits pois surgelés', 'Surgelés'], ['Poisson pané', 'Surgelés'], ['Pizza surgelée', 'Surgelés'],
  ['Glace', 'Surgelés'], ['Sorbet', 'Surgelés'], ['Nuggets', 'Surgelés'], ['Cordon bleu', 'Surgelés'],
  ['Ravioles surgelées', 'Surgelés'], ['Fruits rouges surgelés', 'Surgelés'], ['Crevettes surgelées', 'Surgelés'],
  ['Beignets', 'Surgelés'], ['Pâte feuilletée', 'Surgelés'], ['Gratin dauphinois surgelé', 'Surgelés'],
  ['Soupe surgelée', 'Surgelés'],

  ['Eau plate', 'Boissons'], ['Eau gazeuse', 'Boissons'], ["Jus d'orange", 'Boissons'], ['Jus de pomme', 'Boissons'],
  ['Soda cola', 'Boissons'], ['Limonade', 'Boissons'], ['Café en grains', 'Boissons'], ['Café moulu', 'Boissons'],
  ['Thé en sachet', 'Boissons'], ['Vin rouge', 'Boissons'], ['Vin blanc', 'Boissons'], ['Bière', 'Boissons'],
  ['Sirop', 'Boissons'], ['Thé glacé', 'Boissons'], ['Eau aromatisée', 'Boissons'], ['Chocolat en poudre', 'Boissons'],
  ['Champagne', 'Boissons'],

  ['Dentifrice', 'Hygiène'], ['Brosse à dents', 'Hygiène'], ['Gel douche', 'Hygiène'], ['Shampooing', 'Hygiène'],
  ['Après-shampooing', 'Hygiène'], ['Déodorant', 'Hygiène'], ['Papier toilette', 'Hygiène'], ['Mouchoirs', 'Hygiène'],
  ['Coton-tiges', 'Hygiène'], ['Rasoirs', 'Hygiène'], ['Mousse à raser', 'Hygiène'], ['Protections hygiéniques', 'Hygiène'],
  ['Savon', 'Hygiène'], ['Crème solaire', 'Hygiène'], ['Crème hydratante', 'Hygiène'], ['Lingettes bébé', 'Hygiène'],
  ['Couches', 'Hygiène'], ['Fil dentaire', 'Hygiène'],

  ['Liquide vaisselle', 'Entretien'], ['Éponges', 'Entretien'], ['Lessive', 'Entretien'], ['Adoucissant', 'Entretien'],
  ['Nettoyant multi-usage', 'Entretien'], ['Sacs poubelle', 'Entretien'], ['Papier essuie-tout', 'Entretien'],
  ['Javel', 'Entretien'], ['Nettoyant vitres', 'Entretien'], ['Désinfectant WC', 'Entretien'],
  ['Recharge aspirateur', 'Entretien'], ['Piles', 'Entretien'], ['Ampoules', 'Entretien'],
  ['Tablettes lave-vaisselle', 'Entretien'], ['Détartrant', 'Entretien'], ['Sacs congélation', 'Entretien'],

  ['Aliments pour animaux', 'Autre'], ['Litière pour chat', 'Autre'], ['Bougies', 'Autre'], ['Allumettes', 'Autre'],
  ['Fleurs', 'Autre'], ['Journal ou magazine', 'Autre'], ['Sacs plastique', 'Autre'], ['Piles boutons', 'Autre'],
];

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

// Les vérifications de structure (onglets, colonnes, pré-remplissage) n'ont besoin
// de tourner qu'une fois après un déploiement : ce drapeau, mémorisé au niveau du
// script, évite de les relancer (et de ralentir) à chaque requête. Si une future
// mise à jour ajoute une nouvelle migration, incrémenter ce nom pour la forcer à
// se rejouer une fois.
const SETUP_FLAG = 'setupComplete_v2';

function ensureSetup() {
  const proprietes = PropertiesService.getScriptProperties();
  if (proprietes.getProperty(SETUP_FLAG) !== 'true') {
    Object.keys(HEADERS).forEach(getSheet_);
    migrerEntete_(SHEET_LISTE, 'quantite');
    migrerEntete_(SHEET_ARCHIVES, 'quantite');
    seedReferenceSiVide_();
    const defaultSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Feuille 1') ||
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
    if (defaultSheet && defaultSheet.getLastRow() === 0 && defaultSheet.getLastColumn() <= 1) {
      SpreadsheetApp.getActiveSpreadsheet().deleteSheet(defaultSheet);
    }
    proprietes.setProperty(SETUP_FLAG, 'true');
  }

  migrerVersListesMultiples_();
}

// Introduit les listes de courses multiples (ex: Alimentaire, Bricolage) sur un
// déploiement existant : ajoute la colonne listeId (Liste/Archives) et quantite
// (Recurrents), rattache les articles déjà présents à une liste "Alimentaire"
// créée pour l'occasion, puis pré-remplit une liste "Bricolage" avec le modèle
// "Portail - bricolage". Gardé séparé de SETUP_FLAG pour tourner une seule fois
// même sur une feuille déjà en place depuis longtemps.
const MIGRATION_LISTES_MULTIPLES_FLAG = 'migrationListesMultiples_v1';

function migrerVersListesMultiples_() {
  const proprietes = PropertiesService.getScriptProperties();
  if (proprietes.getProperty(MIGRATION_LISTES_MULTIPLES_FLAG) === 'true') return;

  getSheet_(SHEET_LISTES);
  migrerEntete_(SHEET_LISTE, 'listeId');
  migrerEntete_(SHEET_ARCHIVES, 'listeId');
  migrerEntete_(SHEET_RECURRENTS, 'quantite');

  const alimentaireId = trouverOuCreerListe_('Alimentaire', CATEGORIES_ALIMENTAIRE_DEFAUT);
  rattacherLignesSansListeId_(getSheet_(SHEET_LISTE), alimentaireId);
  rattacherLignesSansListeId_(getSheet_(SHEET_ARCHIVES), alimentaireId);

  trouverOuCreerListe_('Bricolage', CATEGORIES_BRICOLAGE_DEFAUT);
  seedModeleBricolageSiAbsent_();

  proprietes.setProperty(MIGRATION_LISTES_MULTIPLES_FLAG, 'true');
}

function trouverOuCreerListe_(nom, categories) {
  const sheet = getSheet_(SHEET_LISTES);
  const listes = rowsToObjects_(sheet);
  const existante = listes.find(l => l.nom === nom);
  if (existante) return existante.id;
  const id = newId_();
  sheet.appendRow([id, nom, JSON.stringify(categories), nowIso_()]);
  return id;
}

function rattacherLignesSansListeId_(sheet, listeIdParDefaut) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return;
  const headers = values[0];
  const col = headers.indexOf('listeId') + 1;
  if (col === 0) return;
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === '' || values[i][col - 1]) continue;
    sheet.getRange(i + 1, col).setValue(listeIdParDefaut);
  }
}

function seedModeleBricolageSiAbsent_() {
  const sheet = getSheet_(SHEET_RECURRENTS);
  const items = rowsToObjects_(sheet);
  const dejaPresent = items.some(it => it.modele === MODELE_BRICOLAGE_NOM);
  if (dejaPresent) return;
  const lignes = MODELE_BRICOLAGE_SEED.map(([nom, categorie, quantite]) =>
    [newId_(), MODELE_BRICOLAGE_NOM, nom, categorie, quantite]);
  lignes.forEach(ligne => sheet.appendRow(ligne));
}

// Ajoute une colonne d'en-tête manquante sur une feuille déjà déployée avant cette
// mise à jour (les lignes existantes gardent une valeur vide pour cette colonne).
function migrerEntete_(nomFeuille, colonne) {
  const sheet = getSheet_(nomFeuille);
  const lastCol = sheet.getLastColumn();
  const entetes = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (entetes.indexOf(colonne) === -1) {
    sheet.getRange(1, lastCol + 1).setValue(colonne);
  }
}

// Pré-remplit la table de référence avec des articles courants, uniquement si
// elle vient d'être créée (aucune donnée au-delà de la ligne d'en-tête).
function seedReferenceSiVide_() {
  const sheet = getSheet_(SHEET_REFERENCE);
  if (sheet.getLastRow() > 1) return;
  const lignes = REFERENCE_SEED.map(([nom, categorie]) => [newId_(), nom, categorie]);
  if (lignes.length > 0) {
    sheet.getRange(2, 1, lignes.length, 3).setValues(lignes);
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
      case 'getListes':
        result = actionGetListes();
        break;
      case 'getReference':
        result = actionGetReference();
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
      case 'creerListe':
        result = withLock_(() => actionCreerListe(payload));
        break;
      case 'ajouterReference':
        result = withLock_(() => actionAjouterReference(payload));
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
    sheet.appendRow([id, payload.nom, payload.categorie || 'Autre', 'actif', nowIso_(), nowIso_(), payload.quantite || '', payload.listeId || '']);
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
  archives.appendRow([obj.id, obj.nom, obj.categorie, obj.dateAjout, nowIso_(), obj.quantite || '', obj.listeId || '']);
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
  liste.appendRow([obj.id, obj.nom, obj.categorie, 'actif', obj.dateAjout, nowIso_(), obj.quantite || '', obj.listeId || '']);
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
  sheet.appendRow([id, payload.modele, payload.nom, payload.categorie || 'Autre', payload.quantite || '']);
  return { id };
}

function actionSupprimerDuModele(payload) {
  const sheet = getSheet_(SHEET_RECURRENTS);
  const row = findRowIndexById_(sheet, payload.id);
  if (row === -1) return { id: payload.id };
  sheet.deleteRow(row);
  return { id: payload.id };
}

// ---- Listes de courses (Alimentaire, Bricolage, ...) ----

function actionGetListes() {
  return rowsToObjects_(getSheet_(SHEET_LISTES)).map(l => ({
    id: l.id,
    nom: l.nom,
    categories: parseCategories_(l.categories),
  }));
}

function parseCategories_(json) {
  try {
    const categories = JSON.parse(json);
    return Array.isArray(categories) ? categories : [];
  } catch (e) {
    return [];
  }
}

function actionCreerListe(payload) {
  const sheet = getSheet_(SHEET_LISTES);
  const listes = rowsToObjects_(sheet);
  const doublon = listes.find(l => String(l.nom).toLowerCase() === String(payload.nom).toLowerCase());
  if (doublon) return { id: doublon.id };
  const id = payload.id || newId_();
  sheet.appendRow([id, payload.nom, JSON.stringify(payload.categories || []), nowIso_()]);
  return { id };
}

// ---- Table de référence des articles ----

function actionGetReference() {
  return rowsToObjects_(getSheet_(SHEET_REFERENCE));
}

function actionAjouterReference(payload) {
  const sheet = getSheet_(SHEET_REFERENCE);
  const items = rowsToObjects_(sheet);
  const doublon = items.find(it => String(it.nom).toLowerCase() === String(payload.nom).toLowerCase());
  if (doublon) return { id: doublon.id };
  const id = payload.id || newId_();
  sheet.appendRow([id, payload.nom, payload.categorie || 'Autre']);
  return { id };
}

function actionAjouterDepuisModele(payload) {
  const recurrents = rowsToObjects_(getSheet_(SHEET_RECURRENTS)).filter(it => it.modele === payload.modele);
  const liste = getSheet_(SHEET_LISTE);
  const actifs = rowsToObjects_(liste)
    .filter(it => it.listeId === payload.listeId)
    .map(it => String(it.nom).toLowerCase());
  const ajoutes = [];
  recurrents.forEach(item => {
    if (actifs.indexOf(String(item.nom).toLowerCase()) !== -1) return;
    const id = newId_();
    liste.appendRow([id, item.nom, item.categorie, 'actif', nowIso_(), nowIso_(), item.quantite || '', payload.listeId || '']);
    ajoutes.push({ id, nom: item.nom, categorie: item.categorie, quantite: item.quantite || '' });
  });
  return { ajoutes };
}

// ---- Suggestions / autocomplétion ----

function actionGetSuggestions(query) {
  const q = String(query).toLowerCase();
  if (!q) return [];
  const seen = {};
  const all = []
    .concat(rowsToObjects_(getSheet_(SHEET_REFERENCE)))
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
