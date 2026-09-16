# Liste de courses du foyer

Application web (PWA) de liste de courses partagée, installable sur téléphone comme une vraie appli, sans nécessiter que tout le monde ait un compte ou une connexion particulière (pas de Tailscale requis pour les autres membres).

## Comment ça marche

- Le **frontend** (ce que vous voyez et utilisez) est un site statique hébergé gratuitement sur GitHub Pages.
- Les **données** (liste de courses, archives, modèles récurrents) sont stockées dans un **Google Sheet** de votre Google Drive.
- Un petit programme (**Google Apps Script**) sert de pont entre le site et le Google Sheet. Il est exécuté avec votre compte Google, donc les autres membres du foyer n'ont jamais besoin de se connecter à Google : ils ouvrent juste l'appli.

## Étape 1 : créer le Google Sheet et l'Apps Script

1. Allez sur [sheets.google.com](https://sheets.google.com) et créez une nouvelle feuille de calcul vide. Nommez-la par exemple "Données - Liste de courses".
2. Dans le menu, allez dans **Extensions > Apps Script**.
3. Supprimez le contenu par défaut du fichier `Code.gs` et collez-y le contenu du fichier [`apps-script/Code.gs`](apps-script/Code.gs) de ce dépôt.
4. Cliquez sur **Enregistrer** (icône disquette).
5. Cliquez sur **Déployer > Nouveau déploiement**.
   - Type : **Application Web**.
   - Description : ce que vous voulez (ex: "v1").
   - Exécuter en tant que : **Moi** (votre compte Google).
   - Qui a accès : **Tout le monde**.
6. Cliquez sur **Déployer**. Google vous demandera d'autoriser le script à accéder à votre Google Sheet (c'est normal, c'est votre propre script). Acceptez.
7. Copiez l'**URL de l'application Web** qui s'affiche (elle ressemble à `https://script.google.com/macros/s/AKfycb.../exec`). C'est votre backend.

Le script crée automatiquement les onglets nécessaires (`Liste`, `Archives`, `Recurrents`, `Listes`) au premier appel, vous n'avez rien d'autre à préparer dans la feuille.

> Si plus tard vous modifiez le code du script, il faut créer une **nouvelle version** du déploiement (Déployer > Gérer les déploiements > icône crayon > Version > Nouvelle version) pour que les changements soient pris en compte, sans que cela change l'URL.

## Étape 2 : publier sur GitHub Pages

GitHub Pages exige que le dépôt soit **public**. L'URL de votre Apps Script (étape 1) n'est donc **jamais mise dans le code** : elle n'apparaît dans aucun fichier du dépôt, elle est saisie directement dans l'appli et reste stockée uniquement sur chaque téléphone (voir "Sécurité de l'URL" plus bas).

1. Committez et poussez vos changements sur la branche du dépôt.
2. Dans les paramètres du dépôt GitHub : **Settings > Pages**.
3. Source : **Deploy from a branch**, branche = celle où se trouve le code, dossier = `/ (root)`.
4. Enregistrez. GitHub vous donne une URL du type `https://votre-compte.github.io/Liste-courses-home/`.

> **Branche déployée sur GitHub Pages : `claude/shared-shopping-list-app-3xtucd`.**
> C'est la seule branche que GitHub Pages publie réellement. Toute modification doit être fusionnée dans cette branche pour apparaître dans l'appli installée sur les téléphones (fermer/rouvrir l'appli ne suffit pas si le code est resté sur une autre branche). Vérifiable et modifiable dans Settings > Pages du dépôt.

C'est cette URL que vous et les autres membres du foyer allez utiliser. Vous pouvez personnaliser la liste `CATEGORIES` dans [`config.js`](config.js) si vous voulez d'autres rayons (ce fichier ne contient rien de sensible).

## Étape 3 : installer l'appli et se connecter

**Sur Android (Chrome) :**
1. Ouvrez l'URL GitHub Pages dans Chrome.
2. Menu ⋮ > **Ajouter à l'écran d'accueil** (ou une bannière d'installation apparaît automatiquement).

**Sur iPhone (Safari, obligatoire — Chrome iOS ne permet pas l'installation) :**
1. Ouvrez l'URL GitHub Pages dans Safari.
2. Appuyez sur l'icône de partage (carré avec flèche vers le haut).
3. **Sur l'écran d'accueil**.
4. Confirmez. L'icône verte avec la coche apparaît sur l'écran d'accueil et s'ouvre en plein écran comme une vraie appli.

**À la toute première ouverture**, l'appli affiche un écran demandant l'URL de votre déploiement Apps Script (celle copiée à l'étape 1). Envoyez-la aux autres membres du foyer par un moyen privé (SMS, message chiffré...), jamais par un canal public. Une fois saisie, elle est enregistrée sur l'appareil et ne sera plus redemandée. Un bouton ⚙️ en haut de l'écran permet de la modifier plus tard (par exemple si vous redéployez le script et obtenez une nouvelle URL).

## Mettre à jour l'appli après un changement de code

L'appli fonctionne en "réseau d'abord" : à chaque ouverture, si vous avez du réseau, elle récupère la dernière version en ligne. Mais le tout premier chargement d'une mise à jour se fait encore avec l'ancien service worker (le programme qui gère le cache), donc :

1. Attendez ~1 minute après un push sur GitHub que **GitHub Pages** ait fini de redéployer (visible dans l'onglet **Actions** du dépôt).
2. **Fermez complètement l'appli** sur le téléphone (pas juste la mettre en arrière-plan : sur Android comme sur iPhone, balayez la carte de l'appli dans le sélecteur de tâches pour la fermer).
3. **Rouvrez-la** : ce premier réveil installe le nouveau service worker en tâche de fond.
4. **Fermez et rouvrez une seconde fois** pour voir effectivement la mise à jour à l'écran.

En dernier recours (si ça ne suffit toujours pas) : réglages du navigateur > effacer les données du site pour l'adresse GitHub Pages. Cela réinitialise aussi l'URL Apps Script enregistrée, à ressaisir ensuite via l'écran ⚙️.

À noter aussi : une **icône d'appli déjà posée sur l'écran d'accueil n'est en général pas remplacée automatiquement** par iOS/Android, même après une mise à jour du logo. Si l'icône ne change pas, supprimez le raccourci existant et refaites "Ajouter à l'écran d'accueil".

## Sécurité de l'URL Apps Script

- Le dépôt GitHub étant public, rien de ce qu'il contient (code, `config.js`, historique des commits) ne doit jamais inclure cette URL.
- L'URL n'est cependant pas un vrai mot de passe : toute personne qui l'obtient (lien intercepté, capture d'écran) peut lire/modifier la liste, exactement comme un lien "partageable" classique. La retirer du dépôt public empêche surtout sa découverte automatique par des robots qui scannent GitHub à la recherche de liens exposés — elle ne remplace pas un vrai contrôle d'accès.
- Si vous voulez une protection plus forte plus tard, on peut ajouter un code secret vérifié côté Apps Script (`Code.gs`), en plus de l'URL.

## Limites et points d'attention

- **Pas de synchronisation instantanée** : chaque personne doit rouvrir/rafraîchir l'appli pour voir les ajouts des autres (l'appli se resynchronise automatiquement à chaque ouverture et quand elle repasse au premier plan).
- **Mode hors ligne** : si le téléphone n'a pas de réseau (au fond d'un magasin par exemple), les actions (ajouter, cocher, archiver) restent visibles localement et sont envoyées automatiquement au Google Sheet dès que le réseau revient. Un petit point orange en haut de l'écran indique qu'une synchronisation est en attente.
- **Quotas Google Apps Script** : très largement suffisants pour un usage à 2-4 personnes (largement plus de 20 000 requêtes/jour sur un compte Google gratuit).
- Le Raspberry Pi n'est pas utilisé par cette version. Il pourra servir plus tard, par exemple pour une sauvegarde automatique périodique du Google Sheet.

## Structure du projet

```
index.html                    Page principale de l'appli
style.css                     Mise en forme
app.js                        Logique (affichage, actions, file d'attente hors-ligne)
recettes.js                   Moteur de recettes : analyse des ingrédients, mise à l'échelle, cumul
recettes-catalogue.js         Catalogue de ~195 recettes embarquées (entrées et plats)
config.js                     Liste des catégories (aucune donnée sensible)
manifest.json                 Manifeste PWA (installation sur l'écran d'accueil)
sw.js                         Service worker (réseau d'abord, repli sur le cache hors-ligne)
icons/                        Icônes de l'appli (dont les variantes "maskable" pour Android)
apps-script/Code.gs           Code du backend Google Apps Script à coller dans votre Google Sheet
```

## Partir d'une recette

L'onglet **Recettes** transforme une recette en liste de courses. Trois façons d'y entrer, qui aboutissent toutes au même écran d'aperçu :

1. **Taper le nom d'une recette.** La recherche porte d'abord sur le catalogue embarqué (environ 195 entrées et plats : cuisine française, plats à partager, plats exotiques) et sur les recettes que vous avez déjà importées. C'est instantané et ça marche hors ligne.
2. **Coller le lien d'une recette** (Cookomix, Marmiton, 750g, CuisineAZ...). L'Apps Script va lire la page et en extrait les ingrédients ainsi que le nombre de parts. Nécessite une connexion.
3. **Coller la liste des ingrédients** telle que copiée sur un site. Les titres de section et les phrases de préparation sont écartés, et listés à part pour que vous puissiez vérifier que rien d'utile n'a été perdu.

Sur l'écran d'aperçu, chaque ingrédient est modifiable : nom, quantité, unité, rayon. Vous indiquez pour combien de personnes la recette est prévue et pour combien vous cuisinez, et les quantités suivent. Les quantités comptables sont arrondies au supérieur (on n'achète pas 1,5 oignon) et les fonds de placard (sel, poivre, huile, beurre, farine, épices) arrivent décochés, à recocher si vous en manquez.

Au bout, deux choix : **créer un modèle** réutilisable, ou **ajouter directement à une liste**. Un nom de modèle déjà pris ne remplace jamais l'ancien, il devient « Blanquette de veau (2) ».

### Cumul des quantités

Quand un ingrédient est déjà dans la liste avec une quantité chiffrée, les quantités s'additionnent au lieu de créer un doublon : 300 g de beurre pour un gratin plus 200 g pour une sauce donnent une seule ligne « Beurre, 500 g ». Un petit picto sur la ligne indique d'où elle vient, et un clic dessus affiche la provenance (« Gratin du soir + Sauce blanche »). Les quantités saisies en texte libre ne sont jamais fusionnées : on ne sait pas additionner « une bonne poignée ».

### Fiche des modèles

Chaque modèle peut porter une **description** et un **lien vers la recette d'origine**, remplis automatiquement à l'import ou saisis à la main via l'icône ✎ sur la carte du modèle. Le lien est cliquable depuis l'appli, pour retrouver la recette complète au moment de cuisiner.

### Enrichir le catalogue

Le catalogue est un simple fichier, [`recettes-catalogue.js`](recettes-catalogue.js) : une ligne `r(nom, tags, portions, ingrédients)` par recette. En ajouter se fait à la main ou en demandant à Claude de compléter le fichier. Rien n'est facturé à l'usage : le catalogue est embarqué dans l'appli, aucune requête n'est faite pour l'interroger.

### Vérifier qu'un site est exploitable

L'import par lien s'appuie sur les données structurées (schema.org `Recipe`) que les sites de recettes publient pour Google. Pour vérifier qu'un site donné fonctionne, appelez votre déploiement avec :

```
https://votre-url-apps-script/exec?action=diagnostiquerUrl&url=ADRESSE_DE_LA_RECETTE
```

La réponse indique si des ingrédients ont été trouvés, par quelle méthode, combien, et le nombre de parts détecté. Si un site ne renvoie rien, le collage du texte reste toujours possible.

## Recherche internet (optionnelle, à configurer)

La recherche par nom peut être étendue à internet, pour les recettes absentes du catalogue. Elle passe par l'API Google Custom Search, restreinte aux sites de recettes. Tant qu'elle n'est pas configurée, l'appli fonctionne normalement : seule cette extension reste inactive.

Pour l'activer :

1. Créez un moteur de recherche personnalisé sur [programmablesearchengine.google.com](https://programmablesearchengine.google.com), restreint à `cookomix.com`, `marmiton.org`, `750g.com` et `cuisineaz.com`. Notez son **ID de moteur de recherche**.
2. Créez une clé API pour l'API « Custom Search » sur [console.cloud.google.com](https://console.cloud.google.com/apis/library/customsearch.googleapis.com).
3. Dans votre Apps Script : **Paramètres du projet > Propriétés du script > Ajouter une propriété**, deux fois :
   - `GOOGLE_CSE_KEY` = votre clé API
   - `GOOGLE_CSE_ID` = l'ID du moteur de recherche

La clé est stockée **uniquement dans votre Apps Script**, jamais dans ce dépôt public, et elle survit à un recollage de `Code.gs`. Aucun redéploiement n'est nécessaire : la recherche s'active dès que les deux propriétés sont présentes. Le quota gratuit est de 100 recherches par jour, très au-delà d'un usage familial.

## Journal des évolutions récentes

- **Import de recettes** : nouvel onglet « Recettes » permettant de taper le nom d'une recette, de coller le lien d'une page ou d'y coller une liste d'ingrédients, puis de la transformer en modèle ou de l'ajouter directement à une liste, avec mise à l'échelle par nombre de personnes et cumul des quantités. Les modèles gagnent une fiche (description et lien vers la recette). Voir « Partir d'une recette » ci-dessus.
  > Cette évolution ajoute les onglets `Modeles` et `Recettes` côté Google Sheet, ainsi que les colonnes `qte`, `unite` et `provenance`. Pensez à recoller le nouveau [`apps-script/Code.gs`](apps-script/Code.gs) et à redéployer une nouvelle version. **L'import par lien accède à des sites externes : Google redemandera votre autorisation une fois lors du redéploiement**, c'est normal. Rien à faire sur la feuille, la mise à jour se fait toute seule au premier appel, et les quantités déjà saisies en texte libre sont conservées telles quelles.
- **Plusieurs listes de courses** : le titre en haut de l'onglet « Liste » devient un menu déroulant permettant de changer de liste active (ex : Alimentaire, Bricolage) ou d'en créer une nouvelle en lui donnant un nom. Chaque liste a ses propres catégories, ses propres archives, et sa propre sélection d'articles. Depuis un modèle récurrent, le bouton « Ajouter à la liste » demande désormais dans quelle liste ajouter les articles sélectionnés. Les articles de modèles peuvent aussi porter une quantité/remarque (ex : prix), affichée comme sur la liste active.
  > Une liste **Alimentaire** regroupant vos données existantes est créée automatiquement à la première exécution de la nouvelle version du script (rien à faire sur la feuille elle-même). Pensez à recoller le nouveau [`apps-script/Code.gs`](apps-script/Code.gs) dans votre Apps Script et à redéployer une nouvelle version (voir "Étape 1" ci-dessus). Aucune autre liste ni aucun modèle n'est pré-rempli par le script : ils se créent depuis l'appli (ou via son API, à la demande).
- **Autocomplétion avec table de référence des articles** : en tapant un article, un menu déroulant propose des suggestions (issues d'une nouvelle table de référence pré-remplie d'articles courants, et de votre historique) et remplit automatiquement le rayon correspondant. Si l'article tapé est inconnu, une popup propose de l'ajouter à la table de référence (avec sa catégorie) pour le retrouver plus vite la prochaine fois ; sinon la sélection manuelle du rayon fonctionne comme avant. La recherche se fait entièrement en local (aucun aller-retour réseau à chaque frappe) pour un affichage instantané ; les données sont tenues à jour à l'ouverture de l'appli, à chaque retour au premier plan, et discrètement en tâche de fond quand vous ouvrez le champ d'ajout.
- **Quantité optionnelle par article** : une icône ⚖️ à côté du champ d'ajout permet de préciser une quantité en texte libre (ex : "500g", "x6", "1L"). Si elle est renseignée, un petit picto apparaît sur la ligne de l'article ; un clic dessus affiche temporairement la valeur saisie.
  > Ces deux évolutions ajoutent un nouvel onglet `Reference` et une colonne `quantite` côté Google Sheet : pensez à recoller le nouveau [`apps-script/Code.gs`](apps-script/Code.gs) dans votre Apps Script et à redéployer une nouvelle version (voir "Étape 1" ci-dessus). Rien à faire sur la feuille elle-même, la mise à jour se fait toute seule au premier appel.
- **Sélection par cases à cocher dans les modèles récurrents** : chaque article d'un modèle peut être coché/décoché avant de l'ajouter à la liste (tout coché par défaut), avec des liens "Tout sélectionner" / "Enlever sélection" par modèle. La sélection est mémorisée sur l'appareil.
- **Écran de connexion à la première ouverture** : l'URL Apps Script n'est plus stockée dans le dépôt (public) mais saisie une fois sur chaque appareil et conservée en local. Modifiable via l'icône ⚙️.
- **Service worker en réseau d'abord** : les mises à jour de l'appli se propagent désormais aux téléphones sans manipulation particulière (voir "Mettre à jour l'appli" ci-dessus pour la toute première fois après ce changement).
- **Nouveau logo Rue Felix** : icônes, couleur de thème et écran de démarrage mis à jour avec la nouvelle identité visuelle.
