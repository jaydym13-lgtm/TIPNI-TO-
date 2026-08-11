// =========================================================================
// 🚀 TIPNI TO! - CHANGELOG & NEWS ENGINE (changelog.js)
// =========================================================================

export const CHANGELOG = [
    {
        id: '2026-08-11-2050',
        datetime: '2026-08-11 20:50',
        type: 'IMPROVEMENT', // 'FEATURE' (Novinka) | 'IMPROVEMENT' (Vylepšení) | 'FIX' (Oprava) | 'SECURITY' (Bezpečnost)
        title: 'Nový vizuál výběru tipovačky',
        desc: 'Stránka všechny tipovačky" dostala nový design. U každé ligy se ukazuje počet aktivních hráčů.'
    },
    {
        id: '2026-08-11-1915',
        datetime: '2026-08-11 19:15',
        type: 'FEATURE',
        title: 'Osobní zvýraznění v žebříčku',
        desc: 'Tvé jméno je teď v tabulce pořadí jasně zvýrazněno smaragdově zelenou barvou, abys se hned našel!'
    },
    {
        id: '2026-08-11-1800',
        datetime: '2026-08-11 18:00',
        type: 'SECURITY',
        title: 'Ochrana dlouhodobých tipů',
        desc: 'Dlouhodobé tipy na vítěze a střelce jsou až do výkopu 1. zápasu sezóny skryté před ostatními hráči.'
    },
    {
        id: '2026-08-11-0920',
        datetime: '2026-08-11 09:20',
        type: 'IMPROVEMENT',
        title: 'Návod na instalaci pro iPhone (iOS)',
        desc: 'Přidán návod pro uložení tipovačky na plochu iPhonu.'
    },
    {
        id: '2026-08-11-0830',
        datetime: '2026-08-11 08:30',
        type: 'FIX',
        title: 'Oprava ukládání přezdívky',
        desc: 'Oprava zabezpečení prvního zápisu hráče a uložení přezdívky hráče.'
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