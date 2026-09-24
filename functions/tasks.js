// =========================================================================
// ⏰ TIPNI TO! - CLOUD TASKS & PUSH NOTIFIKACE (tasks.js)
// =========================================================================

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { db, tasksClient, DEFAULT_SEASON_ID, RENDER_BOT_URL } = require("./init");
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getMessaging } = require("firebase-admin/messaging");

// ⏰ DVOJITÝ BUDÍK: T-62 (Push notifikace hráčům) & T-2 (Vzbudit bota a zahájit keep-alive)
async function naplanujBudikProKickoff(kickoffMs) {
  const nowMs = Date.now();
  const projectId = process.env.GCLOUD_PROJECT || "tipni-to";
  const location = "europe-west1";
  const queue = "tipni-tasks";
  const parent = tasksClient.queuePath(projectId, location, queue);

  // 1. Budík T-62 minut (pouze push notifikace nenatipovaným)
  const targetNotifMs = kickoffMs - (62 * 60 * 1000);
  if (targetNotifMs > nowMs) {
    const taskId = `task-notif-${kickoffMs}`;
    const taskName = `${parent}/tasks/${taskId}`;
    const url = `https://${location}-${projectId}.cloudfunctions.net/preMatchExecutionTask`;

    const task = {
      name: taskName,
      httpRequest: {
        httpMethod: "POST",
        url: url,
        headers: { "Content-Type": "application/json" },
        body: Buffer.from(JSON.stringify({ kickoffMs })).toString("base64")
      },
      scheduleTime: {
        seconds: Math.floor(targetNotifMs / 1000)
      }
    };

    try {
      await tasksClient.createTask({ parent, task });
      console.log(`⏰ CLOUD TASKS: Notifikační budík T-62 naplánován na ${new Date(targetNotifMs).toLocaleTimeString("cs-CZ")}`);
    } catch (err) {
      if (err.code !== 6) console.error("❌ CLOUD TASKS CHYBA (T-62):", err.message);
    }
  }

  // 2. Budík T-2 minuty (probuzení Renderu a odpálení udržovacího řetězu)
  const targetWakeupMs = kickoffMs - (2 * 60 * 1000);
  if (targetWakeupMs > nowMs) {
    const taskId = `task-wakeup-${kickoffMs}`;
    const taskName = `${parent}/tasks/${taskId}`;
    const url = `https://${location}-${projectId}.cloudfunctions.net/botWakeupAndKeepAliveTask`;

    const task = {
      name: taskName,
      httpRequest: {
        httpMethod: "POST",
        url: url,
        headers: { "Content-Type": "application/json" },
        body: Buffer.from(JSON.stringify({ kickoffMs, iteration: 0 })).toString("base64")
      },
      scheduleTime: {
        seconds: Math.floor(targetWakeupMs / 1000)
      }
    };

    try {
      await tasksClient.createTask({ parent, task });
      console.log(`⏰ CLOUD TASKS: Wakeup budík bota T-2 naplánován na ${new Date(targetWakeupMs).toLocaleTimeString("cs-CZ")}`);
    } catch (err) {
      if (err.code !== 6) console.error("❌ CLOUD TASKS CHYBA (T-2):", err.message);
    }
  }
}

// 🔔 SPRÁVA PUSH ODBĚRATELŮ NA R2: 0 FIRESTORE READS, 0 ZÁPISŮ DO USERS
const togglePushSubscriptionCF = onCall({
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Pro správu notifikací musíš být přihlášen!");
  }

  const uid = request.auth.uid;
  const { enabled, token } = request.data;
  const R2_BUCKET = process.env.R2_BUCKET_NAME || "tipni-to-data";
  const R2_KEY = "notifikace/odberatele_push.json";

  const r2 = new S3Client({
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    region: "auto",
  });

  let subscribers = {};
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: R2_KEY }));
    const raw = await res.Body.transformToString();
    subscribers = JSON.parse(raw);
  } catch (e) {
    subscribers = {};
  }

  if (enabled === true && token) {
    const userDoc = await db.collection("users").doc(uid).get();
    const uData = userDoc.exists ? userDoc.data() : {};
    const existingTokens = subscribers[uid]?.tokens || [];
    if (!existingTokens.includes(token)) {
      existingTokens.push(token);
    }

    subscribers[uid] = {
      tokens: existingTokens,
      nickname: uData.nickname || (uData.email || "").split("@")[0] || "Hráč",
      leagues: uData.leagues || [],
      isSuperAdmin: uData.isSuperAdmin === true,
      updatedAt: new Date().toISOString()
    };
  } else {
    delete subscribers[uid];
  }

  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: R2_KEY,
    Body: JSON.stringify(subscribers, null, 2),
    ContentType: "application/json"
  }));

  return { success: true, enabled: Boolean(enabled) };
});

// ⚡ TASK HANDLER T-62: Chytré odeslání push notifikací před výkopem s přesným čtením tipů
const preMatchExecutionTask = onRequest({
  region: "europe-west1",
  memory: "256MiB",
  invoker: "public",
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (req, res) => {
  const kickoffMs = req.body?.kickoffMs;
  console.log(`🔔 EXEKUCE T-62: Zahajuji kontrolu a odesílání notifikací před výkopem v ${new Date(kickoffMs).toLocaleTimeString("cs-CZ")}...`);

  try {
    const r2 = new S3Client({
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      region: "auto",
    });

    const R2_BUCKET = process.env.R2_BUCKET_NAME || "tipni-to-data";
    const SEZNAM_LIG = ["Chance Liga", "Premier League", "Liga mistrů", "Tipsport Extraliga", "MS v hokeji", "MS ve fotbale"];

    // 1. Zjistíme zápasy začínající v tomto okně (kickoffMs ± 15 minut)
    const matchesAtKickoff = [];
    for (const lName of SEZNAM_LIG) {
      const lKlic = lName.replace(/ /g, "_");
      try {
        const rRes = await r2.send(new GetObjectCommand({
          Bucket: R2_BUCKET,
          Key: `sezony/${DEFAULT_SEASON_ID}/${lKlic}/rozpis.json`
        }));
        const rJson = JSON.parse(await rRes.Body.transformToString());
        Object.entries(rJson.zapasyMapa || {}).forEach(([mId, z]) => {
          if (z.apiStatus === "POSTPONED" || z.vysledek_domaci !== undefined) return;
          const zMs = Date.parse(z.datum);
          if (zMs && Math.abs(zMs - kickoffMs) < 15 * 60 * 1000) {
            matchesAtKickoff.push({ id: mId, league: lName, domaci: z.domaci, hoste: z.hoste });
          }
        });
      } catch (e) {}
    }

    if (matchesAtKickoff.length === 0) {
      res.status(200).send("No matches found for this kickoff.");
      return;
    }

    // 2. Načteme odběratele z R2 (0 Firestore Reads!)
    let subscribers = {};
    try {
      const subRes = await r2.send(new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: "notifikace/odberatele_push.json"
      }));
      subscribers = JSON.parse(await subRes.Body.transformToString());
    } catch (e) {
      res.status(200).send("No subscribers.");
      return;
    }

    // 3. Vybereme pouze aktivní odběratele, kterých se tyto zápasy týkají
    const relevantSubscribers = [];
    for (const [uid, sub] of Object.entries(subscribers)) {
      const tokens = Array.isArray(sub.tokens) ? sub.tokens.filter(Boolean) : [];
      if (tokens.length === 0) continue;

      const userLeagues = sub.leagues || [];
      const userMatches = matchesAtKickoff.filter(m => sub.isSuperAdmin === true || userLeagues.includes(m.league));
      if (userMatches.length > 0) {
        relevantSubscribers.push({ uid, sub, tokens, userMatches });
      }
    }

    if (relevantSubscribers.length === 0) {
      res.status(200).send("No subscribers for these leagues.");
      return;
    }

    // 4. DÁVKOVÝ RPC DOTAZ POUZE PRO AKTIVNÍ ODBĚRATELE (Přesné zjištění reálných tipů)
    const sezonaDocRefs = relevantSubscribers.map(r => 
      db.collection("users").doc(r.uid).collection("sezony").doc(DEFAULT_SEASON_ID)
    );
    const sezonaDocSnaps = await db.getAll(...sezonaDocRefs);
    const userSezonaDataMap = {};
    sezonaDocSnaps.forEach(snap => {
      if (snap.exists) {
        const uid = snap.ref.parent.parent.id;
        userSezonaDataMap[uid] = snap.data() || {};
      }
    });

    const messaging = getMessaging();
    const APP_BASE_URL = process.env.APP_BASE_URL || "https://tipni-to.netlify.app";
    let subsModified = false;

    const getSportIcon = (league) => {
      const l = String(league || "").toLowerCase();
      return (l.includes("extraliga") || l.includes("hokej")) ? "🏒" : "⚽";
    };

    // 5. Odeslání zpráv pouze těm, kdo skutečně nemají natipováno
    for (const { uid, tokens, userMatches } of relevantSubscribers) {
      const souteze = userSezonaDataMap[uid]?.souteze || {};

      const untipped = userMatches.filter(m => {
        const lKlic = m.league.replace(/ /g, "_");
        const userTips = souteze[lKlic]?.tipy || {};
        const tip = userTips[m.id];
        return !tip || tip.tip_domaci === undefined || tip.tip_domaci === null || String(tip.tip_domaci).trim() === "";
      });

      if (untipped.length === 0) continue;

      const ligyGroup = {};
      untipped.forEach(m => {
        if (!ligyGroup[m.league]) ligyGroup[m.league] = [];
        ligyGroup[m.league].push(m);
      });

      const unikatniLigy = Object.keys(ligyGroup);
      const totalUntippedCount = untipped.length;
      let title = "";
      let body = "";
      const primaryLeague = unikatniLigy[0];

      if (unikatniLigy.length === 1) {
        const ligaNazev = unikatniLigy[0];
        const icon = getSportIcon(ligaNazev);
        const zapasyVLize = ligyGroup[ligaNazev];

        title = `${icon} ${ligaNazev}: Nezapomeň natipovat!`;
        body = zapasyVLize.length === 1
          ? `${zapasyVLize[0].domaci} – ${zapasyVLize[0].hoste} začíná za 60 minut a nemáš natipováno!`
          : `Za 60 minut začíná ${zapasyVLize.length} zápasů bez tvého tipu!`;
      } else {
        title = `🏆 Nezapomeň natipovat (${totalUntippedCount} zápasů ve ${unikatniLigy.length} soutěžích)`;
        const rozpisText = unikatniLigy.map(l => `${getSportIcon(l)} ${l} (${ligyGroup[l].length})`).join(" • ");
        body = `Za 60 minut začínají zápasy bez tipu: ${rozpisText}`;
      }

      const leagueParam = encodeURIComponent(primaryLeague.replace(/ /g, "_"));
      const targetUrl = `${APP_BASE_URL}/?league=${leagueParam}#matchesScreen`;

      const resp = await messaging.sendEachForMulticast({
        tokens: tokens,
        notification: { title, body },
        webpush: {
          headers: {
            Urgency: "high",
            urgency: "high",
            TTL: "3600",
            Topic: "prematch-alert"
          },
          notification: {
            title,
            body,
            icon: `${APP_BASE_URL}/img/favicon192.png`,
            badge: `${APP_BASE_URL}/img/favicon192.png`,
            vibrate: [200, 100, 200],
            tag: "untipped-match-alert",
            requireInteraction: true,
            data: { url: targetUrl }
          }
        },
        data: { url: targetUrl, league: primaryLeague }
      });

      // Úklid neplatných tokenů z R2
      const deadTokens = [];
      resp.responses.forEach((r, idx) => {
        if (!r.success && (r.error?.code === "messaging/invalid-registration-token" || r.error?.code === "messaging/registration-token-not-registered")) {
          deadTokens.push(tokens[idx]);
        }
      });
      if (deadTokens.length > 0) {
        subscribers[uid].tokens = subscribers[uid].tokens.filter(t => !deadTokens.includes(t));
        if (subscribers[uid].tokens.length === 0) delete subscribers[uid];
        subsModified = true;
      }
    }

    if (subsModified) {
      await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: "notifikace/odberatele_push.json",
        Body: JSON.stringify(subscribers, null, 2),
        ContentType: "application/json"
      }));
    }
  } catch (err) {
    console.error("❌ Chyba v preMatchExecutionTask:", err);
  }

  res.status(200).send("OK");
});

// 💓 PROBUZENÍ V T-2 & UDRŽOVACÍ ŘETĚZ BOTA PO DOBU ŽIVÝCH ZÁPASŮ (0 FIRESTORE READS)
const botWakeupAndKeepAliveTask = onRequest({
  region: "europe-west1",
  memory: "256MiB",
  invoker: "public",
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (req, res) => {
  const { kickoffMs, iteration = 0 } = req.body || {};
  console.log(`💓 KEEP-ALIVE: Úkol bota aktivován (iterace ${iteration}) v ${new Date().toLocaleTimeString("cs-CZ")}`);

  // 1. HTTP ping na Render /cron pro probuzení nebo reset 15min spánkového časovače
  try {
    const pingUrl = `${RENDER_BOT_URL.replace(/\/+$/, "")}/cron`;
    await fetch(pingUrl, { signal: AbortSignal.timeout(12000) });
    console.log("📡 RENDER PING: Signál /cron úspěšně doručen.");
  } catch (e) {
    console.warn("⚠️ RENDER PING nedokončen (bot se pravděpodobně studeně probouzí):", e.message);
  }

  let shouldChain = false;

  // 2. Rozhodnutí o pokračování řetězu
  if (iteration === 0) {
    shouldChain = true;
    console.log("⏳ T-2 START: Bot probuzen 2 min před začátkem, plánuji další keep-alive ping za 10 minut.");
  } else {
    try {
      const r2 = new S3Client({
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
        region: "auto",
      });
      const R2_BUCKET = process.env.R2_BUCKET_NAME || "tipni-to-data";
      const resR2 = await r2.send(new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: `sezony/${DEFAULT_SEASON_ID}/live_radar.json`
      }));
      const radarJson = JSON.parse(await resR2.Body.transformToString());
      const beziLiveZapas = Object.values(radarJson || {}).some(val => val === true);

      if (beziLiveZapas) {
        shouldChain = true;
        console.log("🔥 LIVE ZÁPASY BĚŽÍ: V live_radar.json svítí aktivní hra, prodlužuji řetěz o dalších 10 minut.");
      } else if (iteration < 4) {
        shouldChain = true;
        console.log(`🛡️ POJISTKA ROZEHRÁNÍ: Iterace ${iteration} v prvních 40 minutách, prodlužuji řetěz.`);
      } else {
        console.log("🏁 ŽÁDNÝ LIVE ZÁPAS NEBĚŽÍ: live_radar.json hlásí hotovo, řetěz končí a Render může přirozeně usnout.");
      }
    } catch (err) {
      console.warn("⚠️ Nepodařilo se přečíst live_radar.json z R2:", err.message);
      if (iteration < 12) shouldChain = true;
    }
  }

  if (shouldChain && iteration < 25) {
    await naplanujDalsiKeepAlivePing(iteration + 1);
  }

  res.status(200).send("OK");
});

async function naplanujDalsiKeepAlivePing(nextIteration) {
  const delayMs = 10 * 60 * 1000;
  const targetMs = Date.now() + delayMs;
  const projectId = process.env.GCLOUD_PROJECT || "tipni-to";
  const location = "europe-west1";
  const queue = "tipni-tasks";
  const parent = tasksClient.queuePath(projectId, location, queue);
  const taskId = `task-keepalive-${targetMs}-${nextIteration}`;
  const taskName = `${parent}/tasks/${taskId}`;
  const url = `https://${location}-${projectId}.cloudfunctions.net/botWakeupAndKeepAliveTask`;

  const task = {
    name: taskName,
    httpRequest: {
      httpMethod: "POST",
      url: url,
      headers: { "Content-Type": "application/json" },
      body: Buffer.from(JSON.stringify({ iteration: nextIteration })).toString("base64")
    },
    scheduleTime: {
      seconds: Math.floor(targetMs / 1000)
    }
  };

  try {
    await tasksClient.createTask({ parent, task });
    console.log(`⏰ CLOUD TASKS: Další keep-alive ping naplánován na ${new Date(targetMs).toLocaleTimeString("cs-CZ")}`);
  } catch (err) {
    if (err.code !== 6) {
      console.error("❌ CLOUD TASKS CHYBA při plánování keep-alive:", err.message);
    }
  }
}

// ⏰ CHYTRÝ AUDITOR VÝKOPŮ Z R2
async function naplanujBudikyZR2() {
  const nowMs = Date.now();
  const horizonMs = nowMs + (7 * 24 * 60 * 60 * 1000);
  const uniqueKickoffs = new Set();
  let pocetLiveZapasu = 0;

  const r2 = new S3Client({
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    region: "auto",
  });

  const R2_BUCKET = process.env.R2_BUCKET_NAME || "tipni-to-data";
  const SEZNAM_LIG = ["Chance Liga", "Premier League", "Liga mistrů", "Tipsport Extraliga", "MS v hokeji", "MS ve fotbale"];

  for (const lName of SEZNAM_LIG) {
    const lKlic = lName.replace(/ /g, "_");
    try {
      const res = await r2.send(new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: `sezony/${DEFAULT_SEASON_ID}/${lKlic}/rozpis.json`
      }));
      const rJson = JSON.parse(await res.Body.transformToString());
      Object.values(rJson.zapasyMapa || {}).forEach(z => {
        if (!z.datum || z.apiStatus === "POSTPONED" || z.apiStatus === "FINISHED" || z.vysledek_domaci !== undefined) return;
        const d = Date.parse(z.datum);
        if (isNaN(d)) return;

        const jeLiveStatus = z.apiStatus === "IN_PLAY" || z.apiStatus === "PAUSED";
        const jeVRozmeziHry = (d <= nowMs) && ((nowMs - d) < (3.5 * 60 * 60 * 1000));

        if (jeLiveStatus || jeVRozmeziHry) {
          pocetLiveZapasu++;
        }

        if (d > nowMs && d <= horizonMs && !jeLiveStatus) {
          uniqueKickoffs.add(d);
        }
      });
    } catch (e) {}
  }

  for (const kMs of uniqueKickoffs) {
    await naplanujBudikProKickoff(kMs);
  }

  return { uniqueKickoffs, pocetLiveZapasu };
}

// 🔄 RUČNÍ PŘEPLÁNOVÁNÍ BUDÍKŮ KDYKOLIV PŘES PROHLÍŽEČ (0 FIRESTORE READS)
const rescheduleBudikyManual = onRequest({
  region: "europe-west1",
  memory: "256MiB",
  invoker: "public",
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (req, res) => {
  console.log("🔄 RUČNÍ RE-PLAN (R2): Spouštím audit zápasů a plánování budíků z R2...");
  try {
    const { uniqueKickoffs, pocetLiveZapasu } = await naplanujBudikyZR2();
    const liveZapasNalezen = pocetLiveZapasu > 0;
    let keepAliveInfo = "Žádný zápas právě neběží.";

    if (liveZapasNalezen) {
      console.log(`🔥 RUČNÍ RE-PLAN: Detekováno ${pocetLiveZapasu} běžících zápasů! Ihned pinguji Render a startuji 10min řetěz...`);
      try {
        const pingUrl = `${RENDER_BOT_URL.replace(/\/+$/, "")}/cron`;
        await fetch(pingUrl, { signal: AbortSignal.timeout(12000) });
        await naplanujDalsiKeepAlivePing(1);
        keepAliveInfo = `Detekováno ${pocetLiveZapasu} běžících zápasů -> Bot probuzen a 10min řetěz úspěšně odpálen!`;
      } catch (e) {
        keepAliveInfo = `Detekováno ${pocetLiveZapasu} zápasů, ale ping selhal: ${e.message}`;
      }
    }

    res.status(200).send(`
      <body style="background:#0f172a;color:#f8fafc;font-family:sans-serif;padding:30px;line-height:1.6;">
        <h2 style="color:#38bdf8;">✅ Budíky Cloud Tasks úspěšně přeplánovány (0 Firestore Reads)!</h2>
        <p>• Budoucí termíny (7 dní): <strong>${uniqueKickoffs.size}</strong> časových oken</p>
        <p>• Právě probíhající zápasy: <strong style="color:${liveZapasNalezen ? '#34d399' : '#fbbf24'};">${keepAliveInfo}</strong></p>
        <p style="color:#9ca3af;font-size:0.9rem;">Plánovač čerpal data výhradně z Cloudflare R2.</p>
      </body>
    `);
  } catch (err) {
    console.error("❌ Chyba při ručním plánování:", err);
    res.status(500).send(`Chyba: ${err.message}`);
  }
});

module.exports = {
  togglePushSubscriptionCF,
  preMatchExecutionTask,
  botWakeupAndKeepAliveTask,
  rescheduleBudikyManual,
  naplanujBudikyZR2,
  naplanujBudikProKickoff,
  naplanujDalsiKeepAlivePing
};