const state = {
  liste: [],
  modeles: {},
  archives: [],
};

let modalCurrentItem = null;
let toastTimer = null;
let isFlushing = false;

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

function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// ---- Cache locale ----

function loadCache() {
  try {
    state.liste = JSON.parse(localStorage.getItem('lc_liste') || '[]');
    state.modeles = JSON.parse(localStorage.getItem('lc_modeles') || '{}');
    state.archives = JSON.parse(localStorage.getItem('lc_archives') || '[]');
  } catch (e) { /* cache corrompu, on repart de zéro */ }
}

function saveCache() {
  localStorage.setItem('lc_liste', JSON.stringify(state.liste));
  localStorage.setItem('lc_modeles', JSON.stringify(state.modeles));
  localStorage.setItem('lc_archives', JSON.stringify(state.archives));
}

function loadQueue() {
  try { return JSON.parse(localStorage.getItem('lc_queue') || '[]'); }
  catch (e) { return []; }
}

function saveQueue(queue) {
  localStorage.setItem('lc_queue', JSON.stringify(queue));
}

// ---- Réseau ----

async function apiGet(action, params = {}) {
  const qs = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`${CONFIG.APPS_SCRIPT_URL}?${qs}`);
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || 'Erreur serveur');
  return body.data;
}

async function apiPost(action, payload = {}) {
  const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
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
  if (isFlushing) return;
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
  if (loadQueue().length > 0) return; // des actions locales n'ont pas encore été envoyées
  try {
    const [liste, modeles, archives] = await Promise.all([
      apiGet('getListe'), apiGet('getModeles'), apiGet('getArchives'),
    ]);
    state.liste = liste;
    state.modeles = modeles;
    state.archives = archives;
    saveCache();
    renderAll();
  } catch (err) {
    // hors ligne, ou APPS_SCRIPT_URL pas encore configurée : on garde le cache local
  } finally {
    updateOfflineBanner();
  }
}

function updateOfflineBanner() {
  const enAttente = loadQueue().length;
  const horsLigne = !navigator.onLine;
  const banner = document.getElementById('offline-banner');
  const dot = document.getElementById('offline-dot');
  if (horsLigne || enAttente > 0) {
    dot.hidden = false;
    banner.hidden = false;
    document.getElementById('offline-banner-text').textContent = horsLigne
      ? (enAttente > 0 ? `Hors ligne · ${enAttente} action(s) en attente` : 'Hors ligne')
      : `Synchronisation… ${enAttente} action(s) en attente`;
  } else {
    dot.hidden = true;
    banner.hidden = true;
  }
}

// ---- Actions : Liste ----

function ajouterArticle(nom, categorie) {
  nom = nom.trim();
  if (!nom) return;
  const id = uuid();
  const now = new Date().toISOString();
  state.liste.push({ id, nom, categorie, statut: 'actif', dateAjout: now, dateMaj: now });
  saveCache();
  renderListe();
  queueOrSend('ajouterArticle', { id, nom, categorie });
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
  });
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
  showToast(`« ${item.nom} » restauré dans la liste`);
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
  showToast(`Ajouté au modèle « ${modele} »`);
}

function supprimerDuModele(modele, id) {
  state.modeles[modele] = (state.modeles[modele] || []).filter(it => it.id !== id);
  saveCache();
  renderModeles();
  queueOrSend('supprimerDuModele', { id });
}

function ajouterDepuisModele(modele) {
  const items = state.modeles[modele] || [];
  const nomsActifs = new Set(state.liste.map(it => it.nom.toLowerCase()));
  let compte = 0;
  items.forEach(item => {
    if (nomsActifs.has(item.nom.toLowerCase())) return;
    const now = new Date().toISOString();
    state.liste.push({ id: uuid(), nom: item.nom, categorie: item.categorie, statut: 'actif', dateAjout: now, dateMaj: now });
    nomsActifs.add(item.nom.toLowerCase());
    compte++;
  });
  saveCache();
  renderListe();
  queueOrSend('ajouterDepuisModele', { modele });
  showToast(compte > 0 ? `${compte} article(s) ajouté(s) depuis « ${modele} »` : 'Tous les articles y sont déjà');
}

// ---- Rendu ----

function renderAll() {
  renderListe();
  renderModeles();
  renderArchives();
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
    return `
      <div class="categorie-groupe">
        <p class="categorie-titre">${escapeHtml(cat)}</p>
        ${items.map(renderItemRow).join('')}
      </div>`;
  }).join('');
}

function renderItemRow(item) {
  const achete = item.statut === 'achete';
  return `
    <div class="item-row ${achete ? 'achete' : ''}" data-id="${item.id}">
      <button class="item-checkbox ${achete ? 'checked' : ''}" data-action="toggle" title="Marquer acheté">${achete ? '✓' : ''}</button>
      <span class="item-nom">${escapeHtml(item.nom)}</span>
      <div class="item-actions">
        <button class="icon-btn" data-action="modele" title="Ajouter à un modèle">⭐</button>
        <button class="icon-btn" data-action="archiver" title="Archiver">📦</button>
      </div>
    </div>`;
}

function renderModeles() {
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
          <strong>${escapeHtml(modele)}</strong>
          <button class="btn-secondary" style="width:auto;padding:8px 12px;" data-action="ajouter-depuis-modele">Ajouter à la liste</button>
        </div>
        ${items.length === 0 ? '<p class="archive-date">Aucun article dans ce modèle pour l\'instant.</p>' : items.map(item => `
          <div class="modele-item" data-id="${item.id}">
            <span>${escapeHtml(item.nom)}</span>
            <button class="icon-btn" data-action="supprimer-du-modele" title="Retirer du modèle">✕</button>
          </div>`).join('')}
      </div>`;
  }).join('');
}

function renderArchives() {
  const conteneur = document.getElementById('archives-contenu');
  const vide = document.getElementById('archives-vide');
  if (state.archives.length === 0) {
    conteneur.innerHTML = '';
    vide.hidden = false;
    return;
  }
  vide.hidden = true;
  const items = state.archives.slice().sort((a, b) => (b.dateArchive || '').localeCompare(a.dateArchive || ''));
  conteneur.innerHTML = items.map(item => `
    <div class="archive-row" data-id="${item.id}">
      <span class="item-nom">${escapeHtml(item.nom)}</span>
      <span class="archive-date">${formatDate(item.dateArchive)}</span>
      <button class="icon-btn" data-action="restaurer" title="Restaurer dans la liste">↩️</button>
    </div>`).join('');
}

function populateCategorieSelect() {
  const select = document.getElementById('input-categorie');
  select.innerHTML = CONFIG.CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

// ---- Toast (annuler) ----

function showToast(message, onUndo) {
  clearTimeout(toastTimer);
  const toast = document.getElementById('toast');
  document.getElementById('toast-text').textContent = message;
  const undoBtn = document.getElementById('toast-undo');
  undoBtn.hidden = !onUndo;
  undoBtn.onclick = () => { hideToast(); if (onUndo) onUndo(); };
  toast.hidden = false;
  toastTimer = setTimeout(hideToast, 6000);
}

function hideToast() {
  document.getElementById('toast').hidden = true;
}

// ---- Modal "ajouter à un modèle" ----

function ouvrirModalModele(nom, categorie) {
  modalCurrentItem = { nom, categorie };
  const conteneur = document.getElementById('modal-modele-liste');
  const noms = Object.keys(state.modeles).sort((a, b) => a.localeCompare(b));
  conteneur.innerHTML = noms.map(m => `<button class="modele-choix-btn" data-modele="${escapeHtml(m)}">${escapeHtml(m)}</button>`).join('')
    || '<p class="archive-date">Aucun modèle existant, créez-en un ci-dessous.</p>';
  document.getElementById('modal-modele').hidden = false;
}

function fermerModalModele() {
  document.getElementById('modal-modele').hidden = true;
  modalCurrentItem = null;
  document.getElementById('modal-input-nouveau-modele').value = '';
}

// ---- Suggestions / autocomplétion ----

const chercherSuggestions = debounce(async (q) => {
  const conteneur = document.getElementById('suggestions');
  if (!q) { conteneur.hidden = true; return; }
  let resultats = [];
  try {
    resultats = await apiGet('getSuggestions', { q });
  } catch (err) {
    resultats = suggestionsLocales(q);
  }
  if (resultats.length === 0) { conteneur.hidden = true; return; }
  conteneur.innerHTML = resultats.map(r => `
    <div class="suggestion-item" data-nom="${escapeHtml(r.nom)}" data-categorie="${escapeHtml(r.categorie)}">
      <span>${escapeHtml(r.nom)}</span><small>${escapeHtml(r.categorie)}</small>
    </div>`).join('');
  conteneur.hidden = false;
}, 250);

function suggestionsLocales(q) {
  const query = q.toLowerCase();
  const vus = new Map();
  [...state.liste, ...state.archives, ...Object.values(state.modeles).flat()].forEach(item => {
    if (!item.nom || vus.has(item.nom.toLowerCase())) return;
    if (item.nom.toLowerCase().includes(query)) vus.set(item.nom.toLowerCase(), { nom: item.nom, categorie: item.categorie || 'Autre' });
  });
  return [...vus.values()].slice(0, 8);
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

  document.getElementById('form-ajout').addEventListener('submit', (e) => {
    e.preventDefault();
    const nomInput = document.getElementById('input-nom');
    const categorie = document.getElementById('input-categorie').value;
    ajouterArticle(nomInput.value, categorie);
    nomInput.value = '';
    document.getElementById('suggestions').hidden = true;
  });

  document.getElementById('input-nom').addEventListener('input', (e) => {
    chercherSuggestions(e.target.value.trim());
  });

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
  await refreshFromServer();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
