const state = {
  liste: [],
  modeles: {},
  modelesMeta: {},
  archives: [],
  reference: [],
  listes: [],
  recettes: [],
  rechercheInternet: { configuree: false },
};

let modalCurrentItem = null;
let modalListesMode = 'switch'; // 'switch' (changer de liste active) ou 'destination' (ajouter depuis un modèle)
let modalListesModeleSource = null;
let toastTimer = null;
let isFlushing = false;
let dernierRafraichissementArrierePlan = 0;

// ---- Utils ----

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

// ---- Cache locale ----

function loadCache() {
  try {
    state.liste = JSON.parse(localStorage.getItem('lc_liste') || '[]');
    state.modeles = JSON.parse(localStorage.getItem('lc_modeles') || '{}');
    state.modelesMeta = JSON.parse(localStorage.getItem('lc_modeles_meta') || '{}');
    state.archives = JSON.parse(localStorage.getItem('lc_archives') || '[]');
    state.reference = JSON.parse(localStorage.getItem('lc_reference') || '[]');
    state.listes = JSON.parse(localStorage.getItem('lc_listes') || '[]');
    state.recettes = JSON.parse(localStorage.getItem('lc_recettes') || '[]');
  } catch (e) { /* cache corrompu, on repart de zéro */ }
}

function saveCache() {
  localStorage.setItem('lc_liste', JSON.stringify(state.liste));
  localStorage.setItem('lc_modeles', JSON.stringify(state.modeles));
  localStorage.setItem('lc_modeles_meta', JSON.stringify(state.modelesMeta));
  localStorage.setItem('lc_recettes', JSON.stringify(state.recettes));
  localStorage.setItem('lc_archives', JSON.stringify(state.archives));
  localStorage.setItem('lc_reference', JSON.stringify(state.reference));
  localStorage.setItem('lc_listes', JSON.stringify(state.listes));
}

// ---- Liste de courses active (Alimentaire, Bricolage, ...) ----

function getListeActiveId() {
  return localStorage.getItem('lc_liste_active_id') || '';
}

function setListeActiveId(id) {
  localStorage.setItem('lc_liste_active_id', id);
}

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
  const id = uuid();
  const categories = CONFIG.CATEGORIES.slice();
  const liste = { id, nom, categories };
  state.listes.push(liste);
  saveCache();
  queueOrSend('creerListe', { id, nom, categories });
  return liste;
}

function changerListeActive(id) {
  setListeActiveId(id);
  populateCategorieSelect();
  renderAll();
}

function loadQueue() {
  try { return JSON.parse(localStorage.getItem('lc_queue') || '[]'); }
  catch (e) { return []; }
}

function saveQueue(queue) {
  localStorage.setItem('lc_queue', JSON.stringify(queue));
}

function loadDeselection() {
  try { return JSON.parse(localStorage.getItem('lc_modele_deselection') || '{}'); }
  catch (e) { return {}; }
}

function saveDeselection(deselection) {
  localStorage.setItem('lc_modele_deselection', JSON.stringify(deselection));
}

function getAppsScriptUrl() {
  return localStorage.getItem('lc_apps_script_url') || '';
}

function setAppsScriptUrl(url) {
  localStorage.setItem('lc_apps_script_url', url.trim());
}

// ---- Réseau ----

async function apiGet(action, params = {}) {
  const base = getAppsScriptUrl();
  if (!base) throw new Error('URL non configurée');
  const qs = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`${base}?${qs}`);
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || 'Erreur serveur');
  return body.data;
}

async function apiPost(action, payload = {}) {
  const base = getAppsScriptUrl();
  if (!base) throw new Error('URL non configurée');
  const res = await fetch(base, {
    method: 'POST',
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || 'Erreur serveur');
  return body.data;
}

function queueOrSend(action, payload) {
  const queue = loadQueue();
  queue.push({ action, payload });
  saveQueue(queue);
  flushQueue();
}

async function flushQueue() {
  if (isFlushing || !getAppsScriptUrl()) return;
  isFlushing = true;
  try {
    let queue = loadQueue();
    while (queue.length > 0) {
      const item = queue[0];
      try {
        await apiPost(item.action, item.payload);
        queue.shift();
        saveQueue(queue);
      } catch (err) {
        if (err instanceof TypeError) break; // pas de réseau : on retentera plus tard
        console.error('Action rejetée par le serveur, abandonnée :', item, err);
        queue.shift();
        saveQueue(queue);
      }
    }
  } finally {
    isFlushing = false;
    updateOfflineBanner();
  }
}

// Chaque ressource est récupérée indépendamment : si l'une échoue (backend pas
// encore à jour, action inconnue, etc.), les autres se mettent quand même à
// jour au lieu de laisser tout l'écran bloqué sur l'ancien cache sans indice
// sur ce qui cloche (voir la console en cas de souci).
async function refreshFromServer() {
  if (!getAppsScriptUrl()) return;
  if (loadQueue().length > 0) return; // des actions locales n'ont pas encore été envoyées
  const cibles = {
    liste: 'getListe', modeles: 'getModeles', archives: 'getArchives',
    reference: 'getReference', listes: 'getListes',
    modelesMeta: 'getModelesMeta', recettes: 'getRecettes',
    rechercheInternet: 'etatRechercheInternet',
  };
  const resultats = await Promise.allSettled(
    Object.values(cibles).map(action => apiGet(action))
  );
  Object.keys(cibles).forEach((cle, i) => {
    const resultat = resultats[i];
    if (resultat.status === 'fulfilled') {
      state[cle] = resultat.value;
    } else if (!(resultat.reason instanceof TypeError)) {
      // TypeError = pas de réseau, cas normal hors ligne ; toute autre erreur
      // (action inconnue, erreur du script) vaut la peine d'être visible.
      console.error(`Échec de ${cibles[cle]} :`, resultat.reason);
    }
  });
  assurerListeActiveValide();
  saveCache();
  populateCategorieSelect();
  renderAll();
  updateOfflineBanner();
}

// Recharge liste/modèles/archives/référence en tâche de fond (sans bloquer l'UI),
// pour que l'autocomplétion locale reste à jour si un autre membre du foyer a
// ajouté un article entre-temps. Limité dans le temps pour éviter de solliciter
// le backend à chaque ouverture du champ d'ajout.
function rafraichirReferenceEnArrierePlan() {
  const maintenant = Date.now();
  if (maintenant - dernierRafraichissementArrierePlan < 20000) return;
  dernierRafraichissementArrierePlan = maintenant;
  refreshFromServer();
}

function updateOfflineBanner() {
  const enAttente = loadQueue().length;
  const horsLigne = !navigator.onLine;
  const banner = document.getElementById('offline-banner');
  if (horsLigne || enAttente > 0) {
    banner.hidden = false;
    document.getElementById('offline-banner-text').textContent = horsLigne
      ? (enAttente > 0 ? `Hors ligne · ${enAttente} action(s) en attente` : 'Hors ligne')
      : `Synchronisation… ${enAttente} action(s) en attente`;
  } else {
    banner.hidden = true;
  }
}

// ---- Actions : Liste ----

function ajouterArticle(nom, categorie, quantite) {
  nom = nom.trim();
  if (!nom) return;
  quantite = (quantite || '').trim();
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

function archiver(id) {
  const idx = state.liste.findIndex(it => it.id === id);
  if (idx === -1) return;
  const [item] = state.liste.splice(idx, 1);
  state.archives.unshift({ ...item, dateArchive: new Date().toISOString() });
  saveCache();
  renderListe();
  renderArchives();
  queueOrSend('archiver', { id });
  showToast(`« ${item.nom} » archivé`, () => {
    state.archives = state.archives.filter(it => it.id !== item.id);
    state.liste.push(item);
    saveCache(); renderListe(); renderArchives();
    queueOrSend('restaurerDepuisArchive', { id: item.id });
  }, 'inventory_2');
}

// Archive tous les articles de la liste active (cochés ou non), en une fois.
function archiverToutListeActive(items) {
  if (items.length === 0) return;
  const ids = new Set(items.map(it => it.id));
  const now = new Date().toISOString();
  state.liste = state.liste.filter(it => !ids.has(it.id));
  state.archives.unshift(...items.map(it => ({ ...it, dateArchive: now })));
  saveCache();
  renderListe();
  renderArchives();
  items.forEach(it => queueOrSend('archiver', { id: it.id }));
  showToast(`${pluriel(items.length, 'article')} archivé${items.length > 1 ? 's' : ''}`, () => {
    state.archives = state.archives.filter(it => !ids.has(it.id));
    state.liste.push(...items);
    saveCache(); renderListe(); renderArchives();
    items.forEach(it => queueOrSend('restaurerDepuisArchive', { id: it.id }));
  }, 'inventory_2');
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

// ---- Actions : Modèles ----

function creerModeleVide(nom) {
  nom = nom.trim();
  if (!nom || state.modeles[nom]) return;
  state.modeles[nom] = [];
  saveCache();
  renderModeles();
}

function ajouterAuModele(nom, categorie, modele, quantite) {
  modele = modele.trim();
  if (!modele) return;
  quantite = quantite || '';
  if (!state.modeles[modele]) state.modeles[modele] = [];
  const existe = state.modeles[modele].some(it => it.nom.toLowerCase() === nom.toLowerCase());
  if (!existe) {
    state.modeles[modele].push({ id: uuid(), modele, nom, categorie, quantite });
    saveCache();
    renderModeles();
    queueOrSend('ajouterAuModele', { modele, nom, categorie, quantite });
  }
  showToast(`Ajouté au modèle « ${modele} »`, null, 'bookmark_add');
}

function supprimerDuModele(modele, id) {
  state.modeles[modele] = (state.modeles[modele] || []).filter(it => it.id !== id);
  saveCache();
  renderModeles();
  queueOrSend('supprimerDuModele', { id });
}

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

function ajouterDepuisModele(modele) {
  const items = (state.modeles[modele] || []).filter(item => estArticleSelectionne(modele, item.nom));
  if (items.length === 0) {
    showToast('Aucun article sélectionné dans ce modèle');
    return;
  }
  ouvrirModalListes('destination', modele);
}

function ajouterDepuisModeleVersListe(modele, listeId) {
  const items = (state.modeles[modele] || []).filter(item => estArticleSelectionne(modele, item.nom));
  const resultat = ajouterArticlesAvecCumul(items.map(item => ({
    nom: item.nom,
    categorie: item.categorie,
    quantite: item.quantite || '',
    qte: item.qte === '' || item.qte === null || item.qte === undefined ? null : Number(item.qte),
    unite: item.unite || '',
  })), listeId, modele);
  const nomListe = (state.listes.find(l => l.id === listeId) || {}).nom || 'la liste';
  showToast(messageAjout(resultat, nomListe));
}

// ---- Actions : Table de référence ----

function trouverReference(nom) {
  const q = nom.trim().toLowerCase();
  return state.reference.find(it => String(it.nom).toLowerCase() === q);
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

// ---- Rendu ----

function renderAll() {
  renderListe();
  renderModeles();
  renderArchives();
  renderRecettes();
}

function pluriel(n, mot) { return `${n} ${mot}${n > 1 ? 's' : ''}`; }

function renderHeaderListe() {
  const liste = listeActive();
  document.getElementById('hero-liste-nom').textContent = liste ? liste.nom : 'Choisir une liste';
}

function renderStatsListe(items) {
  const total = items.length;
  const achetes = items.filter(it => it.statut === 'achete').length;
  const nbRayons = new Set(items.map(it => it.categorie || 'Autre')).size;
  document.getElementById('stats-liste').textContent = total === 0
    ? 'Aucun article pour le moment'
    : `${pluriel(total, 'article')} · ${achetes} acheté${achetes > 1 ? 's' : ''} · ${pluriel(nbRayons, 'rayon')}`;
}

function renderStatsModeles() {
  const nb = Object.keys(state.modeles).length;
  document.getElementById('stats-modeles').textContent = nb === 0
    ? 'Aucune liste récurrente'
    : `${nb} liste${nb > 1 ? 's' : ''} récurrente${nb > 1 ? 's' : ''}`;
}

function renderStatsArchives(items) {
  const nb = items.length;
  document.getElementById('stats-archives').textContent = nb === 0
    ? 'Aucun article archivé'
    : `${nb} article${nb > 1 ? 's' : ''} archivé${nb > 1 ? 's' : ''}`;
}

function groupParCategorie(items) {
  const groupes = {};
  items.forEach(item => {
    const cat = item.categorie || 'Autre';
    (groupes[cat] = groupes[cat] || []).push(item);
  });
  return groupes;
}

function renderListe() {
  renderHeaderListe();
  const items = articlesListeActive();
  renderStatsListe(items);
  const conteneur = document.getElementById('liste-contenu');
  const vide = document.getElementById('liste-vide');
  const btnArchiverTout = document.getElementById('btn-archiver-tout');
  if (items.length === 0) {
    conteneur.innerHTML = '';
    vide.hidden = false;
    btnArchiverTout.hidden = true;
    return;
  }
  vide.hidden = true;

  const actifs = items.filter(it => it.statut !== 'achete');
  const achetes = items.filter(it => it.statut === 'achete');
  btnArchiverTout.hidden = achetes.length === 0;

  const groupes = groupParCategorie(actifs);
  const ordre = categoriesListeActive().filter(c => groupes[c]);
  Object.keys(groupes).forEach(c => { if (!ordre.includes(c)) ordre.push(c); });

  let html = actifs.length === 0
    ? '<p class="empty-state-inline">Tous les articles ont été récupérés.</p>'
    : ordre.map(cat => {
      const items = groupes[cat].slice().sort((a, b) => (a.dateAjout || '').localeCompare(b.dateAjout || ''));
      return `
        <div class="categorie-groupe">
          <div class="categorie-entete">
            <span class="categorie-badge">${escapeHtml(cat)}</span>
            <span class="categorie-trait"></span>
            <span class="categorie-compte">${items.length}</span>
          </div>
          ${items.map(renderItemRow).join('')}
        </div>`;
    }).join('');

  if (achetes.length > 0) {
    const triees = achetes.slice().sort((a, b) => (b.dateMaj || b.dateAjout || '').localeCompare(a.dateMaj || a.dateAjout || ''));
    html += `
      <div class="categorie-groupe categorie-groupe-recuperes">
        <div class="categorie-entete">
          <span class="categorie-badge categorie-badge-recuperes">Éléments récupérés</span>
          <span class="categorie-trait"></span>
          <span class="categorie-compte">${achetes.length}</span>
        </div>
        ${triees.map(renderItemRow).join('')}
      </div>`;
  }

  conteneur.innerHTML = html;
}

// Quantité affichée : le texte libre saisi à la main prime, sinon la quantité
// structurée issue d'une recette (qte + unité).
function quantiteAffichee(item) {
  if (item.quantite) return String(item.quantite);
  if (item.qte !== '' && item.qte !== null && item.qte !== undefined) {
    return RECETTES.formatQuantite(Number(item.qte), item.unite || '');
  }
  return item.unite ? String(item.unite) : '';
}

function renderItemRow(item) {
  const achete = item.statut === 'achete';
  const quantite = quantiteAffichee(item);
  const badgeQuantite = quantite
    ? `<button class="item-qte-badge" data-action="voir-quantite" title="Voir la quantité"><span class="ms">scale</span></button>`
    : '';
  const badgeProvenance = item.provenance
    ? `<button class="item-provenance-badge" data-action="voir-provenance" title="D'où vient cet article"><span class="ms">menu_book</span></button>`
    : '';
  return `
    <div class="item-row ${achete ? 'achete' : ''}" data-id="${item.id}" data-quantite="${escapeHtml(quantite)}" data-provenance="${escapeHtml(item.provenance || '')}">
      <button class="item-checkbox ${achete ? 'checked' : ''}" data-action="toggle" title="Marquer acheté">${achete ? '<span class="ms msf">check</span>' : ''}</button>
      <span class="item-nom">${escapeHtml(item.nom)}</span>
      ${badgeQuantite}
      ${badgeProvenance}
      <div class="item-actions">
        <button class="icon-btn" data-action="modele" title="Ajouter à un modèle"><span class="ms">bookmark_add</span></button>
        <button class="icon-btn" data-action="archiver" title="Archiver"><span class="ms">inventory_2</span></button>
      </div>
    </div>`;
}

function renderModeles() {
  renderStatsModeles();
  const conteneur = document.getElementById('modeles-contenu');
  const vide = document.getElementById('modeles-vide');
  const noms = Object.keys(state.modeles).sort((a, b) => a.localeCompare(b));
  if (noms.length === 0) {
    conteneur.innerHTML = '';
    vide.hidden = false;
    return;
  }
  vide.hidden = true;
  conteneur.innerHTML = noms.map(modele => {
    const items = state.modeles[modele] || [];
    const meta = state.modelesMeta[modele] || {};
    const ficheHtml = (meta.description || meta.url) ? `
          <div class="modele-fiche">
            <span class="ms">description</span>
            <div class="modele-fiche-texte">
              ${meta.description ? escapeHtml(meta.description) : ''}
              ${meta.url ? `<a class="modele-fiche-lien" href="${escapeHtml(meta.url)}" target="_blank" rel="noopener noreferrer"><span class="ms">open_in_new</span>Voir la recette</a>` : ''}
            </div>
          </div>` : '';
    return `
      <div class="modele-carte" data-modele="${escapeHtml(modele)}">
        <div class="modele-entete">
          <div class="modele-entete-titre">
            <span class="ms">bookmarks</span>
            <strong>${escapeHtml(modele)}</strong>
            <span class="modele-compte">${items.length}</span>
            ${meta.portions ? `<span class="modele-portions">${meta.portions} pers.</span>` : ''}
            <button type="button" class="icon-btn" data-action="editer-fiche" title="Modifier la fiche"><span class="ms">edit_note</span></button>
            <button type="button" class="icon-btn icon-btn-danger" data-action="supprimer-modele" title="Supprimer le modèle"><span class="ms">delete</span></button>
          </div>
          ${ficheHtml}
          ${items.length === 0 ? '' : `
          <div class="modele-actions">
            <button type="button" class="btn-pill btn-pill-compact" data-action="ajouter-depuis-modele"><span class="ms">playlist_add</span>Ajouter à la liste</button>
            <div class="modele-selection-liens">
              <button type="button" class="lien-selection selectionner" data-action="tout-selectionner">Tout sélectionner</button>
              <button type="button" class="lien-selection enlever" data-action="enlever-selection">Enlever sélection</button>
            </div>
          </div>`}
        </div>
        ${items.length === 0 ? '<p class="empty-state-inline dans-carte">Aucun article dans ce modèle pour l\'instant.</p>' : items.map(item => {
          const selectionne = estArticleSelectionne(modele, item.nom);
          const quantite = quantiteAffichee(item);
          const badgeQuantite = quantite
            ? `<button type="button" class="item-qte-badge" data-action="voir-quantite-modele" title="Voir la quantité"><span class="ms">scale</span></button>`
            : '';
          return `
          <div class="modele-item ${selectionne ? 'selectionne' : ''}" data-id="${item.id}" data-nom="${escapeHtml(item.nom)}" data-quantite="${escapeHtml(quantite)}">
            <button type="button" class="modele-checkbox-btn ${selectionne ? 'checked' : ''}" data-action="toggle-selection" title="Sélectionner">${selectionne ? '<span class="ms msf">check</span>' : ''}</button>
            <span class="modele-item-nom">${escapeHtml(item.nom)}</span>
            ${badgeQuantite}
            <button class="icon-btn icon-btn-danger" data-action="supprimer-du-modele" title="Retirer du modèle"><span class="ms">close</span></button>
          </div>`;
        }).join('')}
      </div>`;
  }).join('');
}

function renderArchives() {
  const archives = archivesListeActive();
  renderStatsArchives(archives);
  const conteneur = document.getElementById('archives-contenu');
  const vide = document.getElementById('archives-vide');
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
          <button class="btn-restaurer" data-action="restaurer" title="Restaurer dans la liste"><span class="ms">undo</span>Restaurer</button>
        </div>`).join('')}
    </div>`).join('');
}

function populateCategorieSelect() {
  const select = document.getElementById('input-categorie');
  select.innerHTML = categoriesListeActive().map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

// ---- Toast (annuler / infos) ----

let toastQuantiteId = null;

function showToast(message, onUndo, icone = 'check_circle') {
  clearTimeout(toastTimer);
  toastQuantiteId = null; // par défaut ce toast n'est pas lié à l'affichage d'une quantité
  const toast = document.getElementById('toast');
  document.getElementById('toast-icon').textContent = icone;
  document.getElementById('toast-text').textContent = message;
  const undoBtn = document.getElementById('toast-undo');
  undoBtn.hidden = !onUndo;
  undoBtn.onclick = () => { hideToast(); if (onUndo) onUndo(); };
  toast.hidden = false;
  toastTimer = setTimeout(hideToast, 6000);
}

function hideToast() {
  clearTimeout(toastTimer);
  document.getElementById('toast').hidden = true;
  toastQuantiteId = null;
}

// ---- Modal "ajouter à un modèle" ----

function ouvrirModalModele(nom, categorie, quantite) {
  modalCurrentItem = { nom, categorie, quantite };
  document.getElementById('modal-soustitre').textContent = `« ${nom} » sera ajouté au modèle choisi.`;
  const conteneur = document.getElementById('modal-modele-liste');
  const noms = Object.keys(state.modeles).sort((a, b) => a.localeCompare(b));
  conteneur.innerHTML = noms.map(m => {
    const nbArticles = (state.modeles[m] || []).length;
    return `
      <button type="button" class="modele-choix-btn" data-modele="${escapeHtml(m)}">
        <span class="ms icon-bookmarks">bookmarks</span>
        <span class="modele-choix-infos">
          <span class="modele-choix-nom">${escapeHtml(m)}</span>
          <span class="modele-choix-compte">${nbArticles} article${nbArticles > 1 ? 's' : ''}</span>
        </span>
        <span class="ms icon-chevron">chevron_right</span>
      </button>`;
  }).join('') || '<p class="modal-vide">Aucun modèle existant, créez-en un ci-dessous.</p>';
  document.getElementById('modal-modele').hidden = false;
}

function fermerModalModele() {
  document.getElementById('modal-modele').hidden = true;
  modalCurrentItem = null;
  document.getElementById('modal-input-nouveau-modele').value = '';
}

// ---- Modal "changer de liste" / "choisir la liste de destination" ----

function ouvrirModalListes(mode, modele) {
  modalListesMode = mode;
  modalListesModeleSource = modele || null;
  const idActive = getListeActiveId();
  const modeAjout = mode === 'destination' || mode === 'import';
  document.getElementById('modal-listes-titre').textContent = modeAjout ? 'Ajouter à quelle liste ?' : 'Changer de liste';
  document.getElementById('modal-listes-soustitre').textContent = modeAjout
    ? `Les ingrédients cochés de « ${modele} » seront ajoutés à la liste choisie, en cumulant les quantités déjà présentes.`
    : 'Choisissez la liste de courses à afficher.';
  const conteneur = document.getElementById('modal-listes-liste');
  const listes = state.listes.slice().sort((a, b) => a.nom.localeCompare(b.nom));
  conteneur.innerHTML = listes.map(l => {
    const estActive = mode === 'switch' && l.id === idActive;
    return `
      <button type="button" class="modele-choix-btn" data-liste-id="${escapeHtml(l.id)}">
        <span class="ms icon-bookmarks">shopping_cart</span>
        <span class="modele-choix-infos">
          <span class="modele-choix-nom">${escapeHtml(l.nom)}</span>
          ${estActive ? '<span class="modele-choix-compte">Liste actuelle</span>' : ''}
        </span>
        <span class="ms icon-chevron">chevron_right</span>
      </button>`;
  }).join('') || '<p class="modal-vide">Aucune liste existante, créez-en une ci-dessous.</p>';
  document.getElementById('modal-listes').hidden = false;
}

function fermerModalListes() {
  document.getElementById('modal-listes').hidden = true;
  document.getElementById('modal-input-nouvelle-liste').value = '';
  modalListesModeleSource = null;
}

// ---- Modal "confirmer l'archivage de toute la liste" ----

function ouvrirModalConfirmerArchiverTout() {
  const items = articlesListeActive();
  const liste = listeActive();
  const nomListe = liste ? liste.nom : 'cette liste';
  document.getElementById('modal-confirmer-archiver-tout-texte').textContent =
    `${pluriel(items.length, 'article')} de « ${nomListe} » ${items.length > 1 ? 'seront archivés' : 'sera archivé'}, y compris ceux non cochés. Vous pourrez annuler juste après si besoin.`;
  document.getElementById('modal-confirmer-archiver-tout').hidden = false;
}

function fermerModalConfirmerArchiverTout() {
  document.getElementById('modal-confirmer-archiver-tout').hidden = true;
}

// ---- Champ quantité (repliable) ----

function ouvrirQuantite() {
  document.getElementById('quantite-row').hidden = false;
  document.getElementById('btn-toggle-quantite').classList.add('actif');
  document.getElementById('input-quantite').focus();
}

function fermerQuantite() {
  document.getElementById('quantite-row').hidden = true;
  document.getElementById('btn-toggle-quantite').classList.remove('actif');
  document.getElementById('input-quantite').value = '';
}

// ---- Suggestions / autocomplétion ----
//
// Recherche entièrement locale (dans le cache déjà chargé en mémoire) pour un
// affichage instantané : un aller-retour réseau à chaque frappe serait bien trop
// lent (le backend Apps Script répond typiquement en 1 à 3 secondes). Le cache
// est tenu à jour par refreshFromServer(), appelée à l'ouverture de l'appli, à
// chaque retour au premier plan, et en tâche de fond quand on ouvre le champ
// d'ajout (voir rafraichirReferenceEnArrierePlan).

function chercherSuggestions(q) {
  const conteneur = document.getElementById('suggestions');
  if (!q) { conteneur.hidden = true; return; }
  const resultats = suggestionsLocales(q);
  if (resultats.length === 0) { conteneur.hidden = true; return; }
  conteneur.innerHTML = resultats.map(r => `
    <div class="suggestion-item" data-nom="${escapeHtml(r.nom)}" data-categorie="${escapeHtml(r.categorie)}">
      <span>${escapeHtml(r.nom)}</span><small>${escapeHtml(r.categorie)}</small>
    </div>`).join('');
  conteneur.hidden = false;
}

function suggestionsLocales(q) {
  const query = q.toLowerCase();
  const vus = new Map();
  [...state.reference, ...state.liste, ...state.archives, ...Object.values(state.modeles).flat()].forEach(item => {
    if (!item.nom || vus.has(item.nom.toLowerCase())) return;
    if (item.nom.toLowerCase().includes(query)) vus.set(item.nom.toLowerCase(), { nom: item.nom, categorie: item.categorie || 'Autre' });
  });
  return [...vus.values()].slice(0, 8);
}

// ---- Modal "nouvel article -> ajouter à la référence" ----

let referenceCandidat = null;

function proposerAjoutReference(nom, categorie) {
  if (trouverReference(nom)) return;
  referenceCandidat = { nom, categorie };
  document.getElementById('modal-reference-soustitre').textContent =
    `« ${nom} » n'est pas encore dans votre table de référence. L'ajouter permet de le retrouver plus vite la prochaine fois, avec sa catégorie.`;
  const select = document.getElementById('modal-reference-categorie-select');
  select.innerHTML = categoriesListeActive().map(c => `<option value="${escapeHtml(c)}" ${c === categorie ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
  document.getElementById('modal-reference').hidden = false;
}

function fermerModalReference() {
  document.getElementById('modal-reference').hidden = true;
  referenceCandidat = null;
}

// ---- Écran de configuration (URL du backend) ----

function ouvrirEcranConfig({ obligatoire }) {
  document.getElementById('config-input-url').value = obligatoire ? '' : getAppsScriptUrl();
  document.getElementById('config-erreur').hidden = true;
  document.getElementById('config-forcer').hidden = true;
  document.getElementById('config-annuler').hidden = obligatoire;
  document.getElementById('screen-config').hidden = false;
}

function fermerEcranConfig() {
  document.getElementById('screen-config').hidden = true;
}

async function validerEtEnregistrerUrl(url, { forcer }) {
  url = url.trim();
  if (!url) return;
  const erreurEl = document.getElementById('config-erreur');
  const forcerBtn = document.getElementById('config-forcer');
  if (!forcer) {
    erreurEl.hidden = true;
    forcerBtn.hidden = true;
    try {
      const res = await fetch(`${url}?action=getListe`);
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || 'Réponse invalide');
    } catch (err) {
      erreurEl.textContent = "Impossible de joindre cette adresse. Vérifiez l'URL, ou enregistrez quand même si vous êtes hors ligne pour le moment.";
      erreurEl.hidden = false;
      forcerBtn.hidden = false;
      return;
    }
  }
  setAppsScriptUrl(url);
  fermerEcranConfig();
  await refreshFromServer();
  flushQueue();
}

// ---- Navigation par onglets ----

function activerOnglet(nom) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === nom));
  document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== `view-${nom}`);
}


// ---- Ajout d'articles avec cumul des quantités ----
//
// Les mêmes règles tournent côté Apps Script (actionAjouterLot) : l'écran se met
// à jour tout de suite, le serveur refait le même calcul de son côté, et les
// deux convergent au prochain rafraîchissement.

function fusionnerProvenanceLocale(ancienne, nouvelle) {
  const parts = String(ancienne || '').split(' + ').concat(String(nouvelle || '').split(' + '))
    .map(p => p.trim()).filter(Boolean);
  return [...new Set(parts)].join(' + ');
}

function messageAjout(resultat, nomListe) {
  if (resultat.ajoutes === 0 && resultat.cumules === 0) return 'Tous ces articles y sont déjà';
  const bouts = [];
  if (resultat.ajoutes > 0) bouts.push(`${pluriel(resultat.ajoutes, 'article')} ajouté${resultat.ajoutes > 1 ? 's' : ''}`);
  if (resultat.cumules > 0) bouts.push(`${resultat.cumules} cumulé${resultat.cumules > 1 ? 's' : ''}`);
  return `${bouts.join(' · ')} dans « ${nomListe} »`;
}

function ajouterArticlesAvecCumul(items, listeId, provenance) {
  const aEnvoyer = [];
  const resultat = { ajoutes: 0, cumules: 0 };

  items.forEach(src => {
    const item = {
      nom: src.nom,
      categorie: src.categorie || 'Autre',
      quantite: src.quantite || '',
      qte: src.qte === '' || src.qte === null || src.qte === undefined ? null : Number(src.qte),
      unite: src.unite || '',
      provenance: provenance || '',
    };

    // Article sans quantité chiffrée : rien à cumuler, on évite juste le doublon.
    if (item.qte === null) {
      const deja = state.liste.some(ex => ex.listeId === listeId
        && RECETTES.normaliser(ex.nom) === RECETTES.normaliser(item.nom));
      if (deja) return;
    } else {
      const cible = state.liste.find(ex => ex.listeId === listeId
        && !ex.quantite
        && ex.qte !== '' && ex.qte !== null && ex.qte !== undefined
        && RECETTES.normaliser(ex.nom) === RECETTES.normaliser(item.nom)
        && RECETTES.cumulables(ex.unite || '', item.unite || ''));
      if (cible) {
        const somme = RECETTES.additionner(Number(cible.qte), cible.unite || '', item.qte, item.unite);
        if (somme) {
          cible.qte = somme.qte;
          cible.unite = somme.unite;
          cible.provenance = fusionnerProvenanceLocale(cible.provenance, item.provenance);
          cible.dateMaj = new Date().toISOString();
          resultat.cumules++;
          aEnvoyer.push(item);
          return;
        }
      }
    }

    const now = new Date().toISOString();
    state.liste.push({
      id: uuid(), nom: item.nom, categorie: item.categorie, quantite: item.quantite,
      statut: 'actif', dateAjout: now, dateMaj: now, listeId,
      qte: item.qte === null ? '' : item.qte, unite: item.unite, provenance: item.provenance,
    });
    resultat.ajoutes++;
    aEnvoyer.push(item);
  });

  saveCache();
  if (listeId === getListeActiveId()) renderListe();
  if (aEnvoyer.length > 0) queueOrSend('ajouterLot', { listeId, items: aEnvoyer });
  return resultat;
}

// ---- Onglet Recettes : recherche et points d'entrée ----

function catalogueRecettes() {
  return (typeof RECETTES_CATALOGUE !== 'undefined' && Array.isArray(RECETTES_CATALOGUE)) ? RECETTES_CATALOGUE : [];
}

function scoreRecherche(recette, requete) {
  const nom = RECETTES.normaliser(recette.nom);
  if (!requete) return 0;
  if (nom === requete) return 100;
  if (nom.indexOf(requete) === 0) return 80;
  if (nom.indexOf(requete) !== -1) return 60;
  const mots = requete.split(' ').filter(Boolean);
  const trouves = mots.filter(m => nom.indexOf(m) !== -1 || (recette.tags || []).some(t => RECETTES.normaliser(t).indexOf(m) !== -1));
  if (trouves.length === mots.length) return 40;
  if (trouves.length > 0) return 20;
  return 0;
}

function chercherRecettesLocales(requete) {
  const q = RECETTES.normaliser(requete);
  const enregistrees = state.recettes.map(r => ({ ...r, origine: 'enregistree' }));
  const catalogue = catalogueRecettes().map(r => ({ ...r, origine: 'catalogue' }));
  // Une recette enregistrée masque son homonyme du catalogue.
  const nomsEnregistres = new Set(enregistrees.map(r => RECETTES.normaliser(r.nom)));
  const toutes = enregistrees.concat(catalogue.filter(r => !nomsEnregistres.has(RECETTES.normaliser(r.nom))));
  if (!q) return toutes.filter(r => r.origine === 'enregistree').sort((a, b) => a.nom.localeCompare(b.nom));
  return toutes
    .map(r => ({ recette: r, score: scoreRecherche(r, q) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.recette.nom.localeCompare(b.recette.nom))
    .slice(0, 25)
    .map(x => x.recette);
}

function renderStatsRecettes() {
  const el = document.getElementById('stats-recettes');
  if (!el) return;
  const n = state.recettes.length;
  const c = catalogueRecettes().length;
  el.textContent = n === 0
    ? `${c} recettes au catalogue`
    : `${pluriel(n, 'recette')} enregistrée${n > 1 ? 's' : ''} · ${c} au catalogue`;
}

function renderRecettes() {
  const conteneur = document.getElementById('recettes-resultats');
  if (!conteneur) return;
  renderStatsRecettes();
  const message = document.getElementById('recettes-message');
  const requete = document.getElementById('input-recherche-recette').value.trim();
  const locales = chercherRecettesLocales(requete);

  let html = '';
  if (locales.length > 0) {
    html += `<p class="recette-groupe-titre">${requete ? 'Recettes trouvées' : 'Vos recettes enregistrées'}</p>`;
    html += locales.map(r => {
      const nbIng = (r.ingredients || []).length;
      const meta = [
        r.origine === 'enregistree' ? (r.source || 'enregistrée') : 'catalogue',
        r.portions ? `${r.portions} pers.` : '',
        nbIng ? `${nbIng} ingrédients` : '',
      ].filter(Boolean).join(' · ');
      return `
        <button type="button" class="recette-resultat" data-origine="${escapeHtml(r.origine)}" data-nom="${escapeHtml(r.nom)}">
          <span class="ms">${r.origine === 'enregistree' ? 'bookmark' : 'menu_book'}</span>
          <span class="recette-resultat-infos">
            <span class="recette-resultat-nom">${escapeHtml(r.nom)}</span>
            <span class="recette-resultat-meta">${escapeHtml(meta)}</span>
          </span>
          <span class="ms icon-chevron">chevron_right</span>
        </button>`;
    }).join('');
  }

  if (requete && resultatsInternet.length > 0) {
    html += '<p class="recette-groupe-titre">Trouvées sur internet</p>';
    html += resultatsInternet.map(r => `
      <button type="button" class="recette-resultat" data-origine="internet" data-url="${escapeHtml(r.url)}" data-nom="${escapeHtml(r.titre)}">
        <span class="ms">public</span>
        <span class="recette-resultat-infos">
          <span class="recette-resultat-nom">${escapeHtml(r.titre)}</span>
          <span class="recette-resultat-meta">${escapeHtml(r.site)}</span>
        </span>
        <span class="ms icon-chevron">chevron_right</span>
      </button>`).join('');
  }

  conteneur.innerHTML = html;

  if (html) {
    message.hidden = true;
  } else {
    message.hidden = false;
    message.textContent = requete
      ? "Aucune recette de ce nom. Essayez un autre mot, ou collez le lien ou les ingrédients de la recette."
      : "Cherchez une recette par son nom, ou partez d'un lien ou d'une liste d'ingrédients collée. Les recettes importées se retrouvent ensuite ici.";
  }
}

let resultatsInternet = [];
let rechercheEnCours = false;

async function lancerRecherche() {
  resultatsInternet = [];
  renderRecettes();
  const requete = document.getElementById('input-recherche-recette').value.trim();
  if (!requete || rechercheEnCours) return;
  if (chercherRecettesLocales(requete).length > 0) return; // le local suffit
  if (!state.rechercheInternet.configuree) {
    showToast("Recherche internet non configurée (voir le README). Collez le lien ou les ingrédients.", null, 'info');
    return;
  }
  rechercheEnCours = true;
  showToast('Recherche sur internet…', null, 'public');
  try {
    const data = await apiGet('chercherRecette', { q: requete });
    resultatsInternet = data.resultats || [];
    hideToast();
    renderRecettes();
    if (resultatsInternet.length === 0) showToast('Aucun résultat sur internet', null, 'search_off');
  } catch (err) {
    hideToast();
    showToast('Recherche internet indisponible', null, 'error');
  } finally {
    rechercheEnCours = false;
  }
}

// ---- Écran d'import : analyse, aperçu, création ----

let importRecette = null;

function ouvrirEcranRecette(mode, donnees) {
  importRecette = {
    mode,
    nom: (donnees && donnees.nom) || '',
    description: (donnees && donnees.description) || '',
    url: (donnees && donnees.url) || '',
    source: (donnees && donnees.source) || '',
    portionsSource: (donnees && donnees.portions) || 4,
    portionsCible: (donnees && donnees.portions) || 4,
    ingredients: [],
    ignorees: [],
    enregistrer: true,
  };
  document.getElementById('recette-nom').value = importRecette.nom;
  document.getElementById('recette-url').value = mode === 'url' ? '' : importRecette.url;
  document.getElementById('recette-texte').value = '';
  document.getElementById('recette-erreur').hidden = true;
  document.getElementById('recette-bloc-url').hidden = mode !== 'url';
  document.getElementById('recette-bloc-texte').hidden = mode !== 'texte';
  document.getElementById('recette-etape-libelle').textContent =
    mode === 'url' ? 'Import par lien' : mode === 'texte' ? 'Ingrédients collés' : 'Recette';
  document.getElementById('screen-recette').hidden = false;

  if (donnees && donnees.ingredients) {
    appliquerIngredients(donnees.ingredients, donnees);
  } else {
    afficherEtape('saisie');
  }
}

function fermerEcranRecette() {
  document.getElementById('screen-recette').hidden = true;
  importRecette = null;
}

function afficherEtape(etape) {
  document.getElementById('recette-etape-saisie').hidden = etape !== 'saisie';
  document.getElementById('recette-etape-apercu').hidden = etape !== 'apercu';
  document.getElementById('recette-actions').hidden = etape !== 'apercu';
}

// Transforme des lignes brutes en lignes d'aperçu éditables.
function appliquerIngredients(lignes, donnees) {
  const analyse = RECETTES.parserTexte(lignes);
  const portions = (donnees && donnees.portions) || analyse.portions || importRecette.portionsSource || 4;
  importRecette.portionsSource = portions;
  importRecette.portionsCible = portions;
  importRecette.ignorees = analyse.ignorees;
  importRecette.ingredients = analyse.ingredients.map(ing => ({
    nom: ing.nom,
    categorie: RECETTES.categoriePour(ing.nom, state.reference) === 'Autre' ? ing.categorie : RECETTES.categoriePour(ing.nom, state.reference),
    qteBase: ing.qte,
    uniteBase: ing.unite,
    qte: ing.qte,
    unite: ing.unite,
    note: ing.note,
    basique: ing.basique,
    coche: !ing.basique,
    qteManuelle: false,
  }));
  if (donnees) {
    if (donnees.nom) { importRecette.nom = donnees.nom; document.getElementById('recette-nom').value = donnees.nom; }
    if (donnees.url) importRecette.url = donnees.url;
    if (donnees.description) importRecette.description = donnees.description;
    if (donnees.source) importRecette.source = donnees.source;
  }
  document.getElementById('recette-description').value = importRecette.description || '';
  document.getElementById('recette-lien').value = importRecette.url || '';
  renderApercuRecette();
  afficherEtape('apercu');
}

function recalculerEchelle() {
  const facteur = importRecette.portionsCible / importRecette.portionsSource;
  importRecette.ingredients.forEach(ing => {
    if (ing.qteManuelle) return;
    const r = RECETTES.echelonnerQuantite(ing.qteBase, ing.uniteBase, facteur);
    ing.qte = r.qte;
    ing.unite = r.unite;
  });
}

function renderApercuRecette() {
  document.getElementById('portions-source').textContent = importRecette.portionsSource;
  document.getElementById('portions-cible').textContent = importRecette.portionsCible;

  const categories = categoriesListeActive();
  document.getElementById('recette-ingredients').innerHTML = importRecette.ingredients.map((ing, i) => `
    <div class="ing-row ${ing.coche ? '' : 'decoche'}" data-idx="${i}">
      <div class="ing-ligne1">
        <button type="button" class="ing-check ${ing.coche ? 'checked' : ''}" data-action="toggle-ing" aria-label="Sélectionner">${ing.coche ? '<span class="ms msf">check</span>' : ''}</button>
        <input type="text" class="ing-nom" data-champ="nom" value="${escapeHtml(ing.nom)}" placeholder="Ingrédient">
        ${ing.basique ? '<span class="ing-basique-badge">placard</span>' : ''}
        <button type="button" class="ing-supprimer" data-action="supprimer-ing" aria-label="Retirer"><span class="ms">close</span></button>
      </div>
      <div class="ing-ligne2">
        <input type="text" class="ing-qte" data-champ="qte" value="${escapeHtml(ing.qte === null || ing.qte === undefined ? '' : RECETTES.formatNombre(ing.qte))}" placeholder="Qté" inputmode="decimal">
        <input type="text" class="ing-unite" data-champ="unite" value="${escapeHtml(ing.unite || '')}" placeholder="Unité">
        <select class="ing-categorie" data-champ="categorie">
          ${categories.map(c => `<option value="${escapeHtml(c)}" ${c === ing.categorie ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
      </div>
    </div>`).join('') || '<p class="empty-state-inline dans-carte">Aucun ingrédient reconnu. Ajoutez-en un ci-dessous.</p>';

  const blocIgnorees = document.getElementById('recette-ignorees-bloc');
  if (importRecette.ignorees.length === 0) {
    blocIgnorees.hidden = true;
  } else {
    blocIgnorees.hidden = false;
    document.getElementById('recette-ignorees-titre').textContent =
      `${pluriel(importRecette.ignorees.length, 'ligne')} ignorée${importRecette.ignorees.length > 1 ? 's' : ''}`;
    document.getElementById('recette-ignorees').innerHTML = importRecette.ignorees.map(l => `
      <div class="recette-ignoree-ligne">${escapeHtml(l.brut)}<small>${escapeHtml(l.raison)}</small></div>`).join('');
  }
}

async function analyserSaisie() {
  const erreurEl = document.getElementById('recette-erreur');
  erreurEl.hidden = true;

  if (importRecette.mode === 'texte') {
    const texte = document.getElementById('recette-texte').value.trim();
    if (!texte) {
      erreurEl.textContent = 'Collez d\'abord la liste des ingrédients.';
      erreurEl.hidden = false;
      return;
    }
    appliquerIngredients(texte, null);
    return;
  }

  const url = document.getElementById('recette-url').value.trim();
  if (!url) {
    erreurEl.textContent = 'Collez l\'adresse de la page de la recette.';
    erreurEl.hidden = false;
    return;
  }
  const bouton = document.getElementById('recette-analyser');
  bouton.disabled = true;
  bouton.innerHTML = '<span class="ms">hourglass_top</span>Lecture de la page…';
  try {
    const recette = await apiGet('importerRecette', { url });
    appliquerIngredients(recette.ingredients, recette);
  } catch (err) {
    erreurEl.textContent = err instanceof TypeError
      ? "Pas de réseau : l'import par lien a besoin d'une connexion. Vous pouvez coller les ingrédients à la main."
      : String(err.message || err);
    erreurEl.hidden = false;
  } finally {
    bouton.disabled = false;
    bouton.innerHTML = '<span class="ms">auto_awesome</span>Analyser';
  }
}

function ingredientsCoches() {
  return importRecette.ingredients.filter(ing => ing.coche && ing.nom.trim());
}

function nomRecetteSaisi() {
  const saisi = document.getElementById('recette-nom').value.trim();
  return saisi || importRecette.nom || 'Recette sans nom';
}

// Un nom déjà pris devient « Blanquette (2) » : on ne remplace jamais un modèle.
function nomModeleDisponible(base) {
  if (!state.modeles[base]) return base;
  let n = 2;
  while (state.modeles[`${base} (${n})`]) n++;
  return `${base} (${n})`;
}

function enregistrerRecetteSource(nom) {
  const lignes = importRecette.ingredients.map(ing => {
    const q = ing.qteBase === null || ing.qteBase === undefined ? '' : RECETTES.formatNombre(ing.qteBase);
    return [q, ing.uniteBase, ing.nom].filter(Boolean).join(' ').trim();
  }).filter(Boolean);
  const recette = {
    nom,
    source: importRecette.source || (importRecette.mode === 'texte' ? 'collée' : ''),
    url: document.getElementById('recette-lien').value.trim(),
    portions: importRecette.portionsSource,
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
  const base = nomRecetteSaisi();
  const modele = nomModeleDisponible(base);
  const description = document.getElementById('recette-description').value.trim();
  const url = document.getElementById('recette-lien').value.trim();

  const items = coches.map(ing => ({
    id: uuid(), modele, nom: ing.nom.trim(), categorie: ing.categorie,
    quantite: '', qte: ing.qte === null || ing.qte === undefined ? '' : ing.qte, unite: ing.unite || '',
  }));

  state.modeles[modele] = items;
  state.modelesMeta[modele] = { nom: modele, description, url, portions: importRecette.portionsCible };
  saveCache();
  queueOrSend('creerModeleDepuisRecette', {
    modele, description, url, portions: importRecette.portionsCible,
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
    qte: ing.qte === null || ing.qte === undefined ? null : ing.qte, unite: ing.unite || '',
  })), listeId, nom);
  enregistrerRecetteSource(nom);
  renderRecettes();
  fermerEcranRecette();
  activerOnglet('liste');
  const nomListe = (state.listes.find(l => l.id === listeId) || {}).nom || 'la liste';
  showToast(messageAjout(resultat, nomListe));
}

// ---- Fiche d'un modèle (description et lien) ----

let ficheModeleCourant = null;

function ouvrirModalFiche(modele) {
  ficheModeleCourant = modele;
  const meta = state.modelesMeta[modele] || {};
  document.getElementById('modal-fiche-soustitre').textContent = `Modèle « ${modele} »`;
  document.getElementById('modal-fiche-description').value = meta.description || '';
  document.getElementById('modal-fiche-url').value = meta.url || '';
  document.getElementById('modal-fiche-modele').hidden = false;
}

function fermerModalFiche() {
  document.getElementById('modal-fiche-modele').hidden = true;
  ficheModeleCourant = null;
}

function enregistrerFicheModele() {
  if (!ficheModeleCourant) return;
  const modele = ficheModeleCourant;
  const ancienne = state.modelesMeta[modele] || {};
  const meta = {
    nom: modele,
    description: document.getElementById('modal-fiche-description').value.trim(),
    url: document.getElementById('modal-fiche-url').value.trim(),
    portions: ancienne.portions || null,
  };
  state.modelesMeta[modele] = meta;
  saveCache();
  queueOrSend('enregistrerModeleMeta', meta);
  fermerModalFiche();
  renderModeles();
  showToast('Fiche enregistrée', null, 'edit_note');
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

// ---- Câblage des évènements ----

function setupEventListeners() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => activerOnglet(btn.dataset.tab));
  });

  document.getElementById('toast-fermer').addEventListener('click', hideToast);

  document.getElementById('form-ajout').addEventListener('submit', (e) => {
    e.preventDefault();
    const nomInput = document.getElementById('input-nom');
    const categorie = document.getElementById('input-categorie').value;
    const nom = nomInput.value.trim();
    if (!nom) return;
    const quantite = document.getElementById('input-quantite').value;
    const estNouveau = !trouverReference(nom);
    ajouterArticle(nom, categorie, quantite);
    nomInput.value = '';
    document.getElementById('suggestions').hidden = true;
    fermerQuantite();
    if (estNouveau) proposerAjoutReference(nom, categorie);
  });

  document.getElementById('input-nom').addEventListener('input', (e) => {
    chercherSuggestions(e.target.value.trim());
  });

  document.getElementById('input-nom').addEventListener('focus', rafraichirReferenceEnArrierePlan);

  document.getElementById('btn-toggle-quantite').addEventListener('click', () => {
    const row = document.getElementById('quantite-row');
    if (row.hidden) ouvrirQuantite(); else fermerQuantite();
  });

  document.getElementById('btn-fermer-quantite').addEventListener('click', fermerQuantite);

  document.getElementById('input-quantite').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('form-ajout').requestSubmit(); }
  });

  document.getElementById('modal-reference-oui').addEventListener('click', () => {
    if (!referenceCandidat) return;
    const categorie = document.getElementById('modal-reference-categorie-select').value;
    ajouterReference(referenceCandidat.nom, categorie);
    fermerModalReference();
  });
  document.getElementById('modal-reference-non').addEventListener('click', fermerModalReference);
  document.getElementById('modal-reference-fermer').addEventListener('click', fermerModalReference);

  document.getElementById('suggestions').addEventListener('click', (e) => {
    const el = e.target.closest('.suggestion-item');
    if (!el) return;
    document.getElementById('input-nom').value = el.dataset.nom;
    document.getElementById('input-categorie').value = el.dataset.categorie;
    document.getElementById('suggestions').hidden = true;
  });

  document.getElementById('liste-contenu').addEventListener('click', (e) => {
    const row = e.target.closest('.item-row');
    if (!row) return;
    const id = row.dataset.id;
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'toggle') toggleAchete(id);
    else if (action === 'archiver') archiver(id);
    else if (action === 'modele') {
      const item = state.liste.find(it => it.id === id);
      if (item) ouvrirModalModele(item.nom, item.categorie, item.quantite);
    } else if (action === 'voir-quantite') {
      const toast = document.getElementById('toast');
      if (!toast.hidden && toastQuantiteId === id) {
        hideToast();
      } else {
        showToast(`Quantité : ${row.dataset.quantite}`, null, 'scale');
        toastQuantiteId = id;
      }
    } else if (action === 'voir-provenance') {
      const toast = document.getElementById('toast');
      if (!toast.hidden && toastQuantiteId === 'prov-' + id) {
        hideToast();
      } else {
        showToast(`Vient de : ${row.dataset.provenance}`, null, 'menu_book');
        toastQuantiteId = 'prov-' + id;
      }
    }
  });

  document.getElementById('form-nouveau-modele').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('input-nouveau-modele');
    creerModeleVide(input.value);
    input.value = '';
  });

  document.getElementById('modeles-contenu').addEventListener('click', (e) => {
    const carte = e.target.closest('.modele-carte');
    if (!carte) return;
    const modele = carte.dataset.modele;
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'ajouter-depuis-modele') ajouterDepuisModele(modele);
    else if (action === 'editer-fiche') ouvrirModalFiche(modele);
    else if (action === 'supprimer-modele') supprimerModele(modele);
    else if (action === 'supprimer-du-modele') {
      const id = e.target.closest('.modele-item').dataset.id;
      supprimerDuModele(modele, id);
    } else if (action === 'tout-selectionner') toutSelectionner(modele);
    else if (action === 'enlever-selection') enleverSelection(modele);
    else if (action === 'toggle-selection') {
      const itemEl = e.target.closest('.modele-item');
      const dejaSelectionne = itemEl.classList.contains('selectionne');
      definirSelectionArticle(modele, itemEl.dataset.nom, !dejaSelectionne);
      renderModeles();
    } else if (action === 'voir-quantite-modele') {
      const itemEl = e.target.closest('.modele-item');
      const toast = document.getElementById('toast');
      if (!toast.hidden && toastQuantiteId === itemEl.dataset.id) {
        hideToast();
      } else {
        showToast(`Quantité : ${itemEl.dataset.quantite}`, null, 'scale');
        toastQuantiteId = itemEl.dataset.id;
      }
    }
  });

  document.getElementById('archives-contenu').addEventListener('click', (e) => {
    const row = e.target.closest('.archive-row');
    if (!row) return;
    if (e.target.closest('[data-action="restaurer"]')) restaurerDepuisArchive(row.dataset.id);
  });

  document.getElementById('modal-modele-liste').addEventListener('click', (e) => {
    const btn = e.target.closest('.modele-choix-btn');
    if (!btn || !modalCurrentItem) return;
    ajouterAuModele(modalCurrentItem.nom, modalCurrentItem.categorie, btn.dataset.modele, modalCurrentItem.quantite);
    fermerModalModele();
  });

  document.getElementById('form-modal-nouveau-modele').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!modalCurrentItem) return;
    const input = document.getElementById('modal-input-nouveau-modele');
    if (!input.value.trim()) return;
    ajouterAuModele(modalCurrentItem.nom, modalCurrentItem.categorie, input.value, modalCurrentItem.quantite);
    fermerModalModele();
  });

  document.getElementById('modal-fermer').addEventListener('click', fermerModalModele);

  document.getElementById('btn-liste-active').addEventListener('click', () => ouvrirModalListes('switch'));

  document.getElementById('modal-listes-liste').addEventListener('click', (e) => {
    const btn = e.target.closest('.modele-choix-btn');
    if (!btn) return;
    const listeId = btn.dataset.listeId;
    if (modalListesMode === 'import') ajouterImportALaListe(listeId);
    else if (modalListesMode === 'destination') ajouterDepuisModeleVersListe(modalListesModeleSource, listeId);
    else changerListeActive(listeId);
    fermerModalListes();
  });

  document.getElementById('form-modal-nouvelle-liste').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('modal-input-nouvelle-liste');
    const nom = input.value.trim();
    if (!nom) return;
    const liste = creerListe(nom);
    if (modalListesMode === 'import') ajouterImportALaListe(liste.id);
    else if (modalListesMode === 'destination') ajouterDepuisModeleVersListe(modalListesModeleSource, liste.id);
    else changerListeActive(liste.id);
    fermerModalListes();
  });

  document.getElementById('modal-listes-fermer').addEventListener('click', fermerModalListes);

  document.getElementById('btn-archiver-tout').addEventListener('click', ouvrirModalConfirmerArchiverTout);
  document.getElementById('modal-confirmer-archiver-tout-annuler').addEventListener('click', fermerModalConfirmerArchiverTout);
  document.getElementById('modal-confirmer-archiver-tout-fermer').addEventListener('click', fermerModalConfirmerArchiverTout);
  document.getElementById('modal-confirmer-archiver-tout-confirmer').addEventListener('click', () => {
    fermerModalConfirmerArchiverTout();
    archiverToutListeActive(articlesListeActive());
  });

  document.querySelectorAll('.btn-settings').forEach(btn => {
    btn.addEventListener('click', () => ouvrirEcranConfig({ obligatoire: false }));
  });

  document.getElementById('btn-vide-modeles').addEventListener('click', () => activerOnglet('modeles'));

  document.getElementById('form-config').addEventListener('submit', (e) => {
    e.preventDefault();
    validerEtEnregistrerUrl(document.getElementById('config-input-url').value, { forcer: false });
  });

  document.getElementById('config-forcer').addEventListener('click', () => {
    validerEtEnregistrerUrl(document.getElementById('config-input-url').value, { forcer: true });
  });

  document.getElementById('config-annuler').addEventListener('click', fermerEcranConfig);

  // ---- Onglet Recettes ----

  document.getElementById('input-recherche-recette').addEventListener('input', () => {
    resultatsInternet = [];
    renderRecettes();
  });

  document.getElementById('form-recherche-recette').addEventListener('submit', (e) => {
    e.preventDefault();
    document.getElementById('input-recherche-recette').blur();
    lancerRecherche();
  });

  document.getElementById('btn-import-url').addEventListener('click', () => ouvrirEcranRecette('url'));
  document.getElementById('btn-import-texte').addEventListener('click', () => ouvrirEcranRecette('texte'));

  document.getElementById('recettes-resultats').addEventListener('click', async (e) => {
    const btn = e.target.closest('.recette-resultat');
    if (!btn) return;
    const origine = btn.dataset.origine;
    if (origine === 'internet') {
      showToast('Lecture de la recette…', null, 'hourglass_top');
      try {
        const recette = await apiGet('importerRecette', { url: btn.dataset.url });
        hideToast();
        ouvrirEcranRecette('url', recette);
      } catch (err) {
        hideToast();
        showToast("Cette page n'a pas pu être lue. Collez les ingrédients à la main.", null, 'error');
      }
      return;
    }
    const nomCherche = RECETTES.normaliser(btn.dataset.nom);
    const source = origine === 'enregistree'
      ? state.recettes.find(r => RECETTES.normaliser(r.nom) === nomCherche)
      : catalogueRecettes().find(r => RECETTES.normaliser(r.nom) === nomCherche);
    if (source) ouvrirEcranRecette('catalogue', source);
  });

  // ---- Écran d'import ----

  document.getElementById('recette-retour').addEventListener('click', fermerEcranRecette);
  document.getElementById('recette-analyser').addEventListener('click', () => {
    if (importRecette) analyserSaisie();
  });

  document.querySelectorAll('.portions-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!importRecette) return;
      const champ = btn.dataset.portions === 'source' ? 'portionsSource' : 'portionsCible';
      const valeur = importRecette[champ] + Number(btn.dataset.delta);
      importRecette[champ] = Math.min(50, Math.max(1, valeur));
      recalculerEchelle();
      renderApercuRecette();
    });
  });

  document.getElementById('recette-tout-cocher').addEventListener('click', () => {
    if (!importRecette) return;
    importRecette.ingredients.forEach(ing => { ing.coche = true; });
    renderApercuRecette();
  });
  document.getElementById('recette-tout-decocher').addEventListener('click', () => {
    if (!importRecette) return;
    importRecette.ingredients.forEach(ing => { ing.coche = false; });
    renderApercuRecette();
  });

  document.getElementById('recette-ajouter-ligne').addEventListener('click', () => {
    if (!importRecette) return;
    importRecette.ingredients.push({
      nom: '', categorie: categoriesListeActive()[0] || 'Autre',
      qteBase: null, uniteBase: '', qte: null, unite: '', note: '',
      basique: false, coche: true, qteManuelle: true,
    });
    renderApercuRecette();
    const champs = document.querySelectorAll('#recette-ingredients .ing-nom');
    if (champs.length) champs[champs.length - 1].focus();
  });

  const conteneurIng = document.getElementById('recette-ingredients');

  conteneurIng.addEventListener('click', (e) => {
    const row = e.target.closest('.ing-row');
    if (!row || !importRecette) return;
    const idx = Number(row.dataset.idx);
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'toggle-ing') {
      importRecette.ingredients[idx].coche = !importRecette.ingredients[idx].coche;
      renderApercuRecette();
    } else if (action === 'supprimer-ing') {
      importRecette.ingredients.splice(idx, 1);
      renderApercuRecette();
    }
  });

  // Les champs sont lus au fil de la frappe pour ne rien perdre au moment de
  // valider, sans redessiner la liste (ce qui ferait perdre le focus).
  conteneurIng.addEventListener('input', (e) => {
    const row = e.target.closest('.ing-row');
    if (!row || !importRecette) return;
    const ing = importRecette.ingredients[Number(row.dataset.idx)];
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
    if (e.target.dataset.champ !== 'categorie') return;
    const row = e.target.closest('.ing-row');
    if (row) importRecette.ingredients[Number(row.dataset.idx)].categorie = e.target.value;
  });

  document.getElementById('recette-creer-modele').addEventListener('click', () => {
    if (importRecette) creerModeleDepuisImport();
  });
  document.getElementById('recette-ajouter-liste').addEventListener('click', () => {
    if (!importRecette) return;
    if (ingredientsCoches().length === 0) { showToast('Aucun ingrédient coché'); return; }
    ouvrirModalListes('import', nomRecetteSaisi());
  });

  // ---- Fiche d'un modèle ----

  document.getElementById('modal-fiche-enregistrer').addEventListener('click', enregistrerFicheModele);
  document.getElementById('modal-fiche-annuler').addEventListener('click', fermerModalFiche);
  document.getElementById('modal-fiche-fermer').addEventListener('click', fermerModalFiche);

  window.addEventListener('online', () => { updateOfflineBanner(); flushQueue(); refreshFromServer(); });
  window.addEventListener('offline', updateOfflineBanner);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { flushQueue(); refreshFromServer(); }
  });
  setInterval(() => { if (loadQueue().length > 0) flushQueue(); }, 20000);
}

// ---- Démarrage ----

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
