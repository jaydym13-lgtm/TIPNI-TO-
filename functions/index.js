// =========================================================================
// 🚀 TIPNI TO! - CLOUD FUNCTIONS MASTER ROUTER (index.js)
// =========================================================================

// 1. Centrální inicializace (Firebase Admin SDK, Europe-west1, Cloud Tasks)
require("./init");

// 2. Hráčské jádro (Super-rychlý Cold Start pro mobily hráčů)
const tips = require("./tips");
exports.saveUserTipsCF = tips.saveUserTipsCF;
exports.saveBonusTipsCF = tips.saveBonusTipsCF;
exports.registerNicknameCF = tips.registerNicknameCF;

// 3. Administrace, Rekalkulace žebříčků & Loutkovodič (admin.js)
const adminModule = require("./admin");
exports.manageUserPermissionsCF = adminModule.manageUserPermissionsCF;
exports.purgeUserAbsoluteCF = adminModule.purgeUserAbsoluteCF;
exports.saveProxyDataCF = adminModule.saveProxyDataCF;
exports.recalculateLeaderboardCF = adminModule.recalculateLeaderboardCF;
exports.transferUserDataCF = adminModule.transferUserDataCF;
exports.updateMatchDateCF = adminModule.updateMatchDateCF;
exports.saveMatchOddsCF = adminModule.saveMatchOddsCF;
exports.deleteMatchOddsCF = adminModule.deleteMatchOddsCF;
exports.deleteMatchCF = adminModule.deleteMatchCF;
exports.toggleMatchPostponedCF = adminModule.toggleMatchPostponedCF;
exports.syncAllUsersToRtdbCF = adminModule.syncAllUsersToRtdbCF;
exports.deleteMyAccountCF = adminModule.deleteMyAccountCF;

// 4. Cloud Tasks & Push notifikace (tasks.js)
const tasks = require("./tasks");
exports.togglePushSubscriptionCF = tasks.togglePushSubscriptionCF;
exports.preMatchExecutionTask = tasks.preMatchExecutionTask;
exports.botWakeupAndKeepAliveTask = tasks.botWakeupAndKeepAliveTask;
exports.rescheduleBudikyManual = tasks.rescheduleBudikyManual;

// 5. Plánované cron radary (scheduled.js)
const scheduled = require("./scheduled");
exports.syncFixturesScheduled = scheduled.syncFixturesScheduled;
exports.syncFixturesMonthlyDeepScheduled = scheduled.syncFixturesMonthlyDeepScheduled;
exports.syncOddsWeekendScheduled = scheduled.syncOddsWeekendScheduled;
exports.syncOddsMidweekScheduled = scheduled.syncOddsMidweekScheduled;
exports.syncOddsHockeyWeekendScheduled = scheduled.syncOddsHockeyWeekendScheduled;
exports.syncOddsHockeyMondayScheduled = scheduled.syncOddsHockeyMondayScheduled;
exports.syncOddsHockeyWednesdayScheduled = scheduled.syncOddsHockeyWednesdayScheduled;
exports.syncEventMappingScheduled = scheduled.syncEventMappingScheduled;