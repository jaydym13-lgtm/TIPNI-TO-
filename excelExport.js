// =========================================================================
// 📊 EXCEL EXPORT ENGINE (excelExport.js)
// Plně modulární, lazy-loaded (0 kB zátěž při startu aplikace)
// =========================================================================

const nactiExcelJS = () => {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
        script.onload = () => resolve(window.ExcelJS);
        script.onerror = () => reject(new Error('Nelze načíst knihovnu ExcelJS ze sítě.'));
        document.head.appendChild(script);
    });
};

window.exportujTabulkuPoradiExcel = async () => {
    const store = window.Alpine?.store('appState');
    const leagueName = store?.selectedLeague || 'Tipsport Extraliga';
    const centralDoc = store?.leaderboardData;

    if (!centralDoc || (!centralDoc.zebricek && !centralDoc.zebricekLive)) {
        if (typeof window.showToast === 'function') {
            window.showToast("Žebříček zatím nemá načtená data pro export ❌", true);
        }
        return;
    }

    if (typeof window.showToast === 'function') {
        window.showToast("⏳ Připravuji Excel sešit podle šablony...", false);
    }

    try {
        // 🚀 LAZY LOADING: Knihovna se stáhne až teď
        const ExcelJS = await nactiExcelJS();

        // 1. Načtení šablony ze statické složky projektu
        const response = await fetch('/templates/sablona_poradi.xlsx?t=' + Date.now());
        if (!response.ok) {
            throw new Error("Šablona 'templates/sablona_poradi.xlsx' nebyla nalezena ve složce templates/.");
        }
        const templateBuffer = await response.arrayBuffer();

        // 2. Otevření šablony se zachováním stylů
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(templateBuffer);
        const worksheet = workbook.worksheets[0] || workbook.getWorksheet(1);

        if (!worksheet) {
            throw new Error("V šabloně nebyl nalezen žádný list.");
        }

        // 3. Výběr žebříčku (Total vs. Live)
        const tab = window.leaderboardActiveTab || 'total';
        const zebricek = (tab === 'live' && centralDoc.zebricekLive) ? centralDoc.zebricekLive : (centralDoc.zebricek || []);

        let aktualniPoradiCislo = 1;

        // 4. Propis hráčů do řádků 3 až 26
        zebricek.forEach((stats, index) => {
            const rNum = 3 + index;
            const row = worksheet.getRow(rNum);

            if (index > 0) {
                const prev = zebricek[index - 1];
                const jeUplnaShoda = (
                    stats.celkemBodu === prev.celkemBodu &&
                    (stats.presneVysledkyCount || 0) === (prev.presneVysledkyCount || 0) &&
                    (stats.presneTopMatchesCount || 0) === (prev.presneTopMatchesCount || 0) &&
                    (stats.spravneTendenceCount || 0) === (prev.spravneTendenceCount || 0) &&
                    (stats.nenatipovaneVyhodnocene || 0) === (prev.nenatipovaneVyhodnocene || 0) &&
                    (stats.vyhranaKolaCount || 0) === (prev.vyhranaKolaCount || 0) &&
                    (stats.nejviceBoduVKole || 0) === (prev.nejviceBoduVKole || 0)
                );
                if (!jeUplnaShoda) {
                    aktualniPoradiCislo = index + 1;
                }
            } else {
                aktualniPoradiCislo = 1;
            }

            const cistiBonus = (val) => {
                if (!val || typeof val !== 'string' || val.includes('SKRYTO')) return '';
                return val.trim();
            };

            row.getCell(2).value = `${aktualniPoradiCislo}.`;
            row.getCell(3).value = stats.nickname || 'Hráč';
            row.getCell(4).value = cistiBonus(stats.vitezMs);
            row.getCell(5).value = cistiBonus(stats.nejStrelec);
            row.getCell(6).value = cistiBonus(stats.nejKanadske || stats.kanadske);
           row.getCell(7).value = stats.natipovanaKola ?? 0;
            row.getCell(8).value = stats.nenatipovanaKola ?? 0;
            row.getCell(9).value = stats.presneVysledkyCount ?? 0;
            row.getCell(10).value = stats.presneTopMatchesCount ?? 0;
            row.getCell(11).value = stats.nejviceBoduVKole ?? 0;
            row.getCell(12).value = stats.celkemBodu ?? 0;

            row.commit();
        });

        // 5. Vygenerování a stažení
        const outBuffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([outBuffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        const safeLeague = String(leagueName).replace(/[^a-zA-Z0-9]/g, '_');
        const fileName = `Poradi_${safeLeague}_${new Date().toISOString().split('T')[0]}.xlsx`;

        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(downloadUrl);

        if (typeof window.showToast === 'function') {
            window.showToast("📊 Tabulka pořadí v Excelu úspěšně stažena!");
        }
    } catch (err) {
        console.error("Chyba exportu do Excelu:", err);
        if (typeof window.showToast === 'function') {
            window.showToast(`❌ ${err.message || "Export selhal"}`, true);
        }
    }
};