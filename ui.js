// =========================================================================
// 📱 TIPNI TO! - MODULÁRNÍ GLOBÁLNÍ UI ENGINE V1.0.0 (ui.js)
// =========================================================================

// 1. CENTRÁLNÍ TOAST SYSTÉM
export const showToast = (text, isError = false) => {
    const toast = document.getElementById('toastMsg');
    const toastText = document.getElementById('toastText');
    if (!toast || !toastText) return;

    toast.className = 'toast'; 
    toastText.innerText = text;

    if (isError) toast.classList.add('toast-error');
    toast.classList.add('show');

    setTimeout(() => { toast.classList.remove('show'); }, 2500);
};

// 2. DETEKCE INTERNETOVÉHO SPOJENÍ (ONLINE / OFFLINE)
export const inicializujNetworkStatusBadge = () => {
    let badge = document.querySelector('.status-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'status-badge';
        document.body.appendChild(badge);
    }

    const aktualizujStavSiete = () => {
        if (navigator.onLine) {
            badge.className = 'status-badge status-online';
            badge.innerHTML = `<span class="status-dot"></span> Online`;
            setTimeout(() => { badge.style.opacity = '0'; }, 3000);
        } else {
            badge.style.opacity = '1';
            badge.className = 'status-badge status-offline';
            badge.innerHTML = `<span class="status-dot"></span> Jsi offline!`;
        }
    };

    window.addEventListener('online', () => { badge.style.opacity = '1'; aktualizujStavSiete(); });
    window.addEventListener('offline', aktualizujStavSiete);
    aktualizujStavSiete();
};

// 3. AUTOMATICKÝ DARK MODE
export const inicializujDarkMode = () => {
    const preferencesTma = window.matchMedia('(prefers-color-scheme: dark)');
    const aplikujMod = (chceTmu) => {
        if (chceTmu) document.body.classList.add('dark-mode');
        else document.body.classList.remove('dark-mode');
    };
    aplikujMod(preferencesTma.matches);
    preferencesTma.addEventListener('change', e => aplikujMod(e.matches));
};

// 👁️ CENTRÁLNÍ UI KOMPONENT PRO GLOBÁLNÍ MODÁLNÍ OKNA
export const openGlobalUiModal = (title, contentHtml) => {
    const staryOverlay = document.querySelector('.spy-modal-overlay');
    if (staryOverlay) staryOverlay.remove();

    const overlay = document.createElement('div');
    overlay.className = 'spy-modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    
    overlay.innerHTML = `
        <div class="spy-modal-box">
            <div class="spy-modal-header">
                <h3>📋 ${title}</h3>
                <button class="spy-modal-close" onclick="this.closest('.spy-modal-overlay').remove()">✕</button>
            </div>
            <div class="spy-modal-body">
                ${contentHtml}
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
};

// 🛡️ GLOBÁLNÍ SANITIZAČNÍ ŠTÍT (Anti-XSS)
export const escapeHTML = (str) => {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

// 🪐 GLOBÁLNÍ SMRŠŤOVACÍ ENGINE PRO SPLASH SCREEN
export const setSplashText = (text) => {
    const subtitle = document.getElementById('splashSubtitle');
    if (subtitle) subtitle.innerText = text;
};

export const hideSplash = () => {
    const splash = document.getElementById('splashScreen');
    if (splash) splash.classList.add('hidden');
};

export const showSplash = (text = "Načítání...") => {
    const splash = document.getElementById('splashScreen');
    if (splash) {
        splash.classList.remove('hidden');
        setSplashText(text);
    }
};

// 🧠 BACKWARD BINDING COMPATIBILITY WRAPPER: Ponecháme vazby na window objektu, aby zbytek aplikace před plným přeimportováním nespadl
window.showToast = showToast;
window.inicializujDarkMode = inicializujDarkMode;
window.openGlobalUiModal = openGlobalUiModal;
window.escapeHTML = escapeHTML;
window.setSplashText = setSplashText;
window.hideSplash = hideSplash;
window.showSplash = showSplash;

// Bezpečné spuštění asistentů nezávisle na momentu dokončení načítání modulárního stromu scriptů
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        inicializujNetworkStatusBadge();
        inicializujDarkMode();
    });
} else {
    inicializujNetworkStatusBadge();
    inicializujDarkMode();
}
console.log("📱 UI Asistent úspěšně upgradován na stabilní ES6 modul.");