// =========================================================================
// 🚀 TIPNI TO! - AUTOMATICKÝ HTML DYNAMICKÝ PARSER A IMPORTER Z WEBU V1.3
// =========================================================================

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// 1. INICIALIZACE PŘES TVŮJ ADMIN KLÍČ
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Vyčištění HTML značek a spacerů z textových buněk webu
function cleanText(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Neprůstřelná normalizace názvů týmů
function normTeam(name) {
  if (!name) return '';
  let n = name.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  if (n.includes("czech") || n.includes("cesko")) return "cesko";
  if (n.includes("mexiko") || n.includes("mexico")) return "mexiko";
  if (n.includes("korea")) return "jiznikorea"; 
  if (n.includes("afrika") || n.includes("jar")) return "jar";
  if (n.includes("bosna")) return "bosna";
  if (n.includes("kanada")) return "kanada";
  if (n.includes("katar")) return "katar";
  if (n.includes("svycarsko") || n.includes("switzerland")) return "svycarsko";
  if (n.includes("brazilie") || n.includes("brazil")) return "brazilie";
  if (n.includes("haiti")) return "haiti";
  if (n.includes("maroko")) return "maroko";
  if (n.includes("skotsko")) return "skotsko";
  if (n.includes("australie")) return "australie";
  if (n.includes("panama")) return "panama";
  if (n.includes("paraguay")) return "paraguay";
  if (n.includes("turecko") || n.includes("turkiye")) return "turecko";
  if (n.includes("usa") || n.includes("unitedstates")) return "usa";
  if (n.includes("curacao")) return "curacao";
  if (n.includes("ekvador")) return "ekvador";
  if (n.includes("nemecko") || n.includes("germany")) return "nemecko";
  if (n.includes("slonovin") || n.includes("ivoire")) return "pobrezislonoviny";
  if (n.includes("japonsko") || n.includes("japan")) return "japonsko";
  if (n.includes("nizozemsko") || n.includes("netherlands")) return "nizozemsko";
  if (n.includes("svedsko") || n.includes("sweden")) return "svedsko";
  if (n.includes("tunisko")) return "tunisko";
  if (n.includes("belgie")) return "belgie";
  if (n.includes("egypt")) return "egypt";
  if (n.includes("iran")) return "iran";
  
  // Oprava zkratek z tvého watchdogu a webu
  if (n.includes("novyzeland") || n.includes("newzealand") || n.includes("zeland")) return "novyzeland";
  if (n.includes("saud") || n.includes("s.arabie") || n.includes("s. arabie")) return "saudskaarabie";
  
  if (n.includes("spanelsko") || n.includes("spain")) return "spanelsko";
  if (n.includes("uruguay")) return "uruguay";
  if (n.includes("francie") || n.includes("france")) return "francie";
  if (n.includes("irak")) return "irak";
  if (n.includes("norsko")) return "norsko";
  if (n.includes("senegal")) return "senegal";
  if (n.includes("alzirsko")) return "alzirsko";
  if (n.includes("argentina")) return "argentina";
  if (n.includes("rakousko")) return "rakousko";
  if (n.includes("jordansko")) return "jordansko";
  if (n.includes("portugalsko")) return "portugalsko";
  if (n.includes("uzbekistan")) return "uzbekistan";
  if (n.includes("kolumbie")) return "kolumbie";
  if (n.includes("kongo")) return "kongo";
  if (n.includes("chorvatsko")) return "chorvatsko";
  if (n.includes("anglie")) return "anglie";
  if (n.includes("ghana")) return "ghana";
  
  return n.replace(/[^a-z0-9]/g, "");
}

function normalizujPrezdivku(text) {
  if (!text) return '';
  return text.toString().trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '');
}

async function spustitWebsnadnoImport() {
  console.log("============================================================");
  console.log("⚽ MASTER RE-IMPORT V1.3: ODSTRANĚNÍ SHIFTOVÝCH PASTI");
  console.log("============================================================");

  console.log("📡 Stahuji rozpis zápasů z Firestore...");
  const rozpisDoc = await db.collection('ligy').doc('MS ve fotbale').collection('stav').doc('rozpis').get();
  if (!rozpisDoc.exists) {
    throw new Error("❌ Centrální rozpis neexistuje!");
  }
  const zapasyMapa = rozpisDoc.data().zapasyMapa || {};

  console.log("👥 Sosám uživatelské profily z databáze...");
  const usersSnapshot = await db.collection('users').get();
  const nicknameToUidMap = {};
  usersSnapshot.forEach(doc => {
    const data = doc.data();
    if (data.nickname) {
      nicknameToUidMap[normalizujPrezdivku(data.nickname)] = doc.id;
    }
  });

  const finalUserData = {}; 
  const files = ['part1.html', 'part2.html', 'part3.html'];

  for (const file of files) {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) continue;

    const htmlContent = fs.readFileSync(filePath, 'utf8');
    const tables = htmlContent.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];

    for (const tableHtml of tables) {
      // Pokud tabulka vůbec nemá herní data turnaje, mineme ji
      if (!tableHtml.includes('Celkový vítěz')) continue;

      const rows = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
      if (!rows || rows.length < 5) continue;

      // 🧠 DYNAMICKÉ URČENÍ STRUKTURY: Najdeme řádek s textem 'Celkový vítěz'
      let vitezRowIdx = -1;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].includes('Celkový vítěz')) {
          vitezRowIdx = i;
          break;
        }
      }

      if (vitezRowIdx === -1) continue;

      // Hráči jsou VŽDY přesně o jeden řádek nad "Celkovým vítězem"
      const playerRowCells = rows[vitezRowIdx - 1].match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      const currentTablePlayers = [];
      for (let i = 4; i < playerRowCells.length; i++) {
        const name = cleanText(playerRowCells[i]);
        if (name) currentTablePlayers.push(name);
      }

      if (currentTablePlayers.length === 0) continue;

      const rowVitezCells = rows[vitezRowIdx].match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      const rowStrelecCells = rows[vitezRowIdx + 1].match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      
      const currentTableWinners = [];
      const currentTableScorers = [];

      for (let i = 4; i < rowVitezCells.length; i++) currentTableWinners.push(cleanText(rowVitezCells[i]));
      for (let i = 4; i < rowStrelecCells.length; i++) currentTableScorers.push(cleanText(rowStrelecCells[i]));

      // Příprava RAM uzlů pro lidi z této tabulky
      currentTablePlayers.forEach((player, pIdx) => {
        const uid = nicknameToUidMap[normalizujPrezdivku(player)];
        if (uid && !finalUserData[uid]) {
          finalUserData[uid] = {
            bonusy: {
              vitez: currentTableWinners[pIdx] || '',
              strelec: currentTableScorers[pIdx] || ''
            },
            tipy: {}
          };
        }
      });

      // Zápasy turnaje začínají VŽDY přesně 3 řádky pod řádkem "Celkový vítěz"
      const startZapasuRowIdx = vitezRowIdx + 3;

      for (let r = startZapasuRowIdx; r < rows.length; r++) {
        const cells = rows[r].match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
        if (cells.length < 5) continue;

        const matchText = cleanText(cells[2]);
        if (matchText.includes('body celkem') || matchText === 'Zápas' || (!matchText.includes('–') && !matchText.includes('-'))) continue;

        const parts = matchText.split(/–|-/);
        if (parts.length < 2) continue;

        const excelDom = normTeam(parts[0]);
        const excelHos = normTeam(parts[1]);

        let targetMatchId = null;
        let teamsFlipped = false;

        for (const [mId, mData] of Object.entries(zapasyMapa)) {
          const dbDom = normTeam(mData.domaci);
          const dbHos = normTeam(mData.hoste);
          
          if (dbDom === excelDom && dbHos === excelHos) {
            targetMatchId = mId;
            teamsFlipped = false;
            break;
          } else if (dbDom === excelHos && dbHos === excelDom) {
            targetMatchId = mId;
            teamsFlipped = true; 
            break;
          }
        }

        if (!targetMatchId) {
          console.warn(`⚠️ WATCHDOG: Zápas [${parts[0].trim()} – ${parts[1].trim()}] nebyl nalezen ve Firestore.`);
          continue;
        }

        currentTablePlayers.forEach((player, pIdx) => {
          const uid = nicknameToUidMap[normalizujPrezdivku(player)];
          if (!uid) return;

          const tipCellIdx = 4 + pIdx * 2;
          if (tipCellIdx >= cells.length) return;

          const tipString = cleanText(cells[tipCellIdx]);
          if (tipString && tipString !== 'X' && tipString.includes(':')) {
            const [tDomStr, tHosStr] = tipString.split(':');
            let tDom = parseInt(tDomStr.trim());
            let tHos = parseInt(tHosStr.trim());

            // Pokud web přehodil strany turnaje, zrcadlově otočíme i góly v tipu
            if (teamsFlipped) {
              const temp = tDom;
              tDom = tHos;
              tHos = temp;
            }

            finalUserData[uid].tipy[targetMatchId] = {
              matchId: targetMatchId,
              postup: "",
              tip_domaci: tDom,
              tip_hoste: tHos
            };
          }
        }); 
      }
    }
  }

  const batch = db.batch();
  let writeCount = 0;

  for (const [uid, uData] of Object.entries(finalUserData)) {
    const docRef = db.collection('users').doc(uid).collection('sezony').doc('2025_2026');
    batch.set(docRef, {
      souteze: {
        "MS_ve_fotbale": {
          bonusy: uData.bonusy,
          tipy: uData.tipy
        }
      }
    }, { mergeFields: ['souteze.MS_ve_fotbale'] });
    writeCount++;
  }

  console.log(`\n⏳ Tlačím pročištěná data na cloud pro ${writeCount} hráčů...`);
  await batch.commit();

  console.log("============================================================");
  console.log("🏁 MASTER RE-IMPORT DOKONČEN! DATA PRO DRUHÉ KOLO JSOU TAM.");
  console.log("============================================================");
}

spustitWebsnadnoImport().catch(console.error);