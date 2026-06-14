// =========================================================================
// 📱 TIPNI TO! - GLOBÁLNÍ UI, TOASTY A SÍŤOVÉ BADGES (ui.js)
// =========================================================================

// 1. CENTRÁLNÍ TOAST SYSTÉM
// Sjednocuje zobrazení hlášek napříč celou aplikací, abychom to nemuseli psát ručně
window.showToast = (text, isError = false) => {
    const toast = document.getElementById('toastMsg');
    const toastText = document.getElementById('toastText');
    
    if (!toast || !toastText) return;

    // Reset předchozích stavů
    toast.className = 'toast'; 
    toastText.innerText = text;

    if (isError) {
        toast.classList.add('toast-error');
    }
    
    // Zobrazení pomocí tvé CSS třídy
    toast.classList.add('show');

    // Automatické skrytí po 2.5 sekundách
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2500);
};

// 2. DETEKCE INTERNETOVÉHO SPOJENÍ (ONLINE / OFFLINE)
// Automaticky injektuje a mění status badge v levém dolním rohu podle stavu sítě
const inicializujNetworkStatusBadge = () => {
    // Vytvoříme badge prvek dynamically, pokud v HTML chybí
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
            // Po 3 sekundách online badge diskrétně schováme, ať nezavází
            setTimeout(() => { badge.style.opacity = '0'; }, 3000);
        } else {
            badge.style.opacity = '1';
            badge.className = 'status-badge status-offline';
            badge.innerHTML = `<span class="status-dot"></span> Jsi offline!`;
        }
    };

    // Nasadíme posluchače na prohlížeč
    window.addEventListener('online', () => { badge.style.opacity = '1'; aktualizujStavSiete(); });
    window.addEventListener('offline', aktualizujStavSiete);

    // První spuštění při načtení appky
    aktualizujStavSiete();
};

// 3. AUTOMATICKÝ / RUČNÍ DARK MODE
// Kontrola systémového nastavení telefonu + příprava pro případné tlačítko
window.inicializujDarkMode = () => {
    const preferencesTma = window.matchMedia('(prefers-color-scheme: dark)');
    
    const aplikujMod = (chceTmu) => {
        if (chceTmu) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
    };

    // Načteme výchozí stav podle systému uživatele
    aplikujMod(preferencesTma.matches);

    // Reagujeme živě, pokud uživatel přepne systémové téma v nastavení mobilu
    preferencesTma.addEventListener('change', e => aplikujMod(e.matches));
};

// Spuštění UI asistentů hned po načtení DOMu
document.addEventListener('DOMContentLoaded', () => {
    inicializujNetworkStatusBadge();
    window.inicializujDarkMode();
    console.log("📱 UI Asistent (Sítě, Toasty a Témata) inicializován.");
});

// 👁️ GLOBÁLNÍ MODAL PRO PROHLÍŽENÍ TIPŮ SOUPEŘŮ (ANTI-CHEAT ZAJIŠTĚNO)
window.showSpyModal = (matchId, matchTitle) => {
    const content = window.spyModalsRegistry ? window.spyModalsRegistry[matchId] : '';
    
    const overlay = document.createElement('div');
    overlay.className = 'spy-modal-overlay';
    
    // Kliknutím na ztmavené pozadí mimo okno se popup bezpečně zavře
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    
    overlay.innerHTML = `
        <div class="spy-modal-box">
            <div class="spy-modal-header">
                <h3>📋 Tipy: ${matchTitle}</h3>
                <button class="spy-modal-close" onclick="this.closest('.spy-modal-overlay').remove()">✕</button>
            </div>
            <div class="spy-modal-body">
                ${content || '<div style="color:#6b7280; font-size:0.85rem; text-align:center; padding:15px 0;">Žádné tipy k zobrazení.</div>'}
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
};