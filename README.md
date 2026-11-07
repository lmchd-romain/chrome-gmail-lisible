# Gmail Lisible

Extension Chrome qui rend Gmail plus lisible.

## Ce qu'elle fait

**Dans les conversations**

- **Déplie tous les messages**, y compris les « N messages plus anciens ». La conversation s'affiche directement dépliée, sans passer par l'état replié. Si vous repliez un message ensuite, il reste replié.
- **Masque le bouton « Afficher le contenu abrégé »** (les trois petits points « ••• ») sous les messages et dans la zone où vous écrivez votre réponse.
- **Masque l'historique déjà lu** : quand une réponse recopie toute la conversation précédente, la partie recopiée est cachée si elle est déjà affichée plus haut. Si vous n'aviez jamais reçu ces anciens messages (ajouté en copie en cours de route, par exemple), ils restent affichés, même si Gmail les avait cachés derrière « ••• ».
- **Une seule signature par e-mail** : quand la même signature est empilée plusieurs fois dans un e-mail (une par réponse), une seule reste visible.
- **Masque les noms de fichiers** du type `<BEAR_Rennes_6mm.dxf><BEAR_Rennes_6mm.pdf>` qu'Apple Mail ajoute dans le texte des réponses.
- **Conversation inversée** (désactivée par défaut) : le dernier message en haut, le premier en bas. La réponse et les boutons « Répondre / Transférer » passent tout en haut, et la conversation s'ouvre en haut. La réponse pop-up marche alors dans l'autre sens (pop-up en descendant, retour en remontant).
- **Réponse en fenêtre pop-up** : après un clic sur « Répondre », si vous remontez pour relire la conversation, la réponse passe dans la fenêtre pop-up de Gmail (la vraie). Quand vous redescendez et que sa place réapparaît à l'écran, elle revient dans la conversation (Gmail garde votre texte en brouillon). Un petit mouvement vers le haut ne la renvoie pas en pop-up : il faut vraiment remonter.

**Pièces jointes**

- **Au-dessus du message** : elles s'affichent avant le texte.
- **Compactes** : une ligne par fichier (icône, nom, taille, Télécharger, Drive), sans les grands aperçus. Un clic sur le nom ouvre l'aperçu de Gmail.
- **Toutes regroupées** : en haut des longues conversations, la liste de toutes les pièces jointes, avec l'expéditeur, la date et un bouton pour aller au message d'origine.

**Dans la boîte de réception** (et les libellés, recherches…)

- **Séparateurs de dates** entre les e-mails, sauf dans la section « Messages suivis ». Deux modes au choix :
  - *Chaque jour* : « Aujourd'hui », « Hier », « 04/11 », « 03/11 »…
  - *Regrouper* : « Aujourd'hui », « Hier », « Cette semaine », « Semaine dernière », « Octobre »…

**Réglages** : dans Gmail, ⚙️ → *Voir tous les paramètres* → onglet **Personnalisation** (ou icône de l'extension → *Ouvrir les réglages*). Chaque fonction s'active ou se désactive, les changements s'appliquent tout de suite.

## Installation (5 minutes)

1. **Télécharger** : [chrome-gmail-lisible-main.zip](https://github.com/lmchd-romain/chrome-gmail-lisible/archive/refs/heads/main.zip) (en étant connecté à GitHub).
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

- **Page de 100 e-mails** : Gmail affiche 50 e-mails par page. Pour en voir plus d'un coup : Gmail → ⚙️ → *Voir tous les paramètres* → *Général* → *Taille maximale de la page* → **100** (maximum permis par Gmail) → *Enregistrer*.
- L'extension ne fonctionne que sur `mail.google.com`. Elle n'envoie aucune donnée nulle part : tout se passe dans votre navigateur. Elle demande seulement le droit d'enregistrer vos réglages et de copier le diagnostic.
- Contenu abrégé masqué : pour revoir exceptionnellement un texte cité, désactivez le réglage le temps de le lire.
- **Un souci ?** Gmail modifie parfois sa page. Ouvrez la page Gmail concernée, cliquez sur l'icône de l'extension, puis **Copier un diagnostic**, et collez le résultat dans la discussion. Le diagnostic décrit la structure de la page, sans le contenu de vos e-mails.

## Pour les développeurs

- Code de l'extension : `extension/` (Manifest V3, sans étape de compilation).
- Tests : `npm test` (tests des dates + test de bout en bout dans Chromium avec Playwright, sur de fausses pages Gmail dans `tests/fixtures/`).
- Icônes : `python3 tools/make-icons.py`.
