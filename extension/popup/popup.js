/* Fenêtre de l'icône : ouvre l'onglet « Personnalisation » dans Gmail + diagnostic. */
(function () {
  'use strict';

  const GMAIL_SETTINGS = 'https://mail.google.com/mail/u/0/#settings/general';

  document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;

  /** Envoie un message aux onglets Gmail (l'onglet actif d'abord) ; renvoie le premier qui répond. */
  async function askGmail(message) {
    const active = await chrome.tabs.query({ active: true, currentWindow: true });
    const others = await chrome.tabs.query({});
    for (const tab of [...active, ...others]) {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, message);
        if (res && res.ok) return { tab, res };
      } catch (err) {
        // pas un onglet Gmail
      }
    }
    return null;
  }

  // ---------- Ouvrir les réglages ----------

  document.getElementById('open').addEventListener('click', async () => {
    const found = await askGmail({ type: 'glx-open-settings' });
    if (found) {
      await chrome.tabs.update(found.tab.id, { active: true });
      await chrome.windows.update(found.tab.windowId, { focused: true });
    } else {
      // Aucun Gmail ouvert : nouvel onglet, qui ouvrira « Personnalisation » en arrivant.
      await chrome.storage.local.set({ glxOpenSettings: Date.now() });
      await chrome.tabs.create({ url: GMAIL_SETTINGS });
    }
    window.close();
  });

  // ---------- Diagnostic ----------

  const diagStatus = document.getElementById('diag-status');
  const diagText = document.getElementById('diag-text');

  document.getElementById('diag').addEventListener('click', async () => {
    diagStatus.textContent = '…';
    const found = await askGmail({ type: 'glx-diagnostic' });
    const text = found && found.res.text;
    if (!text) {
      diagStatus.textContent = "Ouvrez Gmail dans l'onglet actif, rechargez-le, puis réessayez.";
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      diagStatus.textContent = 'Copié ! Collez-le dans la discussion.';
      diagText.hidden = true;
    } catch (err) {
      diagStatus.textContent = 'Copie impossible : sélectionnez le texte ci-dessous.';
      diagText.hidden = false;
      diagText.value = text;
      diagText.select();
    }
  });
})();
