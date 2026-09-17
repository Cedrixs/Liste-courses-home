/**
 * Moteur de recettes : analyse d'une liste d'ingrédients écrite pour des humains,
 * mise à l'échelle par nombre de personnes, et cumul des quantités.
 *
 * Ce fichier est du calcul pur (aucun accès au DOM ni au réseau) : il est appelé
 * par app.js pour le collage de texte, pour l'import par URL (le backend renvoie
 * les lignes brutes, l'analyse se fait ici) et pour le catalogue de recettes.
 */
const RECETTES = (function () {

  // ---- Normalisation ----

  function sansAccents(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // Forme de comparaison : minuscules, sans accents, apostrophes uniformisées,
  // espaces resserrés. Sert de clé partout (dictionnaire, cumul, doublons).
  function normaliser(s) {
    return sansAccents(s)
      .toLowerCase()
      .replace(/[’ʼ`]/g, "'")
      .replace(/œ/g, 'oe')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Mots dont le « s » final fait partie du mot : les dépluraliser donnerait
  // « poi », « anana », « radi »...
  const INVARIABLES = {
    pois: 1, ananas: 1, anis: 1, jus: 1, couscous: 1, mais: 1, cassis: 1,
    radis: 1, pastis: 1, os: 1, temps: 1, tapas: 1, riz: 1, brebis: 1,
    'nuoc-mam': 1, chips: 1, gres: 1,
  };

  // Retire un pluriel simple pour retrouver l'entrée du dictionnaire
  // ("carottes" -> "carotte", "oeufs" -> "oeuf", "choux" -> "chou").
  function singulier(mot) {
    if (Object.prototype.hasOwnProperty.call(INVARIABLES, mot)) return mot;
    if (mot.length > 3 && /(s|x)$/.test(mot)) return mot.slice(0, -1);
    return mot;
  }

  function singulariserExpression(expr) {
    return expr.split(' ').map(singulier).join(' ');
  }

  function majusculeInitiale(s) {
    s = String(s || '').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // ---- Nombres ----

  const FRACTIONS_UNICODE = {
    '½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3',
    '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5',
    '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
  };

  const NOMBRES_EN_LETTRES = {
    'un': 1, 'une': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5, 'six': 6,
    'sept': 7, 'huit': 8, 'neuf': 9, 'dix': 10, 'onze': 11, 'douze': 12,
    'quinze': 15, 'vingt': 20, 'trente': 30, 'cinquante': 50, 'cent': 100,
    'demi': 0.5, 'demie': 0.5, 'quart': 0.25,
    'douzaine': 12, 'demi-douzaine': 6,
  };

  function remplacerFractions(texte) {
    let out = String(texte == null ? '' : texte);
    Object.keys(FRACTIONS_UNICODE).forEach(function (f) {
      out = out.split(f).join(' ' + FRACTIONS_UNICODE[f] + ' ');
    });
    return out.replace(/\s+/g, ' ');
  }

  // Développe les abréviations de cuillères, qui s'écrivent d'une dizaine de
  // façons selon les sites (« c. à s. », « c.a.s », « cuil. à soupe »).
  // S'applique sur une chaîne déjà normalisée (sans accents).
  function developperAbreviations(t) {
    return t
      .replace(/\bcuil?l?\.?\s*a\s*soupe\b/g, 'cuillere a soupe')
      .replace(/\bcuil?l?\.?\s*a\s*cafe\b/g, 'cuillere a cafe')
      .replace(/\bc\s*\.?\s*a\s*\.?\s*s\b\.?/g, 'cuillere a soupe')
      .replace(/\bc\s*\.?\s*a\s*\.?\s*c\b\.?/g, 'cuillere a cafe')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Affichage à la française : virgule décimale, pas de zéro inutile.
  function formatNombre(n) {
    if (n == null || isNaN(n)) return '';
    const arrondi = Math.round(n * 100) / 100;
    if (Number.isInteger(arrondi)) return String(arrondi);
    return String(arrondi).replace('.', ',');
  }

  // ---- Unités ----
  //
  // `formes` est écrit en forme normalisée (sans accents). `type` regroupe les
  // unités convertibles entre elles ; `base` donne la valeur dans l'unité de
  // référence du type (g pour les poids, ml pour les volumes).

  const UNITES = [
    { canon: 'g', type: 'poids', base: 1, formes: ['g', 'gr', 'grs', 'gramme', 'grammes'] },
    { canon: 'kg', type: 'poids', base: 1000, formes: ['kg', 'kgs', 'kilo', 'kilos', 'kilogramme', 'kilogrammes'] },
    { canon: 'mg', type: 'poids', base: 0.001, formes: ['mg'] },

    { canon: 'ml', type: 'volume', base: 1, formes: ['ml', 'millilitre', 'millilitres'] },
    { canon: 'cl', type: 'volume', base: 10, formes: ['cl', 'centilitre', 'centilitres'] },
    { canon: 'dl', type: 'volume', base: 100, formes: ['dl', 'decilitre', 'decilitres'] },
    { canon: 'l', type: 'volume', base: 1000, formes: ['l', 'litre', 'litres'] },

    {
      canon: 'c. à soupe', type: 'cuillere', formes: [
        'cuillere a soupe', 'cuilleres a soupe', 'cuillere a soupes', 'cuil a soupe', 'cuil. a soupe',
        'c a soupe', 'c. a soupe', 'c a s', 'c.a.s', 'c. a. s.', 'cas', 'cs', 'cuilleree a soupe',
        'cuillere a soupe rase', 'grosse cuillere a soupe',
      ],
    },
    {
      canon: 'c. à café', type: 'cuillere', formes: [
        'cuillere a cafe', 'cuilleres a cafe', 'cuil a cafe', 'cuil. a cafe',
        'c a cafe', 'c. a cafe', 'c a c', 'c.a.c', 'c. a. c.', 'cac', 'cc', 'cuilleree a cafe',
        'cuillere a the', 'cuilleres a the',
      ],
    },

    { canon: 'pincée', type: 'appoint', nonEchelle: true, formes: ['pincee', 'pincees'] },
    { canon: 'filet', type: 'appoint', nonEchelle: true, formes: ['filet de', 'trait', 'traits'] },
    { canon: 'noix', type: 'appoint', nonEchelle: true, formes: ['noix de beurre'] },

    { canon: 'gousse', type: 'piece', formes: ['gousse', 'gousses'] },
    { canon: 'botte', type: 'piece', formes: ['botte', 'bottes'] },
    { canon: 'bouquet', type: 'piece', formes: ['bouquet', 'bouquets'] },
    { canon: 'brin', type: 'piece', formes: ['brin', 'brins', 'branche', 'branches'] },
    { canon: 'feuille', type: 'piece', formes: ['feuille', 'feuilles'] },
    { canon: 'tranche', type: 'piece', formes: ['tranche', 'tranches'] },
    { canon: 'sachet', type: 'piece', formes: ['sachet', 'sachets'] },
    { canon: 'boîte', type: 'piece', formes: ['boite', 'boites', 'conserve', 'conserves'] },
    { canon: 'brique', type: 'piece', formes: ['brique', 'briques'] },
    { canon: 'pot', type: 'piece', formes: ['pot', 'pots'] },
    { canon: 'bocal', type: 'piece', formes: ['bocal', 'bocaux'] },
    { canon: 'paquet', type: 'piece', formes: ['paquet', 'paquets'] },
    { canon: 'rouleau', type: 'piece', formes: ['rouleau', 'rouleaux'] },
    { canon: 'tête', type: 'piece', formes: ['tete', 'tetes'] },
    { canon: 'poignée', type: 'piece', formes: ['poignee', 'poignees'] },
    { canon: 'verre', type: 'piece', formes: ['verre', 'verres'] },
    { canon: 'tasse', type: 'piece', formes: ['tasse', 'tasses'] },
    { canon: 'bouteille', type: 'piece', formes: ['bouteille', 'bouteilles'] },
    { canon: 'cube', type: 'piece', formes: ['cube', 'cubes'] },
    { canon: 'tige', type: 'piece', formes: ['tige', 'tiges'] },
    { canon: 'zeste', type: 'piece', formes: ['zeste', 'zestes'] },
  ];

  // Index des formes, les plus longues d'abord pour que « cuillere a soupe »
  // l'emporte sur « c » ou « cuillere ».
  const FORMES_UNITES = (function () {
    const liste = [];
    UNITES.forEach(function (u) {
      u.formes.forEach(function (f) { liste.push({ forme: f, unite: u }); });
    });
    return liste.sort(function (a, b) { return b.forme.length - a.forme.length; });
  })();

  function trouverUnite(canon) {
    for (let i = 0; i < UNITES.length; i++) {
      if (UNITES[i].canon === canon) return UNITES[i];
    }
    return null;
  }

  // ---- Dictionnaire ingrédient -> rayon ----
  //
  // Les rayons correspondent aux catégories par défaut de l'appli (config.js).
  // Une liste dont les rayons ont été personnalisés retombe proprement sur
  // « Autre » pour ce qu'elle ne connaît pas.

  const INGREDIENTS_PAR_RAYON = {
    'Fruits & Légumes': [
      'ananas', 'chataigne', 'oseille', 'mesclun', 'plantain', 'combava', 'pousse de soja',
      'oignon nouveau', 'oignon grelot', 'champignon noir',
      'ail', 'oignon', 'oignon rouge', 'oignon blanc', 'oignon nouveau', 'echalote', 'ciboule',
      'carotte', 'pomme de terre', 'patate douce', 'poireau', 'celeri', 'celeri branche',
      'celeri rave', 'navet', 'panais', 'rutabaga', 'topinambour', 'betterave', 'radis',
      'tomate', 'tomate cerise', 'concombre', 'courgette', 'aubergine', 'poivron',
      'poivron rouge', 'poivron vert', 'poivron jaune', 'piment', 'piment doux',
      'champignon', 'champignon de paris', 'cepe', 'girolle', 'shiitake', 'pleurote',
      'salade', 'laitue', 'batavia', 'roquette', 'mache', 'scarole', 'frisee', 'endive',
      'epinard', 'blette', 'chou', 'chou-fleur', 'chou rouge', 'chou blanc', 'chou vert',
      'chou de bruxelles', 'chou chinois', 'brocoli', 'haricot vert', 'haricot beurre',
      'petit pois', 'feve', 'mais', 'courge', 'potiron', 'butternut', 'potimarron',
      'fenouil', 'artichaut', 'asperge', 'poire de terre',
      'persil', 'coriandre', 'basilic', 'menthe', 'ciboulette', 'aneth', 'estragon',
      'cerfeuil', 'sauge', 'romarin', 'thym frais', 'laurier frais', 'herbe',
      'gingembre', 'citronnelle', 'curcuma frais', 'raifort',
      'citron', 'citron vert', 'citron jaune', 'orange', 'pamplemousse', 'clementine',
      'mandarine', 'pomme', 'poire', 'banane', 'ananas', 'mangue', 'papaye', 'avocat',
      'fraise', 'framboise', 'myrtille', 'mure', 'groseille', 'cassis', 'cerise',
      'peche', 'nectarine', 'abricot', 'prune', 'raisin', 'melon', 'pasteque',
      'kiwi', 'figue', 'grenade', 'litchi', 'fruit de la passion', 'noix de coco',
      'rhubarbe', 'datte fraiche', 'physalis',
    ],
    'Laitage & Fromage': [
      'tomme fraiche', 'buche de chevre',
      'lait', 'lait entier', 'lait demi-ecreme', 'lait ecreme', 'lait concentre',
      'creme', 'creme fraiche', 'creme liquide', 'creme epaisse', 'creme entiere',
      'beurre', 'beurre demi-sel', 'beurre doux', 'margarine',
      'yaourt', 'yaourt nature', 'yaourt grec', 'fromage blanc', 'faisselle', 'skyr',
      'petit suisse', 'mascarpone', 'ricotta', 'philadelphia', 'fromage frais',
      'fromage', 'fromage rape', 'gruyere', 'emmental', 'comte', 'beaufort', 'cantal',
      'parmesan', 'pecorino', 'mozzarella', 'burrata', 'feta', 'halloumi',
      'chevre', 'buche de chevre', 'roquefort', 'bleu', 'gorgonzola', 'camembert',
      'brie', 'reblochon', 'raclette', 'munster', 'saint-nectaire', 'tomme',
      'mimolette', 'cheddar', 'creme de gruyere', 'oeuf', 'oeufs',
    ],
    'Viande & Poisson': [
      'morue', 'morue dessalee', 'gesier', 'os a moelle', 'rascasse', 'petit sale',
      'viande des grisons', 'coppa', 'rosbif', 'rosette', 'poisson de roche', 'jarret de veau',
      'palette de porc', 'cuisse de canard confite', 'saucisse de toulouse', 'saucisse de morteau',
      'saucisse de strasbourg', 'foie de porc',
      'boeuf', 'steak', 'steak hache', 'bavette', 'entrecote', 'faux-filet', 'rumsteck',
      'paleron', 'joue de boeuf', 'gite', 'macreuse', 'bourguignon', 'pot-au-feu',
      'veau', 'escalope de veau', 'epaule de veau', 'tendron de veau', 'osso buco',
      'agneau', 'gigot', 'souris d\'agneau', 'cotelette', 'collier d\'agneau', 'mouton',
      'porc', 'echine de porc', 'filet mignon', 'roti de porc', 'travers de porc',
      'poulet', 'blanc de poulet', 'cuisse de poulet', 'aile de poulet', 'escalope de poulet',
      'poulet entier', 'dinde', 'escalope de dinde', 'canard', 'magret', 'confit de canard',
      'cuisse de canard', 'pintade', 'lapin', 'caille', 'chapon',
      'saucisse', 'chorizo', 'merguez', 'saucisson', 'lardon', 'poitrine fumee',
      'jambon', 'jambon blanc', 'jambon cru', 'jambon de bayonne', 'bacon', 'pancetta',
      'andouille', 'boudin', 'chair a saucisse', 'viande hachee',
      'poisson', 'saumon', 'pave de saumon', 'saumon fume', 'truite', 'cabillaud',
      'colin', 'lieu', 'merlu', 'dorade', 'bar', 'loup', 'sole', 'limande', 'turbot',
      'lotte', 'thon', 'espadon', 'maquereau', 'sardine', 'anchois', 'hareng', 'haddock',
      'crevette', 'gambas', 'langoustine', 'homard', 'crabe', 'tourteau', 'ecrevisse',
      'moule', 'huitre', 'coquille saint-jacques', 'saint-jacques', 'palourde', 'coque',
      'bulot', 'calamar', 'encornet', 'poulpe', 'seiche', 'surimi',
    ],
    'Sec': [
      'sauce nuoc-mam', 'nuoc-mam', 'cacahuete', 'tortilla', 'gnocchi', 'nori', 'feuille de nori',
      'sauce nantua', 'baie de genievre', 'chips', 'wasabi', 'epices tandoori', 'garam masala',
      'mirin', 'feuille a gyoza', 'brick', 'haricot noir', 'poudre de colombo', 'pate d\'arachide',
      'pate de curry', 'pate de curry vert', 'pate de curry massaman', 'pate de piment',
      'sauce huitre', 'vermicelle de riz', 'nouille ramen', 'feuille de lasagne', 'lasagne',
      'pain pita', 'pain a burger', 'chips de mais', 'riz a sushi', 'gingembre marine',
      'poudre d\'amande', 'farine de sarrasin', 'epices', 'citron confit',
      'farine', 'farine de ble', 'maizena', 'fecule', 'fecule de mais', 'fecule de pomme de terre',
      'levure', 'levure chimique', 'levure de boulanger', 'bicarbonate',
      'sucre', 'sucre en poudre', 'sucre roux', 'cassonade', 'sucre glace', 'sucre vanille',
      'miel', 'sirop d\'erable', 'sirop d\'agave', 'confiture',
      'riz', 'riz basmati', 'riz thai', 'riz arborio', 'riz complet', 'riz rond',
      'pates', 'spaghetti', 'tagliatelle', 'penne', 'farfalle', 'macaroni', 'lasagne',
      'coquillette', 'vermicelle', 'nouille', 'nouilles chinoises', 'nouilles de riz',
      'semoule', 'couscous', 'boulgour', 'quinoa', 'polenta', 'epeautre', 'orge',
      'lentille', 'lentille corail', 'lentille verte', 'pois chiche', 'haricot rouge',
      'haricot blanc', 'haricot coco', 'flageolet', 'pois casse', 'soja',
      'huile', 'huile d\'olive', 'huile de tournesol', 'huile de colza', 'huile de sesame',
      'huile d\'arachide', 'huile de noix', 'vinaigre', 'vinaigre balsamique',
      'vinaigre de vin', 'vinaigre de cidre', 'vinaigre de riz',
      'sel', 'gros sel', 'fleur de sel', 'sel fin', 'poivre', 'poivre noir', 'poivre blanc',
      'baie rose', 'piment d\'espelette', 'paprika', 'paprika fume', 'curry', 'curcuma',
      'cumin', 'coriandre moulue', 'cannelle', 'muscade', 'noix de muscade', 'gingembre moulu',
      'clou de girofle', 'anis', 'badiane', 'cardamome', 'safran', 'ras el hanout',
      'herbes de provence', 'thym', 'laurier', 'origan', 'basilic seche', 'romarin seche',
      'bouillon', 'bouillon de volaille', 'bouillon de boeuf', 'bouillon de legumes',
      'cube de bouillon', 'fond de veau', 'fumet de poisson', 'bouquet garni',
      'moutarde', 'moutarde a l\'ancienne', 'ketchup', 'mayonnaise', 'sauce soja',
      'sauce worcestershire', 'tabasco', 'harissa', 'pesto', 'concentre de tomate',
      'tomate pelee', 'tomate concassee', 'coulis de tomate', 'passata', 'sauce tomate',
      'lait de coco', 'lait de coco en conserve', 'creme de coco', 'tahini', 'puree de sesame',
      'olive', 'olive noire', 'olive verte', 'cornichon', 'capre',
      'chapelure', 'biscotte', 'pain de mie', 'pain', 'baguette', 'pate brisee',
      'pate feuilletee', 'pate sablee', 'pate a pizza', 'feuille de brick', 'galette de riz',
      'amande', 'amande effilee', 'noisette', 'noix', 'noix de cajou', 'pistache',
      'pignon de pin', 'graine de sesame', 'graine de courge', 'graine de tournesol',
      'raisin sec', 'abricot sec', 'pruneau', 'datte', 'figue seche', 'cranberry',
      'chocolat', 'chocolat noir', 'chocolat au lait', 'cacao', 'cacao en poudre',
      'vanille', 'extrait de vanille', 'gousse de vanille', 'fleur d\'oranger',
      'gelatine', 'agar-agar', 'cafe', 'the',
    ],
    'Traiteur': [
      'escargot', 'quenelle de brochet', 'quenelle', 'falafel', 'ravioles', 'ravioli',
      'pate feuilletee fraiche', 'tarama', 'houmous', 'tzatziki', 'guacamole',
      'salade de chou', 'taboule', 'quiche', 'pizza', 'sushi', 'nem', 'samoussa',
      'terrine', 'pate en croute', 'rillettes', 'foie gras', 'saucisson sec',
    ],
    'Surgelés': [
      'edamame',
      'petit pois surgele', 'epinard surgele', 'haricot vert surgele', 'poele de legumes',
      'glace', 'sorbet', 'frite surgelee', 'poisson pane', 'crevette surgelee',
      'pate feuilletee surgelee', 'fruit rouge surgele',
    ],
    'Boissons': [
      'vin', 'vin blanc', 'vin rouge', 'vin rose', 'biere', 'cidre', 'champagne',
      'cognac', 'armagnac', 'rhum', 'whisky', 'vodka', 'porto', 'madere', 'vermouth',
      'pastis', 'kirsch', 'grand marnier', 'cointreau', 'calvados',
      'jus d\'orange', 'jus de citron', 'jus de pomme', 'jus de tomate',
      'eau gazeuse', 'eau petillante', 'limonade', 'soda', 'coca',
    ],
  };

  // Table plate : clé normalisée -> rayon.
  const INGREDIENTS = (function () {
    const table = {};
    Object.keys(INGREDIENTS_PAR_RAYON).forEach(function (rayon) {
      INGREDIENTS_PAR_RAYON[rayon].forEach(function (nom) {
        table[normaliser(nom)] = rayon;
      });
    });
    return table;
  })();

  // Clés triées par longueur décroissante pour la recherche par inclusion :
  // « pomme de terre » doit gagner contre « pomme ».
  const CLES_INGREDIENTS = Object.keys(INGREDIENTS).sort(function (a, b) {
    return b.length - a.length;
  });

  // Fonds de placard : proposés à l'import mais décochés par défaut.
  const BASIQUES = [
    'sel', 'gros sel', 'fleur de sel', 'sel fin', 'poivre', 'poivre noir', 'poivre blanc',
    'huile', 'huile d\'olive', 'huile de tournesol', 'huile de colza', 'huile d\'arachide',
    'beurre', 'beurre doux', 'beurre demi-sel', 'farine', 'farine de ble', 'maizena', 'fecule',
    'sucre', 'sucre en poudre', 'sucre roux', 'cassonade', 'vinaigre', 'vinaigre de vin',
    'vinaigre balsamique', 'moutarde', 'levure', 'levure chimique',
    'herbes de provence', 'thym', 'laurier', 'origan', 'paprika', 'curry', 'cumin',
    'cannelle', 'muscade', 'noix de muscade', 'piment d\'espelette', 'curcuma',
    'bouillon', 'cube de bouillon', 'bouillon de volaille', 'bouillon de legumes',
  ].reduce(function (acc, nom) { acc[normaliser(nom)] = true; return acc; }, {});

  // Lignes qui n'ont rien à faire sur une liste de courses.
  const IGNORES = [
    'eau', 'eau froide', 'eau chaude', 'eau tiede', 'eau bouillante', 'eau de source',
    'glacon', 'glacons',
  ].reduce(function (acc, nom) { acc[normaliser(nom)] = true; return acc; }, {});

  // Mots de préparation retirés du nom (après une virgule) et remontés en note.
  const PREPARATIONS = [
    'hache', 'hachee', 'haches', 'hachees', 'emince', 'emincee', 'eminces', 'emincees',
    'cisele', 'ciselee', 'rape', 'rapee', 'rapes', 'rapees', 'ecrase', 'ecrasee',
    'coupe en des', 'coupee en des', 'en des', 'en rondelles', 'en lamelles', 'en morceaux',
    'en tranches', 'en quartiers', 'en julienne', 'en batonnets', 'pele', 'pelee',
    'epluche', 'epluchee', 'degraisse', 'denoyaute', 'denoyautee', 'egoutte', 'egouttee',
    'a temperature ambiante', 'bien froid', 'bien froide', 'fondu', 'fondue', 'ramolli',
    'ramollie', 'battu', 'battue', 'facultatif', 'facultative', 'optionnel', 'optionnelle',
    'pour la finition', 'pour le service', 'pour la cuisson',
  ].reduce(function (acc, mot) { acc[normaliser(mot)] = true; return acc; }, {});

  // ---- Analyse d'une ligne ----

  /**
   * Analyse une ligne d'ingrédient telle qu'écrite sur un site de recettes.
   * Renvoie { type: 'ingredient' | 'section' | 'ignore', ... }.
   */
  function parserLigne(ligneBrute) {
    const brut = String(ligneBrute == null ? '' : ligneBrute).trim();
    if (!brut) return { type: 'ignore', brut: brut, raison: 'vide' };

    // Puces et tirets de début de ligne.
    let texte = brut.replace(/^[\s\-–—•·*▪●>]+/, '').trim();
    if (!texte) return { type: 'ignore', brut: brut, raison: 'vide' };

    // Titre de section (« Pour la pâte : », « Garniture »).
    if (/:\s*$/.test(texte) && !/\d/.test(texte)) {
      return { type: 'section', label: majusculeInitiale(texte.replace(/:\s*$/, '').trim()), brut: brut };
    }

    texte = remplacerFractions(texte);

    // Parenthèses et texte après un « , » final descriptif -> note.
    const notes = [];
    texte = texte.replace(/\(([^)]*)\)/g, function (_, contenu) {
      if (contenu.trim()) notes.push(contenu.trim());
      return ' ';
    }).replace(/\s+/g, ' ').trim();

    let reste = developperAbreviations(normaliser(texte));
    let qte = null;
    let unite = null;

    // Une ligne qui ne dit que le nombre de parts n'est pas un ingrédient.
    if (/^(?:pour\s+)?\d+(?:\s*(?:a|-)\s*\d+)?\s*(?:personnes?|parts?|portions?|convives?|couverts?)\.?$/.test(reste)) {
      return { type: 'ignore', brut: brut, raison: 'nombre de personnes' };
    }

    // 1) Quantité chiffrée, éventuellement une fourchette (« 2 à 3 »), pour
    // laquelle on retient la borne haute (mieux vaut en avoir trop en courses).
    const mNombre = reste.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)\s*(?:(?:a|-|\/)\s*(\d+(?:[.,]\d+)?)\s)?/);
    if (mNombre) {
      qte = evaluerNombre(mNombre[1]);
      if (mNombre[2]) {
        const haut = evaluerNombre(mNombre[2]);
        if (haut != null && (qte == null || haut > qte)) qte = haut;
      }
      reste = reste.slice(mNombre[0].length).trim();
    } else {
      // 2) Quantité en toutes lettres (« deux oeufs », « une pincée »).
      const mMot = reste.match(/^([a-z-]+)\s+/);
      if (mMot && Object.prototype.hasOwnProperty.call(NOMBRES_EN_LETTRES, mMot[1])) {
        qte = NOMBRES_EN_LETTRES[mMot[1]];
        reste = reste.slice(mMot[0].length).trim();
      }
    }

    // 3) Unité collée ou séparée (« 200g », « 200 g », « 2 c. à soupe »).
    const resteAvantUnite = reste;
    for (let i = 0; i < FORMES_UNITES.length; i++) {
      const f = FORMES_UNITES[i];
      // La forme doit être suivie d'une fin de chaîne, d'un espace ou d'un
      // connecteur : sinon « g » attraperait le début de « gruyère ».
      const re = new RegExp('^' + echapperRegex(f.forme) + '(?=$|[\\s.,])');
      if (re.test(reste)) {
        unite = f.unite;
        reste = reste.slice(f.forme.length).replace(/^[.,]/, '').trim();
        break;
      }
    }

    // 4) Connecteur « de / d' / du / de la / des ». Les limites de mot évitent
    // que « de la » ampute « de lait » de ses deux premières lettres.
    const avantConnecteur = reste;
    reste = reste.replace(/^(?:de\s+la\b|de\s+l'|des\b|du\b|de\b|d')\s*/, '').trim();
    const connecteurTrouve = reste !== avantConnecteur;

    // Un mot d'unité non suivi de « de » fait souvent partie du nom :
    // « 1 bouquet garni » n'est pas un bouquet de garni. On ne garde l'unité
    // que si le reste est un ingrédient identifiable.
    if (unite && !connecteurTrouve && reste && categoriePour(reste) === 'Autre') {
      unite = null;
      reste = resteAvantUnite;
    }

    // 5) Nettoyage du nom : préparations rejetées en note.
    const morceaux = reste.split(',').map(function (m) { return m.trim(); }).filter(Boolean);
    let nomNorm = morceaux.length ? morceaux[0] : '';
    for (let i = 1; i < morceaux.length; i++) {
      if (PREPARATIONS[morceaux[i]]) notes.push(morceaux[i]);
      else notes.push(morceaux[i]);
    }
    nomNorm = nomNorm.replace(/[.;:!?]+$/, '').trim();

    if (!nomNorm) return { type: 'ignore', brut: brut, raison: 'sans nom' };
    if (IGNORES[nomNorm] || IGNORES[singulariserExpression(nomNorm)]) {
      return { type: 'ignore', brut: brut, raison: 'ingrédient non achetable' };
    }

    // Phrase d'instruction glissée dans la liste : beaucoup de mots, aucune quantité.
    if (qte == null && unite == null && nomNorm.split(' ').length > 9) {
      return { type: 'ignore', brut: brut, raison: 'ressemble à une étape de préparation' };
    }

    // Le nom affiché reprend la casse d'origine quand elle correspond, sinon on
    // se contente d'une majuscule initiale sur la forme normalisée.
    const nomAffiche = retrouverCasse(texte, nomNorm);

    return {
      type: 'ingredient',
      brut: brut,
      nom: nomAffiche,
      cle: nomNorm,
      qte: qte,
      unite: unite ? unite.canon : '',
      note: notes.join(', '),
      categorie: categoriePour(nomNorm),
      basique: estBasique(nomNorm),
    };
  }

  function echapperRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function evaluerNombre(txt) {
    const s = String(txt).replace(',', '.').trim();
    const mMixte = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (mMixte) return Number(mMixte[1]) + Number(mMixte[2]) / Number(mMixte[3]);
    const mFraction = s.match(/^(\d+)\/(\d+)$/);
    if (mFraction) return Number(mFraction[1]) / Number(mFraction[2]);
    const n = Number(s);
    return isNaN(n) ? null : n;
  }

  // Retrouve dans le texte d'origine le fragment correspondant au nom normalisé,
  // pour conserver les accents et la casse (« Crème fraîche » plutôt que « creme fraiche »).
  function retrouverCasse(texteOrigine, nomNorm) {
    const mots = nomNorm.split(' ').filter(Boolean);
    if (mots.length === 0) return majusculeInitiale(nomNorm);
    const motsOrigine = texteOrigine.split(/\s+/);
    for (let debut = 0; debut < motsOrigine.length; debut++) {
      let candidat = motsOrigine.slice(debut, debut + mots.length).join(' ').replace(/[.,;:!?]+$/, '');
      // Le premier mot peut porter un connecteur collé (« d'épaule »), à retirer
      // avant comparaison pour ne pas perdre les accents du texte d'origine.
      const candidatNu = candidat.replace(/^(?:d['’]|l['’])/i, '');
      if (normaliser(candidat) === nomNorm) return majusculeInitiale(candidat);
      if (normaliser(candidatNu) === nomNorm) return majusculeInitiale(candidatNu);
    }
    return majusculeInitiale(nomNorm);
  }

  /**
   * Rayon d'un ingrédient. `reference` est la table de référence de l'appli
   * (tableau d'objets { nom, categorie }), consultée avant les approximations.
   */
  function categoriePour(nom, reference) {
    const cle = normaliser(nom);
    if (INGREDIENTS[cle]) return INGREDIENTS[cle];

    const cleSing = singulariserExpression(cle);
    if (INGREDIENTS[cleSing]) return INGREDIENTS[cleSing];

    if (reference && reference.length) {
      for (let i = 0; i < reference.length; i++) {
        const refCle = normaliser(reference[i].nom);
        if (refCle === cle || singulariserExpression(refCle) === cleSing) {
          return reference[i].categorie || 'Autre';
        }
      }
    }

    // Recherche par inclusion, la clé la plus longue d'abord.
    for (let i = 0; i < CLES_INGREDIENTS.length; i++) {
      const k = CLES_INGREDIENTS[i];
      if (k.length < 4) continue;
      if (cleSing.indexOf(k) !== -1 || cle.indexOf(k) !== -1) return INGREDIENTS[k];
    }

    return 'Autre';
  }

  function estBasique(nom) {
    const cle = normaliser(nom);
    if (BASIQUES[cle]) return true;
    return !!BASIQUES[singulariserExpression(cle)];
  }

  // ---- Analyse d'un bloc de texte ----

  /**
   * Analyse un texte collé (ou un tableau de lignes venant d'un import par URL).
   * Renvoie { ingredients, sections, ignorees, portions }.
   */
  function parserTexte(entree) {
    const lignes = eclaterLignesGroupees(Array.isArray(entree)
      ? entree.slice()
      : String(entree == null ? '' : entree).split(/\r?\n/));

    const ingredients = [];
    const ignorees = [];
    let portions = null;
    let sectionCourante = '';

    lignes.forEach(function (ligne) {
      const portionsLigne = detecterPortions(ligne);
      if (portionsLigne && portions == null) {
        portions = portionsLigne;
        // Une ligne « Pour 4 personnes » n'est pas un ingrédient.
        if (normaliser(ligne).replace(/[^a-z]/g, '').length < 24) return;
      }
      const r = parserLigne(ligne);
      if (r.type === 'section') { sectionCourante = r.label; return; }
      if (r.type === 'ignore') {
        if (r.raison !== 'vide') ignorees.push({ brut: r.brut, raison: r.raison });
        return;
      }
      r.section = sectionCourante;
      ingredients.push(r);
    });

    return { ingredients: ingredients, ignorees: ignorees, portions: portions };
  }

  // « Sel, poivre » est une ligne pour deux ingrédients. On ne l'éclate que si
  // la ligne ne porte aucune quantité et que chaque morceau est un ingrédient
  // reconnaissable, pour ne pas découper « 200 g de champignons, émincés ».
  function eclaterLignesGroupees(lignes) {
    const sortie = [];
    lignes.forEach(function (ligne) {
      const t = String(ligne == null ? '' : ligne);
      if (!/\d/.test(t) && t.indexOf(',') !== -1) {
        const morceaux = t.split(/,| et /).map(function (m) { return m.trim(); }).filter(Boolean);
        const toutesConnues = morceaux.length > 1 && morceaux.every(function (m) {
          return m.split(/\s+/).length <= 3 && categoriePour(m) !== 'Autre';
        });
        if (toutesConnues) {
          morceaux.forEach(function (m) { sortie.push(m); });
          return;
        }
      }
      sortie.push(t);
    });
    return sortie;
  }

  // « Pour 4 personnes », « 6 parts », « pour 4 à 6 personnes ».
  function detecterPortions(texte) {
    const t = normaliser(texte);
    const m = t.match(/(?:pour\s+)?(\d+)(?:\s*(?:a|-)\s*(\d+))?\s*(personnes?|parts?|portions?|convives?|couverts?)/);
    if (!m) return null;
    const bas = Number(m[1]);
    const haut = m[2] ? Number(m[2]) : null;
    const n = haut ? Math.round((bas + haut) / 2) : bas;
    return n > 0 && n <= 50 ? n : null;
  }

  // ---- Mise à l'échelle ----

  /**
   * Applique un facteur à une quantité et choisit une valeur achetable.
   * Renvoie { qte, unite }.
   */
  function echelonnerQuantite(qte, uniteCanon, facteur) {
    if (qte == null) return { qte: null, unite: uniteCanon || '' };
    const u = uniteCanon ? trouverUnite(uniteCanon) : null;
    if (u && u.nonEchelle) return { qte: qte, unite: uniteCanon };

    let valeur = qte * facteur;
    let unite = uniteCanon || '';

    if (u && u.type === 'poids') {
      let grammes = valeur * u.base;
      if (grammes >= 1000) {
        return { qte: arrondiPas(grammes / 1000, 0.05), unite: 'kg' };
      }
      return { qte: arrondiPoids(grammes), unite: 'g' };
    }

    if (u && u.type === 'volume') {
      let ml = valeur * u.base;
      if (ml >= 1000) return { qte: arrondiPas(ml / 1000, 0.05), unite: 'l' };
      if (ml >= 100) return { qte: arrondiPas(ml / 10, 1), unite: 'cl' };
      return { qte: arrondiPas(ml, 5), unite: 'ml' };
    }

    if (u && u.type === 'cuillere') {
      return { qte: Math.max(0.5, arrondiPas(valeur, 0.5)), unite: unite };
    }

    // Pièces et articles comptés : on ne peut pas acheter 1,5 oignon, donc on
    // arrondit systématiquement au supérieur.
    return { qte: Math.max(1, Math.ceil(valeur - 0.001)), unite: unite };
  }

  function arrondiPas(valeur, pas) {
    return Math.round(valeur / pas) * pas;
  }

  function arrondiPoids(g) {
    if (g >= 200) return arrondiPas(g, 25);
    if (g >= 100) return arrondiPas(g, 10);
    if (g >= 20) return arrondiPas(g, 5);
    return Math.max(1, Math.round(g));
  }

  /**
   * Met une liste d'ingrédients à l'échelle entre deux nombres de personnes.
   */
  function mettreAEchelle(ingredients, portionsSource, portionsCible) {
    const source = Number(portionsSource) > 0 ? Number(portionsSource) : 1;
    const cible = Number(portionsCible) > 0 ? Number(portionsCible) : source;
    const facteur = cible / source;
    return ingredients.map(function (ing) {
      const r = echelonnerQuantite(ing.qte, ing.unite, facteur);
      return Object.assign({}, ing, { qte: r.qte, unite: r.unite });
    });
  }

  // ---- Quantités : affichage et cumul ----

  function formatQuantite(qte, unite) {
    if (qte == null || qte === '') return unite ? String(unite) : '';
    const n = formatNombre(Number(qte));
    if (!unite) return n;
    // Les unités « pièce » s'accordent au pluriel.
    const u = trouverUnite(unite);
    if (u && (u.type === 'piece' || u.type === 'appoint') && Number(qte) > 1 && !/s$/.test(unite)) {
      return n + ' ' + unite + 's';
    }
    return n + ' ' + unite;
  }

  // Deux quantités sont cumulables si elles partagent le même type d'unité
  // (deux poids, deux volumes), ou si elles n'ont toutes les deux pas d'unité.
  function typeUnite(uniteCanon) {
    if (!uniteCanon) return 'piece-nue';
    const u = trouverUnite(uniteCanon);
    return u ? u.type : 'autre:' + uniteCanon;
  }

  function cumulables(uniteA, uniteB) {
    const ta = typeUnite(uniteA);
    const tb = typeUnite(uniteB);
    if (ta !== tb) return false;
    if (ta === 'piece') return normaliser(uniteA) === normaliser(uniteB);
    return true;
  }

  /**
   * Additionne deux quantités cumulables et renvoie { qte, unite } dans l'unité
   * la plus lisible. Renvoie null si elles ne sont pas cumulables.
   */
  function additionner(qteA, uniteA, qteB, uniteB) {
    if (!cumulables(uniteA, uniteB)) return null;
    if (qteA == null || qteB == null) return null;
    const ua = uniteA ? trouverUnite(uniteA) : null;
    const ub = uniteB ? trouverUnite(uniteB) : null;

    if (ua && ub && ua.base && ub.base) {
      const total = qteA * ua.base + qteB * ub.base;
      if (ua.type === 'poids') {
        return total >= 1000
          ? { qte: Math.round((total / 1000) * 100) / 100, unite: 'kg' }
          : { qte: Math.round(total * 10) / 10, unite: 'g' };
      }
      if (ua.type === 'volume') {
        if (total >= 1000) return { qte: Math.round((total / 1000) * 100) / 100, unite: 'l' };
        if (total >= 100) return { qte: Math.round(total / 10 * 10) / 10, unite: 'cl' };
        return { qte: Math.round(total), unite: 'ml' };
      }
    }
    return { qte: Math.round((qteA + qteB) * 100) / 100, unite: uniteA || uniteB || '' };
  }

  return {
    normaliser: normaliser,
    singulariserExpression: singulariserExpression,
    majusculeInitiale: majusculeInitiale,
    parserLigne: parserLigne,
    parserTexte: parserTexte,
    detecterPortions: detecterPortions,
    categoriePour: categoriePour,
    estBasique: estBasique,
    mettreAEchelle: mettreAEchelle,
    echelonnerQuantite: echelonnerQuantite,
    formatQuantite: formatQuantite,
    formatNombre: formatNombre,
    additionner: additionner,
    cumulables: cumulables,
    INGREDIENTS: INGREDIENTS,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RECETTES;
