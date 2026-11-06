/*
 * Réglages par défaut de Gmail Lisible.
 * Partagés par la fenêtre de réglages (popup) et le script injecté dans Gmail.
 */
(function (root) {
  'use strict';

  root.GL_DEFAULTS = Object.freeze({
    autoExpand: true, // Déplier tous les messages d'une conversation
    hideTrimmedButton: true, // Masquer le bouton « Afficher le contenu abrégé »
    hideAttachmentPlaceholders: true, // Masquer les « <fichier.pdf> » sous le contenu abrégé
    floatingReply: true, // Réponse flottante quand on remonte la conversation
    daySeparators: true, // Séparateurs de dates dans les listes d'e-mails
    daySeparatorMode: 'day', // 'day' = un séparateur par jour, 'group' = regroupé (Cette semaine…)
  });
})(globalThis);
