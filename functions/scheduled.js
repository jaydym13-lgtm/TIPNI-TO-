// =========================================================================
// 📅 TIPNI TO! - PLÁNOVANÉ CRON RADARY A SYNCHRONIZACE (scheduled.js)
// =========================================================================

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { RENDER_BOT_URL } = require("./init");
const { naplanujBudikyZR2 } = require("./tasks");

// 📅 KALENDÁŘNÍ RADAR: Denní kontrola ve 12:00 (0 FIRESTORE READS)
const syncFixturesScheduled = onSchedule({
  schedule: "0 12 * * *",
  timeZone: "Europe/Prague",
  memory: "256MiB",
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (event) => {
  if (new Date().getDate() === 1) {
    console.log("📅 FIXTURE RADAR: Dnes je 1. den v měsíci – polední kontrolu přeskakuji (ráno proběhl hloubkový audit).");
    return null;
  }

  console.log("📅 FIXTURE RADAR: Startuji denní kontrolu nejbližších zápasů (1x denně ve 12:00)...");

  try {
    const targetUrl = `${RENDER_BOT_URL.replace(/\/+$/, "")}/sync-fixtures`;
    const res = await fetch(targetUrl);
    console.log(`📡 FIXTURE RADAR: Signál doručen na Render (/sync-fixtures). Status: ${res.status}`);

    // ⏰ PLÁNOVÁNÍ BUDÍKŮ PRO NEJBLIŽŠÍCH 7 DNÍ Z R2 (0 READS)
    await naplanujBudikyZR2();
  } catch (err) {
    console.error("❌ FIXTURE RADAR CRITICAL:", err);
  }
  return null;
});

// 📅 GENERÁLNÍ AUDIT SEZÓNY: 1. den v měsíci ve 03:00 ráno (0 FIRESTORE READS)
const syncFixturesMonthlyDeepScheduled = onSchedule({
  schedule: "0 3 1 * *",
  timeZone: "Europe/Prague",
  memory: "256MiB",
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (event) => {
  console.log("📅 FIXTURE RADAR (HLOUBKOVÝ): Startuji měsíční generální audit všech lig do konce sezóny...");
  try {
    const targetUrl = `${RENDER_BOT_URL.replace(/\/+$/, "")}/sync-fixtures?deep=true`;
    const res = await fetch(targetUrl);
    console.log(`📡 FIXTURE RADAR (HLOUBKOVÝ): Signál doručen na Render (/sync-fixtures?deep=true). Status: ${res.status}`);

    // ⏰ PLÁNOVÁNÍ BUDÍKŮ PRO NEJBLIŽŠÍCH 7 DNÍ Z R2 (0 READS)
    await naplanujBudikyZR2();
  } catch (err) {
    console.error("❌ FIXTURE RADAR (HLOUBKOVÝ) CRITICAL: Selhalo odeslání hloubkového auditu:", err);
  }
  return null;
});

// 📊 ODDS RADAR 1: ÚTERÝ v 17:00 – stažení víkendového balíku (Pátek až Pondělí)
const syncOddsWeekendScheduled = onSchedule({
  schedule: "0 17 * * 2",
  timeZone: "Europe/Prague",
  memory: "256MiB"
}, async (event) => {
  console.log("📊 ODDS RADAR (Út 17:00): Probouzím Render pro víkendové kurzy (/sync-odds)...");
  try {
    const targetUrl = `${RENDER_BOT_URL.replace(/\/+$/, "")}/sync-odds`;
    const res = await fetch(targetUrl);
    console.log(`📡 ODDS RADAR: Signál doručen na Render. Status: ${res.status}`);
  } catch (err) {
    console.error("❌ ODDS RADAR CRITICAL: Selhalo probuzení pro kurzy:", err);
  }
  return null;
});

// 📊 ODDS RADAR 2: SOBOTA a PONDĚLÍ v 04:00 – stažení LM a dočištění dohrávek (Úterý až Čtvrtek)
const syncOddsMidweekScheduled = onSchedule({
  schedule: "0 4 * * 1,6",
  timeZone: "Europe/Prague",
  memory: "256MiB"
}, async (event) => {
  console.log("📊 ODDS RADAR (So/Po 04:00): Probouzím Render pro kurzy všedních dnů (/sync-odds)...");
  try {
    const targetUrl = `${RENDER_BOT_URL.replace(/\/+$/, "")}/sync-odds`;
    const res = await fetch(targetUrl);
    console.log(`📡 ODDS RADAR: Signál doručen na Render. Status: ${res.status}`);
  } catch (err) {
    console.error("❌ ODDS RADAR CRITICAL: Selhalo probuzení pro kurzy:", err);
  }
  return null;
});

// 🏒 HOCKEY ODDS RADAR 1: SOBOTA ve 12:00 – stažení nedělní a pondělní Extraligy
const syncOddsHockeyWeekendScheduled = onSchedule({
  schedule: "0 12 * * 6",
  timeZone: "Europe/Prague",
  memory: "256MiB"
}, async (event) => {
  console.log("🏒 HOCKEY ODDS RADAR (So 12:00): Probouzím Render pro hokejové kurzy (/sync-odds-hockey)...");
  try {
    const targetUrl = `${RENDER_BOT_URL.replace(/\/+$/, "")}/sync-odds-hockey`;
    const res = await fetch(targetUrl);
    console.log(`📡 HOCKEY ODDS RADAR: Signál doručen na Render. Status: ${res.status}`);
  } catch (err) {
    console.error("❌ HOCKEY ODDS RADAR CRITICAL: Selhalo probuzení pro hokejové kurzy:", err);
  }
  return null;
});

// 🏒 HOCKEY ODDS RADAR 2: PONDĚLÍ v 10:00 – vložená kola (úterý a středa)
const syncOddsHockeyMondayScheduled = onSchedule({
  schedule: "0 10 * * 1",
  timeZone: "Europe/Prague",
  memory: "256MiB"
}, async (event) => {
  console.log("🏒 HOCKEY ODDS RADAR (Po 10:00): Probouzím Render pro hokejové kurzy (/sync-odds-hockey)...");
  try {
    const targetUrl = `${RENDER_BOT_URL.replace(/\/+$/, "")}/sync-odds-hockey`;
    const res = await fetch(targetUrl);
    console.log(`📡 HOCKEY ODDS RADAR: Signál doručen na Render. Status: ${res.status}`);
  } catch (err) {
    console.error("❌ HOCKEY ODDS RADAR CRITICAL: Selhalo probuzení pro hokejové kurzy:", err);
  }
  return null;
});

// 🏒 HOCKEY ODDS RADAR 3: STŘEDA v 10:00 – čtvrteční, páteční a sobotní kola Extraligy
const syncOddsHockeyWednesdayScheduled = onSchedule({
  schedule: "0 10 * * 3",
  timeZone: "Europe/Prague",
  memory: "256MiB"
}, async (event) => {
  console.log("🏒 HOCKEY ODDS RADAR (St 10:00): Probouzím Render pro hokejové kurzy (/sync-odds-hockey)...");
  try {
    const targetUrl = `${RENDER_BOT_URL.replace(/\/+$/, "")}/sync-odds-hockey`;
    const res = await fetch(targetUrl);
    console.log(`📡 HOCKEY ODDS RADAR: Signál doručen na Render. Status: ${res.status}`);
  } catch (err) {
    console.error("❌ HOCKEY ODDS RADAR CRITICAL: Selhalo probuzení pro hokejové kurzy:", err);
  }
  return null;
});

// 🗺️ EVENT MAPPER RADAR: 1× měsíčně (1. den v měsíci ve 02:00) stáhne a spáruje ID zápasů
const syncEventMappingScheduled = onSchedule({
  schedule: "0 2 1 * *",
  timeZone: "Europe/Prague",
  memory: "256MiB"
}, async (event) => {
  console.log("🗺️ EVENT MAPPER RADAR: Posílám měsíční signál pro aktualizaci mapy ID (/sync-event-map)...");
  try {
    const targetUrl = `${RENDER_BOT_URL.replace(/\/+$/, "")}/sync-event-map`;
    const res = await fetch(targetUrl);
    console.log(`📡 EVENT MAPPER RADAR: Signál doručen na Render. Status: ${res.status}`);
  } catch (err) {
    console.error("❌ EVENT MAPPER RADAR CRITICAL: Selhalo probuzení pro mapování ID:", err);
  }
  return null;
});

module.exports = {
  syncFixturesScheduled,
  syncFixturesMonthlyDeepScheduled,
  syncOddsWeekendScheduled,
  syncOddsMidweekScheduled,
  syncOddsHockeyWeekendScheduled,
  syncOddsHockeyMondayScheduled,
  syncOddsHockeyWednesdayScheduled,
  syncEventMappingScheduled
};