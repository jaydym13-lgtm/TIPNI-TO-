// =========================================================================
// 🚀 TIPNI TO! - CHANGELOG & NEWS ENGINE (changelog.js)
// =========================================================================

export const CHANGELOG = [
    {
        id: '2026-08-21-2335',
        datetime: '2026-08-21 22:50',
        type: 'FIX',
        title: '🛠️ Omluva za nefunkčnost LIVE funkcí',
        desc: 'Omlouvám se za dnešní komplikace a záseky během zápasu! Zítra si ověříme zdali se mi podařilo všechny LIVE funkce a přechody stavů v aplikaci úspěšně vyřešit a vyladit.'
    },
    {
        id: '2026-08-17-2130',
        datetime: '2026-08-17 22:00',
        type: 'FEATURE',
        title: '🌐 Přihlášení a registrace přes Google a propojení účtu',
        desc: 'Už žádné zdlouhavé vypisování e-mailu a hesla! Nově se přihlásíš nebo zaregistruješ přes Google. Pokud už v tipovačce účet máš (metoda e-mail a heslo), v bočním menu si ho můžeš s Googlem jednoduše propojit a příště vstupovat bez vyplňování údajů. Navíc přihlašovací stránka dostala nový kabát.'
    },
    {
        id: '2026-08-14-2220',
        datetime: '2026-08-14 22:20',
        type: 'FEATURE',
        title: '🏆 Startuje Tipni Chance Cup – Boj o pohárovou trofej!',
        desc: 'I když ti zrovna uteče čelo tabulky, sezóna pro tebe nekončí! Spouštíme paralelní turnaj, který běží 100% automaticky z tvých běžných ligových tipů. Po podzimní kvalifikaci a 4 základních skupinách (12.–18. kolo) tě na jaře čeká neúprosný vyřazovací pavouk a K.O. duely na odvety. Budeš první kdo získá tohle ocenění?'
    },
    {
        id: '2026-08-13-1920',
        datetime: '2026-08-13 19:30',
        type: 'FEATURE',
        title: '⚔️ Nový H2H Duel – Porovnej se s kámošem!',
        desc: 'Rozbal kartu soupeře v žebříčku a klepni na ⚔️ POROVNAT SE MNOU! Získáš okamžité srovnání několika statistik – porovná např průměrný počet branek na zápas, vzájemné skóre po kolech, úspěšnost i zápasy, kde jste tipli úplný opak.'
    },
    {
        id: '2026-08-13-1630',
        datetime: '2026-08-13 17:30',
        type: 'FEATURE',
        title: 'Nový kokpit rekordů a statistik',
        desc: 'V roletce statistik přibyly nové trofeje: Hráč kola (počet vyhraných kol), Přesné TOP zápasy, Trefené tendence a exkluzivní zlatá karta za Perfektní tipnuté celé kolo.'
    },
    {
        id: '2026-08-13-1540',
        datetime: '2026-08-13 15:40',
        type: 'IMPROVEMENT',
        title: 'Vylepšená karta hráče a úprava Chance Ligy',
        desc: 'Rozbalená karta hráče má teď mřížku 10 statistik. Pro Chance Ligu je schovaný nadbytečný Tip na vítěze.'
    },
    {
        id: '2026-08-13-1015',
        datetime: '2026-08-13 10:15',
        type: 'IMPROVEMENT',
        title: 'Vylepšený detail historie tipů hráče',
        desc: 'V modálním okně historie tipů je přidáno automatické zmenšování dlouhých názvů týmů na míru, označení ikonou 🔥 u TOP zápasů a zlaté zvýraznění u přesně trefených výsledků.'
    },
    {
        id: '2026-08-12-2200',
        datetime: '2026-08-12 22:00',
        type: 'FEATURE',
        title: 'Import výsledků Chance ligy',
        desc: 'Podařilo se nahrát výsledky z Chance ligy, získané od Švěri.'
    },
    {
        id: '2026-08-12-2145',
        datetime: '2026-08-12 21:45',
        type: 'IMPROVEMENT',
        title: 'Vylepšený náhled historie tipů',
        desc: 'Modální okno s historií tipů hráče má teď stejné přepínání kol jako např. program utkání. Až bude odehráno více kol, eliminuje se zdlouhavé scrolovaní.'
    },
    {
        id: '2026-08-11-2050',
        datetime: '2026-08-11 20:50',
        type: 'IMPROVEMENT',
        title: 'Nový vizuál výběru tipovačky',
        desc: 'Stránka "Všechny tipovačky" dostala nový design. U každé ligy se ukazuje počet aktivních hráčů.'
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