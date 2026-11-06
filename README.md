# Gmail Lisible

Extension Chrome qui rend Gmail plus lisible.

## Ce qu'elle fait

**Dans les conversations**

- **Déplie tous les messages.** Plus de messages repliés ni de « N messages plus anciens » dans les longues conversations. Si vous repliez un message ensuite, il reste replié.
- **Masque le bouton « Afficher le contenu abrégé »** (les trois petits points sous chaque message).
- **Masque les noms de pièces jointes** du type `<BEAR_Rennes_6mm.dxf><BEAR_Rennes_6mm.pdf><PastedGraphic-1.tiff>` qui s'affichent sous ce bouton (Apple Mail les ajoute dans ses réponses).
- **Réponse flottante.** Après un clic sur « Répondre », si vous remontez pour relire la conversation, votre réponse reste visible en bas à droite, comme une fenêtre pop-up. Quand vous redescendez tout en bas, elle reprend sa place. Sa barre de titre permet de la réduire (—) ou d'y revenir (⤓). Votre texte n'est jamais perdu : seul l'affichage change.

**Dans la boîte de réception** (et les libellés, recherches…)

- **Séparateurs de dates** entre les e-mails, au choix :
  - *Chaque jour* : « Aujourd'hui », « Hier », « 04/11 », « 03/11 »…
  - *Regrouper* : « Aujourd'hui », « Hier », « Cette semaine », « Semaine dernière », « Octobre »…

Chaque fonction se règle en cliquant sur l'icône de l'extension. Les changements s'appliquent tout de suite.

## Installation (5 minutes)

1. **Télécharger** : [chrome-gmail-lisible-main.zip](https://github.com/lmchd-romain/chrome-gmail-lisible/archive/refs/heads/main.zip) (connecté à GitHub).
2. **Décompresser** le fichier (double-clic). Ranger le dossier obtenu `chrome-gmail-lisible-main` dans un endroit fixe, par exemple **Documents**. Ne plus le déplacer ni le supprimer : Chrome lit l'extension dans ce dossier.
3. Dans Chrome, ouvrir l'adresse `chrome://extensions`.
4. En haut à droite, activer **Mode développeur**.
5. Cliquer **Charger l'extension non empaquetée** et choisir le dossier **`extension`** qui se trouve *dans* `chrome-gmail-lisible-main`.
6. Cliquer sur l'icône puzzle 🧩 à droite de la barre d'adresse, puis sur l'épingle à côté de **Gmail Lisible**, pour garder l'icône visible.
7. **Recharger Gmail** (touche F5 ou ⌘R).

## Mettre à jour

1. Re-télécharger le ZIP (même lien) et remplacer l'ancien dossier par le nouveau, au même endroit.
2. Dans `chrome://extensions`, cliquer sur la flèche ↻ de **Gmail Lisible**.
3. Recharger Gmail.

Vos réglages sont conservés.

## Bon à savoir

- L'extension ne fonctionne que sur `mail.google.com`. Elle n'envoie aucune donnée nulle part : tout se passe dans votre navigateur. Elle demande seulement le droit d'enregistrer vos réglages.
- Contenu abrégé masqué : pour revoir exceptionnellement un texte cité, désactivez le réglage le temps de le lire.
- Gmail modifie parfois sa page. Si une fonction ne marche plus, désactivez-la dans les réglages et signalez-le.

## Prochaines étapes

- Défilement infini à la place de « 1–50 sur … » (plus besoin de changer de page).
- Retrouver facilement toutes les pièces jointes d'une longue conversation.

## Pour les développeurs

- Code de l'extension : `extension/` (Manifest V3, sans étape de compilation).
- Tests : `npm test` (tests des dates + test de bout en bout dans Chromium avec Playwright, sur de fausses pages Gmail dans `tests/fixtures/`).
- Icônes : `python3 tools/make-icons.py`.
