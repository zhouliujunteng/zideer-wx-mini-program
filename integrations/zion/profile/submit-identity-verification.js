// Compiled with the existing CryptoJS SHA-256 bundle by the sync script.
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

function emptyResult(message) {
  return { success: false, duplicate: false, message: message, recordId: null, province: null, city: null, sex: null, birthday: null, verify: null, maskedIdCard: null };
}

function saveVerification(principalId, object) {
  return context.runGql('UpsertGuardianVerification', 'mutation UpsertGuardianVerification($object: guardian_verification_insert_input!) { insert_guardian_verification_one(object: $object, on_conflict: {constraint: guardian_verification_guardian_principal_id_key, update_columns: [verification_status, verified_at, verification_method, evidence_reference, risk_level, reviewed_by, provider, request_no, legal_name, id_number_hash, id_number_tail, failure_code, response_digest, lookup_summary]}) { id } }', { object: object }, { role: 'admin' }).insert_guardian_verification_one;
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
var existingData = context.runGql('ReadExistingGuardianVerification', 'query ReadExistingGuardianVerification($principalId: bigint!) { guardian_verification(where: {guardian_principal_id: {_eq: $principalId}}, limit: 1) { id verification_status id_number_hash } }', { principalId: principalId }, { role: 'admin' });
var existing = (existingData.guardian_verification || [])[0];
if (existing && existing.verification_status === 'verified' && existing.id_number_hash === cardHash) {
  context.setResult({ success: true, duplicate: true, message: '该身份已完成核验', recordId: existing.id, province: null, city: null, sex: null, birthday: null, verify: null, maskedIdCard: maskCard(card) });
  return;
}

var now = new Date().toISOString();
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
var summary = lookupOk ? { area: area || null, province: location.province || null, city: location.city || null, sex: detail.sex ? String(detail.sex) : null, birthday: detail.birthday ? String(detail.birthday) : null } : null;
var saved = saveVerification(principalId, { guardian_principal_id: principalId, verification_status: 'verified', verified_at: now, verification_method: 'juhe_idcard_name_match+idcard_lookup', evidence_reference: String(authResult.orderid || ''), risk_level: 'normal', reviewed_by: 'system', provider: 'juhe', request_no: String(authResult.orderid || ''), legal_name: name, id_number_hash: cardHash, id_number_tail: card.slice(-4), failure_code: lookupOk ? null : 'lookup_unavailable', response_digest: sha256(String(auth.error_code) + '|' + String(authResult.res) + '|' + String(lookup.resultcode || '') + '|' + String(lookup.error_code || '')), lookup_summary: summary });
context.runGql('GrantGuardianRole', 'mutation GrantGuardianRole($object: user_role_assignment_insert_input!) { insert_user_role_assignment_one(object: $object, on_conflict: {constraint: user_role_assignment_principal_role_unique, update_columns: [status, granted_at, revoked_at, grant_reason]}) { id } }', { object: { user_principal_id: principalId, role_code: 'guardian', status: 'active', granted_at: now, revoked_at: null, grant_reason: 'identity_verification' } }, { role: 'admin' });
context.setResult({ success: true, duplicate: false, message: lookupOk ? '实名认证成功' : '实名认证成功，资料解析暂不可用', recordId: saved.id, province: lookupOk ? (location.province || null) : null, city: lookupOk ? (location.city || null) : null, sex: lookupOk && detail.sex ? String(detail.sex) : null, birthday: lookupOk && detail.birthday ? String(detail.birthday) : null, verify: null, maskedIdCard: maskCard(card) });
