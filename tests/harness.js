// Tests de bout en bout : sert le site statique, simule le backend Apps Script
// en mémoire (miroir simplifié de Code.gs) et déroule dans Chromium les
// parcours principaux de l'appli (ajout, cocher, archiver, modèles, recettes,
// listes multiples, hors ligne).
//
// Prérequis (une fois) : npm install playwright && npx playwright install chromium
// Lancement            : node tests/harness.js [nom-du-dossier-de-captures]
// Les captures d'écran sont déposées dans tests/captures/<nom>/.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const RACINE = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'captures', process.argv[2] || 'run');
fs.mkdirSync(SHOTS, { recursive: true });
const BACKEND = 'https://script.example/macros/s/abc/exec';

// ---- Backend simulé (miroir simplifié de Code.gs) ----
// BACKEND_ANCIEN=1 simule un script pas encore mis à jour (sans getTout ni
// actions groupées) pour vérifier que l'appli retombe sur les actions unitaires.
const BACKEND_ANCIEN = process.env.BACKEND_ANCIEN === '1';
function creerBackend() {
  const db = {
    liste: [], archives: [], recurrents: [], reference: [
      { id: 'r1', nom: 'Pommes', categorie: 'Fruits & Légumes' },
      { id: 'r2', nom: 'Lait', categorie: 'Laitage & Fromage' },
      { id: 'r3', nom: 'Beurre', categorie: 'Laitage & Fromage' },
    ],
    listes: [{ id: 'L1', nom: 'Alimentaire', categories: ['Fruits & Légumes', 'Laitage & Fromage', 'Viande & Poisson', 'Sec', 'Traiteur', 'Surgelés', 'Boissons', 'Hygiène', 'Entretien', 'Autre'] }],
    modeles: {}, recettes: [], journal: [],
  };
  let seq = 0;
  const newId = () => 'srv-' + (++seq);
  const now = () => new Date().toISOString();
  const get = (action, params) => {
    if (BACKEND_ANCIEN && action === 'getTout') throw new Error('Action GET inconnue: getTout');
    switch (action) {
      case 'getTout': return { version: 2, liste: db.liste, archives: db.archives, modeles: get('getModeles'), modelesMeta: db.modeles, reference: db.reference, listes: db.listes, recettes: db.recettes, rechercheInternet: get('etatRechercheInternet') };
      case 'getListe': return db.liste;
      case 'getArchives': return db.archives;
      case 'getModeles': { const m = {}; db.recurrents.forEach(it => { (m[it.modele] = m[it.modele] || []).push(it); }); return m; }
      case 'getListes': return db.listes;
      case 'getReference': return db.reference;
      case 'getModelesMeta': return db.modeles;
      case 'getRecettes': return db.recettes;
      case 'etatRechercheInternet': return { configuree: false, sites: [] };
      case 'importerRecette': return { nom: 'Gratin test', description: 'desc', portions: 4, url: params.url, source: 'example.com', ingredients: ['300 g de beurre', '4 oeufs', 'Sel, poivre', '1 kg de pommes de terre'] };
      default: throw new Error('Action GET inconnue: ' + action);
    }
  };
  const post = (p) => {
    db.journal.push(p.action);
    if (BACKEND_ANCIEN && ['archiverLot', 'restaurerLot', 'modifierArticle'].includes(p.action)) throw new Error('Action POST inconnue: ' + p.action);
    switch (p.action) {
      case 'archiverLot': { let n = 0; p.ids.forEach(id => { const i = db.liste.findIndex(it => it.id === id); if (i !== -1) { const [it] = db.liste.splice(i, 1); db.archives.push({ ...it, dateArchive: now() }); n++; } }); return { archives: n }; }
      case 'restaurerLot': { let n = 0; p.ids.forEach(id => { const i = db.archives.findIndex(it => it.id === id); if (i !== -1) { const [it] = db.archives.splice(i, 1); db.liste.push({ ...it, statut: 'actif' }); n++; } }); return { restaures: n }; }
      case 'modifierArticle': { const it = db.liste.find(i => i.id === p.id); if (!it) throw new Error('Article introuvable'); ['nom', 'categorie', 'quantite', 'qte', 'unite'].forEach(c => { if (p[c] !== undefined) it[c] = p[c]; }); return it; }
      case 'ajouterArticle': if (!db.liste.some(it => it.id === p.id)) db.liste.push({ id: p.id, nom: p.nom, categorie: p.categorie, statut: 'actif', dateAjout: now(), dateMaj: now(), quantite: p.quantite || '', listeId: p.listeId, qte: p.qte ?? '', unite: p.unite || '', provenance: p.provenance || '' }); return { id: p.id };
      case 'toggleAchete': { const it = db.liste.find(i => i.id === p.id); if (!it) throw new Error('Article introuvable'); it.statut = p.statut; return { id: p.id }; }
      case 'archiver': { const i = db.liste.findIndex(it => it.id === p.id); if (i === -1) throw new Error('Article introuvable'); const [it] = db.liste.splice(i, 1); db.archives.push({ ...it, dateArchive: now() }); return { id: p.id }; }
      case 'restaurerDepuisArchive': { const i = db.archives.findIndex(it => it.id === p.id); if (i === -1) throw new Error('introuvable'); const [it] = db.archives.splice(i, 1); db.liste.push({ ...it, statut: 'actif' }); return { id: p.id }; }
      case 'supprimer': { const src = p.source === 'archives' ? db.archives : db.liste; const i = src.findIndex(it => it.id === p.id); if (i !== -1) src.splice(i, 1); return { id: p.id }; }
      case 'ajouterAuModele': { if (db.recurrents.some(it => it.modele === p.modele && it.nom.toLowerCase() === p.nom.toLowerCase())) return {}; const id = (!BACKEND_ANCIEN && p.id) || newId(); db.recurrents.push({ id, modele: p.modele, nom: p.nom, categorie: p.categorie, quantite: p.quantite || '', qte: p.qte ?? '', unite: p.unite || '' }); return { id }; }
      case 'creerListe': if (!db.listes.some(l => l.id === p.id)) db.listes.push({ id: p.id, nom: p.nom, categories: p.categories }); return { id: p.id };
      case 'ajouterReference': db.reference.push({ id: p.id, nom: p.nom, categorie: p.categorie }); return { id: p.id };
      case 'supprimerDuModele': db.recurrents = db.recurrents.filter(it => it.id !== p.id); return {};
      case 'enregistrerModeleMeta': db.modeles[p.nom] = { nom: p.nom, description: p.description || '', url: p.url || '', portions: p.portions || null }; return {};
      case 'supprimerModele': db.recurrents = db.recurrents.filter(it => it.modele !== p.modele); delete db.modeles[p.modele]; return {};
      case 'creerModeleDepuisRecette': db.modeles[p.modele] = { nom: p.modele, description: p.description || '', url: p.url || '', portions: p.portions || null }; (p.items || []).forEach(it => db.recurrents.push({ id: (!BACKEND_ANCIEN && it.id) || newId(), modele: p.modele, nom: it.nom, categorie: it.categorie, quantite: it.quantite || '', qte: it.qte ?? '', unite: it.unite || '' })); return {};
      case 'ajouterLot': (p.items || []).forEach(it => db.liste.push({ id: it.id || newId(), nom: it.nom, categorie: it.categorie, statut: 'actif', dateAjout: now(), dateMaj: now(), quantite: it.quantite || '', listeId: p.listeId, qte: it.qte ?? '', unite: it.unite || '', provenance: it.provenance || '' })); return { ajoutes: (p.items || []).length, cumules: 0 };
      case 'enregistrerRecette': { const i = db.recettes.findIndex(r => r.nom === p.nom); const r = { id: newId(), nom: p.nom, source: p.source, url: p.url, portions: p.portions, ingredients: p.ingredients }; if (i === -1) db.recettes.push(r); else db.recettes[i] = r; return {}; }
      default: throw new Error('Action POST inconnue: ' + p.action);
    }
  };
  return { db, get, post };
}

// ---- Serveur statique ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
function servir() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(RACINE, p);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, () => resolve({ srv, port: srv.address().port }));
  });
}

async function main() {
  const { srv, port } = await servir();
  const backend = creerBackend();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', ignoreHTTPSErrors: true });
  const erreurs = [];
  // Les polices Google (icônes) sont servies à Chromium via curl et mises en
  // cache localement : sans elles, les icônes s'affichent en toutes lettres et
  // la barre d'onglets déborde de l'écran.
  const CACHE_POLICES = path.join(__dirname, 'captures', 'polices-cache'); fs.mkdirSync(CACHE_POLICES, { recursive: true });
  await context.route(u => /(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(u.hostname), async route => {
    const url = route.request().url();
    const cle = path.join(CACHE_POLICES, crypto.createHash('md5').update(url).digest('hex'));
    try {
      if (!fs.existsSync(cle)) {
        execFileSync('curl', ['-sS', '--max-time', '20', '-A', route.request().headers()['user-agent'] || 'Mozilla/5.0 Chrome/120', '-o', cle, url]);
      }
      const ct = url.includes('googleapis.com') ? 'text/css' : 'font/woff2';
      await route.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(cle) });
    } catch (e) { await route.abort(); }
  });
  let horsLigne = false;
  await context.route(u => u.href.startsWith('https://script.example/'), async route => {
    if (horsLigne) { await route.abort('internetdisconnected'); return; }
    const req = route.request();
    const url = new URL(req.url());
    let body;
    try {
      if (req.method() === 'POST') body = { ok: true, data: backend.post(JSON.parse(req.postData())) };
      else body = { ok: true, data: backend.get(url.searchParams.get('action'), Object.fromEntries(url.searchParams)) };
    } catch (e) { body = { ok: false, error: String(e.message) }; }
    await new Promise(r => setTimeout(r, 60));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await context.addInitScript(url => { localStorage.setItem('lc_apps_script_url', url); }, BACKEND);
  const page = await context.newPage();
  page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_INTERNET_DISCONNECTED')) erreurs.push('console: ' + m.text()); });
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + '.png') });
  const attendreSync = async () => { await page.waitForTimeout(400); await page.waitForFunction(() => JSON.parse(localStorage.getItem('lc_queue') || '[]').length === 0); await page.waitForTimeout(200); };
  const texteToast = () => page.evaluate(() => { const t = document.getElementById('toast'); return t.hidden ? null : document.getElementById('toast-text').textContent; });
  const rapport = [];
  const verif = (nom, cond) => { rapport.push((cond ? 'OK   ' : 'FAIL ') + nom); if (!cond) erreurs.push('verif: ' + nom); };

  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForTimeout(800);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const policeIcones = await page.evaluate(() => document.fonts.check('20px "Material Symbols Rounded"'));
  rapport.push((policeIcones ? 'OK   ' : 'INFO ') + 'police d\'icônes chargée');
  await shot('01-liste-vide');
  verif('liste vide affichée', await page.isVisible('#liste-vide'));

  // Ajout d'articles
  for (const [nom, cat] of [['Pommes', 'Fruits & Légumes'], ['Lait', 'Laitage & Fromage'], ['Savon', 'Hygiène']]) {
    await page.fill('#input-nom', nom);
    await page.selectOption('#input-categorie', cat);
    await page.press('#input-nom', 'Enter');
    await page.waitForTimeout(150);
    if (await page.isVisible('#modal-reference')) { await shot('02-modal-reference'); await page.click('#modal-reference-oui'); }
  }
  await attendreSync();
  await shot('03-liste-3-articles');
  verif('3 articles rendus', (await page.locator('.item-row').count()) === 3);
  verif('3 articles côté serveur', backend.db.liste.length === 3);
  verif('référence Savon ajoutée', backend.db.reference.some(r => r.nom === 'Savon'));

  // Suggestions
  await page.fill('#input-nom', 'po');
  await page.waitForTimeout(100);
  await shot('04-suggestions');
  verif('suggestions visibles', await page.isVisible('#suggestions'));
  await page.fill('#input-nom', '');

  // Cocher, archiver, annuler
  await page.click('.item-row:has-text("Lait") [data-action="toggle"]');
  await page.waitForTimeout(100);
  verif('Lait coché déplacé dans récupérés', await page.isVisible('.categorie-groupe-recuperes .item-row:has-text("Lait")'));
  verif('bouton archiver tout visible', await page.isVisible('#btn-archiver-tout'));
  await shot('05-un-coche');
  await page.click('.item-row:has-text("Pommes") [data-action="archiver"]');
  await page.waitForTimeout(100);
  verif('toast archivé', (await texteToast() || '').includes('archivé'));
  await page.click('#toast-undo');
  await page.waitForTimeout(100);
  verif('annulation restaure Pommes', (await page.locator('.item-row:has-text("Pommes")').count()) === 1);
  await attendreSync();
  verif('serveur : 3 articles après annulation', backend.db.liste.length === 3 && backend.db.archives.length === 0);

  // Archiver tout. Avec le backend ancien, on force l'appli à croire le
  // script récent pour vérifier qu'une action groupée refusée est bien
  // décomposée en actions unitaires (et rien de perdu).
  if (BACKEND_ANCIEN) await page.evaluate(() => definirVersionBackend(2));
  await page.click('#btn-archiver-tout');
  await page.waitForTimeout(100);
  await shot('06-modal-archiver-tout');
  await page.click('#modal-confirmer-archiver-tout-confirmer');
  await attendreSync();
  verif('liste vide après archivage', await page.isVisible('#liste-vide'));
  verif('serveur : 3 archivés', backend.db.archives.length === 3);
  const nbArchiverLot = backend.db.journal.filter(a => a === 'archiverLot').length;
  verif(BACKEND_ANCIEN ? 'archivage groupé retombé sur 3 actions unitaires' : 'archivage groupé en une requête',
    BACKEND_ANCIEN ? nbArchiverLot === 1 && backend.db.journal.filter(a => a === 'archiver').length >= 4 : nbArchiverLot === 1 && !backend.db.journal.slice(-1).includes('archiver'));

  // Archives et restauration
  await page.click('.tab-btn[data-tab="archives"]');
  await page.waitForTimeout(100);
  await shot('07-archives');
  verif('3 lignes archives', (await page.locator('.archive-row').count()) === 3);
  await page.click('.archive-row:has-text("Lait") [data-action="restaurer"]');
  await attendreSync();
  verif('Lait restauré serveur', backend.db.liste.some(it => it.nom === 'Lait' && it.statut === 'actif'));

  // Modèles : créer un modèle vide, ajouter un article depuis la liste
  await page.click('.tab-btn[data-tab="modeles"]');
  await page.fill('#input-nouveau-modele', 'Semaine');
  await page.press('#input-nouveau-modele', 'Enter');
  await page.waitForTimeout(100);
  await shot('08-modele-vide');
  verif('modèle vide affiché', (await page.locator('.modele-carte').count()) === 1);
  // Simule un retour au premier plan : rafraîchissement depuis le serveur
  await attendreSync();
  await page.evaluate(() => refreshFromServer());
  await page.waitForTimeout(800);
  verif('modèle vide survit à un rafraîchissement serveur', (await page.locator('.modele-carte').count()) === 1);

  await page.click('.tab-btn[data-tab="liste"]');
  await page.click('.item-row:has-text("Lait") [data-action="modele"]');
  await page.waitForTimeout(100);
  await shot('09-modal-modele');
  await page.fill('#modal-input-nouveau-modele', 'Petit déj');
  await page.press('#modal-input-nouveau-modele', 'Enter');
  await attendreSync();
  verif('Lait dans modèle Petit déj (serveur)', backend.db.recurrents.some(it => it.modele === 'Petit déj' && it.nom === 'Lait'));
  await page.click('.tab-btn[data-tab="modeles"]');
  await page.waitForTimeout(100);
  await shot('10-modeles');
  await page.click('.tab-btn[data-tab="liste"]');
  await page.fill('#input-nom', 'Café');
  await page.press('#input-nom', 'Enter');
  await page.waitForTimeout(100);
  if (await page.isVisible('#modal-reference')) await page.click('#modal-reference-non');
  await page.click('.item-row:has-text("Café") [data-action="modele"]');
  await page.click('#modal-modele-liste .modele-choix-btn:has-text("Petit déj")');
  await attendreSync();
  await page.waitForTimeout(300);
  await page.click('.tab-btn[data-tab="modeles"]');
  await page.click('.modele-carte:has-text("Petit déj") .modele-item:has-text("Café") [data-action="supprimer-du-modele"]');
  await attendreSync();
  verif('article retiré du modèle juste après son ajout (serveur)', !backend.db.recurrents.some(it => it.modele === 'Petit déj' && it.nom === 'Café'));
  await page.click('.modele-carte:has-text("Petit déj") [data-action="ajouter-depuis-modele"]');
  await page.waitForTimeout(100);
  await shot('11-modal-listes-destination');
  await page.click('#modal-listes-liste .modele-choix-btn');
  await page.waitForTimeout(150);
  verif('toast déjà présent', (await texteToast() || '').includes('déjà'));

  // Recettes : catalogue
  await page.click('.tab-btn[data-tab="recettes"]');
  await page.fill('#input-recherche-recette', 'quiche');
  await page.waitForTimeout(100);
  await shot('12-recettes-recherche');
  verif('résultats catalogue', (await page.locator('.recette-resultat').count()) > 0);
  await page.click('.recette-resultat:has-text("Quiche lorraine")');
  await page.waitForTimeout(200);
  await shot('13-recette-apercu');
  verif('aperçu recette affiché', await page.isVisible('#recette-etape-apercu'));
  const nbIng = await page.locator('.ing-row').count();
  verif('ingrédients analysés (' + nbIng + ')', nbIng >= 6);
  await page.click('.portions-btn[data-portions="cible"][data-delta="1"]');
  await page.click('.portions-btn[data-portions="cible"][data-delta="1"]');
  await page.waitForTimeout(100);
  const qteLardons = await page.locator('.ing-row:has(input.ing-nom[value*="ardons"]) .ing-qte').inputValue();
  verif('lardons mis à l\'échelle 6→8 (' + qteLardons + ')', qteLardons === '275' || qteLardons === '250' || qteLardons === '300');
  await shot('14-recette-echelle');
  await page.click('#recette-ajouter-liste');
  await page.waitForTimeout(100);
  await page.click('#modal-listes-liste .modele-choix-btn');
  await attendreSync();
  await shot('15-liste-apres-recette');
  verif('ingrédients ajoutés à la liste', backend.db.liste.length > 3);
  verif('recette enregistrée', backend.db.recettes.some(r => r.nom === 'Quiche lorraine'));
  verif('badge quantité présent', (await page.locator('.item-qte-badge').count()) > 0);
  await page.click('.item-qte-badge >> nth=0');
  await page.waitForTimeout(100);
  verif('toast quantité', (await texteToast() || '').startsWith('Quantité'));

  // Import par lien (simulé)
  await page.click('.tab-btn[data-tab="recettes"]');
  await page.click('#btn-import-url');
  await page.fill('#recette-url', 'https://example.com/recette');
  await page.click('#recette-analyser');
  await page.waitForTimeout(300);
  verif('import lien : aperçu', await page.isVisible('#recette-etape-apercu'));
  await page.click('#recette-creer-modele');
  await attendreSync();
  await shot('16-modele-cree-depuis-import');
  verif('modèle Gratin test créé', !!backend.db.modeles['Gratin test']);
  verif('fiche modèle visible', await page.isVisible('.modele-carte:has-text("Gratin test") .modele-fiche'));

  // Changement de liste
  await page.click('.tab-btn[data-tab="liste"]');
  await page.click('#btn-liste-active');
  await page.fill('#modal-input-nouvelle-liste', 'Bricolage');
  await page.press('#modal-input-nouvelle-liste', 'Enter');
  await attendreSync();
  verif('liste Bricolage active', (await page.textContent('#hero-liste-nom')) === 'Bricolage');
  verif('liste Bricolage vide', await page.isVisible('#liste-vide'));
  await shot('17-liste-bricolage');

  // Ajouts rapides : aucune action ne doit se perdre dans la file
  for (const nom of ['Clous', 'Marteau', 'Scie', 'Colle']) {
    await page.fill('#input-nom', nom);
    await page.press('#input-nom', 'Enter');
    await page.waitForTimeout(30);
    if (await page.isVisible('#modal-reference')) await page.click('#modal-reference-non');
  }
  await attendreSync();
  const bricolageServeur = backend.db.liste.filter(it => it.nom !== 'Vis' && ['Clous', 'Marteau', 'Scie', 'Colle'].includes(it.nom)).length;
  verif('4 ajouts rapides tous synchronisés (' + bricolageServeur + ')', bricolageServeur === 4);

  // Doublon : re-saisir un article présent ne le duplique pas ; coché, il est remis dans la liste
  await page.fill('#input-nom', 'clous');
  await page.press('#input-nom', 'Enter');
  await page.waitForTimeout(150);
  verif('doublon refusé avec message', (await texteToast() || '').includes('déjà'));
  verif('pas de doublon rendu', (await page.locator('.item-row:has-text("Clous")').count()) === 1);
  await page.click('.item-row:has-text("Scie") [data-action="toggle"]');
  await page.waitForTimeout(100);
  await page.fill('#input-nom', 'Scie');
  await page.press('#input-nom', 'Enter');
  await page.waitForTimeout(150);
  verif('article coché remis dans la liste', (await texteToast() || '').includes('remis') && !(await page.isVisible('.categorie-groupe-recuperes')));
  await attendreSync();

  // Le rayon choisi survit à un rafraîchissement en arrière-plan
  await page.selectOption('#input-categorie', 'Entretien');
  await page.evaluate(() => refreshFromServer());
  await page.waitForTimeout(600);
  verif('rayon choisi conservé après rafraîchissement', (await page.inputValue('#input-categorie')) === 'Entretien');

  // Un article ajouté pendant un rafraîchissement ne disparaît pas de l'écran
  await page.evaluate(() => { window.__p = refreshFromServer(); });
  await page.fill('#input-nom', 'Pinceau');
  await page.press('#input-nom', 'Enter');
  await page.waitForTimeout(50);
  if (await page.isVisible('#modal-reference')) await page.click('#modal-reference-non');
  await page.evaluate(() => window.__p);
  await page.waitForTimeout(100);
  verif('article ajouté pendant un rafraîchissement toujours affiché', (await page.locator('.item-row:has-text("Pinceau")').count()) === 1);
  await attendreSync();
  await page.waitForTimeout(600);
  verif('Pinceau synchronisé', backend.db.liste.some(it => it.nom === 'Pinceau'));

  // Modification d'un article (nom, rayon, quantité)
  await page.click('.item-row:has-text("Clous") .item-nom');
  await page.waitForTimeout(150);
  if (BACKEND_ANCIEN) {
    verif('modification refusée avec un backend ancien', (await texteToast() || '').includes('script'));
  } else {
    verif('modale de modification ouverte', await page.isVisible('#modal-article'));
    await shot('20-modifier-article');
    await page.fill('#modal-article-nom', 'Clous 40 mm');
    await page.selectOption('#modal-article-categorie', 'Entretien');
    await page.fill('#modal-article-quantite', '2 boîtes');
    await page.press('#modal-article-quantite', 'Enter');
    await attendreSync();
    const modifie = backend.db.liste.find(it => it.nom === 'Clous 40 mm');
    verif('article modifié côté serveur (nom, rayon, quantité structurée)', !!modifie && modifie.categorie === 'Entretien' && Number(modifie.qte) === 2 && modifie.unite === 'boîte' && modifie.quantite === '');
    verif('quantité affichée après modification', (await page.locator('.item-row:has-text("Clous 40 mm")').getAttribute('data-quantite')) === '2 boîtes');
    await page.click('.item-row:has-text("Marteau") .item-nom');
    await page.fill('#modal-article-quantite', 'x6');
    await page.press('#modal-article-quantite', 'Enter');
    await attendreSync();
    const marteau = backend.db.liste.find(it => it.nom === 'Marteau');
    verif('quantité en texte libre conservée telle quelle', marteau.quantite === 'x6' && marteau.qte === '');
  }

  // Navigation clavier dans les suggestions
  await page.fill('#input-nom', 'ma');
  await page.waitForTimeout(100);
  verif('correspondance surlignée', (await page.locator('#suggestions mark').count()) > 0);
  await page.press('#input-nom', 'ArrowDown');
  verif('suggestion active au clavier', (await page.locator('.suggestion-item.active').count()) === 1);
  const suggestionActive = await page.locator('.suggestion-item.active').getAttribute('data-nom');
  await page.press('#input-nom', 'Enter');
  await page.waitForTimeout(50);
  verif('Entrée reprend la suggestion sans ajouter (' + suggestionActive + ')', (await page.inputValue('#input-nom')) === suggestionActive && !(await page.isVisible('#suggestions')));
  await page.fill('#input-nom', '');

  // Rafraîchissement périodique : un ajout fait par un autre membre apparaît
  backend.db.liste.push({ id: 'autre-1', nom: 'Perceuse', categorie: 'Autre', statut: 'actif', dateAjout: new Date().toISOString(), dateMaj: new Date().toISOString(), quantite: '', listeId: backend.db.listes.find(l => l.nom === 'Bricolage').id, qte: '', unite: '', provenance: '' });
  await page.evaluate(() => { dernierRafraichissement = 0; rafraichissementPeriodique(); });
  await page.waitForTimeout(700);
  verif('ajout d\'un autre membre visible après le rafraîchissement périodique', (await page.locator('.item-row:has-text("Perceuse")').count()) === 1);
  verif('rafraîchissement périodique sans indicateur', !(await page.evaluate(() => document.body.classList.contains('sync-en-cours'))));

  // Fermeture des modales : clic sur le fond, touche Échap
  await page.click('#btn-liste-active');
  await page.waitForTimeout(100);
  await page.mouse.click(195, 60);
  await page.waitForTimeout(100);
  verif('modale fermée par un clic sur le fond', !(await page.isVisible('#modal-listes')));
  await page.click('#btn-liste-active');
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  verif('modale fermée par Échap', !(await page.isVisible('#modal-listes')));
  await page.fill('#input-nom', 'cl');
  await page.waitForTimeout(100);
  verif('suggestions ouvertes', await page.isVisible('#suggestions'));
  await page.mouse.click(195, 600);
  await page.waitForTimeout(100);
  verif('suggestions fermées par un clic ailleurs', !(await page.isVisible('#suggestions')));
  await page.fill('#input-nom', '');

  // Écran de réglages
  await page.click('#view-liste .btn-settings');
  await page.waitForTimeout(100);
  await shot('18-config');
  verif('config annulable', await page.isVisible('#config-annuler'));
  await page.click('#config-annuler');

  // Hors ligne : ajout puis file d'attente
  horsLigne = true;
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }); window.dispatchEvent(new Event('offline')); });
  await page.fill('#input-nom', 'Vis');
  await page.press('#input-nom', 'Enter');
  await page.waitForTimeout(300);
  if (await page.isVisible('#modal-reference')) await page.click('#modal-reference-non');
  await shot('19-hors-ligne');
  verif('bannière hors ligne', await page.isVisible('#offline-banner'));
  const enAttente = await page.evaluate(() => JSON.parse(localStorage.getItem('lc_queue') || '[]').length);
  verif('action en attente (' + enAttente + ')', enAttente >= 1);
  horsLigne = false;
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true }); window.dispatchEvent(new Event('online')); });
  await attendreSync();
  verif('bannière disparue', !(await page.isVisible('#offline-banner')));
  verif('Vis synchronisé', backend.db.liste.some(it => it.nom === 'Vis'));

  console.log(rapport.join('\n'));
  console.log('\nJournal serveur :', backend.db.journal.join(', '));
  if (erreurs.length) { console.log('\nERREURS :\n' + erreurs.join('\n')); }
  await browser.close();
  srv.close();
  process.exit(erreurs.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
