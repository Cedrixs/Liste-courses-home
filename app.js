const state = {
  liste: [],
  modeles: {},
  archives: [],
  reference: [],
};

let modalCurrentItem = null;
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
    state.archives = JSON.parse(localStorage.getItem('lc_archives') || '[]');
    state.reference = JSON.parse(localStorage.getItem('lc_reference') || '[]');
  } catch (e) { /* cache corrompu, on repart de zéro */ }
}

function saveCache() {
  localStorage.setItem('lc_liste', JSON.stringify(state.liste));
  localStorage.setItem('lc_modeles', JSON.stringify(state.modeles));
  localStorage.setItem('lc_archives', JSON.stringify(state.archives));
  localStorage.setItem('lc_reference', JSON.stringify(state.reference));
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

async function refreshFromServer() {
  if (!getAppsScriptUrl()) return;
  if (loadQueue().length > 0) return; // des actions locales n'ont pas encore été envoyées
  try {
    const [liste, modeles, archives, reference] = await Promise.all([
      apiGet('getListe'), apiGet('getModeles'), apiGet('getArchives'), apiGet('getReference'),
    ]);
    state.liste = liste;
    state.modeles = modeles;
    state.archives = archives;
    state.reference = reference;
    saveCache();
    renderAll();
  } catch (err) {
    // hors ligne, ou APPS_SCRIPT_URL pas encore configurée : on garde le cache local
  } finally {
    updateOfflineBanner();
  }
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
  const now = new Date().toISOString();
  state.liste.push({ id, nom, categorie, quantite, statut: 'actif', dateAjout: now, dateMaj: now });
  saveCache();
  renderListe();
  queueOrSend('ajouterArticle', { id, nom, categorie, quantite });
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

function ajouterAuModele(nom, categorie, modele) {
  modele = modele.trim();
  if (!modele) return;
  if (!state.modeles[modele]) state.modeles[modele] = [];
  const existe = state.modeles[modele].some(it => it.nom.toLowerCase() === nom.toLowerCase());
  if (!existe) {
    state.modeles[modele].push({ id: uuid(), modele, nom, categorie });
    saveCache();
    renderModeles();
    queueOrSend('ajouterAuModele', { modele, nom, categorie });
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
  const nomsActifs = new Set(state.liste.map(it => it.nom.toLowerCase()));
  let compte = 0;
  items.forEach(item => {
    if (nomsActifs.has(item.nom.toLowerCase())) return;
    const id = uuid();
    const now = new Date().toISOString();
    state.liste.push({ id, nom: item.nom, categorie: item.categorie, statut: 'actif', dateAjout: now, dateMaj: now });
    nomsActifs.add(item.nom.toLowerCase());
    queueOrSend('ajouterArticle', { id, nom: item.nom, categorie: item.categorie });
    compte++;
  });
  saveCache();
  renderListe();
  showToast(compte > 0 ? `${compte} article(s) ajouté(s) depuis « ${modele} »` : 'Tous les articles sélectionnés y sont déjà');
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
}

function pluriel(n, mot) { return `${n} ${mot}${n > 1 ? 's' : ''}`; }

function renderStatsListe() {
  const total = state.liste.length;
  const achetes = state.liste.filter(it => it.statut === 'achete').length;
  const nbRayons = new Set(state.liste.map(it => it.categorie || 'Autre')).size;
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

function renderStatsArchives() {
  const nb = state.archives.length;
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
  renderStatsListe();
  const conteneur = document.getElementById('liste-contenu');
  const vide = document.getElementById('liste-vide');
  if (state.liste.length === 0) {
    conteneur.innerHTML = '';
    vide.hidden = false;
    return;
  }
  vide.hidden = true;
  const groupes = groupParCategorie(state.liste);
  const ordre = CONFIG.CATEGORIES.filter(c => groupes[c]);
  Object.keys(groupes).forEach(c => { if (!ordre.includes(c)) ordre.push(c); });

  conteneur.innerHTML = ordre.map(cat => {
    const items = groupes[cat].slice().sort((a, b) => {
      if ((a.statut === 'achete') !== (b.statut === 'achete')) return a.statut === 'achete' ? 1 : -1;
      return (a.dateAjout || '').localeCompare(b.dateAjout || '');
    });
    const nbAchetes = items.filter(it => it.statut === 'achete').length;
    return `
      <div class="categorie-groupe">
        <div class="categorie-entete">
          <span class="categorie-badge">${escapeHtml(cat)}</span>
          <span class="categorie-trait"></span>
          <span class="categorie-compte">${nbAchetes}/${items.length}</span>
        </div>
        ${items.map(renderItemRow).join('')}
      </div>`;
  }).join('');
}

function renderItemRow(item) {
  const achete = item.statut === 'achete';
  const badgeQuantite = item.quantite
    ? `<button class="item-qte-badge" data-action="voir-quantite" title="Voir la quantité"><span class="ms">scale</span></button>`
    : '';
  return `
    <div class="item-row ${achete ? 'achete' : ''}" data-id="${item.id}" data-quantite="${escapeHtml(item.quantite || '')}">
      <button class="item-checkbox ${achete ? 'checked' : ''}" data-action="toggle" title="Marquer acheté">${achete ? '<span class="ms msf">check</span>' : ''}</button>
      <span class="item-nom">${escapeHtml(item.nom)}</span>
      ${badgeQuantite}
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
    return `
      <div class="modele-carte" data-modele="${escapeHtml(modele)}">
        <div class="modele-entete">
          <div class="modele-entete-titre">
            <span class="ms">bookmarks</span>
            <strong>${escapeHtml(modele)}</strong>
            <span class="modele-compte">${items.length}</span>
          </div>
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
          return `
          <div class="modele-item ${selectionne ? 'selectionne' : ''}" data-id="${item.id}" data-nom="${escapeHtml(item.nom)}">
            <button type="button" class="modele-checkbox-btn ${selectionne ? 'checked' : ''}" data-action="toggle-selection" title="Sélectionner">${selectionne ? '<span class="ms msf">check</span>' : ''}</button>
            <span class="modele-item-nom">${escapeHtml(item.nom)}</span>
            <button class="icon-btn icon-btn-danger" data-action="supprimer-du-modele" title="Retirer du modèle"><span class="ms">close</span></button>
          </div>`;
        }).join('')}
      </div>`;
  }).join('');
}

function renderArchives() {
  renderStatsArchives();
  const conteneur = document.getElementById('archives-contenu');
  const vide = document.getElementById('archives-vide');
  if (state.archives.length === 0) {
    conteneur.innerHTML = '';
    vide.hidden = false;
    return;
  }
  vide.hidden = true;
  const items = state.archives.slice().sort((a, b) => (b.dateArchive || '').localeCompare(a.dateArchive || ''));
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
  select.innerHTML = CONFIG.CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
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

function ouvrirModalModele(nom, categorie) {
  modalCurrentItem = { nom, categorie };
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
  select.innerHTML = CONFIG.CATEGORIES.map(c => `<option value="${escapeHtml(c)}" ${c === categorie ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
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
      if (item) ouvrirModalModele(item.nom, item.categorie);
    } else if (action === 'voir-quantite') {
      const toast = document.getElementById('toast');
      if (!toast.hidden && toastQuantiteId === id) {
        hideToast();
      } else {
        showToast(`Quantité : ${row.dataset.quantite}`, null, 'scale');
        toastQuantiteId = id;
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
    ajouterAuModele(modalCurrentItem.nom, modalCurrentItem.categorie, btn.dataset.modele);
    fermerModalModele();
  });

  document.getElementById('form-modal-nouveau-modele').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!modalCurrentItem) return;
    const input = document.getElementById('modal-input-nouveau-modele');
    if (!input.value.trim()) return;
    ajouterAuModele(modalCurrentItem.nom, modalCurrentItem.categorie, input.value);
    fermerModalModele();
  });

  document.getElementById('modal-fermer').addEventListener('click', fermerModalModele);

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
