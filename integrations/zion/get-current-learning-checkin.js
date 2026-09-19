// 部署位置：Zion 动作流「读取当前学生学习打卡」8c5cc15b-e766-5512-fda2-16369afadb85，节点 s17b631f2（CUSTOM_CODE），
// 输入 current_account_id 来自模板节点「读取当前登录帐户」。仅已登录用户可调用。
// 读取当前学生学习打卡：当天（北京时间）有效课程学习累计满 THRESHOLD 秒算一天打卡。只读。
// 数据源：student_learning_time_rollup（daily），由 AF43 接收课程服务上报。
var accountId = Number(context.getArg('current_account_id'));
if (!Number.isSafeInteger(accountId) || accountId <= 0) {
  context.setResult({ status: 'unauthenticated' });
  return;
}
var DAY_MS = 86400000;
var OFFSET_MS = 8 * 3600000;
var THRESHOLD = 300;
var WINDOW_DAYS = 400;
var nowMs = Date.now();
var today = new Date(nowMs + OFFSET_MS).toISOString().slice(0, 10);

var identityData = context.runGql(
  'ReadCheckinIdentity',
  'query ReadCheckinIdentity($accountId: bigint!) { account_identity(where: {account_id: {_eq: $accountId}}, limit: 1) { user_principal_id } }',
  { accountId: accountId },
  { role: 'admin' }
);
var identity = (identityData.account_identity || [])[0];
if (!identity || !identity.user_principal_id) {
  context.setResult({ status: 'not_initialized' });
  return;
}
var profileData = context.runGql(
  'ReadCheckinProfile',
  'query ReadCheckinProfile($principalId: bigint!) { user_profile(where: {user_principal_id: {_eq: $principalId}}, limit: 1) { id status profile_completed_at } }',
  { principalId: identity.user_principal_id },
  { role: 'admin' }
);
var profile = (profileData.user_profile || [])[0];
if (!profile || !profile.profile_completed_at || profile.status !== 'active') {
  context.setResult({ status: 'not_initialized' });
  return;
}
// 当天有效学习秒数来自 student_learning_time_rollup（课程服务经 AF43 上报的每日累计，只增不减）。
var sinceDay = new Date(nowMs + OFFSET_MS - WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
var rollupData = context.runGql(
  'ReadCheckinRollups',
  'query ReadCheckinRollups($profileId: bigint!, $sinceDay: date!) {' +
    ' student_learning_time_rollup(where: {student_profile_id: {_eq: $profileId}, period_type: {_eq: "daily"},' +
    ' period_start: {_gte: $sinceDay}}) { period_start effective_seconds }' +
  ' }',
  { profileId: profile.id, sinceDay: sinceDay },
  { role: 'admin' }
);
var secondsByDate = {};
(rollupData.student_learning_time_rollup || []).forEach(function (row) {
  var key = String(row.period_start || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) secondsByDate[key] = Number(row.effective_seconds || 0);
});
var checkedDates = Object.keys(secondsByDate).filter(function (key) {
  return secondsByDate[key] >= THRESHOLD && key <= today;
}).sort();
context.setResult({
  status: 'ready',
  today: today,
  thresholdSeconds: THRESHOLD,
  todaySeconds: secondsByDate[today] || 0,
  checkedDates: checkedDates
});
