/**
 * Socle de l'appli : état partagé, utilitaires et stockage local.
 *
 * Les fichiers app-*.js sont des scripts classiques chargés dans l'ordre
 * indiqué par index.html (config.js, recettes.js, recettes-catalogue.js,
 * app-base.js, app-sync.js, app-recettes.js puis app.js qui démarre l'appli).
 * Ils partagent le même espace global : chaque fichier ne fait référence aux
 * autres qu'au moment où ses fonctions s'exécutent, jamais au chargement.
 */

// ---- État et utilitaires ----

const state = {
  liste: [],
  modeles: {},      // nom du modèle -> articles
  modelesMeta: {},  // nom du modèle -> { description, url, portions }
  archives: [],
  reference: [],
  listes: [],
  recettes: [],
  rechercheInternet: { configuree: false },
  backend: { version: 1 },  // version de l'API du script déployé (voir app-sync.js)
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
  suggestionActive: -1,      // suggestion en surbrillance (navigation clavier)
  articleEnEdition: null,    // identifiant de l'article ouvert dans la modale de modification
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

// ---- Stockage local ----

const CLES = {
  cache: {
    liste: 'lc_liste', modeles: 'lc_modeles', modelesMeta: 'lc_modeles_meta',
    archives: 'lc_archives', reference: 'lc_reference', listes: 'lc_listes', recettes: 'lc_recettes',
    backend: 'lc_backend',
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
    state[champ] = lireJson(CLES.cache[champ], Array.isArray(state[champ]) ? [] : state[champ]);
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

