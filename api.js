// =========================================================================
// 📡 TIPNI TO! - INTEGRACE API (api.js) - ZDROJ: FOOTBALL-DATA.ORG
// =========================================================================

// TLAČÍTKO A: Stažení rozpisu zápasů naostro z internetu
window.importMatchesFromApi = async () => {
    const apiKey = document.getElementById('api-key-input').value.trim();
    const leagueId = document.getElementById('api-league-id-input').value.trim();

    if (!apiKey || !leagueId) {
        alert("⚠️ Chyba: Pro stažení rozpisu musíš nejprve vyplnit API Klíč i ID ligy!");
        return;
    }

    const store = Alpine.store('appState');
    const activeAdminLeague = store ? store.selectedAdminLeague : "MS ve fotbale";

    console.log(`📡 Startuji stahování zápasů pro ligu: ${activeAdminLeague} (API ID: ${leagueId})...`);

    try {
        const response = await fetch(`https://corsproxy.io/?https://api.football-data.org/v4/competitions/${leagueId}/matches`, {
            method: "GET",
            headers: {
                "X-Auth-Token": apiKey
            }
        });

        if (!response.ok) {
            throw new Error(`Server vrátil chybu: ${response.status} (${response.statusText})`);
        }

        const data = await response.json();
        const matches = data.matches || [];

        // SLOVNÍK PRO 48 ÚČASTNÍKŮ MS 2026
        const slovnikTymu = {
            "Czech Republic": "Česko", "Czechia": "Česko", "Mexico": "Mexiko",
            "South Korea": "Jižní Korea", "Korea Republic": "Jižní Korea", "South Africa": "JAR",
            "Bosnia and Herzegovina": "Bosna", "Bosnia": "Bosna", "Bosnia-Herzegovina": "Bosna",
            "Canada": "Kanada", "Qatar": "Katar", "Switzerland": "Švýcarsko",
            "Brazil": "Brazílie", "Haiti": "Haiti", "Morocco": "Maroko", "Scotland": "Skotsko",
            "Australia": "Austrálie", "Paraguay": "Paraguay", "Turkey": "Turecko", "Türkiye": "Turecko",
            "USA": "USA", "United States": "USA", "Curaçao": "Curaçao", "Curacao": "Curaçao",
            "Ecuador": "Ekvádor", "Germany": "Německo", "Ivory Coast": "Pob. slonoviny", "Côte d'Ivoire": "Pob. slonoviny",
            "Japan": "Japonsko", "Netherlands": "Nizozemsko", "Sweden": "Švédsko", "Tunisia": "Tunisko",
            "Belgium": "Belgie", "Egypt": "Egypt", "Iran": "Írán", "New Zealand": "Nový Zéland",
            "Cape Verde": "Kapverdy", "Cabo Verde": "Kapverdy", "Cape Verde Islands": "Kapverdy",
            "Saudi Arabia": "Saúdská Arábie", "Spain": "Španělsko", "Uruguay": "Uruguay",
            "France": "Francie", "Iraq": "Irák", "Norway": "Norsko", "Senegal": "Senegal",
            "Algeria": "Alžírsko", "Argentina": "Argentina", "Austria": "Rakousko", "Jordan": "Jordánsko",
            "Portugal": "Portugalsko", "Uzbekistan": "Uzbekistán", "Colombia": "Kolumbie",
            "DR Congo": "Kongo", "Congo DR": "Kongo", "Croatia": "Chorvatsko", "England": "Anglie",
            "Ghana": "Ghana", "Panama": "Panama"
        };

        let nověPřidáno = 0;
        let aktualizovano = 0;

        for (const match of matches) {
            const apiId = match.id;

            const anglickyDomaci = match.homeTeam.name;
            const anglickyHoste = match.awayTeam.name;
            const ceskyDomaci = slovnikTymu[anglickyDomaci] || anglickyDomaci;
            const ceskyHoste = slovnikTymu[anglickyHoste] || anglickyHoste;

            // NOVÁ CESTA: Kontrola duplicity míří přímo do podsložky zápasů vybrané ligy
            const checkDuplicate = await db.collection('ligy').doc(activeAdminLeague).collection('zapasy')
                .where('apiMatchId', '==', apiId)
                .get();

            let urceneKolo = 0;
            if (match.stage === "GROUP_STAGE") {
                if (match.matchday === 1) urceneKolo = 1;
                else if (match.matchday === 2) urceneKolo = 2;
                else if (match.matchday === 3) urceneKolo = 3;
            } else if (match.stage === "LAST_32" || match.stage === "LAST_16" || match.stage === "ROUND_OF_32" || match.stage === "ROUND_OF_16") {
                urceneKolo = 4;
            }

            if (checkDuplicate.empty) {
                const jePlayoff = match.stage !== "GROUP_STAGE";

                // NOVÁ CESTA: Založení zápasu přímo pod ligu s inteligentním označením herního kola
                await db.collection('ligy').doc(activeAdminLeague).collection('zapasy').add({
                    domaci: ceskyDomaci,
                    hoste: ceskyHoste,
                    datum: firebase.firestore.Timestamp.fromDate(new Date(match.utcDate)),
                    isPlayoff: jePlayoff,
                    apiMatchId: apiId,
                    kolo: urceneKolo
                });
                nověPřidáno++;
            } else {
                const existujiciDocId = checkDuplicate.docs[0].id;
                
                // NOVÁ CESTA: Aktualizace zápasu přímo pod ligou (udržuje herní kola synchronizovaná)
                await db.collection('ligy').doc(activeAdminLeague).collection('zapasy').doc(existujiciDocId).update({
                    domaci: ceskyDomaci,
                    hoste: ceskyHoste,
                    datum: firebase.firestore.Timestamp.fromDate(new Date(match.utcDate)),
                    kolo: urceneKolo
                });
                aktualizovano++;
            }
        }

        if (window.renderAdminMatches) {
            window.renderAdminMatches();
        }

        window.showToast(`📡 API Sync: Importováno ${nověPřidáno} novinek, aktualizováno ${aktualizovano} časů.`);

    } catch (e) {
        console.error("❌ Kritická chyba sítě:", e);
        alert("💥 Selhalo internetové spojení: " + e.message);
    }
};

// TLAČÍTKO B: Aktualizace výsledků naostro z internetu do Firebase
window.updateResultsFromApi = async () => {
    const apiKey = document.getElementById('api-key-input').value.trim();
    const leagueId = document.getElementById('api-league-id-input').value.trim();

    if (!apiKey || !leagueId) {
        alert("⚠️ Chyba: Pro kontrolu výsledků musíš vyplnit API Klíč i ID ligy!");
        return;
    }

    const store = Alpine.store('appState');
    const activeAdminLeague = store ? store.selectedAdminLeague : "MS ve fotbale";

    console.log(`📡 Startuji kontrolu dohraných zápasů pro ligu: ${activeAdminLeague}...`);

    try {
        const response = await fetch(`https://corsproxy.io/?https://api.football-data.org/v4/competitions/${leagueId}/matches`, {
            method: "GET",
            headers: {
                "X-Auth-Token": apiKey
            }
        });

        if (!response.ok) {
            throw new Error(`Server vrátil chybu: ${response.status} (${response.statusText})`);
        }

        const data = await response.json();
        const matches = data.matches || [];

        let aktualizovanoZapasu = 0;

        for (const match of matches) {
            const apiId = match.id;

            // 🛠️ CHYTRÁ OPRAVA: Posloucháme jak konec zápasu (FINISHED), tak běžící LIVE přenos (IN_PLAY)
            const jeZapasAktivni = match.status === "FINISHED" || match.status === "IN_PLAY";
            const maNacteneGoly = match.score?.fullTime?.home !== null && match.score?.fullTime?.away !== null;

            if (jeZapasAktivni && maNacteneGoly) {
                const golyDomaci = parseInt(match.score.fullTime.home);
                const golyHoste = parseInt(match.score.fullTime.away);

                // NOVÁ CESTA: Hledáme zápas v podsložce vybrané ligy
                const snapshot = await db.collection('ligy').doc(activeAdminLeague).collection('zapasy')
                    .where('apiMatchId', '==', apiId)
                    .get();

                if (!snapshot.empty) {
                    const docId = snapshot.docs[0].id;
                    const firebaseMatchData = snapshot.docs[0].data();

                    // 🔒 JEDNOSMĚRNÝ ZÁMEK: Pokud zápas v DB už jednou skončil (FINISHED), nenecháme ho přepsat zpět na LIVE (IN_PLAY)
                    if (firebaseMatchData.apiStatus === "FINISHED" && match.status === "IN_PLAY") {
                        continue;
                    }

                    // 🛠️ CHYTRÁ OPRAVA: Reagujeme na změnu skóre NEBO na změnu statusu (např. z LIVE na FINISHED)
                    if (firebaseMatchData.vysledek_domaci !== golyDomaci || 
                        firebaseMatchData.vysledek_hoste !== golyHoste || 
                        firebaseMatchData.apiStatus !== match.status) {
                        
                        let postupVal = "";
                        if (firebaseMatchData.isPlayoff && golyDomaci === golyHoste) {
                            if (match.score.winner === "HOME_TEAM") postupVal = "domaci";
                            if (match.score.winner === "AWAY_TEAM") postupVal = "hoste";
                        }

                        // NOVÁ CESTA: Uložíme výsledek do podsložky zápasů ligy včetně nového apiStatus parametru
                        await db.collection('ligy').doc(activeAdminLeague).collection('zapasy').doc(docId).update({
                            vysledek_domaci: golyDomaci,
                            vysledek_hoste: golyHoste,
                            postup: postupVal,
                            apiStatus: match.status // 🔥 Ukládáme stav, aby aplikace ihned poznala LIVE/KONEC
                        });

                        aktualizovanoZapasu++;
                    }
                }
            }
        }

        if (window.renderAdminMatches) {
            window.renderAdminMatches();
        }

        // Pokud došlo ke změně v API zápasech, vystřelíme bleskovou regeneraci centralizovaného dokumentu
        if (aktualizovanoZapasu > 0 && typeof window.aktualizujCentralniZebricek === 'function') {
            await window.aktualizujCentralniZebricek(activeAdminLeague);
        }

        window.showToast(`🎯 Synchronizováno ${aktualizovanoZapasu} čerstvých výsledků!`);

    } catch (e) {
        console.error("❌ Chyba stahování výsledků:", e);
        alert("💥 Selhala aktualizace výsledků: " + e.message);
    }
};