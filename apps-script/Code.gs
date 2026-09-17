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
const SHEET_MODELES = 'Modeles';
const SHEET_RECETTES = 'Recettes';

// `quantite` (texte libre saisi à la main) coexiste avec `qte` + `unite`
// (quantité structurée, issue d'une recette) : la première reste la source de
// vérité quand elle est remplie, les secondes permettent le cumul et la mise à
// l'échelle. `provenance` retient les recettes d'où vient un article cumulé.
const HEADERS = {
  [SHEET_LISTE]: ['id', 'nom', 'categorie', 'statut', 'dateAjout', 'dateMaj', 'quantite', 'listeId', 'qte', 'unite', 'provenance'],
  [SHEET_ARCHIVES]: ['id', 'nom', 'categorie', 'dateAjout', 'dateArchive', 'quantite', 'listeId', 'qte', 'unite', 'provenance'],
  [SHEET_RECURRENTS]: ['id', 'modele', 'nom', 'categorie', 'quantite', 'qte', 'unite'],
  [SHEET_REFERENCE]: ['id', 'nom', 'categorie'],
  [SHEET_LISTES]: ['id', 'nom', 'categories', 'dateCreation'],
  [SHEET_MODELES]: ['id', 'nom', 'description', 'url', 'portions', 'dateMaj'],
  [SHEET_RECETTES]: ['id', 'nom', 'source', 'url', 'portions', 'ingredients', 'dateAjout'],
};

// Nom de la propriété de script contenant la clé de recherche internet.
// Elle se saisit dans Apps Script (Paramètres du projet > Propriétés du script),
// jamais dans ce fichier : le dépôt GitHub est public.
const PROP_CSE_CLE = 'GOOGLE_CSE_KEY';
const PROP_CSE_ID = 'GOOGLE_CSE_ID';

// Sites interrogés par la recherche internet, dans cet ordre de préférence.
const SITES_RECETTES = ['cookomix.com', 'marmiton.org', '750g.com', 'cuisineaz.com'];

// Catégories par défaut de la liste "Alimentaire" créée lors de la migration
// vers le multi-listes (voir migrerVersListesMultiples_), pour rattacher les
// données déjà présentes avant cette fonctionnalité. Toute autre liste (créée
// depuis l'appli, ou via l'API par un tiers) reçoit ses propres catégories,
// choisies au moment de sa création : rien d'autre n'est présupposé ici.
const CATEGORIES_ALIMENTAIRE_DEFAUT = [
  'Fruits & Légumes', 'Laitage & Fromage', 'Viande & Poisson', 'Sec', 'Traiteur',
  'Surgelés', 'Boissons', 'Hygiène', 'Entretien', 'Autre',
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
  migrerVersRecettes_();
}

// Introduit l'import de recettes : quantités structurées (qte + unite),
// provenance des articles cumulés, fiche de modèle (description, lien vers la
// recette, nombre de parts) et cache des recettes importées. Les quantités en
// texte libre déjà saisies restent intactes dans la colonne `quantite`.
const MIGRATION_RECETTES_FLAG = 'migrationRecettes_v1';

function migrerVersRecettes_() {
  const proprietes = PropertiesService.getScriptProperties();
  if (proprietes.getProperty(MIGRATION_RECETTES_FLAG) === 'true') return;

  getSheet_(SHEET_MODELES);
  getSheet_(SHEET_RECETTES);
  ['qte', 'unite', 'provenance'].forEach(function (col) {
    migrerEntete_(SHEET_LISTE, col);
    migrerEntete_(SHEET_ARCHIVES, col);
  });
  migrerEntete_(SHEET_RECURRENTS, 'qte');
  migrerEntete_(SHEET_RECURRENTS, 'unite');

  proprietes.setProperty(MIGRATION_RECETTES_FLAG, 'true');
}

// Introduit les listes de courses multiples (ex: Alimentaire, Bricolage) sur un
// déploiement existant : ajoute la colonne listeId (Liste/Archives) et quantite
// (Recurrents), puis rattache les articles déjà présents à une liste
// "Alimentaire" créée pour l'occasion. Ne crée aucune autre liste ni aucun
// modèle : toute nouvelle liste ou modèle se crée depuis l'appli, ou via
// l'API (actions creerListe / ajouterAuModele), jamais codé en dur ici.
// Gardé séparé de SETUP_FLAG pour tourner une seule fois même sur une feuille
// déjà en place depuis longtemps.
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

// Les colonnes sont lues depuis la feuille elle-même plutôt que depuis HEADERS :
// une feuille déployée avant une migration peut avoir ses colonnes dans un autre
// ordre, et écrire à l'aveugle par position écraserait les mauvaises cellules.
// Les en-têtes ne bougent pas pendant une requête : les relire à chaque cellule
// écrite multiplierait les appels à la feuille (un ajout groupé de 15 articles
// en ferait plusieurs dizaines).
const CACHE_ENTETES = {};

function entetesDe_(sheet) {
  const nom = sheet.getName();
  if (!CACHE_ENTETES[nom]) {
    CACHE_ENTETES[nom] = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  }
  return CACHE_ENTETES[nom];
}

function ajouterLigne_(sheet, obj) {
  sheet.appendRow(entetesDe_(sheet).map(function (h) {
    return obj[h] === undefined || obj[h] === null ? '' : obj[h];
  }));
}

function objetDepuisLigne_(sheet, row) {
  const entetes = entetesDe_(sheet);
  const values = sheet.getRange(row, 1, 1, entetes.length).getValues()[0];
  const obj = {};
  entetes.forEach(function (h, i) { obj[h] = values[i]; });
  return obj;
}

function ecrireCellule_(sheet, row, colonne, valeur) {
  const col = entetesDe_(sheet).indexOf(colonne) + 1;
  if (col > 0) sheet.getRange(row, col).setValue(valeur);
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
      case 'getModelesMeta':
        result = actionGetModelesMeta();
        break;
      case 'getRecettes':
        result = actionGetRecettes();
        break;
      case 'importerRecette':
        result = actionImporterRecette(e.parameter.url || '');
        break;
      case 'chercherRecette':
        result = actionChercherRecette(e.parameter.q || '');
        break;
      case 'diagnostiquerUrl':
        result = actionDiagnostiquerUrl(e.parameter.url || '');
        break;
      case 'etatRechercheInternet':
        result = actionEtatRechercheInternet();
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
      case 'enregistrerModeleMeta':
        result = withLock_(() => actionEnregistrerModeleMeta(payload));
        break;
      case 'supprimerModele':
        result = withLock_(() => actionSupprimerModele(payload));
        break;
      case 'creerModeleDepuisRecette':
        result = withLock_(() => actionCreerModeleDepuisRecette(payload));
        break;
      case 'ajouterLot':
        result = withLock_(() => actionAjouterLot(payload));
        break;
      case 'enregistrerRecette':
        result = withLock_(() => actionEnregistrerRecette(payload));
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
    ajouterLigne_(sheet, {
      id: id, nom: payload.nom, categorie: payload.categorie || 'Autre', statut: 'actif',
      dateAjout: nowIso_(), dateMaj: nowIso_(), quantite: payload.quantite || '',
      listeId: payload.listeId || '', qte: payload.qte === undefined || payload.qte === null ? '' : payload.qte,
      unite: payload.unite || '', provenance: payload.provenance || '',
    });
  }
  return { id };
}

function actionToggleAchete(payload) {
  const sheet = getSheet_(SHEET_LISTE);
  const row = findRowIndexById_(sheet, payload.id);
  if (row === -1) throw new Error('Article introuvable');
  const actuel = objetDepuisLigne_(sheet, row);
  const nouveauStatut = payload.statut || (actuel.statut === 'achete' ? 'actif' : 'achete');
  ecrireCellule_(sheet, row, 'statut', nouveauStatut);
  ecrireCellule_(sheet, row, 'dateMaj', nowIso_());
  return { id: payload.id, statut: nouveauStatut };
}

function actionArchiver(payload) {
  const liste = getSheet_(SHEET_LISTE);
  const archives = getSheet_(SHEET_ARCHIVES);
  const row = findRowIndexById_(liste, payload.id);
  if (row === -1) throw new Error('Article introuvable');
  const obj = objetDepuisLigne_(liste, row);
  ajouterLigne_(archives, {
    id: obj.id, nom: obj.nom, categorie: obj.categorie, dateAjout: obj.dateAjout,
    dateArchive: nowIso_(), quantite: obj.quantite || '', listeId: obj.listeId || '',
    qte: obj.qte === '' || obj.qte === undefined ? '' : obj.qte,
    unite: obj.unite || '', provenance: obj.provenance || '',
  });
  liste.deleteRow(row);
  return { id: payload.id };
}

function actionRestaurerDepuisArchive(payload) {
  const liste = getSheet_(SHEET_LISTE);
  const archives = getSheet_(SHEET_ARCHIVES);
  const row = findRowIndexById_(archives, payload.id);
  if (row === -1) throw new Error('Article introuvable dans les archives');
  const obj = objetDepuisLigne_(archives, row);
  ajouterLigne_(liste, {
    id: obj.id, nom: obj.nom, categorie: obj.categorie, statut: 'actif',
    dateAjout: obj.dateAjout, dateMaj: nowIso_(), quantite: obj.quantite || '',
    listeId: obj.listeId || '', qte: obj.qte === '' || obj.qte === undefined ? '' : obj.qte,
    unite: obj.unite || '', provenance: obj.provenance || '',
  });
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
  ajouterLigne_(sheet, {
    id: id, modele: payload.modele, nom: payload.nom, categorie: payload.categorie || 'Autre',
    quantite: payload.quantite || '',
    qte: payload.qte === undefined || payload.qte === null ? '' : payload.qte,
    unite: payload.unite || '',
  });
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
  ajouterLigne_(sheet, {
    id: id, nom: payload.nom, categories: JSON.stringify(payload.categories || []), dateCreation: nowIso_(),
  });
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
  ajouterLigne_(sheet, { id: id, nom: payload.nom, categorie: payload.categorie || 'Autre' });
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
    ajouterLigne_(liste, {
      id: id, nom: item.nom, categorie: item.categorie, statut: 'actif',
      dateAjout: nowIso_(), dateMaj: nowIso_(), quantite: item.quantite || '',
      listeId: payload.listeId || '', qte: item.qte === '' || item.qte === undefined ? '' : item.qte,
      unite: item.unite || '', provenance: item.modele || '',
    });
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

// ---- Fiches de modèles (description, lien vers la recette, nombre de parts) ----

function actionGetModelesMeta() {
  const metas = {};
  rowsToObjects_(getSheet_(SHEET_MODELES)).forEach(function (m) {
    metas[m.nom] = {
      nom: m.nom,
      description: m.description || '',
      url: m.url || '',
      portions: m.portions === '' || m.portions === undefined ? null : Number(m.portions),
    };
  });
  return metas;
}

function actionEnregistrerModeleMeta(payload) {
  const sheet = getSheet_(SHEET_MODELES);
  const existantes = rowsToObjects_(sheet);
  const idx = existantes.map(function (m) { return String(m.nom); }).indexOf(String(payload.nom));
  if (idx === -1) {
    const id = newId_();
    ajouterLigne_(sheet, {
      id: id, nom: payload.nom, description: payload.description || '', url: payload.url || '',
      portions: payload.portions || '', dateMaj: nowIso_(),
    });
    return { id: id };
  }
  const row = idx + 2;
  ecrireCellule_(sheet, row, 'description', payload.description || '');
  ecrireCellule_(sheet, row, 'url', payload.url || '');
  ecrireCellule_(sheet, row, 'portions', payload.portions || '');
  ecrireCellule_(sheet, row, 'dateMaj', nowIso_());
  return { id: existantes[idx].id };
}

// Supprime un modèle entier : sa fiche et tous ses articles.
function actionSupprimerModele(payload) {
  const nom = String(payload.modele || '');
  const recurrents = getSheet_(SHEET_RECURRENTS);
  const lignes = rowsToObjects_(recurrents);
  for (let i = lignes.length - 1; i >= 0; i--) {
    if (String(lignes[i].modele) === nom) recurrents.deleteRow(i + 2);
  }
  const modeles = getSheet_(SHEET_MODELES);
  const metas = rowsToObjects_(modeles);
  for (let i = metas.length - 1; i >= 0; i--) {
    if (String(metas[i].nom) === nom) modeles.deleteRow(i + 2);
  }
  return { modele: nom };
}

// Crée un modèle complet en une seule requête (fiche + tous ses articles),
// plutôt que d'enchaîner une vingtaine d'appels depuis le téléphone.
function actionCreerModeleDepuisRecette(payload) {
  const nom = String(payload.modele || '').trim();
  if (!nom) throw new Error('Nom de modèle manquant');
  actionEnregistrerModeleMeta({
    nom: nom, description: payload.description, url: payload.url, portions: payload.portions,
  });
  const sheet = getSheet_(SHEET_RECURRENTS);
  const items = Array.isArray(payload.items) ? payload.items : [];
  items.forEach(function (item) {
    ajouterLigne_(sheet, {
      id: newId_(), modele: nom, nom: item.nom, categorie: item.categorie || 'Autre',
      quantite: item.quantite || '',
      qte: item.qte === undefined || item.qte === null ? '' : item.qte,
      unite: item.unite || '',
    });
  });
  return { modele: nom, ajoutes: items.length };
}

// ---- Ajout groupé avec cumul des quantités ----

const UNITES_BASE = {
  'g': { type: 'poids', base: 1 }, 'kg': { type: 'poids', base: 1000 }, 'mg': { type: 'poids', base: 0.001 },
  'ml': { type: 'volume', base: 1 }, 'cl': { type: 'volume', base: 10 },
  'dl': { type: 'volume', base: 100 }, 'l': { type: 'volume', base: 1000 },
};

function normaliserNom_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
}

// Deux lignes fusionnent si elles portent le même nom et des unités additionnables :
// deux poids, deux volumes, ou strictement la même unité (2 gousses + 3 gousses).
function fusionnables_(a, b) {
  if (normaliserNom_(a.nom) !== normaliserNom_(b.nom)) return false;
  const ua = UNITES_BASE[String(a.unite || '')];
  const ub = UNITES_BASE[String(b.unite || '')];
  if (ua && ub) return ua.type === ub.type;
  if (ua || ub) return false;
  return String(a.unite || '') === String(b.unite || '');
}

function additionner_(a, b) {
  const ua = UNITES_BASE[String(a.unite || '')];
  const ub = UNITES_BASE[String(b.unite || '')];
  if (ua && ub) {
    const total = Number(a.qte) * ua.base + Number(b.qte) * ub.base;
    if (ua.type === 'poids') {
      return total >= 1000
        ? { qte: Math.round(total / 10) / 100, unite: 'kg' }
        : { qte: Math.round(total * 10) / 10, unite: 'g' };
    }
    if (total >= 1000) return { qte: Math.round(total / 10) / 100, unite: 'l' };
    if (total >= 100) return { qte: Math.round(total) / 10, unite: 'cl' };
    return { qte: Math.round(total), unite: 'ml' };
  }
  return { qte: Math.round((Number(a.qte) + Number(b.qte)) * 100) / 100, unite: a.unite || b.unite || '' };
}

function fusionnerProvenance_(ancienne, nouvelle) {
  const parts = String(ancienne || '').split(' + ').concat(String(nouvelle || '').split(' + '))
    .map(function (p) { return p.trim(); })
    .filter(function (p) { return p !== ''; });
  const vues = [];
  parts.forEach(function (p) { if (vues.indexOf(p) === -1) vues.push(p); });
  return vues.join(' + ');
}

/**
 * Ajoute plusieurs articles à une liste en cumulant les quantités des articles
 * déjà présents. Un article dont la quantité est saisie en texte libre n'est
 * jamais fusionné : on ne sait pas additionner « une bonne poignée ».
 */
function actionAjouterLot(payload) {
  const sheet = getSheet_(SHEET_LISTE);
  const listeId = String(payload.listeId || '');
  const items = Array.isArray(payload.items) ? payload.items : [];
  const existants = rowsToObjects_(sheet);
  const resultat = { ajoutes: 0, cumules: 0 };

  items.forEach(function (item) {
    const candidat = {
      nom: item.nom, unite: item.unite || '',
      qte: item.qte === undefined || item.qte === null || item.qte === '' ? null : Number(item.qte),
    };
    let fusionne = false;

    if (candidat.qte !== null) {
      for (let i = 0; i < existants.length; i++) {
        const ex = existants[i];
        if (String(ex.listeId) !== listeId) continue;
        if (ex.quantite) continue;
        if (ex.qte === '' || ex.qte === undefined || ex.qte === null) continue;
        if (!fusionnables_({ nom: ex.nom, unite: ex.unite }, candidat)) continue;
        const somme = additionner_({ qte: Number(ex.qte), unite: ex.unite }, candidat);
        const row = findRowIndexById_(sheet, ex.id);
        if (row === -1) continue;
        ecrireCellule_(sheet, row, 'qte', somme.qte);
        ecrireCellule_(sheet, row, 'unite', somme.unite);
        ecrireCellule_(sheet, row, 'provenance', fusionnerProvenance_(ex.provenance, item.provenance));
        ecrireCellule_(sheet, row, 'dateMaj', nowIso_());
        ex.qte = somme.qte;
        ex.unite = somme.unite;
        resultat.cumules++;
        fusionne = true;
        break;
      }
    }

    if (fusionne) return;
    const id = item.id || newId_();
    ajouterLigne_(sheet, {
      id: id, nom: item.nom, categorie: item.categorie || 'Autre', statut: 'actif',
      dateAjout: nowIso_(), dateMaj: nowIso_(), quantite: item.quantite || '', listeId: listeId,
      qte: candidat.qte === null ? '' : candidat.qte, unite: candidat.unite,
      provenance: item.provenance || '',
    });
    existants.push({
      id: id, nom: item.nom, listeId: listeId, quantite: item.quantite || '',
      qte: candidat.qte === null ? '' : candidat.qte, unite: candidat.unite, provenance: item.provenance || '',
    });
    resultat.ajoutes++;
  });

  return resultat;
}

// ---- Cache des recettes importées ----

function actionGetRecettes() {
  return rowsToObjects_(getSheet_(SHEET_RECETTES)).map(function (r) {
    let ingredients = [];
    try { ingredients = JSON.parse(r.ingredients || '[]'); } catch (e) { ingredients = []; }
    return {
      id: r.id, nom: r.nom, source: r.source || '', url: r.url || '',
      portions: r.portions === '' || r.portions === undefined ? null : Number(r.portions),
      ingredients: Array.isArray(ingredients) ? ingredients : [],
    };
  });
}

function actionEnregistrerRecette(payload) {
  const sheet = getSheet_(SHEET_RECETTES);
  const existantes = rowsToObjects_(sheet);
  const nom = String(payload.nom || '').trim();
  if (!nom) throw new Error('Nom de recette manquant');
  const idx = existantes.map(function (r) { return normaliserNom_(r.nom); }).indexOf(normaliserNom_(nom));
  const ingredientsJson = JSON.stringify(payload.ingredients || []);
  if (idx === -1) {
    const id = payload.id || newId_();
    ajouterLigne_(sheet, {
      id: id, nom: nom, source: payload.source || '', url: payload.url || '',
      portions: payload.portions || '', ingredients: ingredientsJson, dateAjout: nowIso_(),
    });
    return { id: id };
  }
  const row = idx + 2;
  ecrireCellule_(sheet, row, 'source', payload.source || '');
  ecrireCellule_(sheet, row, 'url', payload.url || '');
  ecrireCellule_(sheet, row, 'portions', payload.portions || '');
  ecrireCellule_(sheet, row, 'ingredients', ingredientsJson);
  return { id: existantes[idx].id };
}

// ---- Import d'une recette depuis une URL ----
//
// La page est récupérée côté serveur : le navigateur ne peut pas le faire
// lui-même (les sites de recettes n'autorisent pas les requêtes croisées).
// L'extraction s'appuie sur le bloc JSON-LD schema.org "Recipe" que les sites
// publient pour Google, avec un repli sur les microdonnées.

// Étape à exécuter une fois, à la main, après avoir collé ce fichier : créer
// une nouvelle version de déploiement n'autorise PAS automatiquement l'accès
// à des sites externes, parce que l'écran de consentement ne peut s'afficher
// que quand une fonction est lancée depuis cet éditeur (un appel venant de
// l'appli, exécuté "en tant que vous" mais sans personne pour cliquer sur
// "Autoriser", échoue silencieusement avec "vous n'êtes pas autorisé...").
//
// Marche à suivre : dans le menu déroulant en haut de cet éditeur (à côté du
// bouton ▷ Exécuter), choisissez "autoriserAccesExterne", cliquez sur
// Exécuter, puis sur "Vérifier les autorisations" > votre compte Google >
// "Paramètres avancés" > "Accéder à (nom du projet) (non sécurisé)" >
// Autoriser. C'est normal que Google affiche cet avertissement : c'est votre
// propre script, jamais publié ni vérifié par Google. Une fois fait, l'import
// par lien fonctionne, y compris depuis l'appli.
function autoriserAccesExterne() {
  const reponse = UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  Logger.log('Autorisation obtenue, réponse : ' + reponse.getResponseCode());
}

function recupererPage_(url) {
  const propre = String(url || '').trim();
  if (!/^https?:\/\//i.test(propre)) throw new Error("Adresse invalide : elle doit commencer par https://");
  const reponse = UrlFetchApp.fetch(propre, {
    muteHttpExceptions: true,
    followRedirects: true,
    validateHttpsCertificates: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ListeDeCourses/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'fr-FR,fr;q=0.9',
    },
  });
  const code = reponse.getResponseCode();
  if (code >= 400) throw new Error('Le site a répondu ' + code + ' (page introuvable ou accès refusé).');
  return { code: code, contenu: reponse.getContentText() };
}

// Entités nommées courantes en français : les sites de recettes encodent
// volontiers « crème fraîche » en « cr&egrave;me fra&icirc;che ».
const ENTITES_NOMMEES = {
  agrave: 'à', acirc: 'â', auml: 'ä', aacute: 'á', aelig: 'æ',
  ccedil: 'ç', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  icirc: 'î', iuml: 'ï', iacute: 'í', ocirc: 'ô', ouml: 'ö', oacute: 'ó',
  oelig: 'œ', ugrave: 'ù', ucirc: 'û', uuml: 'ü', uacute: 'ú', yuml: 'ÿ',
  Agrave: 'À', Acirc: 'Â', Ccedil: 'Ç', Eacute: 'É', Egrave: 'È', Ecirc: 'Ê',
  Icirc: 'Î', Ocirc: 'Ô', Oelig: 'Œ', Ugrave: 'Ù', Ucirc: 'Û',
  deg: '°', laquo: '«', raquo: '»', rsquo: "'", lsquo: "'", hellip: '…',
  ndash: '-', mdash: '-', eu: '€', euro: '€',
};

function decoderEntites_(s) {
  return String(s == null ? '' : s)
    .replace(/&([A-Za-z]+);/g, function (entier, nom) {
      return Object.prototype.hasOwnProperty.call(ENTITES_NOMMEES, nom) ? ENTITES_NOMMEES[nom] : entier;
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function blocsJsonLd_(html) {
  const blocs = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const brut = m[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
    try { blocs.push(JSON.parse(brut)); } catch (e) { /* bloc mal formé, on passe au suivant */ }
  }
  return blocs;
}

function estRecette_(noeud) {
  if (!noeud || typeof noeud !== 'object') return false;
  const t = noeud['@type'];
  if (!t) return false;
  return Array.isArray(t) ? t.indexOf('Recipe') !== -1 : String(t) === 'Recipe';
}

function chercherRecetteDansJson_(noeud) {
  if (!noeud || typeof noeud !== 'object') return null;
  if (Array.isArray(noeud)) {
    for (let i = 0; i < noeud.length; i++) {
      const r = chercherRecetteDansJson_(noeud[i]);
      if (r) return r;
    }
    return null;
  }
  if (estRecette_(noeud)) return noeud;
  if (noeud['@graph']) return chercherRecetteDansJson_(noeud['@graph']);
  return null;
}

function extrairePortions_(yield_) {
  if (yield_ === undefined || yield_ === null) return null;
  const valeur = Array.isArray(yield_) ? yield_.join(' ') : String(yield_);
  const m = valeur.match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return n > 0 && n <= 50 ? n : null;
}

// Repli microdonnées, pour les pages sans JSON-LD.
function ingredientsMicrodonnees_(html) {
  const lignes = [];
  const re = /itemprop\s*=\s*["'](?:recipeIngredient|ingredients)["'][^>]*>([\s\S]*?)<\//gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const texte = decoderEntites_(m[1]);
    if (texte) lignes.push(texte);
  }
  return lignes;
}

function titreDeLaPage_(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decoderEntites_(m[1]) : '';
}

function siteDe_(url) {
  const m = String(url || '').match(/^https?:\/\/(?:www\.)?([^\/]+)/i);
  return m ? m[1] : '';
}

function extraireRecette_(html, url) {
  const blocs = blocsJsonLd_(html);
  for (let i = 0; i < blocs.length; i++) {
    const recette = chercherRecetteDansJson_(blocs[i]);
    if (!recette) continue;
    const ingredients = []
      .concat(recette.recipeIngredient || recette.ingredients || [])
      .map(decoderEntites_)
      .filter(function (l) { return l !== ''; });
    if (ingredients.length === 0) continue;
    return {
      nom: decoderEntites_(recette.name || titreDeLaPage_(html)),
      description: decoderEntites_(recette.description || ''),
      portions: extrairePortions_(recette.recipeYield),
      ingredients: ingredients,
      url: url,
      source: siteDe_(url),
      methode: 'json-ld',
    };
  }

  const microdonnees = ingredientsMicrodonnees_(html);
  if (microdonnees.length > 0) {
    return {
      nom: titreDeLaPage_(html),
      description: '',
      portions: null,
      ingredients: microdonnees,
      url: url,
      source: siteDe_(url),
      methode: 'microdonnées',
    };
  }
  return null;
}

function actionImporterRecette(url) {
  const page = recupererPage_(url);
  const recette = extraireRecette_(page.contenu, url);
  if (!recette) {
    throw new Error("Aucune liste d'ingrédients exploitable sur cette page. Copiez-collez les ingrédients à la main.");
  }
  return recette;
}

/**
 * Diagnostic : dit ce qui a été trouvé sur une page, sans rien enregistrer.
 * Sert à vérifier qu'un site donné (Cookomix, par exemple) est exploitable.
 */
function actionDiagnostiquerUrl(url) {
  try {
    const page = recupererPage_(url);
    const blocs = blocsJsonLd_(page.contenu);
    const recette = extraireRecette_(page.contenu, url);
    return {
      ok: !!recette,
      codeHttp: page.code,
      taillePage: page.contenu.length,
      blocsJsonLd: blocs.length,
      methode: recette ? recette.methode : 'aucune',
      titre: recette ? recette.nom : titreDeLaPage_(page.contenu),
      portions: recette ? recette.portions : null,
      nbIngredients: recette ? recette.ingredients.length : 0,
      apercu: recette ? recette.ingredients.slice(0, 5) : [],
    };
  } catch (err) {
    return { ok: false, erreur: String(err) };
  }
}

// ---- Recherche internet (optionnelle) ----
//
// Utilise l'API Google Custom Search, restreinte aux sites de recettes listés
// dans SITES_RECETTES. Tant que la clé n'est pas renseignée dans les propriétés
// du script, l'appli désactive simplement le bouton correspondant.

function configCse_() {
  const proprietes = PropertiesService.getScriptProperties();
  const cle = proprietes.getProperty(PROP_CSE_CLE);
  const cx = proprietes.getProperty(PROP_CSE_ID);
  if (!cle || !cx) return null;
  return { cle: cle, cx: cx };
}

function actionEtatRechercheInternet() {
  return { configuree: !!configCse_(), sites: SITES_RECETTES };
}

function actionChercherRecette(q) {
  const requete = String(q || '').trim();
  if (!requete) return { resultats: [] };
  const cfg = configCse_();
  if (!cfg) {
    throw new Error("La recherche internet n'est pas configurée sur ce déploiement.");
  }
  const url = 'https://www.googleapis.com/customsearch/v1'
    + '?key=' + encodeURIComponent(cfg.cle)
    + '&cx=' + encodeURIComponent(cfg.cx)
    + '&hl=fr&num=6&q=' + encodeURIComponent(requete + ' recette');
  const reponse = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = reponse.getResponseCode();
  const corps = JSON.parse(reponse.getContentText() || '{}');
  if (code >= 400) {
    const message = corps && corps.error && corps.error.message ? corps.error.message : ('erreur ' + code);
    throw new Error('Recherche indisponible : ' + message);
  }
  const items = corps.items || [];
  const resultats = items.map(function (it) {
    return {
      titre: decoderEntites_(it.title || ''),
      url: it.link || '',
      site: siteDe_(it.link || ''),
      extrait: decoderEntites_(it.snippet || ''),
    };
  }).filter(function (r) { return r.url !== ''; });

  // Les sites connus pour publier des données structurées passent devant.
  resultats.sort(function (a, b) {
    const ra = SITES_RECETTES.indexOf(a.site) === -1 ? 99 : SITES_RECETTES.indexOf(a.site);
    const rb = SITES_RECETTES.indexOf(b.site) === -1 ? 99 : SITES_RECETTES.indexOf(b.site);
    return ra - rb;
  });
  return { resultats: resultats };
}
