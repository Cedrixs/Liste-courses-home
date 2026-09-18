/**
 * Réseau et synchronisation avec le backend Apps Script.
 *
 * Deux flux :
 *   - sortant : chaque action locale est mise en file d'attente (localStorage)
 *     puis envoyée dans l'ordre par flushQueue(), qui retente plus tard en cas
 *     de coupure réseau ;
 *   - entrant : refreshFromServer() recharge les données, en une seule requête
 *     (getTout) si le script déployé le permet, sinon ressource par ressource.
 *
 * Le backend annonce sa version dans la réponse de getTout. Un script pas
 * encore mis à jour ne connaît ni getTout ni les actions groupées : l'appli le
 * détecte et retombe sur les actions unitaires, sans rien perdre.
 */

// Apps Script répond typiquement en 1 à 3 secondes ; au-delà de ce délai on
// considère la requête perdue plutôt que de laisser un écran « en cours » figé.
const DELAI_REQUETE_MS = 30000;

// Rafraîchissement périodique quand l'appli est au premier plan, pour voir les
// ajouts des autres membres du foyer sans avoir à la rouvrir.
const INTERVALLE_RAFRAICHISSEMENT_MS = 30000;

const RESSOURCES_SERVEUR = {
  liste: 'getListe', modeles: 'getModeles', archives: 'getArchives',
  reference: 'getReference', listes: 'getListes', modelesMeta: 'getModelesMeta',
  recettes: 'getRecettes', rechercheInternet: 'etatRechercheInternet',
};

// Actions groupées (backend version 2 et plus) et leur équivalent unitaire,
// utilisé si le script déployé ne les connaît pas encore.
const DECOMPOSITIONS = {
  archiverLot: p => p.ids.map(id => ({ action: 'archiver', payload: { id } })),
  restaurerLot: p => p.ids.map(id => ({ action: 'restaurerDepuisArchive', payload: { id } })),
};

// Avec un backend ancien, ces actions attribuent leurs propres identifiants
// aux articles de modèles : la ressource est rechargée après leur envoi pour
// que les actions suivantes (retirer un article du modèle) portent sur les
// bons identifiants. Un backend récent conserve ceux choisis par l'appli.
const RESSOURCES_A_RECHARGER_APRES = {
  ajouterAuModele: ['modeles'],
  creerModeleDepuisRecette: ['modeles'],
};

let isFlushing = false;
let refreshEnCours = null;        // promesse du rafraîchissement en cours, s'il y en a un
let refreshSilencieux = false;    // rafraîchissement périodique : pas d'indicateur à l'écran
let refreshDifferer = false;      // un rafraîchissement a été demandé pendant que des actions attendaient
let compteurActions = 0;          // incrémenté à chaque action locale, pour détecter une réponse serveur périmée
let dernierRafraichissement = 0;
let dernierRafraichissementArrierePlan = 0;
let getToutIndisponible = false;  // le script déployé ne connaît pas getTout (testé une fois par session)

function backendRecent() {
  return Number(state.backend && state.backend.version) >= 2;
}

function definirVersionBackend(version) {
  if (state.backend.version === version) return;
  state.backend = { version };
  ecrireJson(CLES.cache.backend, state.backend);
}

// Réponse du script à une action qu'il ne connaît pas (voir doGet / doPost).
function estActionInconnue(err) {
  return /inconnue/i.test(String((err && err.message) || err));
}

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
      let retirer = true;
      try {
        await apiPost(item.action, item.payload);
        if (!backendRecent()) (RESSOURCES_A_RECHARGER_APRES[item.action] || []).forEach(cle => aRecharger.add(cle));
      } catch (err) {
        if (estErreurReseau(err)) break; // pas de réseau : on retentera plus tard
        const decomposer = DECOMPOSITIONS[item.action];
        if (decomposer && estActionInconnue(err)) {
          // Script pas encore mis à jour : l'action groupée est remplacée
          // par ses actions unitaires, à la même place dans la file.
          definirVersionBackend(1);
          const actuelle = loadQueue();
          actuelle.splice(0, 1, ...decomposer(item.payload));
          saveQueue(actuelle);
          retirer = false;
        } else {
          // Refus du serveur (article introuvable, script pas à jour...) : on
          // abandonne l'action pour ne pas bloquer les suivantes, mais pas en
          // silence, sinon l'utilisateur croit que tout est enregistré.
          console.error('Action rejetée par le serveur, abandonnée :', item, err);
          showToast(`Le serveur a refusé une action (${item.action}) : ${String(err.message || err)}`, null, 'error');
        }
      }
      if (retirer) {
        const actuelle = loadQueue();
        actuelle.shift();
        saveQueue(actuelle);
      }
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

// Récupère les ressources demandées (toutes si `cles` est absent) et renvoie
// { cle: valeur } pour celles reçues. Tout en une requête quand le script le
// permet ; sinon chaque ressource est récupérée indépendamment, pour que
// l'échec de l'une n'empêche pas les autres de se mettre à jour.
async function chargerRessources(cles) {
  if (!cles && !getToutIndisponible) {
    try {
      const tout = await apiGet('getTout');
      definirVersionBackend(Number(tout.version) || 2);
      const recu = {};
      Object.keys(RESSOURCES_SERVEUR).forEach(cle => { if (tout[cle] !== undefined) recu[cle] = tout[cle]; });
      return recu;
    } catch (err) {
      if (estErreurReseau(err)) return {};
      if (!estActionInconnue(err)) { console.error('Échec de getTout :', err); return {}; }
      // Script pas encore mis à jour : requêtes unitaires pour cette session.
      getToutIndisponible = true;
      definirVersionBackend(1);
    }
  }
  const aCharger = cles || Object.keys(RESSOURCES_SERVEUR);
  const resultats = await Promise.allSettled(aCharger.map(cle => apiGet(RESSOURCES_SERVEUR[cle])));
  const recu = {};
  aCharger.forEach((cle, i) => {
    const resultat = resultats[i];
    if (resultat.status === 'fulfilled') recu[cle] = resultat.value;
    else if (!estErreurReseau(resultat.reason)) console.error(`Échec de ${RESSOURCES_SERVEUR[cle]} :`, resultat.reason);
  });
  return recu;
}

// Applique les données reçues et dit si quelque chose a changé (inutile de
// redessiner l'écran, et de perdre la position de défilement, si rien n'a bougé).
function appliquerRessources(recu) {
  let change = false;
  Object.keys(recu).forEach(cle => {
    if (JSON.stringify(state[cle]) === JSON.stringify(recu[cle])) return;
    state[cle] = recu[cle];
    change = true;
  });
  return change;
}

// Recharge tout (ou seulement les ressources demandées) depuis le backend.
// Les données reçues sont ignorées si l'utilisateur a agi entre-temps : elles
// ne contiendraient pas encore son action et la feraient disparaître de l'écran
// jusqu'au prochain rafraîchissement.
function refreshFromServer(cles, options = {}) {
  if (!getAppsScriptUrl()) return Promise.resolve();
  if (loadQueue().length > 0) {
    // Des actions locales n'ont pas encore été envoyées : on rafraîchira une
    // fois la file vidée (voir flushQueue), sinon on écraserait ces actions.
    refreshDifferer = true;
    flushQueue();
    return Promise.resolve();
  }
  if (refreshEnCours) return refreshEnCours;

  const actionsAvant = compteurActions;
  refreshSilencieux = !!options.silencieux;
  refreshEnCours = (async () => {
    majIndicateurSync();
    try {
      const recu = await chargerRessources(cles);
      if (compteurActions !== actionsAvant) {
        if (loadQueue().length > 0 || isFlushing) refreshDifferer = true;
        else setTimeout(() => refreshFromServer(cles), 0);
        return;
      }
      dernierRafraichissement = Date.now();
      if (appliquerRessources(recu)) {
        assurerListeActiveValide();
        saveCache();
        populateCategorieSelect();
        renderAll();
      }
    } finally {
      refreshEnCours = null;
      refreshSilencieux = false;
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

// Rafraîchissement périodique, sans indicateur à l'écran. Avec un backend
// ancien (une requête par ressource), seule la liste est rechargée.
function rafraichissementPeriodique() {
  if (document.hidden || !getAppsScriptUrl()) return;
  if (Date.now() - dernierRafraichissement < INTERVALLE_RAFRAICHISSEMENT_MS - 1000) return;
  refreshFromServer(backendRecent() ? undefined : ['liste'], { silencieux: true });
}

// Fine barre de progression en haut de l'écran pendant qu'un échange avec le
// backend est en cours (le CSS la fait apparaître avec un léger délai, pour
// que les échanges rapides ne provoquent aucun clignotement).
function majIndicateurSync() {
  document.body.classList.toggle('sync-en-cours', isFlushing || (!!refreshEnCours && !refreshSilencieux));
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

function cablerReseau() {
  window.addEventListener('online', () => { updateOfflineBanner(); flushQueue(); refreshFromServer(); });
  window.addEventListener('offline', updateOfflineBanner);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { flushQueue(); refreshFromServer(); }
  });
  setInterval(() => { if (loadQueue().length > 0) flushQueue(); }, 20000);
  setInterval(rafraichissementPeriodique, INTERVALLE_RAFRAICHISSEMENT_MS);
}
