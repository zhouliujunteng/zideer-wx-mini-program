// Compiled with the existing CryptoJS SHA-256 bundle and profile/verified-identity.js by the sync script.
// 提交当前家长实名认证：姓名与身份证号核对一致即完成实名（2026-09-29 起普通实名不再刷脸）。
// 刷脸只在申请推广伙伴时做：申请页先用本流程做基础核验，再录视频（submit-liveness-verification.js）。
function sha256(value) { return OpenMaicLearningCrypto.sha256(String(value)); }

function apiData(reply) {
  var value = reply && reply.data !== undefined ? reply.data : reply;
  if (typeof value === 'string') { try { return JSON.parse(value); } catch (error) { return {}; } }
  return value || {};
}

function maskCard(card) { return card.length === 18 ? card.slice(0, 6) + '********' + card.slice(-4) : '****'; }

function validCard(card) {
  if (!/^\d{17}[0-9X]$/.test(card)) return false;
  var weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  var checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  var sum = 0;
  for (var i = 0; i < 17; i++) sum += Number(card.charAt(i)) * weights[i];
  if (checks[sum % 11] !== card.charAt(17)) return false;
  var birth = card.slice(6, 14), year = Number(birth.slice(0, 4)), month = Number(birth.slice(4, 6)), day = Number(birth.slice(6, 8));
  var date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function splitArea(value) {
  var area = String(value || '').replace(/\s+/g, '');
  var matched = area.match(/^(.+?(?:省|自治区|特别行政区))/), province = matched ? matched[1] : '';
  var rest = province ? area.slice(province.length) : area, cityMatch = rest.match(/^(.+?(?:市|自治州|地区|盟))/);
  return { province: province, city: cityMatch ? cityMatch[1] : '' };
}

// 出生日期直接取自身份证号（第 7-14 位），不依赖资料解析接口；存进 lookup_summary.id_birth_date，
// 切换为家长（保存学习档案）、绑定学生、实名时授予家长角色，都按它判断是否满 22 周岁。
// 家长年龄门槛（2026-09-25 用户规则），与 save-current-profile.js、bind-guardian-student.js 一致。
var GUARDIAN_MIN_AGE = 22;
function cardBirthDate(card) { return card.slice(6, 10) + '-' + card.slice(10, 12) + '-' + card.slice(12, 14); }
// 身份证号第 17 位：奇数为男、偶数为女
function cardGender(card) { return Number(card.charAt(16)) % 2 ? 'male' : 'female'; }
function ageOnToday(birthDate) {
  var today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  var age = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return today.slice(5) < birthDate.slice(5) ? age - 1 : age;
}
// 2026-09-26～09-29 实名分两步时留下的「待人脸核验」记录：姓名与身份证号当时已核对通过。
// 现在普通实名不再刷脸，同一张身份证再提交时直接完成实名，不再调收费的核对接口。
var LEGACY_PENDING = 'pending_liveness';

function emptyResult(message) {
  return { success: false, duplicate: false, message: message, recordId: null, province: null, city: null, sex: null, birthday: null, verify: null, maskedIdCard: null };
}

function parseSummary(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch (error) { value = null; } }
  return value && typeof value === 'object' ? value : {};
}

function saveVerification(principalId, object) {
  return context.runGql('UpsertGuardianVerification', 'mutation UpsertGuardianVerification($object: guardian_verification_insert_input!) { insert_guardian_verification_one(object: $object, on_conflict: {constraint: guardian_verification_guardian_principal_id_key, update_columns: [verification_status, verified_at, verification_method, evidence_reference, risk_level, reviewed_by, provider, request_no, legal_name, id_number_hash, id_number_tail, failure_code, response_digest, lookup_summary]}) { id } }', { object: object }, { role: 'admin' }).insert_guardian_verification_one;
}

// 实名通过：身份证上的生日、性别和发证地（户籍地）写进个人资料，之后这几项不能再改（2026-09-26 用户规则，
// 推算见 verified-identity.js）。所在城市是用户自己填的，不动。写资料失败不影响实名结果：
// 读取、保存资料时仍按实名记录锁定并补写。满 22 周岁授予家长角色，未满只记实名结果（推广伙伴申请等仍可用）。
function completeVerification(principalId, card, province, city, now) {
  var birthDate = cardBirthDate(card);
  var profilePatch = { birthday: birthDate, gender: cardGender(card) }, household = householdRegionText(province, city);
  if (household) profilePatch.household_region = household;
  try { context.runGql('FillProfileFromVerification', 'mutation FillProfileFromVerification($id: bigint!, $patch: user_profile_set_input!) { update_user_profile(where: {user_principal_id: {_eq: $id}}, _set: $patch) { affected_rows } }', { id: principalId, patch: profilePatch }, { role: 'admin' }); }
  catch (error) {}
  if (ageOnToday(birthDate) >= GUARDIAN_MIN_AGE) context.runGql('GrantGuardianRole', 'mutation GrantGuardianRole($object: user_role_assignment_insert_input!) { insert_user_role_assignment_one(object: $object, on_conflict: {constraint: user_role_assignment_principal_role_unique, update_columns: [status, granted_at, revoked_at, grant_reason]}) { id } }', { object: { user_principal_id: principalId, role_code: 'guardian', status: 'active', granted_at: now, revoked_at: null, grant_reason: 'identity_verification' } }, { role: 'admin' });
}

var name = String(context.getArg('name') || '').trim();
var card = String(context.getArg('idCardNumber') || '').replace(/\s/g, '').toUpperCase();
var accountId = Number(context.getArg('accountId') || 0);
if (!accountId) { context.setResult(emptyResult('请先登录后实名认证')); return; }
if (!name || name.length > 50) { context.setResult(emptyResult('请输入有效姓名')); return; }
if (!validCard(card)) { context.setResult(emptyResult('请输入有效的18位身份证号')); return; }

var identityData = context.runGql('ReadCurrentIdentityOwner', 'query ReadCurrentIdentityOwner($accountId: bigint!) { account_identity(where: {account_id: {_eq: $accountId}, disabled_at: {_is_null: true}}, limit: 1) { user_principal_id } }', { accountId: accountId }, { role: 'admin' });
var identity = (identityData.account_identity || [])[0];
if (!identity) { context.setResult(emptyResult('账号尚未初始化，请重新登录后重试')); return; }

var principalId = identity.user_principal_id, cardHash = sha256(card);
var existingData = context.runGql('ReadExistingGuardianVerification', 'query ReadExistingGuardianVerification($principalId: bigint!) { guardian_verification(where: {guardian_principal_id: {_eq: $principalId}}, limit: 1) { id verification_status legal_name id_number_hash lookup_summary } }', { principalId: principalId }, { role: 'admin' });
var existing = (existingData.guardian_verification || [])[0];
if (existing && existing.verification_status === 'verified' && existing.id_number_hash === cardHash && String(existing.legal_name || '').trim() === name) {
  context.setResult({ success: true, duplicate: true, message: '该身份已完成核验', recordId: existing.id, province: null, city: null, sex: null, birthday: null, verify: null, maskedIdCard: maskCard(card) });
  return;
}
// 已实名的账号不能换一张身份证重新实名：生日、性别、户籍地已按原身份证锁定。申请推广伙伴时的基础核验也靠这一条
// 确认填的是本人实名的那张证。确需更换由客服处理。
if (existing && existing.verification_status === 'verified') {
  context.setResult({ success: false, duplicate: false, message: '你已完成实名认证，填写的姓名或身份证号与实名记录不一致', recordId: existing.id, province: null, city: null, sex: null, birthday: null, verify: 'identity_mismatch', maskedIdCard: maskCard(card) });
  return;
}

var now = new Date().toISOString();
// 两步实名时期核对通过、没录视频的记录：同一张身份证直接完成实名，沿用当时存的资料解析结果
if (existing && existing.verification_status === LEGACY_PENDING && existing.id_number_hash === cardHash) {
  var legacySummary = parseSummary(existing.lookup_summary);
  var completed = context.runGql('CompleteLegacyVerification', 'mutation CompleteLegacyVerification($id: bigint!, $hash: String!, $now: timestamptz!) { update_guardian_verification(where: {id: {_eq: $id}, verification_status: {_eq: "pending_liveness"}, id_number_hash: {_eq: $hash}}, _set: {verification_status: "verified", verified_at: $now}) { affected_rows } }', { id: existing.id, hash: cardHash, now: now }, { role: 'admin' }).update_guardian_verification.affected_rows;
  if (completed === 1) {
    completeVerification(principalId, card, legacySummary.province, legacySummary.city, now);
    context.setResult({ success: true, duplicate: false, message: '实名认证成功', recordId: existing.id, province: legacySummary.province || null, city: legacySummary.city || null, sex: legacySummary.sex || null, birthday: legacySummary.birthday || null, verify: null, maskedIdCard: maskCard(card) });
    return;
  }
}

var authReply;
try { authReply = context.callThirdPartyApi('mto8sww9', { mto8u319: card, mto8uw93: name }); }
catch (error) { context.setResult(emptyResult('核验服务暂不可用，请稍后重新查询状态')); return; }
var auth = apiData(authReply), authResult = auth.result || {};
if (!authReply || Number(authReply.code) < 200 || Number(authReply.code) >= 300 || Number(auth.error_code) !== 0 || ![1, 2].includes(Number(authResult.res))) {
  context.setResult(emptyResult('核验服务暂不可用，请稍后再试'));
  return;
}
var authOk = authReply && Number(authReply.code) >= 200 && Number(authReply.code) < 300 && Number(auth.error_code) === 0 && Number(authResult.res) === 1;
if (!authOk) {
  var rejected = saveVerification(principalId, { guardian_principal_id: principalId, verification_status: 'rejected', verified_at: null, verification_method: 'juhe_idcard_name_match', evidence_reference: null, risk_level: 'normal', reviewed_by: 'system', provider: 'juhe', request_no: null, legal_name: name, id_number_hash: cardHash, id_number_tail: card.slice(-4), failure_code: String(auth.error_code || 'provider_rejected'), response_digest: sha256(String(auth.error_code || '') + '|' + String(auth.reason || '')), lookup_summary: null });
  context.setResult({ success: false, duplicate: false, message: '实名认证未通过，请核对姓名和身份证号', recordId: rejected.id, province: null, city: null, sex: null, birthday: null, verify: null, maskedIdCard: maskCard(card) });
  return;
}

var lookupReply;
try { lookupReply = context.callThirdPartyApi('zchv8iike', { mto2s1l9: card }); }
catch (error) { lookupReply = null; }
var lookup = apiData(lookupReply), detail = lookup.result || {};
var lookupOk = lookupReply && Number(lookupReply.code) >= 200 && Number(lookupReply.code) < 300 && String(lookup.resultcode) === '200' && Number(lookup.error_code) === 0;
var area = lookupOk ? String(detail.area || '').slice(0, 120) : '', location = splitArea(area);
var summary = { area: lookupOk ? (area || null) : null, province: lookupOk ? (location.province || null) : null, city: lookupOk ? (location.city || null) : null, sex: lookupOk && detail.sex ? String(detail.sex) : null, birthday: lookupOk && detail.birthday ? String(detail.birthday) : null, id_birth_date: cardBirthDate(card), id_gender: cardGender(card) };
var saved = saveVerification(principalId, { guardian_principal_id: principalId, verification_status: 'verified', verified_at: now, verification_method: 'juhe_idcard_name_match+idcard_lookup', evidence_reference: String(authResult.orderid || ''), risk_level: 'normal', reviewed_by: 'system', provider: 'juhe', request_no: String(authResult.orderid || ''), legal_name: name, id_number_hash: cardHash, id_number_tail: card.slice(-4), failure_code: lookupOk ? null : 'lookup_unavailable', response_digest: sha256(String(auth.error_code) + '|' + String(authResult.res) + '|' + String(lookup.resultcode || '') + '|' + String(lookup.error_code || '')), lookup_summary: summary });
completeVerification(principalId, card, lookupOk ? location.province : null, lookupOk ? location.city : null, now);
context.setResult({ success: true, duplicate: false, message: lookupOk ? '实名认证成功' : '实名认证成功，资料解析暂不可用', recordId: saved.id, province: lookupOk ? (location.province || null) : null, city: lookupOk ? (location.city || null) : null, sex: lookupOk && detail.sex ? String(detail.sex) : null, birthday: lookupOk && detail.birthday ? String(detail.birthday) : null, verify: null, maskedIdCard: maskCard(card) });
