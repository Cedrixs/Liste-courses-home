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

Le script crée automatiquement les onglets nécessaires (`Liste`, `Archives`, `Recurrents`) au premier appel, vous n'avez rien d'autre à préparer dans la feuille.

> Si plus tard vous modifiez le code du script, il faut créer une **nouvelle version** du déploiement (Déployer > Gérer les déploiements > icône crayon > Version > Nouvelle version) pour que les changements soient pris en compte, sans que cela change l'URL.

## Étape 2 : publier sur GitHub Pages

GitHub Pages exige que le dépôt soit **public**. L'URL de votre Apps Script (étape 1) n'est donc **jamais mise dans le code** : elle n'apparaît dans aucun fichier du dépôt, elle est saisie directement dans l'appli et reste stockée uniquement sur chaque téléphone (voir "Sécurité de l'URL" plus bas).

1. Committez et poussez vos changements sur la branche du dépôt.
2. Dans les paramètres du dépôt GitHub : **Settings > Pages**.
3. Source : **Deploy from a branch**, branche = celle où se trouve le code, dossier = `/ (root)`.
4. Enregistrez. GitHub vous donne une URL du type `https://votre-compte.github.io/Liste-courses-home/`.

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
config.js                     Liste des catégories (aucune donnée sensible)
manifest.json                 Manifeste PWA (installation sur l'écran d'accueil)
sw.js                         Service worker (réseau d'abord, repli sur le cache hors-ligne)
icons/                        Icônes de l'appli (dont les variantes "maskable" pour Android)
apps-script/Code.gs           Code du backend Google Apps Script à coller dans votre Google Sheet
```

## Journal des évolutions récentes

- **Autocomplétion avec table de référence des articles** : en tapant un article, un menu déroulant propose des suggestions (issues d'une nouvelle table de référence pré-remplie d'articles courants, et de votre historique) et remplit automatiquement le rayon correspondant. Si l'article tapé est inconnu, une popup propose de l'ajouter à la table de référence (avec sa catégorie) pour le retrouver plus vite la prochaine fois ; sinon la sélection manuelle du rayon fonctionne comme avant. La recherche se fait entièrement en local (aucun aller-retour réseau à chaque frappe) pour un affichage instantané ; les données sont tenues à jour à l'ouverture de l'appli, à chaque retour au premier plan, et discrètement en tâche de fond quand vous ouvrez le champ d'ajout.
- **Quantité optionnelle par article** : une icône ⚖️ à côté du champ d'ajout permet de préciser une quantité en texte libre (ex : "500g", "x6", "1L"). Si elle est renseignée, un petit picto apparaît sur la ligne de l'article ; un clic dessus affiche temporairement la valeur saisie.
  > Ces deux évolutions ajoutent un nouvel onglet `Reference` et une colonne `quantite` côté Google Sheet : pensez à recoller le nouveau [`apps-script/Code.gs`](apps-script/Code.gs) dans votre Apps Script et à redéployer une nouvelle version (voir "Étape 1" ci-dessus). Rien à faire sur la feuille elle-même, la mise à jour se fait toute seule au premier appel.
- **Sélection par cases à cocher dans les modèles récurrents** : chaque article d'un modèle peut être coché/décoché avant de l'ajouter à la liste (tout coché par défaut), avec des liens "Tout sélectionner" / "Enlever sélection" par modèle. La sélection est mémorisée sur l'appareil.
- **Écran de connexion à la première ouverture** : l'URL Apps Script n'est plus stockée dans le dépôt (public) mais saisie une fois sur chaque appareil et conservée en local. Modifiable via l'icône ⚙️.
- **Service worker en réseau d'abord** : les mises à jour de l'appli se propagent désormais aux téléphones sans manipulation particulière (voir "Mettre à jour l'appli" ci-dessus pour la toute première fois après ce changement).
- **Nouveau logo Rue Felix** : icônes, couleur de thème et écran de démarrage mis à jour avec la nouvelle identité visuelle.
