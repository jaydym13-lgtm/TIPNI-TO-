// =========================================================================
// 🚀 TIPNI TO! - CHANGELOG & NEWS ENGINE (changelog.js)
// =========================================================================

export const CHANGELOG = [
    {
        id: '2026-08-11-1915',
        datetime: '2026-08-11 19:15',
        type: 'FEATURE', // 'FEATURE' (Novinka) | 'IMPROVEMENT' (Vylepšení) | 'FIX' (Oprava) | 'SECURITY' (Bezpečnost)
        title: 'Osobní zvýraznění v žebříčku',
        desc: 'Tvé jméno je teď v tabulce pořadí jasně zvýrazněno smaragdově zelenou barvou, abys se hned našel!'
    },
    {
        id: '2026-08-11-1800',
        datetime: '2026-08-11 18:00',
        type: 'SECURITY',
        title: 'Ochrana dlouhodobých tipů',
        desc: 'Dlouhodobé tipy na vítěze a střelce jsou až do výkopu 1. zápasu skryté před ostatními.'
    },
    {
        id: '2026-08-11-1200',
        datetime: '2026-08-11 12:00',
        type: 'IMPROVEMENT',
        title: 'Návod na instalaci pro iPhone (iOS)',
        desc: 'Přidali jsme přehledný obrázkový návod krok za krokem pro snadné uložení tipovačky na plochu iPhonu.'
    }
];

// ⏱️ FORMÁTOVAČ LIDSKÉHO ČASU (Dnes v HH:MM / Včera v HH:MM / DD. MM. YYYY v HH:MM)
export const formatChangelogDate = (dateStr) => {
    if (!dateStr) return '–';
    const d = new Date(dateStr.replace(' ', 'T'));
    if (isNaN(d.getTime())) return dateStr;

    const nyni = new Date();
    const dnesPolnoc = new Date(nyni.getFullYear(), nyni.getMonth(), nyni.getDate());
    const vceraPolnoc = new Date(dnesPolnoc);
    vceraPolnoc.setDate(vceraPolnoc.getDate() - 1);

    const hrs = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    const cas = `${hrs}:${mins}`;

    if (d >= dnesPolnoc) {
        return `Dnes v ${cas}`;
    } else if (d >= vceraPolnoc) {
        return `Včera v ${cas}`;
    } else {
        const den = String(d.getDate()).padStart(2, '0');
        const mesic = String(d.getMonth() + 1).padStart(2, '0');
        const rok = d.getFullYear();
        return `${den}. ${mesic}. ${rok} v ${cas}`;
    }
};

// 🧹 AUTOMATICKÝ FILTR ZPRÁV ZA POSLEDNÍCH 30 DNÍ (SEŘAZENO OD NEJNOVĚJŠÍ)
export const getActiveChangelog = () => {
    const nyni = Date.now();
    const tricetDniMs = 30 * 24 * 60 * 60 * 1000;

    return CHANGELOG
        .filter(item => {
            const itemMs = new Date(item.datetime.replace(' ', 'T')).getTime();
            return !isNaN(itemMs) && (nyni - itemMs) <= tricetDniMs;
        })
        .sort((a, b) => new Date(b.datetime.replace(' ', 'T')) - new Date(a.datetime.replace(' ', 'T')));
};