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
index.html          Page principale de l'appli
style.css           Mise en forme
app.js              Logique (affichage, actions, file d'attente hors-ligne)
config.js           Liste des catégories (aucune donnée sensible)
manifest.json        Manifeste PWA (installation sur l'écran d'accueil)
sw.js                Service worker (mise en cache pour un chargement rapide et hors-ligne)
icons/               Icônes de l'appli
apps-script/Code.gs  Code du backend Google Apps Script à coller dans votre Google Sheet
```
