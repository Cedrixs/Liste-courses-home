/**
 * Onglet Recettes (recherche dans le catalogue, les recettes enregistrées et
 * internet) et écran d'import d'une recette (analyse, aperçu éditable, mise à
 * l'échelle, création d'un modèle ou ajout à une liste).
 */

// ---- Recherche ----

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
    items: items.map(it => ({ id: it.id, nom: it.nom, categorie: it.categorie, qte: it.qte, unite: it.unite, quantite: '' })),
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


// ---- Câblage des évènements ----

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
