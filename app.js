/**
 * Logique principale de l'appli : actions métier, rendu des écrans, modales,
 * câblage des évènements et démarrage.
 *
 * Voir aussi : app-base.js (état, utilitaires, stockage), app-sync.js (réseau
 * et file d'attente hors ligne), app-recettes.js (onglet Recettes et import).
 *
 * Principe général : chaque action met à jour l'état local et l'écran tout de
 * suite (l'appli reste fluide même sans réseau), puis l'envoie au backend via
 * une file d'attente rejouée dès que la connexion le permet.
 */

// ---- Actions métier ----

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
  envoyerParLot('archiverLot', 'archiver', [...ids]);

  const message = items.length === 1
    ? `« ${items[0].nom} » archivé`
    : `${pluriel(items.length, 'article')} archivé${accordS(items.length)}`;
  showToast(message, () => {
    state.archives = state.archives.filter(it => !ids.has(it.id));
    state.liste.push(...items);
    saveCache(); renderListe(); renderArchives();
    envoyerParLot('restaurerLot', 'restaurerDepuisArchive', [...ids]);
  }, 'inventory_2');
}

// Une action sur plusieurs articles part en une requête groupée quand le
// script déployé la connaît, sinon en autant d'actions unitaires.
function envoyerParLot(actionLot, actionUnitaire, ids) {
  if (ids.length > 1 && backendRecent()) queueOrSend(actionLot, { ids });
  else ids.forEach(id => queueOrSend(actionUnitaire, { id }));
}

// Modification d'un article existant (nom, rayon, quantité). Seuls les champs
// qui changent sont envoyés. Renvoie true si quelque chose a été modifié.
function modifierArticle(id, { nom, categorie, quantite }) {
  const item = state.liste.find(it => it.id === id);
  if (!item) return false;
  const changements = {};
  nom = (nom || '').trim();
  if (nom && nom !== item.nom) changements.nom = nom;
  if (categorie && categorie !== item.categorie) changements.categorie = categorie;
  const texteQuantite = (quantite || '').trim();
  if (texteQuantite !== quantiteAffichee(item)) Object.assign(changements, interpreterQuantite(texteQuantite, nom || item.nom));
  if (Object.keys(changements).length === 0) return false;

  Object.assign(item, changements, { dateMaj: new Date().toISOString() });
  saveCache();
  renderListe();
  queueOrSend('modifierArticle', { id, ...changements });
  showToast(`« ${item.nom} » modifié`, null, 'edit');
  return true;
}

// « 500 g » ou « 2 gousses » deviennent une quantité structurée (cumulable
// avec les recettes) ; tout le reste (« x6 », « une bonne poignée ») reste du
// texte libre. L'analyse passe par le moteur de recettes, sur une ligne
// reconstituée comme sur un site de recettes.
function interpreterQuantite(texte, nom) {
  if (!texte) return { quantite: '', qte: '', unite: '' };
  const analyse = RECETTES.parserLigne(`${texte} de ${nom}`);
  if (analyse.type === 'ingredient' && analyse.qte !== null && cleNom(analyse.nom) === cleNom(nom)) {
    return { quantite: '', qte: analyse.qte, unite: analyse.unite || '' };
  }
  return { quantite: texte, qte: '', unite: '' };
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
      id: uuid(), modele, nom: article.nom, categorie: article.categorie,
      quantite: article.quantite || '', qte: qteOuVide(article.qte), unite: article.unite || '',
    };
    state.modeles[modele].push(item);
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

// ---- Rendu des écrans ----

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
      <button type="button" class="item-nom" data-action="modifier" title="Modifier l'article">${escapeHtml(item.nom)}</button>
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

// ---- Toast, modales et écrans secondaires ----

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
  'modal-article': fermerModalArticle,
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
  if (!$('suggestions').hidden) { fermerSuggestions(); return true; }
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

// Modale « modifier l'article »
function ouvrirModalArticle(id) {
  const item = state.liste.find(it => it.id === id);
  if (!item) return;
  if (!backendRecent()) {
    showToast('Pour modifier un article, mettez à jour le script Apps Script (voir le README).', null, 'info');
    return;
  }
  ui.articleEnEdition = id;
  $('modal-article-nom').value = item.nom;
  $('modal-article-categorie').innerHTML = categoriesListeActive()
    .map(c => `<option value="${escapeHtml(c)}" ${c === item.categorie ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
  $('modal-article-quantite').value = quantiteAffichee(item);
  ouvrirModale('modal-article');
  $('modal-article-nom').focus();
}

function fermerModalArticle() {
  $('modal-article').hidden = true;
  ui.articleEnEdition = null;
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

// Met en valeur la partie du nom qui correspond à ce qui est tapé.
function surlignerCorrespondance(nom, q) {
  const idx = nom.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1 || !q) return escapeHtml(nom);
  return `${escapeHtml(nom.slice(0, idx))}<mark>${escapeHtml(nom.slice(idx, idx + q.length))}</mark>${escapeHtml(nom.slice(idx + q.length))}`;
}

function chercherSuggestions(q) {
  const conteneur = $('suggestions');
  const resultats = q ? suggestionsLocales(q) : [];
  ui.suggestionActive = -1;
  if (resultats.length === 0) { conteneur.hidden = true; return; }
  conteneur.innerHTML = resultats.map(r => `
    <div class="suggestion-item" role="option" aria-selected="false" data-nom="${escapeHtml(r.nom)}" data-categorie="${escapeHtml(r.categorie)}">
      <span>${surlignerCorrespondance(r.nom, q)}</span><small>${escapeHtml(r.categorie)}</small>
    </div>`).join('');
  conteneur.hidden = false;
}

function fermerSuggestions() {
  $('suggestions').hidden = true;
  ui.suggestionActive = -1;
}

// Navigation au clavier (flèches) dans les suggestions. Renvoie false s'il
// n'y a rien à parcourir.
function deplacerSuggestion(delta) {
  const conteneur = $('suggestions');
  if (conteneur.hidden) return false;
  const items = [...conteneur.querySelectorAll('.suggestion-item')];
  if (items.length === 0) return false;
  ui.suggestionActive = (ui.suggestionActive + delta + items.length) % items.length;
  items.forEach((el, i) => {
    el.classList.toggle('active', i === ui.suggestionActive);
    el.setAttribute('aria-selected', i === ui.suggestionActive);
  });
  items[ui.suggestionActive].scrollIntoView({ block: 'nearest' });
  return true;
}

function choisirSuggestion(el) {
  $('input-nom').value = el.dataset.nom;
  $('input-categorie').value = el.dataset.categorie;
  fermerSuggestions();
  $('input-nom').focus();
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

// ---- Câblage des évènements et démarrage ----

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
    fermerSuggestions();
    fermerQuantite();
    if (ajoute && estNouveau) proposerAjoutReference(nom, categorie);
  });

  nomInput.addEventListener('input', () => chercherSuggestions(nomInput.value.trim()));
  nomInput.addEventListener('focus', () => {
    chercherSuggestions(nomInput.value.trim());
    rafraichirReferenceEnArrierePlan();
  });

  // Flèches pour parcourir les suggestions, Entrée pour prendre celle en
  // surbrillance (une seconde Entrée ajoute l'article), Échap pour refermer.
  nomInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (deplacerSuggestion(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault();
    } else if (e.key === 'Enter' && ui.suggestionActive >= 0 && !$('suggestions').hidden) {
      e.preventDefault();
      const el = $('suggestions').querySelectorAll('.suggestion-item')[ui.suggestionActive];
      if (el) choisirSuggestion(el);
    }
  });

  $('suggestions').addEventListener('click', (e) => {
    const el = e.target.closest('.suggestion-item');
    if (el) choisirSuggestion(el);
  });

  // Un clic ailleurs referme les suggestions.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#form-ajout') && !e.target.closest('#suggestions')) fermerSuggestions();
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
    modifier: row => ouvrirModalArticle(row.dataset.id),
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

  // Modale « modifier l'article »
  $('form-modal-article').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!ui.articleEnEdition) return;
    const modifie = modifierArticle(ui.articleEnEdition, {
      nom: $('modal-article-nom').value,
      categorie: $('modal-article-categorie').value,
      quantite: $('modal-article-quantite').value,
    });
    fermerModalArticle();
    if (!modifie) showToast('Aucun changement', null, 'info');
  });
  $('modal-article-annuler').addEventListener('click', fermerModalArticle);
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
