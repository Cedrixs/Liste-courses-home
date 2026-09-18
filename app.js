/**
 * Logique de l'appli : état local, synchronisation avec le backend Apps Script
 * (avec file d'attente hors ligne), rendu des écrans et câblage des évènements.
 *
 * Organisation du fichier :
 *   1. État et utilitaires
 *   2. Stockage local (cache, file d'attente, préférences de l'appareil)
 *   3. Réseau et synchronisation
 *   4. Actions métier (liste, modèles, table de référence, listes multiples)
 *   5. Rendu des écrans
 *   6. Toast, modales et écrans secondaires
 *   7. Onglet Recettes et écran d'import
 *   8. Câblage des évènements et démarrage
 *
 * Principe général : chaque action met à jour l'état local et l'écran tout de
 * suite (l'appli reste fluide même sans réseau), puis l'envoie au backend via
 * une file d'attente rejouée dès que la connexion le permet.
 */

// ---- 1. État et utilitaires ----

const state = {
  liste: [],
  modeles: {},      // nom du modèle -> articles
  modelesMeta: {},  // nom du modèle -> { description, url, portions }
  archives: [],
  reference: [],
  listes: [],
  recettes: [],
  rechercheInternet: { configuree: false },
};

// État d'interface, jamais persisté : ce que les modales et écrans ont en cours.
const ui = {
  articlePourModele: null,   // article en cours d'ajout à un modèle
  modalListesMode: 'switch', // 'switch' (changer de liste) | 'destination' (depuis un modèle) | 'import' (depuis une recette)
  modalListesSource: null,   // nom du modèle ou de la recette dont on ajoute les articles
  referenceCandidat: null,   // article inconnu proposé pour la table de référence
  ficheModele: null,         // modèle dont on édite la fiche
  importRecette: null,       // recette en cours d'import (voir ouvrirEcranRecette)
  resultatsInternet: [],
  rechercheEnCours: false,
  toastCle: null,            // identifie un toast d'information, pour le refermer au reclic
};

const $ = (id) => document.getElementById(id);

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatDateHeure(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${date} à ${heure}`;
}

function libelleJour(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const auj = new Date();
  const hier = new Date(auj); hier.setDate(hier.getDate() - 1);
  const memeJour = (a, b) => a.toDateString() === b.toDateString();
  if (memeJour(d, auj)) return "Aujourd'hui";
  if (memeJour(d, hier)) return 'Hier';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

// « 3 articles », « 1 rayon » ; un pluriel irrégulier se passe en 3e argument.
function pluriel(n, mot, motPluriel) {
  return `${n} ${n > 1 ? (motPluriel || `${mot}s`) : mot}`;
}

// Accord d'un adjectif isolé : « archivé » + accordS(n).
function accordS(n) { return n > 1 ? 's' : ''; }

// Une quantité structurée arrive sous plusieurs formes selon sa provenance
// (nombre, chaîne vide venue du Sheet, null, undefined) : ces deux fonctions
// la ramènent à un nombre ou à « rien ».
function qteOuNull(v) { return v === '' || v === null || v === undefined ? null : Number(v); }
function qteOuVide(v) { const n = qteOuNull(v); return n === null ? '' : n; }

// TypeError = pas de réseau, AbortError = délai dépassé : dans les deux cas
// l'action est à retenter plus tard, ce n'est pas une erreur du serveur.
function estErreurReseau(err) {
  return err instanceof TypeError || (err && err.name === 'AbortError');
}

// Seules les adresses http(s) deviennent des liens cliquables : les fiches de
// modèles sont partagées par tout le foyer, on n'y insère pas n'importe quoi.
function urlSure(url) {
  const u = String(url || '').trim();
  return /^https?:\/\//i.test(u) ? u : '';
}

// Clé de comparaison des noms d'articles (sans casse, sans accents).
function cleNom(nom) { return RECETTES.normaliser(nom); }

function trierParNom(objets) {
  return objets.slice().sort((a, b) => a.nom.localeCompare(b.nom));
}

// ---- 2. Stockage local ----

const CLES = {
  cache: {
    liste: 'lc_liste', modeles: 'lc_modeles', modelesMeta: 'lc_modeles_meta',
    archives: 'lc_archives', reference: 'lc_reference', listes: 'lc_listes', recettes: 'lc_recettes',
  },
  queue: 'lc_queue',
  deselection: 'lc_modele_deselection',
  listeActive: 'lc_liste_active_id',
  url: 'lc_apps_script_url',
};

function lireJson(cle, defaut) {
  try {
    const brut = localStorage.getItem(cle);
    if (!brut) return defaut;
    const valeur = JSON.parse(brut);
    const bonType = Array.isArray(defaut) ? Array.isArray(valeur) : (valeur && typeof valeur === 'object');
    return bonType ? valeur : defaut;
  } catch (e) {
    return defaut; // cache corrompu : on repart de la valeur par défaut
  }
}

function ecrireJson(cle, valeur) {
  try {
    localStorage.setItem(cle, JSON.stringify(valeur));
  } catch (e) {
    // Stockage plein ou indisponible (navigation privée) : l'appli continue de
    // fonctionner en mémoire, seule la persistance entre deux ouvertures est perdue.
    console.error(`Impossible d'enregistrer ${cle} sur l'appareil :`, e);
  }
}

function loadCache() {
  Object.keys(CLES.cache).forEach(champ => {
    state[champ] = lireJson(CLES.cache[champ], Array.isArray(state[champ]) ? [] : {});
  });
}

function saveCache() {
  Object.keys(CLES.cache).forEach(champ => ecrireJson(CLES.cache[champ], state[champ]));
}

function loadQueue() { return lireJson(CLES.queue, []); }
function saveQueue(queue) { ecrireJson(CLES.queue, queue); }

function loadDeselection() { return lireJson(CLES.deselection, {}); }
function saveDeselection(deselection) { ecrireJson(CLES.deselection, deselection); }

function getAppsScriptUrl() { return localStorage.getItem(CLES.url) || ''; }
function setAppsScriptUrl(url) { localStorage.setItem(CLES.url, url.trim()); }

function getListeActiveId() { return localStorage.getItem(CLES.listeActive) || ''; }
function setListeActiveId(id) { localStorage.setItem(CLES.listeActive, id); }

// ---- 3. Réseau et synchronisation ----

// Apps Script répond typiquement en 1 à 3 secondes ; au-delà de ce délai on
// considère la requête perdue plutôt que de laisser un écran « en cours » figé.
const DELAI_REQUETE_MS = 30000;

// Actions dont la réponse du serveur fait diverger les identifiants locaux
// (le backend attribue ses propres ids aux articles de modèles) : après leur
// envoi, la ressource concernée est rechargée pour que les actions suivantes
// (retirer un article du modèle) portent sur les bons identifiants.
const RESSOURCES_A_RECHARGER_APRES = {
  ajouterAuModele: ['modeles'],
  creerModeleDepuisRecette: ['modeles'],
};

const RESSOURCES_SERVEUR = {
  liste: 'getListe', modeles: 'getModeles', archives: 'getArchives',
  reference: 'getReference', listes: 'getListes', modelesMeta: 'getModelesMeta',
  recettes: 'getRecettes', rechercheInternet: 'etatRechercheInternet',
};

let isFlushing = false;
let refreshEnCours = null;        // promesse du rafraîchissement en cours, s'il y en a un
let refreshDifferer = false;      // un rafraîchissement a été demandé pendant que des actions attendaient
let compteurActions = 0;          // incrémenté à chaque action locale, pour détecter une réponse serveur périmée
let dernierRafraichissementArrierePlan = 0;

async function lireReponse(res) {
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || 'Erreur serveur');
  return body.data;
}

async function apiGet(action, params = {}) {
  const base = getAppsScriptUrl();
  if (!base) throw new Error('URL non configurée');
  const qs = new URLSearchParams({ action, ...params }).toString();
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), DELAI_REQUETE_MS);
  try {
    const res = await fetch(`${base}?${qs}`, { signal: controleur.signal });
    return await lireReponse(res);
  } finally {
    clearTimeout(minuteur);
  }
}

// Pas d'en-tête Content-Type : Apps Script n'accepte pas la requête de
// pré-vérification CORS qu'un JSON déclaré déclencherait.
async function apiPost(action, payload = {}) {
  const base = getAppsScriptUrl();
  if (!base) throw new Error('URL non configurée');
  const res = await fetch(base, { method: 'POST', body: JSON.stringify({ action, ...payload }) });
  return lireReponse(res);
}

function queueOrSend(action, payload) {
  const queue = loadQueue();
  queue.push({ action, payload });
  saveQueue(queue);
  compteurActions++;
  flushQueue();
}

// Envoie les actions en attente une par une, dans l'ordre. La file est relue
// dans le stockage à chaque tour : d'autres actions ont pu y être ajoutées
// pendant l'envoi, elles ne doivent pas être écrasées par une copie périmée.
async function flushQueue() {
  if (isFlushing || !getAppsScriptUrl()) return;
  isFlushing = true;
  majIndicateurSync();
  const aRecharger = new Set();
  let videe = false;
  try {
    for (;;) {
      const queue = loadQueue();
      if (queue.length === 0) { videe = true; break; }
      const item = queue[0];
      try {
        await apiPost(item.action, item.payload);
        (RESSOURCES_A_RECHARGER_APRES[item.action] || []).forEach(cle => aRecharger.add(cle));
      } catch (err) {
        if (estErreurReseau(err)) break; // pas de réseau : on retentera plus tard
        console.error('Action rejetée par le serveur, abandonnée :', item, err);
      }
      const actuelle = loadQueue();
      actuelle.shift();
      saveQueue(actuelle);
      updateOfflineBanner();
    }
  } finally {
    isFlushing = false;
    majIndicateurSync();
    updateOfflineBanner();
  }
  if (videe && (refreshDifferer || aRecharger.size > 0)) {
    const cles = refreshDifferer ? undefined : [...aRecharger];
    refreshDifferer = false;
    refreshFromServer(cles);
  }
}

// Recharge tout (ou seulement les ressources demandées) depuis le backend.
// Chaque ressource est récupérée indépendamment : si l'une échoue (backend pas
// encore à jour, action inconnue...), les autres se mettent quand même à jour.
// Les données reçues sont ignorées si l'utilisateur a agi entre-temps : elles
// ne contiendraient pas encore son action et la feraient disparaître de l'écran
// jusqu'au prochain rafraîchissement.
function refreshFromServer(cles) {
  if (!getAppsScriptUrl()) return Promise.resolve();
  if (loadQueue().length > 0) {
    // Des actions locales n'ont pas encore été envoyées : on rafraîchira une
    // fois la file vidée (voir flushQueue), sinon on écraserait ces actions.
    refreshDifferer = true;
    flushQueue();
    return Promise.resolve();
  }
  if (refreshEnCours) return refreshEnCours;

  const aCharger = cles || Object.keys(RESSOURCES_SERVEUR);
  const actionsAvant = compteurActions;
  refreshEnCours = (async () => {
    majIndicateurSync();
    try {
      const resultats = await Promise.allSettled(aCharger.map(cle => apiGet(RESSOURCES_SERVEUR[cle])));
      if (compteurActions !== actionsAvant) {
        if (loadQueue().length > 0 || isFlushing) refreshDifferer = true;
        else setTimeout(() => refreshFromServer(cles), 0);
        return;
      }
      aCharger.forEach((cle, i) => {
        const resultat = resultats[i];
        if (resultat.status === 'fulfilled') {
          state[cle] = resultat.value;
        } else if (!estErreurReseau(resultat.reason)) {
          console.error(`Échec de ${RESSOURCES_SERVEUR[cle]} :`, resultat.reason);
        }
      });
      assurerListeActiveValide();
      saveCache();
      populateCategorieSelect();
      renderAll();
    } finally {
      refreshEnCours = null;
      majIndicateurSync();
      updateOfflineBanner();
    }
  })();
  return refreshEnCours;
}

// Rafraîchissement discret quand on ouvre le champ d'ajout, pour que
// l'autocomplétion connaisse les articles ajoutés par les autres membres du
// foyer. Limité dans le temps pour ne pas solliciter le backend à chaque focus.
function rafraichirReferenceEnArrierePlan() {
  const maintenant = Date.now();
  if (maintenant - dernierRafraichissementArrierePlan < 20000) return;
  dernierRafraichissementArrierePlan = maintenant;
  refreshFromServer();
}

// Fine barre de progression en haut de l'écran pendant qu'un échange avec le
// backend est en cours (le CSS la fait apparaître avec un léger délai, pour
// que les échanges rapides ne provoquent aucun clignotement).
function majIndicateurSync() {
  document.body.classList.toggle('sync-en-cours', isFlushing || !!refreshEnCours);
}

// Bandeau « hors ligne » : affiché sans délai quand le réseau est coupé, et
// seulement si l'envoi traîne quand on est en ligne (un envoi normal prend une
// à deux secondes, ce n'est pas la peine d'attirer l'attention dessus).
const DELAI_AVANT_BANDEAU_SYNC_MS = 4000;
let debutAttenteSync = 0;
let minuteurBandeau = null;

function updateOfflineBanner() {
  const enAttente = loadQueue().length;
  const horsLigne = !navigator.onLine;
  if (enAttente === 0) debutAttenteSync = 0;
  else if (!debutAttenteSync) debutAttenteSync = Date.now();
  const ecoule = enAttente > 0 ? Date.now() - debutAttenteSync : 0;
  const attenteLongue = enAttente > 0 && ecoule >= DELAI_AVANT_BANDEAU_SYNC_MS;

  const banner = $('offline-banner');
  if (horsLigne || attenteLongue) {
    banner.hidden = false;
    $('offline-banner-text').textContent = horsLigne
      ? (enAttente > 0 ? `Hors ligne · ${pluriel(enAttente, 'action')} en attente` : 'Hors ligne')
      : `Synchronisation… ${pluriel(enAttente, 'action')} en attente`;
  } else {
    banner.hidden = true;
  }

  clearTimeout(minuteurBandeau);
  if (enAttente > 0 && !horsLigne && !attenteLongue) {
    minuteurBandeau = setTimeout(updateOfflineBanner, DELAI_AVANT_BANDEAU_SYNC_MS - ecoule + 50);
  }
}

// ---- 4. Actions métier ----

// -- Listes de courses (Alimentaire, Bricolage, ...) --

function listeActive() {
  return state.listes.find(l => l.id === getListeActiveId()) || state.listes[0];
}

// S'assure qu'un identifiant de liste active valide est toujours enregistré
// (première ouverture, liste active supprimée ailleurs, etc.), en retombant sur
// « Alimentaire » puis sur la première liste connue.
function assurerListeActiveValide() {
  if (state.listes.length === 0) return;
  const idActuel = getListeActiveId();
  if (idActuel && state.listes.some(l => l.id === idActuel)) return;
  const parDefaut = state.listes.find(l => l.nom === 'Alimentaire') || state.listes[0];
  setListeActiveId(parDefaut.id);
}

function nomListe(listeId) {
  return (state.listes.find(l => l.id === listeId) || {}).nom || 'la liste';
}

function categoriesListeActive() {
  const liste = listeActive();
  return (liste && liste.categories && liste.categories.length > 0) ? liste.categories : CONFIG.CATEGORIES;
}

function articlesListeActive() {
  const idActive = getListeActiveId();
  return state.liste.filter(it => it.listeId === idActive);
}

function archivesListeActive() {
  const idActive = getListeActiveId();
  return state.archives.filter(it => it.listeId === idActive);
}

function creerListe(nom) {
  nom = nom.trim();
  const existante = state.listes.find(l => l.nom.toLowerCase() === nom.toLowerCase());
  if (existante) return existante;
  const liste = { id: uuid(), nom, categories: CONFIG.CATEGORIES.slice() };
  state.listes.push(liste);
  saveCache();
  queueOrSend('creerListe', liste);
  return liste;
}

function changerListeActive(id) {
  setListeActiveId(id);
  populateCategorieSelect();
  renderAll();
}

// -- Liste de courses --

// Ajout manuel d'un article. Un article déjà présent n'est pas dupliqué : s'il
// était coché, il est simplement remis dans la liste. Renvoie true si un
// article a réellement été ajouté.
function ajouterArticle(nom, categorie, quantite) {
  nom = nom.trim();
  if (!nom) return false;
  quantite = (quantite || '').trim();

  const existant = articlesListeActive().find(it => cleNom(it.nom) === cleNom(nom));
  if (existant) {
    if (existant.statut === 'achete') {
      toggleAchete(existant.id);
      showToast(`« ${existant.nom} » remis dans la liste`, null, 'undo');
    } else {
      showToast(`« ${existant.nom} » est déjà dans la liste`, null, 'info');
    }
    return false;
  }

  const id = uuid();
  const listeId = getListeActiveId();
  const now = new Date().toISOString();
  state.liste.push({ id, nom, categorie, quantite, statut: 'actif', dateAjout: now, dateMaj: now, listeId });
  saveCache();
  renderListe();
  queueOrSend('ajouterArticle', { id, nom, categorie, quantite, listeId });
  showToast(`« ${nom} » ajouté`, () => {
    state.liste = state.liste.filter(it => it.id !== id);
    saveCache(); renderListe();
    queueOrSend('supprimer', { id, source: 'liste' });
  });
  return true;
}

function toggleAchete(id) {
  const item = state.liste.find(it => it.id === id);
  if (!item) return;
  item.statut = item.statut === 'achete' ? 'actif' : 'achete';
  item.dateMaj = new Date().toISOString();
  saveCache();
  renderListe();
  queueOrSend('toggleAchete', { id, statut: item.statut });
}

// Archive un ou plusieurs articles de la liste active, avec annulation possible.
function archiverArticles(items) {
  if (items.length === 0) return;
  const ids = new Set(items.map(it => it.id));
  const now = new Date().toISOString();
  state.liste = state.liste.filter(it => !ids.has(it.id));
  state.archives.unshift(...items.map(it => ({ ...it, dateArchive: now })));
  saveCache();
  renderListe();
  renderArchives();
  items.forEach(it => queueOrSend('archiver', { id: it.id }));

  const message = items.length === 1
    ? `« ${items[0].nom} » archivé`
    : `${pluriel(items.length, 'article')} archivé${accordS(items.length)}`;
  showToast(message, () => {
    state.archives = state.archives.filter(it => !ids.has(it.id));
    state.liste.push(...items);
    saveCache(); renderListe(); renderArchives();
    items.forEach(it => queueOrSend('restaurerDepuisArchive', { id: it.id }));
  }, 'inventory_2');
}

function archiver(id) {
  const item = state.liste.find(it => it.id === id);
  if (item) archiverArticles([item]);
}

function restaurerDepuisArchive(id) {
  const idx = state.archives.findIndex(it => it.id === id);
  if (idx === -1) return;
  const [item] = state.archives.splice(idx, 1);
  state.liste.push({ ...item, statut: 'actif' });
  saveCache();
  renderListe();
  renderArchives();
  queueOrSend('restaurerDepuisArchive', { id });
  showToast(`« ${item.nom} » restauré dans la liste`, null, 'undo');
}

// -- Ajout groupé avec cumul des quantités --
//
// Les mêmes règles tournent côté Apps Script (actionAjouterLot) : l'écran se met
// à jour tout de suite, le serveur refait le même calcul de son côté, et les
// deux convergent au prochain rafraîchissement.

function fusionnerProvenanceLocale(ancienne, nouvelle) {
  const parts = String(ancienne || '').split(' + ').concat(String(nouvelle || '').split(' + '))
    .map(p => p.trim()).filter(Boolean);
  return [...new Set(parts)].join(' + ');
}

function messageAjout(resultat, listeId) {
  if (resultat.ajoutes === 0 && resultat.cumules === 0) return 'Tous ces articles y sont déjà';
  const bouts = [];
  if (resultat.ajoutes > 0) bouts.push(`${pluriel(resultat.ajoutes, 'article')} ajouté${accordS(resultat.ajoutes)}`);
  if (resultat.cumules > 0) bouts.push(`${resultat.cumules} cumulé${accordS(resultat.cumules)}`);
  return `${bouts.join(' · ')} dans « ${nomListe(listeId)} »`;
}

function ajouterArticlesAvecCumul(items, listeId, provenance) {
  const aEnvoyer = [];
  const resultat = { ajoutes: 0, cumules: 0 };
  const now = new Date().toISOString();

  items.forEach(src => {
    const item = {
      nom: src.nom,
      categorie: src.categorie || 'Autre',
      quantite: src.quantite || '',
      qte: qteOuNull(src.qte),
      unite: src.unite || '',
      provenance: provenance || '',
    };
    const memeNom = ex => ex.listeId === listeId && cleNom(ex.nom) === cleNom(item.nom);

    if (item.qte === null) {
      // Article sans quantité chiffrée : rien à cumuler, on évite juste le doublon.
      if (state.liste.some(memeNom)) return;
    } else {
      const cible = state.liste.find(ex => memeNom(ex)
        && !ex.quantite
        && qteOuNull(ex.qte) !== null
        && RECETTES.cumulables(ex.unite || '', item.unite || ''));
      if (cible) {
        const somme = RECETTES.additionner(Number(cible.qte), cible.unite || '', item.qte, item.unite);
        if (somme) {
          cible.qte = somme.qte;
          cible.unite = somme.unite;
          cible.provenance = fusionnerProvenanceLocale(cible.provenance, item.provenance);
          cible.dateMaj = now;
          resultat.cumules++;
          aEnvoyer.push(item);
          return;
        }
      }
    }

    // L'identifiant est envoyé au serveur pour que les actions suivantes
    // (cocher, archiver) portent sur la même ligne des deux côtés.
    const id = uuid();
    state.liste.push({
      id, nom: item.nom, categorie: item.categorie, quantite: item.quantite,
      statut: 'actif', dateAjout: now, dateMaj: now, listeId,
      qte: qteOuVide(item.qte), unite: item.unite, provenance: item.provenance,
    });
    resultat.ajoutes++;
    aEnvoyer.push({ ...item, id });
  });

  saveCache();
  if (listeId === getListeActiveId()) renderListe();
  if (aEnvoyer.length > 0) queueOrSend('ajouterLot', { listeId, items: aEnvoyer });
  return resultat;
}

// -- Modèles récurrents --

// Un modèle existe dès qu'il a des articles ou une fiche : un modèle tout juste
// créé, encore vide, n'a qu'une fiche.
function nomsModeles() {
  return [...new Set([...Object.keys(state.modeles), ...Object.keys(state.modelesMeta)])]
    .sort((a, b) => a.localeCompare(b));
}

function modeleExiste(nom) {
  return Object.prototype.hasOwnProperty.call(state.modeles, nom)
    || Object.prototype.hasOwnProperty.call(state.modelesMeta, nom);
}

// Crée un modèle vide. Sa fiche est enregistrée côté serveur tout de suite :
// sans cela, le modèle disparaîtrait au prochain rafraîchissement.
function creerModeleVide(nom) {
  nom = nom.trim();
  if (!nom) return;
  if (modeleExiste(nom)) {
    showToast(`Le modèle « ${nom} » existe déjà`, null, 'info');
    return;
  }
  const meta = { nom, description: '', url: '', portions: null };
  state.modeles[nom] = [];
  state.modelesMeta[nom] = meta;
  saveCache();
  renderModeles();
  queueOrSend('enregistrerModeleMeta', meta);
  showToast(`Modèle « ${nom} » créé`, null, 'bookmark_add');
}

function ajouterAuModele(article, modele) {
  modele = modele.trim();
  if (!modele) return;
  if (!state.modeles[modele]) state.modeles[modele] = [];
  const existe = state.modeles[modele].some(it => cleNom(it.nom) === cleNom(article.nom));
  if (!existe) {
    const item = {
      modele, nom: article.nom, categorie: article.categorie,
      quantite: article.quantite || '', qte: qteOuVide(article.qte), unite: article.unite || '',
    };
    state.modeles[modele].push({ id: uuid(), ...item });
    saveCache();
    renderModeles();
    queueOrSend('ajouterAuModele', item);
  }
  showToast(`Ajouté au modèle « ${modele} »`, null, 'bookmark_add');
}

function supprimerDuModele(modele, id) {
  state.modeles[modele] = (state.modeles[modele] || []).filter(it => it.id !== id);
  saveCache();
  renderModeles();
  queueOrSend('supprimerDuModele', { id });
}

function supprimerModele(modele) {
  const items = state.modeles[modele] || [];
  const meta = state.modelesMeta[modele] || null;
  delete state.modeles[modele];
  delete state.modelesMeta[modele];
  saveCache();
  renderModeles();
  queueOrSend('supprimerModele', { modele });
  showToast(`Modèle « ${modele} » supprimé`, () => {
    state.modeles[modele] = items;
    if (meta) state.modelesMeta[modele] = meta;
    saveCache();
    renderModeles();
    queueOrSend('creerModeleDepuisRecette', {
      modele,
      description: meta ? meta.description : '',
      url: meta ? meta.url : '',
      portions: meta ? meta.portions : '',
      items: items.map(it => ({ nom: it.nom, categorie: it.categorie, qte: it.qte, unite: it.unite, quantite: it.quantite || '' })),
    });
  }, 'delete');
}

function enregistrerFicheModele(modele, description, url) {
  const ancienne = state.modelesMeta[modele] || {};
  const meta = { nom: modele, description, url, portions: ancienne.portions || null };
  state.modelesMeta[modele] = meta;
  saveCache();
  renderModeles();
  queueOrSend('enregistrerModeleMeta', meta);
  showToast('Fiche enregistrée', null, 'edit_note');
}

// Sélection des articles d'un modèle (mémorisée sur l'appareil, par nom).
function estArticleSelectionne(modele, nom) {
  const deselection = loadDeselection();
  return !(deselection[modele] || []).includes(nom.toLowerCase());
}

function definirSelectionArticle(modele, nom, selectionne) {
  const deselection = loadDeselection();
  const key = nom.toLowerCase();
  const ensemble = new Set(deselection[modele] || []);
  if (selectionne) ensemble.delete(key); else ensemble.add(key);
  deselection[modele] = [...ensemble];
  saveDeselection(deselection);
}

function toutSelectionner(modele) {
  const deselection = loadDeselection();
  delete deselection[modele];
  saveDeselection(deselection);
  renderModeles();
}

function enleverSelection(modele) {
  const deselection = loadDeselection();
  deselection[modele] = (state.modeles[modele] || []).map(it => it.nom.toLowerCase());
  saveDeselection(deselection);
  renderModeles();
}

function articlesSelectionnes(modele) {
  return (state.modeles[modele] || []).filter(item => estArticleSelectionne(modele, item.nom));
}

function ajouterDepuisModele(modele) {
  if (articlesSelectionnes(modele).length === 0) {
    showToast('Aucun article sélectionné dans ce modèle');
    return;
  }
  ouvrirModalListes('destination', modele);
}

function ajouterDepuisModeleVersListe(modele, listeId) {
  const resultat = ajouterArticlesAvecCumul(articlesSelectionnes(modele), listeId, modele);
  showToast(messageAjout(resultat, listeId));
}

// -- Table de référence des articles --

function trouverReference(nom) {
  const q = cleNom(nom);
  return state.reference.find(it => cleNom(it.nom) === q);
}

function ajouterReference(nom, categorie) {
  nom = nom.trim();
  if (!nom || trouverReference(nom)) return;
  const id = uuid();
  state.reference.push({ id, nom, categorie });
  saveCache();
  queueOrSend('ajouterReference', { id, nom, categorie });
  showToast(`« ${nom} » ajouté à la table de référence`, null, 'library_add');
}

// ---- 5. Rendu des écrans ----

function renderAll() {
  renderListe();
  renderModeles();
  renderArchives();
  renderRecettes();
}

// Quantité affichée : le texte libre saisi à la main prime, sinon la quantité
// structurée issue d'une recette (qte + unité).
function quantiteAffichee(item) {
  if (item.quantite) return String(item.quantite);
  const qte = qteOuNull(item.qte);
  if (qte !== null) return RECETTES.formatQuantite(qte, item.unite || '');
  return item.unite ? String(item.unite) : '';
}

function groupParCategorie(items) {
  const groupes = {};
  items.forEach(item => {
    const cat = item.categorie || 'Autre';
    (groupes[cat] = groupes[cat] || []).push(item);
  });
  return groupes;
}

function boutonIcone(action, icone, libelle, classe = 'icon-btn') {
  return `<button type="button" class="${classe}" data-action="${action}" title="${escapeHtml(libelle)}" aria-label="${escapeHtml(libelle)}"><span class="ms">${icone}</span></button>`;
}

function caseACocher(action, coche, classe, libelle) {
  return `<button type="button" class="${classe} ${coche ? 'checked' : ''}" data-action="${action}" aria-label="${escapeHtml(libelle)}" aria-pressed="${coche}">${coche ? '<span class="ms msf">check</span>' : ''}</button>`;
}

// -- Liste --

function renderListe() {
  const liste = listeActive();
  $('hero-liste-nom').textContent = liste ? liste.nom : 'Choisir une liste';

  const items = articlesListeActive();
  const actifs = items.filter(it => it.statut !== 'achete');
  const achetes = items.filter(it => it.statut === 'achete');
  const nbRayons = new Set(items.map(it => it.categorie || 'Autre')).size;
  $('stats-liste').textContent = items.length === 0
    ? 'Aucun article pour le moment'
    : `${pluriel(items.length, 'article')} · ${achetes.length} acheté${accordS(achetes.length)} · ${pluriel(nbRayons, 'rayon')}`;

  const conteneur = $('liste-contenu');
  const vide = $('liste-vide');
  const btnArchiverTout = $('btn-archiver-tout');
  if (items.length === 0) {
    conteneur.innerHTML = '';
    vide.hidden = false;
    btnArchiverTout.hidden = true;
    return;
  }
  vide.hidden = true;
  btnArchiverTout.hidden = achetes.length === 0;

  const groupes = groupParCategorie(actifs);
  const ordre = categoriesListeActive().filter(c => groupes[c]);
  Object.keys(groupes).forEach(c => { if (!ordre.includes(c)) ordre.push(c); });

  let html = actifs.length === 0
    ? '<p class="empty-state-inline">Tous les articles ont été récupérés.</p>'
    : ordre.map(cat => {
      const lignes = groupes[cat].slice().sort((a, b) => (a.dateAjout || '').localeCompare(b.dateAjout || ''));
      return renderGroupeListe(cat, lignes, '');
    }).join('');

  if (achetes.length > 0) {
    const triees = achetes.slice().sort((a, b) => (b.dateMaj || b.dateAjout || '').localeCompare(a.dateMaj || a.dateAjout || ''));
    html += renderGroupeListe('Éléments récupérés', triees, 'recuperes');
  }
  conteneur.innerHTML = html;
}

function renderGroupeListe(titre, items, variante) {
  const suffixe = variante ? `-${variante}` : '';
  return `
    <div class="categorie-groupe${variante ? ` categorie-groupe${suffixe}` : ''}">
      <div class="categorie-entete">
        <span class="categorie-badge${variante ? ` categorie-badge${suffixe}` : ''}">${escapeHtml(titre)}</span>
        <span class="categorie-trait"></span>
        <span class="categorie-compte">${items.length}</span>
      </div>
      ${items.map(renderItemRow).join('')}
    </div>`;
}

function renderItemRow(item) {
  const achete = item.statut === 'achete';
  const quantite = quantiteAffichee(item);
  return `
    <div class="item-row ${achete ? 'achete' : ''}" data-id="${item.id}" data-quantite="${escapeHtml(quantite)}" data-provenance="${escapeHtml(item.provenance || '')}">
      ${caseACocher('toggle', achete, 'item-checkbox', achete ? 'Remettre dans la liste' : 'Marquer acheté')}
      <span class="item-nom">${escapeHtml(item.nom)}</span>
      ${quantite ? boutonIcone('voir-quantite', 'scale', `Quantité : ${quantite}`, 'item-qte-badge') : ''}
      ${item.provenance ? boutonIcone('voir-provenance', 'menu_book', "D'où vient cet article", 'item-provenance-badge') : ''}
      <div class="item-actions">
        ${boutonIcone('modele', 'bookmark_add', 'Ajouter à un modèle')}
        ${boutonIcone('archiver', 'inventory_2', 'Archiver')}
      </div>
    </div>`;
}

function populateCategorieSelect() {
  const select = $('input-categorie');
  const valeurActuelle = select.value;
  const categories = categoriesListeActive();
  select.innerHTML = categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  // Un rafraîchissement en arrière-plan ne doit pas faire perdre le rayon
  // que l'utilisateur vient de choisir.
  if (categories.includes(valeurActuelle)) select.value = valeurActuelle;
}

// -- Modèles --

function renderModeles() {
  const noms = nomsModeles();
  $('stats-modeles').textContent = noms.length === 0
    ? 'Aucune liste récurrente'
    : pluriel(noms.length, 'liste récurrente', 'listes récurrentes');

  const conteneur = $('modeles-contenu');
  const vide = $('modeles-vide');
  if (noms.length === 0) {
    conteneur.innerHTML = '';
    vide.hidden = false;
    return;
  }
  vide.hidden = true;
  conteneur.innerHTML = noms.map(renderModeleCarte).join('');
}

function renderModeleCarte(modele) {
  const items = state.modeles[modele] || [];
  const meta = state.modelesMeta[modele] || {};
  const lien = urlSure(meta.url);
  const ficheHtml = (meta.description || lien) ? `
    <div class="modele-fiche">
      <span class="ms">description</span>
      <div class="modele-fiche-texte">
        ${meta.description ? escapeHtml(meta.description) : ''}
        ${lien ? `<a class="modele-fiche-lien" href="${escapeHtml(lien)}" target="_blank" rel="noopener noreferrer"><span class="ms">open_in_new</span>Voir la recette</a>` : ''}
      </div>
    </div>` : '';
  const actionsHtml = items.length === 0 ? '' : `
    <div class="modele-actions">
      <button type="button" class="btn-pill btn-pill-compact" data-action="ajouter-depuis-modele"><span class="ms">playlist_add</span>Ajouter à la liste</button>
      <div class="modele-selection-liens">
        <button type="button" class="lien-selection selectionner" data-action="tout-selectionner">Tout sélectionner</button>
        <button type="button" class="lien-selection enlever" data-action="enlever-selection">Enlever sélection</button>
      </div>
    </div>`;
  const lignesHtml = items.length === 0
    ? '<p class="empty-state-inline dans-carte">Aucun article dans ce modèle pour l\'instant.</p>'
    : items.map(item => renderModeleItem(modele, item)).join('');

  return `
    <div class="modele-carte" data-modele="${escapeHtml(modele)}">
      <div class="modele-entete">
        <div class="modele-entete-titre">
          <span class="ms">bookmarks</span>
          <strong>${escapeHtml(modele)}</strong>
          <span class="modele-compte">${items.length}</span>
          ${meta.portions ? `<span class="modele-portions">${escapeHtml(meta.portions)} pers.</span>` : ''}
          ${boutonIcone('editer-fiche', 'edit_note', 'Modifier la fiche')}
          ${boutonIcone('supprimer-modele', 'delete', 'Supprimer le modèle', 'icon-btn icon-btn-danger')}
        </div>
        ${ficheHtml}
        ${actionsHtml}
      </div>
      ${lignesHtml}
    </div>`;
}

function renderModeleItem(modele, item) {
  const selectionne = estArticleSelectionne(modele, item.nom);
  const quantite = quantiteAffichee(item);
  return `
    <div class="modele-item ${selectionne ? 'selectionne' : ''}" data-id="${item.id}" data-nom="${escapeHtml(item.nom)}" data-quantite="${escapeHtml(quantite)}">
      ${caseACocher('toggle-selection', selectionne, 'modele-checkbox-btn', 'Sélectionner')}
      <span class="modele-item-nom">${escapeHtml(item.nom)}</span>
      ${quantite ? boutonIcone('voir-quantite-modele', 'scale', `Quantité : ${quantite}`, 'item-qte-badge') : ''}
      ${boutonIcone('supprimer-du-modele', 'close', 'Retirer du modèle', 'icon-btn icon-btn-danger')}
    </div>`;
}

// -- Archives --

function renderArchives() {
  const archives = archivesListeActive();
  $('stats-archives').textContent = archives.length === 0
    ? 'Aucun article archivé'
    : `${pluriel(archives.length, 'article')} archivé${accordS(archives.length)}`;

  const conteneur = $('archives-contenu');
  const vide = $('archives-vide');
  if (archives.length === 0) {
    conteneur.innerHTML = '';
    vide.hidden = false;
    return;
  }
  vide.hidden = true;

  const items = archives.slice().sort((a, b) => (b.dateArchive || '').localeCompare(a.dateArchive || ''));
  const groupes = [];
  items.forEach(item => {
    const libelle = libelleJour(item.dateArchive);
    let groupe = groupes.find(g => g.libelle === libelle);
    if (!groupe) { groupe = { libelle, items: [] }; groupes.push(groupe); }
    groupe.items.push(item);
  });

  conteneur.innerHTML = groupes.map(groupe => `
    <div class="archive-groupe">
      <div class="archive-date-entete">${escapeHtml(groupe.libelle)}</div>
      ${groupe.items.map(item => `
        <div class="archive-row" data-id="${item.id}">
          <div class="archive-infos">
            <div class="archive-nom">${escapeHtml(item.nom)}</div>
            <div class="archive-meta">${escapeHtml(item.categorie || 'Autre')} · ${formatDateHeure(item.dateArchive)}</div>
          </div>
          <button type="button" class="btn-restaurer" data-action="restaurer" title="Restaurer dans la liste"><span class="ms">undo</span>Restaurer</button>
        </div>`).join('')}
    </div>`).join('');
}

// ---- 6. Toast, modales et écrans secondaires ----

// -- Toast (annuler / infos) --

let toastTimer = null;

function showToast(message, onUndo, icone = 'check_circle', cle = null) {
  clearTimeout(toastTimer);
  ui.toastCle = cle;
  $('toast-icon').textContent = icone;
  $('toast-text').textContent = message;
  const undoBtn = $('toast-undo');
  undoBtn.hidden = !onUndo;
  undoBtn.onclick = () => { hideToast(); if (onUndo) onUndo(); };
  $('toast').hidden = false;
  toastTimer = setTimeout(hideToast, 6000);
}

function hideToast() {
  clearTimeout(toastTimer);
  $('toast').hidden = true;
  ui.toastCle = null;
}

// Toast d'information lié à un élément (quantité, provenance) : un second clic
// sur le même picto le referme au lieu de le réafficher.
function basculerToastInfo(cle, message, icone) {
  if (!$('toast').hidden && ui.toastCle === cle) hideToast();
  else showToast(message, null, icone, cle);
}

// -- Modales (feuilles qui montent du bas de l'écran) --

function ouvrirModale(id) {
  $(id).hidden = false;
}

// Chaque modale a sa fermeture, qui remet aussi son état à zéro.
const FERMETURES_MODALES = {
  'modal-modele': fermerModalModele,
  'modal-listes': fermerModalListes,
  'modal-reference': fermerModalReference,
  'modal-confirmer-archiver-tout': () => { $('modal-confirmer-archiver-tout').hidden = true; },
  'modal-fiche-modele': fermerModalFiche,
};

function fermerModale(id) {
  (FERMETURES_MODALES[id] || (() => { $(id).hidden = true; }))();
}

// Ferme ce qui est au premier plan (touche Échap) : modale, écran de recette,
// écran de connexion s'il est annulable, ou simplement les suggestions.
function fermerPremierPlan() {
  const modale = [...document.querySelectorAll('.modal')].find(m => !m.hidden);
  if (modale) { fermerModale(modale.id); return true; }
  if (!$('screen-recette').hidden) { fermerEcranRecette(); return true; }
  if (!$('screen-config').hidden && !$('config-annuler').hidden) { fermerEcranConfig(); return true; }
  if (!$('suggestions').hidden) { $('suggestions').hidden = true; return true; }
  return false;
}

function renderChoixModal(conteneur, choix, messageVide) {
  conteneur.innerHTML = choix.map(c => `
    <button type="button" class="modele-choix-btn" ${c.attributs}>
      <span class="ms icon-bookmarks">${c.icone}</span>
      <span class="modele-choix-infos">
        <span class="modele-choix-nom">${escapeHtml(c.nom)}</span>
        ${c.detail ? `<span class="modele-choix-compte">${escapeHtml(c.detail)}</span>` : ''}
      </span>
      <span class="ms icon-chevron">chevron_right</span>
    </button>`).join('') || `<p class="modal-vide">${messageVide}</p>`;
}

// Modale « ajouter à un modèle »
function ouvrirModalModele(article) {
  ui.articlePourModele = article;
  $('modal-soustitre').textContent = `« ${article.nom} » sera ajouté au modèle choisi.`;
  renderChoixModal($('modal-modele-liste'), nomsModeles().map(m => ({
    attributs: `data-modele="${escapeHtml(m)}"`,
    icone: 'bookmarks',
    nom: m,
    detail: pluriel((state.modeles[m] || []).length, 'article'),
  })), 'Aucun modèle existant, créez-en un ci-dessous.');
  ouvrirModale('modal-modele');
}

function fermerModalModele() {
  $('modal-modele').hidden = true;
  $('modal-input-nouveau-modele').value = '';
  ui.articlePourModele = null;
}

// Modale « changer de liste » / « dans quelle liste ajouter ? »
function ouvrirModalListes(mode, source) {
  ui.modalListesMode = mode;
  ui.modalListesSource = source || null;
  const idActive = getListeActiveId();
  const modeAjout = mode !== 'switch';
  $('modal-listes-titre').textContent = modeAjout ? 'Ajouter à quelle liste ?' : 'Changer de liste';
  $('modal-listes-soustitre').textContent = modeAjout
    ? `Les ingrédients cochés de « ${source} » seront ajoutés à la liste choisie, en cumulant les quantités déjà présentes.`
    : 'Choisissez la liste de courses à afficher.';
  renderChoixModal($('modal-listes-liste'), trierParNom(state.listes).map(l => ({
    attributs: `data-liste-id="${escapeHtml(l.id)}"`,
    icone: 'shopping_cart',
    nom: l.nom,
    detail: (mode === 'switch' && l.id === idActive) ? 'Liste actuelle' : '',
  })), 'Aucune liste existante, créez-en une ci-dessous.');
  ouvrirModale('modal-listes');
}

function fermerModalListes() {
  $('modal-listes').hidden = true;
  $('modal-input-nouvelle-liste').value = '';
  ui.modalListesSource = null;
}

// Une liste vient d'être choisie (ou créée) dans la modale : on applique
// l'action qui a ouvert la modale.
function choisirListe(listeId) {
  if (ui.modalListesMode === 'import') ajouterImportALaListe(listeId);
  else if (ui.modalListesMode === 'destination') ajouterDepuisModeleVersListe(ui.modalListesSource, listeId);
  else changerListeActive(listeId);
  fermerModalListes();
}

// Modale « archiver toute la liste ? »
function ouvrirModalConfirmerArchiverTout() {
  const items = articlesListeActive();
  const liste = listeActive();
  $('modal-confirmer-archiver-tout-texte').textContent =
    `${pluriel(items.length, 'article')} de « ${liste ? liste.nom : 'cette liste'} » ${items.length > 1 ? 'seront archivés' : 'sera archivé'}, y compris ceux non cochés. Vous pourrez annuler juste après si besoin.`;
  ouvrirModale('modal-confirmer-archiver-tout');
}

// Modale « nouvel article -> l'ajouter à la table de référence ? »
function proposerAjoutReference(nom, categorie) {
  if (trouverReference(nom)) return;
  ui.referenceCandidat = { nom, categorie };
  $('modal-reference-soustitre').textContent =
    `« ${nom} » n'est pas encore dans votre table de référence. L'ajouter permet de le retrouver plus vite la prochaine fois, avec sa catégorie.`;
  $('modal-reference-categorie-select').innerHTML = categoriesListeActive()
    .map(c => `<option value="${escapeHtml(c)}" ${c === categorie ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
  ouvrirModale('modal-reference');
}

function fermerModalReference() {
  $('modal-reference').hidden = true;
  ui.referenceCandidat = null;
}

// Modale « fiche du modèle » (description et lien)
function ouvrirModalFiche(modele) {
  ui.ficheModele = modele;
  const meta = state.modelesMeta[modele] || {};
  $('modal-fiche-soustitre').textContent = `Modèle « ${modele} »`;
  $('modal-fiche-description').value = meta.description || '';
  $('modal-fiche-url').value = meta.url || '';
  ouvrirModale('modal-fiche-modele');
}

function fermerModalFiche() {
  $('modal-fiche-modele').hidden = true;
  ui.ficheModele = null;
}

// -- Champ quantité (repliable, sous la barre d'ajout) --

function ouvrirQuantite() {
  $('quantite-row').hidden = false;
  $('btn-toggle-quantite').classList.add('actif');
  $('input-quantite').focus();
}

function fermerQuantite() {
  $('quantite-row').hidden = true;
  $('btn-toggle-quantite').classList.remove('actif');
  $('input-quantite').value = '';
}

// -- Suggestions / autocomplétion --
//
// Recherche entièrement locale (dans le cache déjà chargé en mémoire) pour un
// affichage instantané : un aller-retour réseau à chaque frappe serait bien trop
// lent. Le cache est tenu à jour par refreshFromServer(), appelée à l'ouverture
// de l'appli, à chaque retour au premier plan, et en tâche de fond quand on
// ouvre le champ d'ajout (voir rafraichirReferenceEnArrierePlan).

function suggestionsLocales(q) {
  const query = q.toLowerCase();
  const vus = new Map();
  [...state.reference, ...state.liste, ...state.archives, ...Object.values(state.modeles).flat()].forEach(item => {
    if (!item.nom) return;
    const cle = String(item.nom).toLowerCase();
    if (vus.has(cle) || !cle.includes(query)) return;
    vus.set(cle, { nom: item.nom, categorie: item.categorie || 'Autre' });
  });
  return [...vus.values()].slice(0, 8);
}

function chercherSuggestions(q) {
  const conteneur = $('suggestions');
  const resultats = q ? suggestionsLocales(q) : [];
  if (resultats.length === 0) { conteneur.hidden = true; return; }
  conteneur.innerHTML = resultats.map(r => `
    <div class="suggestion-item" data-nom="${escapeHtml(r.nom)}" data-categorie="${escapeHtml(r.categorie)}">
      <span>${escapeHtml(r.nom)}</span><small>${escapeHtml(r.categorie)}</small>
    </div>`).join('');
  conteneur.hidden = false;
}

// -- Écran de connexion (URL du backend) --

function ouvrirEcranConfig({ obligatoire }) {
  $('config-input-url').value = obligatoire ? '' : getAppsScriptUrl();
  $('config-erreur').hidden = true;
  $('config-forcer').hidden = true;
  $('config-annuler').hidden = obligatoire;
  $('screen-config').hidden = false;
}

function fermerEcranConfig() {
  $('screen-config').hidden = true;
}

async function validerEtEnregistrerUrl(url, { forcer }) {
  url = url.trim();
  if (!url) return;
  const erreurEl = $('config-erreur');
  const forcerBtn = $('config-forcer');
  const bouton = $('form-config').querySelector('button[type="submit"]');
  if (!forcer) {
    erreurEl.hidden = true;
    forcerBtn.hidden = true;
    bouton.disabled = true;
    try {
      const res = await fetch(`${url}?action=getListe`);
      await lireReponse(res);
    } catch (err) {
      erreurEl.textContent = "Impossible de joindre cette adresse. Vérifiez l'URL, ou enregistrez quand même si vous êtes hors ligne pour le moment.";
      erreurEl.hidden = false;
      forcerBtn.hidden = false;
      return;
    } finally {
      bouton.disabled = false;
    }
  }
  setAppsScriptUrl(url);
  fermerEcranConfig();
  await refreshFromServer();
  flushQueue();
}

// -- Navigation par onglets --

function activerOnglet(nom) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === nom));
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== `view-${nom}`; });
}

// ---- 7. Onglet Recettes et écran d'import ----

// -- Recherche (catalogue embarqué, recettes enregistrées, internet) --

function catalogueRecettes() {
  return (typeof RECETTES_CATALOGUE !== 'undefined' && Array.isArray(RECETTES_CATALOGUE)) ? RECETTES_CATALOGUE : [];
}

// Mots trop courants pour signifier quoi que ce soit dans une recherche : les
// ignorer évite qu'une recherche absente du catalogue (ex. "tajine de
// crevettes") ne matche à tort "tajine d'agneau" via le seul mot "de".
const MOTS_VIDES_RECHERCHE = new Set([
  'de', 'des', 'du', 'la', 'le', 'les', 'et', 'a', 'à', 'au', 'aux', 'un', 'une',
  'en', 'sur', 'avec', 'sans', 'pour',
]);

function scoreRecherche(recette, requete) {
  const nom = RECETTES.normaliser(recette.nom);
  if (!requete) return 0;
  if (nom === requete) return 100;
  if (nom.indexOf(requete) === 0) return 80;
  if (nom.indexOf(requete) !== -1) return 60;
  const mots = requete.split(' ').filter(m => m && !MOTS_VIDES_RECHERCHE.has(m));
  if (mots.length === 0) return 0;
  const trouves = mots.filter(m => nom.indexOf(m) !== -1 || (recette.tags || []).some(t => RECETTES.normaliser(t).indexOf(m) !== -1));
  if (trouves.length === mots.length) return 40;
  if (trouves.length > 0) return 20;
  return 0;
}

// Un score élevé (le nom du plat contient vraiment la recherche) suffit à
// considérer que le catalogue a répondu. Un score faible (un seul mot en
// commun) ne doit jamais empêcher silencieusement la recherche internet.
function meilleurScoreLocal(requete) {
  const q = RECETTES.normaliser(requete);
  return state.recettes.concat(catalogueRecettes()).reduce((max, r) => Math.max(max, scoreRecherche(r, q)), 0);
}

function chercherRecettesLocales(requete) {
  const q = RECETTES.normaliser(requete);
  const enregistrees = state.recettes.map(r => ({ ...r, origine: 'enregistree' }));
  // Une recette enregistrée masque son homonyme du catalogue.
  const nomsEnregistres = new Set(enregistrees.map(r => RECETTES.normaliser(r.nom)));
  const catalogue = catalogueRecettes()
    .filter(r => !nomsEnregistres.has(RECETTES.normaliser(r.nom)))
    .map(r => ({ ...r, origine: 'catalogue' }));
  if (!q) return trierParNom(enregistrees);
  return enregistrees.concat(catalogue)
    .map(r => ({ recette: r, score: scoreRecherche(r, q) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.recette.nom.localeCompare(b.recette.nom))
    .slice(0, 25)
    .map(x => x.recette);
}

function trouverRecetteLocale(origine, nom) {
  const cle = RECETTES.normaliser(nom);
  const source = origine === 'enregistree' ? state.recettes : catalogueRecettes();
  return source.find(r => RECETTES.normaliser(r.nom) === cle);
}

function renderResultatRecette(r) {
  const attributs = r.origine === 'internet'
    ? `data-origine="internet" data-url="${escapeHtml(r.url)}" data-nom="${escapeHtml(r.titre)}"`
    : `data-origine="${escapeHtml(r.origine)}" data-nom="${escapeHtml(r.nom)}"`;
  const nbIng = (r.ingredients || []).length;
  const meta = r.origine === 'internet' ? r.site : [
    r.origine === 'enregistree' ? (r.source || 'enregistrée') : 'catalogue',
    r.portions ? `${r.portions} pers.` : '',
    nbIng ? `${nbIng} ingrédients` : '',
  ].filter(Boolean).join(' · ');
  const icone = { enregistree: 'bookmark', catalogue: 'menu_book', internet: 'public' }[r.origine];
  return `
    <button type="button" class="recette-resultat" ${attributs}>
      <span class="ms">${icone}</span>
      <span class="recette-resultat-infos">
        <span class="recette-resultat-nom">${escapeHtml(r.origine === 'internet' ? r.titre : r.nom)}</span>
        <span class="recette-resultat-meta">${escapeHtml(meta)}</span>
      </span>
      <span class="ms icon-chevron">chevron_right</span>
    </button>`;
}

function renderRecettes() {
  const n = state.recettes.length;
  const c = catalogueRecettes().length;
  $('stats-recettes').textContent = n === 0
    ? `${c} recettes au catalogue`
    : `${pluriel(n, 'recette')} enregistrée${accordS(n)} · ${c} au catalogue`;

  const requete = $('input-recherche-recette').value.trim();
  const locales = chercherRecettesLocales(requete);
  const internet = requete ? ui.resultatsInternet.map(r => ({ ...r, origine: 'internet' })) : [];

  let html = '';
  if (locales.length > 0) {
    html += `<p class="recette-groupe-titre">${requete ? 'Recettes trouvées' : 'Vos recettes enregistrées'}</p>`;
    html += locales.map(renderResultatRecette).join('');
  }
  if (internet.length > 0) {
    html += '<p class="recette-groupe-titre">Trouvées sur internet</p>';
    html += internet.map(renderResultatRecette).join('');
  }
  $('recettes-resultats').innerHTML = html;

  const message = $('recettes-message');
  message.hidden = !!html;
  if (!html) {
    message.textContent = requete
      ? "Aucune recette de ce nom. Essayez un autre mot, ou collez le lien ou les ingrédients de la recette."
      : "Cherchez une recette par son nom, ou partez d'un lien ou d'une liste d'ingrédients collée. Les recettes importées se retrouvent ensuite ici.";
  }
}

async function lancerRecherche() {
  ui.resultatsInternet = [];
  renderRecettes();
  const requete = $('input-recherche-recette').value.trim();
  if (!requete) return;
  if (ui.rechercheEnCours) { showToast('Recherche déjà en cours…', null, 'public'); return; }
  // Un nom de plat déjà bien reconnu localement (score élevé) rend la
  // recherche internet inutile ; un vague mot en commun ne compte pas assez
  // pour la bloquer en silence : dans ce cas on interroge quand même internet.
  if (meilleurScoreLocal(requete) >= 60) {
    showToast('Déjà dans votre catalogue ou vos recettes', null, 'menu_book');
    return;
  }
  if (!state.rechercheInternet.configuree) {
    showToast("Recherche internet non configurée (voir le README). Collez le lien ou les ingrédients.", null, 'info');
    return;
  }
  ui.rechercheEnCours = true;
  showToast('Recherche sur internet…', null, 'public');
  try {
    const data = await apiGet('chercherRecette', { q: requete });
    ui.resultatsInternet = data.resultats || [];
    hideToast();
    renderRecettes();
    if (ui.resultatsInternet.length === 0) showToast('Aucun résultat sur internet', null, 'search_off');
  } catch (err) {
    hideToast();
    // Le message du serveur (clé invalide, quota dépassé...) aide à
    // diagnostiquer plutôt qu'un « indisponible » générique.
    const detail = estErreurReseau(err) ? 'pas de réseau' : String(err.message || err);
    showToast(`Recherche internet impossible : ${detail}`, null, 'error');
  } finally {
    ui.rechercheEnCours = false;
  }
}

// Ouvre une recette trouvée sur internet : la page est lue par le backend.
async function ouvrirRecetteInternet(url) {
  showToast('Lecture de la recette…', null, 'hourglass_top');
  try {
    const recette = await apiGet('importerRecette', { url });
    hideToast();
    ouvrirEcranRecette('url', recette);
  } catch (err) {
    hideToast();
    showToast("Cette page n'a pas pu être lue. Collez les ingrédients à la main.", null, 'error');
  }
}

// -- Écran d'import : analyse, aperçu, création --

function ouvrirEcranRecette(mode, donnees) {
  donnees = donnees || {};
  ui.importRecette = {
    mode,
    nom: donnees.nom || '',
    description: donnees.description || '',
    url: donnees.url || '',
    source: donnees.source || '',
    portionsSource: donnees.portions || 4,
    portionsCible: donnees.portions || 4,
    ingredients: [],
    ignorees: [],
  };
  $('recette-nom').value = ui.importRecette.nom;
  $('recette-url').value = mode === 'url' ? '' : ui.importRecette.url;
  $('recette-texte').value = '';
  $('recette-erreur').hidden = true;
  $('recette-bloc-url').hidden = mode !== 'url';
  $('recette-bloc-texte').hidden = mode !== 'texte';
  $('recette-etape-libelle').textContent =
    mode === 'url' ? 'Import par lien' : mode === 'texte' ? 'Ingrédients collés' : 'Recette';
  $('screen-recette').hidden = false;

  if (donnees.ingredients) {
    appliquerIngredients(donnees.ingredients, donnees);
  } else {
    afficherEtape('saisie');
    if (mode === 'url') $('recette-url').focus();
    else if (mode === 'texte') $('recette-texte').focus();
  }
}

function fermerEcranRecette() {
  $('screen-recette').hidden = true;
  ui.importRecette = null;
}

function afficherEtape(etape) {
  $('recette-etape-saisie').hidden = etape !== 'saisie';
  $('recette-etape-apercu').hidden = etape !== 'apercu';
  $('recette-actions').hidden = etape !== 'apercu';
}

// Transforme des lignes brutes en lignes d'aperçu éditables.
function appliquerIngredients(lignes, donnees) {
  const imp = ui.importRecette;
  const analyse = RECETTES.parserTexte(lignes);
  const portions = (donnees && donnees.portions) || analyse.portions || imp.portionsSource || 4;
  imp.portionsSource = portions;
  imp.portionsCible = portions;
  imp.ignorees = analyse.ignorees;
  imp.ingredients = analyse.ingredients.map(ing => {
    // La table de référence du foyer prime sur le dictionnaire embarqué.
    const categorieReference = RECETTES.categoriePour(ing.nom, state.reference);
    return {
      nom: ing.nom,
      categorie: categorieReference === 'Autre' ? ing.categorie : categorieReference,
      qteBase: ing.qte,
      uniteBase: ing.unite,
      qte: ing.qte,
      unite: ing.unite,
      note: ing.note,
      basique: ing.basique,
      coche: !ing.basique,
      qteManuelle: false,
    };
  });
  if (donnees) {
    if (donnees.nom) { imp.nom = donnees.nom; $('recette-nom').value = donnees.nom; }
    if (donnees.url) imp.url = donnees.url;
    if (donnees.description) imp.description = donnees.description;
    if (donnees.source) imp.source = donnees.source;
  }
  $('recette-description').value = imp.description || '';
  $('recette-lien').value = imp.url || '';
  renderApercuRecette();
  afficherEtape('apercu');
}

function recalculerEchelle() {
  const imp = ui.importRecette;
  const facteur = imp.portionsCible / imp.portionsSource;
  imp.ingredients.forEach(ing => {
    if (ing.qteManuelle) return;
    const r = RECETTES.echelonnerQuantite(ing.qteBase, ing.uniteBase, facteur);
    ing.qte = r.qte;
    ing.unite = r.unite;
  });
}

function renderApercuRecette() {
  const imp = ui.importRecette;
  $('portions-source').textContent = imp.portionsSource;
  $('portions-cible').textContent = imp.portionsCible;

  const categories = categoriesListeActive();
  $('recette-ingredients').innerHTML = imp.ingredients.map((ing, i) => `
    <div class="ing-row ${ing.coche ? '' : 'decoche'}" data-idx="${i}">
      <div class="ing-ligne1">
        ${caseACocher('toggle-ing', ing.coche, 'ing-check', 'Sélectionner')}
        <input type="text" class="ing-nom" data-champ="nom" value="${escapeHtml(ing.nom)}" placeholder="Ingrédient">
        ${ing.basique ? '<span class="ing-basique-badge">placard</span>' : ''}
        <button type="button" class="ing-supprimer" data-action="supprimer-ing" aria-label="Retirer"><span class="ms">close</span></button>
      </div>
      <div class="ing-ligne2">
        <input type="text" class="ing-qte" data-champ="qte" value="${escapeHtml(ing.qte === null || ing.qte === undefined ? '' : RECETTES.formatNombre(ing.qte))}" placeholder="Qté" inputmode="decimal" aria-label="Quantité">
        <input type="text" class="ing-unite" data-champ="unite" value="${escapeHtml(ing.unite || '')}" placeholder="Unité" aria-label="Unité">
        <select class="ing-categorie" data-champ="categorie" aria-label="Rayon">
          ${categories.map(c => `<option value="${escapeHtml(c)}" ${c === ing.categorie ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
      </div>
    </div>`).join('') || '<p class="empty-state-inline dans-carte">Aucun ingrédient reconnu. Ajoutez-en un ci-dessous.</p>';

  const blocIgnorees = $('recette-ignorees-bloc');
  blocIgnorees.hidden = imp.ignorees.length === 0;
  if (imp.ignorees.length > 0) {
    $('recette-ignorees-titre').textContent = `${pluriel(imp.ignorees.length, 'ligne')} ignorée${accordS(imp.ignorees.length)}`;
    $('recette-ignorees').innerHTML = imp.ignorees.map(l => `
      <div class="recette-ignoree-ligne">${escapeHtml(l.brut)}<small>${escapeHtml(l.raison)}</small></div>`).join('');
  }
}

function afficherErreurRecette(message) {
  const erreurEl = $('recette-erreur');
  erreurEl.textContent = message;
  erreurEl.hidden = false;
}

async function analyserSaisie() {
  const imp = ui.importRecette;
  $('recette-erreur').hidden = true;

  if (imp.mode === 'texte') {
    const texte = $('recette-texte').value.trim();
    if (!texte) { afficherErreurRecette("Collez d'abord la liste des ingrédients."); return; }
    appliquerIngredients(texte, null);
    return;
  }

  const url = $('recette-url').value.trim();
  if (!url) { afficherErreurRecette("Collez l'adresse de la page de la recette."); return; }
  const bouton = $('recette-analyser');
  bouton.disabled = true;
  bouton.innerHTML = '<span class="ms">hourglass_top</span>Lecture de la page…';
  try {
    const recette = await apiGet('importerRecette', { url });
    if (ui.importRecette !== imp) return; // l'écran a été fermé entre-temps
    appliquerIngredients(recette.ingredients, recette);
  } catch (err) {
    afficherErreurRecette(estErreurReseau(err)
      ? "Pas de réseau, ou site trop lent à répondre : l'import par lien a besoin d'une connexion. Vous pouvez coller les ingrédients à la main."
      : String(err.message || err));
  } finally {
    bouton.disabled = false;
    bouton.innerHTML = '<span class="ms">auto_awesome</span>Analyser';
  }
}

function ingredientsCoches() {
  return ui.importRecette.ingredients.filter(ing => ing.coche && ing.nom.trim());
}

function nomRecetteSaisi() {
  const saisi = $('recette-nom').value.trim();
  return saisi || ui.importRecette.nom || 'Recette sans nom';
}

// Un nom déjà pris devient « Blanquette (2) » : on ne remplace jamais un modèle.
function nomModeleDisponible(base) {
  if (!modeleExiste(base)) return base;
  let n = 2;
  while (modeleExiste(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

// Mémorise la recette (quantités d'origine, avant mise à l'échelle) pour la
// retrouver par son nom dans l'onglet Recettes.
function enregistrerRecetteSource(nom) {
  const imp = ui.importRecette;
  const lignes = imp.ingredients.map(ing => {
    const q = ing.qteBase === null || ing.qteBase === undefined ? '' : RECETTES.formatNombre(ing.qteBase);
    return [q, ing.uniteBase, ing.nom].filter(Boolean).join(' ').trim();
  }).filter(Boolean);
  const recette = {
    nom,
    source: imp.source || (imp.mode === 'texte' ? 'collée' : ''),
    url: $('recette-lien').value.trim(),
    portions: imp.portionsSource,
    ingredients: lignes,
  };
  const idx = state.recettes.findIndex(r => RECETTES.normaliser(r.nom) === RECETTES.normaliser(nom));
  if (idx === -1) state.recettes.push(recette); else state.recettes[idx] = recette;
  saveCache();
  queueOrSend('enregistrerRecette', recette);
}

function creerModeleDepuisImport() {
  const coches = ingredientsCoches();
  if (coches.length === 0) { showToast('Aucun ingrédient coché'); return; }
  const imp = ui.importRecette;
  const base = nomRecetteSaisi();
  const modele = nomModeleDisponible(base);
  const description = $('recette-description').value.trim();
  const url = $('recette-lien').value.trim();

  const items = coches.map(ing => ({
    id: uuid(), modele, nom: ing.nom.trim(), categorie: ing.categorie,
    quantite: '', qte: qteOuVide(ing.qte), unite: ing.unite || '',
  }));

  state.modeles[modele] = items;
  state.modelesMeta[modele] = { nom: modele, description, url, portions: imp.portionsCible };
  saveCache();
  queueOrSend('creerModeleDepuisRecette', {
    modele, description, url, portions: imp.portionsCible,
    items: items.map(it => ({ nom: it.nom, categorie: it.categorie, qte: it.qte, unite: it.unite, quantite: '' })),
  });
  enregistrerRecetteSource(base);
  renderModeles();
  renderRecettes();
  fermerEcranRecette();
  activerOnglet('modeles');
  showToast(`Modèle « ${modele} » créé (${pluriel(items.length, 'article')})`, null, 'bookmark_add');
}

function ajouterImportALaListe(listeId) {
  const coches = ingredientsCoches();
  if (coches.length === 0) { showToast('Aucun ingrédient coché'); return; }
  const nom = nomRecetteSaisi();
  const resultat = ajouterArticlesAvecCumul(coches.map(ing => ({
    nom: ing.nom.trim(), categorie: ing.categorie, quantite: '',
    qte: qteOuNull(ing.qte), unite: ing.unite || '',
  })), listeId, nom);
  enregistrerRecetteSource(nom);
  renderRecettes();
  fermerEcranRecette();
  activerOnglet('liste');
  showToast(messageAjout(resultat, listeId));
}

// ---- 8. Câblage des évènements et démarrage ----

// Attache un gestionnaire de clic délégué : `actions` associe chaque
// data-action à une fonction recevant (élément porteur du sélecteur, évènement).
function surClicDelegue(conteneur, selecteurLigne, actions) {
  conteneur.addEventListener('click', (e) => {
    const ligne = e.target.closest(selecteurLigne);
    if (!ligne || !conteneur.contains(ligne)) return;
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action && actions[action]) actions[action](ligne, e);
  });
}

function cablerOnglets() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => activerOnglet(btn.dataset.tab));
  });
  $('btn-vide-modeles').addEventListener('click', () => activerOnglet('modeles'));
  document.querySelectorAll('.btn-settings').forEach(btn => {
    btn.addEventListener('click', () => ouvrirEcranConfig({ obligatoire: false }));
  });
}

function cablerBarreAjout() {
  const nomInput = $('input-nom');

  $('form-ajout').addEventListener('submit', (e) => {
    e.preventDefault();
    const nom = nomInput.value.trim();
    if (!nom) return;
    const categorie = $('input-categorie').value;
    const estNouveau = !trouverReference(nom);
    const ajoute = ajouterArticle(nom, categorie, $('input-quantite').value);
    nomInput.value = '';
    $('suggestions').hidden = true;
    fermerQuantite();
    if (ajoute && estNouveau) proposerAjoutReference(nom, categorie);
  });

  nomInput.addEventListener('input', () => chercherSuggestions(nomInput.value.trim()));
  nomInput.addEventListener('focus', () => {
    chercherSuggestions(nomInput.value.trim());
    rafraichirReferenceEnArrierePlan();
  });

  $('suggestions').addEventListener('click', (e) => {
    const el = e.target.closest('.suggestion-item');
    if (!el) return;
    nomInput.value = el.dataset.nom;
    $('input-categorie').value = el.dataset.categorie;
    $('suggestions').hidden = true;
    nomInput.focus();
  });

  // Un clic ailleurs referme les suggestions.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#form-ajout') && !e.target.closest('#suggestions')) $('suggestions').hidden = true;
  });

  $('btn-toggle-quantite').addEventListener('click', () => {
    if ($('quantite-row').hidden) ouvrirQuantite(); else fermerQuantite();
  });
  $('btn-fermer-quantite').addEventListener('click', fermerQuantite);
  $('input-quantite').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('form-ajout').requestSubmit(); }
  });
}

function cablerListe() {
  surClicDelegue($('liste-contenu'), '.item-row', {
    toggle: row => toggleAchete(row.dataset.id),
    archiver: row => archiver(row.dataset.id),
    modele: row => {
      const item = state.liste.find(it => it.id === row.dataset.id);
      if (item) ouvrirModalModele(item);
    },
    'voir-quantite': row => basculerToastInfo(`qte-${row.dataset.id}`, `Quantité : ${row.dataset.quantite}`, 'scale'),
    'voir-provenance': row => basculerToastInfo(`prov-${row.dataset.id}`, `Vient de : ${row.dataset.provenance}`, 'menu_book'),
  });

  $('btn-archiver-tout').addEventListener('click', ouvrirModalConfirmerArchiverTout);
  $('modal-confirmer-archiver-tout-annuler').addEventListener('click', () => fermerModale('modal-confirmer-archiver-tout'));
  $('modal-confirmer-archiver-tout-confirmer').addEventListener('click', () => {
    fermerModale('modal-confirmer-archiver-tout');
    archiverArticles(articlesListeActive());
  });

  surClicDelegue($('archives-contenu'), '.archive-row', {
    restaurer: row => restaurerDepuisArchive(row.dataset.id),
  });
}

function cablerModeles() {
  $('form-nouveau-modele').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('input-nouveau-modele');
    creerModeleVide(input.value);
    input.value = '';
  });

  const itemDe = (e) => e.target.closest('.modele-item');
  surClicDelegue($('modeles-contenu'), '.modele-carte', {
    'ajouter-depuis-modele': carte => ajouterDepuisModele(carte.dataset.modele),
    'editer-fiche': carte => ouvrirModalFiche(carte.dataset.modele),
    'supprimer-modele': carte => supprimerModele(carte.dataset.modele),
    'supprimer-du-modele': (carte, e) => supprimerDuModele(carte.dataset.modele, itemDe(e).dataset.id),
    'tout-selectionner': carte => toutSelectionner(carte.dataset.modele),
    'enlever-selection': carte => enleverSelection(carte.dataset.modele),
    'toggle-selection': (carte, e) => {
      const itemEl = itemDe(e);
      definirSelectionArticle(carte.dataset.modele, itemEl.dataset.nom, !itemEl.classList.contains('selectionne'));
      renderModeles();
    },
    'voir-quantite-modele': (carte, e) => {
      const itemEl = itemDe(e);
      basculerToastInfo(`qte-${itemEl.dataset.id}`, `Quantité : ${itemEl.dataset.quantite}`, 'scale');
    },
  });

  // Modale « ajouter à un modèle »
  $('modal-modele-liste').addEventListener('click', (e) => {
    const btn = e.target.closest('.modele-choix-btn');
    if (!btn || !ui.articlePourModele) return;
    ajouterAuModele(ui.articlePourModele, btn.dataset.modele);
    fermerModalModele();
  });
  $('form-modal-nouveau-modele').addEventListener('submit', (e) => {
    e.preventDefault();
    const nom = $('modal-input-nouveau-modele').value.trim();
    if (!ui.articlePourModele || !nom) return;
    ajouterAuModele(ui.articlePourModele, nom);
    fermerModalModele();
  });

  // Modale « fiche du modèle »
  $('modal-fiche-enregistrer').addEventListener('click', () => {
    if (!ui.ficheModele) return;
    enregistrerFicheModele(ui.ficheModele, $('modal-fiche-description').value.trim(), $('modal-fiche-url').value.trim());
    fermerModalFiche();
  });
  $('modal-fiche-annuler').addEventListener('click', fermerModalFiche);
}

function cablerListes() {
  $('btn-liste-active').addEventListener('click', () => ouvrirModalListes('switch'));
  $('modal-listes-liste').addEventListener('click', (e) => {
    const btn = e.target.closest('.modele-choix-btn');
    if (btn) choisirListe(btn.dataset.listeId);
  });
  $('form-modal-nouvelle-liste').addEventListener('submit', (e) => {
    e.preventDefault();
    const nom = $('modal-input-nouvelle-liste').value.trim();
    if (nom) choisirListe(creerListe(nom).id);
  });
}

function cablerReference() {
  $('modal-reference-oui').addEventListener('click', () => {
    if (!ui.referenceCandidat) return;
    ajouterReference(ui.referenceCandidat.nom, $('modal-reference-categorie-select').value);
    fermerModalReference();
  });
  $('modal-reference-non').addEventListener('click', fermerModalReference);
}

function cablerModales() {
  // Croix de fermeture, clic sur le fond assombri, touche Échap.
  document.querySelectorAll('.modal').forEach(modal => {
    modal.querySelector('.modal-close')?.addEventListener('click', () => fermerModale(modal.id));
    modal.addEventListener('click', (e) => { if (e.target === modal) fermerModale(modal.id); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fermerPremierPlan()) e.preventDefault();
  });
  $('toast-fermer').addEventListener('click', hideToast);
}

function cablerConfig() {
  $('form-config').addEventListener('submit', (e) => {
    e.preventDefault();
    validerEtEnregistrerUrl($('config-input-url').value, { forcer: false });
  });
  $('config-forcer').addEventListener('click', () => {
    validerEtEnregistrerUrl($('config-input-url').value, { forcer: true });
  });
  $('config-annuler').addEventListener('click', fermerEcranConfig);
}

function cablerRecettes() {
  $('input-recherche-recette').addEventListener('input', () => {
    ui.resultatsInternet = [];
    renderRecettes();
  });
  $('form-recherche-recette').addEventListener('submit', (e) => {
    e.preventDefault();
    $('input-recherche-recette').blur();
    lancerRecherche();
  });
  $('btn-import-url').addEventListener('click', () => ouvrirEcranRecette('url'));
  $('btn-import-texte').addEventListener('click', () => ouvrirEcranRecette('texte'));

  $('recettes-resultats').addEventListener('click', (e) => {
    const btn = e.target.closest('.recette-resultat');
    if (!btn) return;
    if (btn.dataset.origine === 'internet') { ouvrirRecetteInternet(btn.dataset.url); return; }
    const source = trouverRecetteLocale(btn.dataset.origine, btn.dataset.nom);
    if (source) ouvrirEcranRecette('catalogue', source);
  });
}

function cablerEcranRecette() {
  const imp = () => ui.importRecette;

  $('recette-retour').addEventListener('click', fermerEcranRecette);
  $('recette-analyser').addEventListener('click', () => { if (imp()) analyserSaisie(); });

  document.querySelectorAll('.portions-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!imp()) return;
      const champ = btn.dataset.portions === 'source' ? 'portionsSource' : 'portionsCible';
      imp()[champ] = Math.min(50, Math.max(1, imp()[champ] + Number(btn.dataset.delta)));
      recalculerEchelle();
      renderApercuRecette();
    });
  });

  const cocherTout = (coche) => () => {
    if (!imp()) return;
    imp().ingredients.forEach(ing => { ing.coche = coche; });
    renderApercuRecette();
  };
  $('recette-tout-cocher').addEventListener('click', cocherTout(true));
  $('recette-tout-decocher').addEventListener('click', cocherTout(false));

  $('recette-ajouter-ligne').addEventListener('click', () => {
    if (!imp()) return;
    imp().ingredients.push({
      nom: '', categorie: categoriesListeActive()[0] || 'Autre',
      qteBase: null, uniteBase: '', qte: null, unite: '', note: '',
      basique: false, coche: true, qteManuelle: true,
    });
    renderApercuRecette();
    const champs = document.querySelectorAll('#recette-ingredients .ing-nom');
    if (champs.length) champs[champs.length - 1].focus();
  });

  const conteneurIng = $('recette-ingredients');
  surClicDelegue(conteneurIng, '.ing-row', {
    'toggle-ing': row => {
      const ing = imp().ingredients[Number(row.dataset.idx)];
      ing.coche = !ing.coche;
      renderApercuRecette();
    },
    'supprimer-ing': row => {
      imp().ingredients.splice(Number(row.dataset.idx), 1);
      renderApercuRecette();
    },
  });

  // Les champs sont lus au fil de la frappe pour ne rien perdre au moment de
  // valider, sans redessiner la liste (ce qui ferait perdre le focus).
  conteneurIng.addEventListener('input', (e) => {
    const row = e.target.closest('.ing-row');
    if (!row || !imp()) return;
    const ing = imp().ingredients[Number(row.dataset.idx)];
    const champ = e.target.dataset.champ;
    if (champ === 'nom') {
      ing.nom = e.target.value;
    } else if (champ === 'unite') {
      ing.unite = e.target.value.trim();
      ing.qteManuelle = true;
    } else if (champ === 'qte') {
      const valeur = e.target.value.trim().replace(',', '.');
      ing.qte = valeur === '' ? null : (isNaN(Number(valeur)) ? ing.qte : Number(valeur));
      ing.qteManuelle = true;
    } else if (champ === 'categorie') {
      ing.categorie = e.target.value;
    }
  });
  conteneurIng.addEventListener('change', (e) => {
    if (e.target.dataset.champ !== 'categorie' || !imp()) return;
    const row = e.target.closest('.ing-row');
    if (row) imp().ingredients[Number(row.dataset.idx)].categorie = e.target.value;
  });

  $('recette-creer-modele').addEventListener('click', () => { if (imp()) creerModeleDepuisImport(); });
  $('recette-ajouter-liste').addEventListener('click', () => {
    if (!imp()) return;
    if (ingredientsCoches().length === 0) { showToast('Aucun ingrédient coché'); return; }
    ouvrirModalListes('import', nomRecetteSaisi());
  });
}

function cablerReseau() {
  window.addEventListener('online', () => { updateOfflineBanner(); flushQueue(); refreshFromServer(); });
  window.addEventListener('offline', updateOfflineBanner);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { flushQueue(); refreshFromServer(); }
  });
  setInterval(() => { if (loadQueue().length > 0) flushQueue(); }, 20000);
}

function setupEventListeners() {
  cablerOnglets();
  cablerBarreAjout();
  cablerListe();
  cablerModeles();
  cablerListes();
  cablerReference();
  cablerModales();
  cablerConfig();
  cablerRecettes();
  cablerEcranRecette();
  cablerReseau();
}

async function init() {
  loadCache();
  assurerListeActiveValide();
  populateCategorieSelect();
  renderAll();
  setupEventListeners();
  updateOfflineBanner();

  if (!getAppsScriptUrl()) {
    ouvrirEcranConfig({ obligatoire: true });
  } else {
    await refreshFromServer();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
