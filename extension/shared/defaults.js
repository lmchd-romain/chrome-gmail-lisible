/*
 * Réglages par défaut de Gmail Lisible.
 * Partagés par la fenêtre de réglages (popup) et le script injecté dans Gmail.
 */
(function (root) {
  'use strict';

  root.GL_DEFAULTS = Object.freeze({
    autoExpand: true, // Déplier tous les messages d'une conversation
    hideTrimmedButton: true, // Masquer le bouton « Afficher le contenu abrégé » (messages et réponse)
    hideAttachmentPlaceholders: true, // Masquer les « <fichier.pdf> » laissés par Apple Mail
    hideQuotedHistory: true, // Masquer les anciens messages recopiés dans les réponses (s'ils sont déjà plus haut)
    hideRepeatedSignatures: true, // Une seule signature par e-mail (signatures empilées)
    floatingReply: true, // Réponse dans la fenêtre pop-up de Gmail quand on remonte la conversation
    dockReplyAtBottom: true, // … et la remettre en place quand on redescend tout en bas
    daySeparators: true, // Séparateurs de dates dans les listes d'e-mails
    daySeparatorMode: 'day', // 'day' = un séparateur par jour, 'group' = regroupé (Cette semaine…)
    infiniteScroll: true, // Défilement continu : page suivante / précédente en faisant défiler
    attachmentsOnTop: true, // Pièces jointes au-dessus du texte du message
    attachmentsCompact: true, // Pièces jointes en lignes compactes (sans grandes vignettes)
    attachmentsSummary: true, // Toutes les pièces jointes en haut des longues conversations
  });
})(globalThis);
