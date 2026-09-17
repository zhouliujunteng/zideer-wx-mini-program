// Account, OpenID and access token come from server templates, never client inputs.
const accountId = context.getArg('accountId');
if (!accountId) throw new Error('PHONE_LOGIN_REQUIRED');
const current = context.runGql('PhoneBindingAccount', 'query PhoneBindingAccount($id:bigint!){account(where:{id:{_eq:$id},fz_deleted:{_eq:false}},limit:1){id fz_phone_number}}', {id:accountId}, {role:'admin'});
const account = (current.account || [])[0];
if (!account) throw new Error('PHONE_LOGIN_REQUIRED');
// Recover a completed bind after a lost response without consuming the one-time code again.
if (String(account.fz_phone_number || '').trim()) { context.setResult({phoneVerified:true}); return; }
const code = String(context.getArg('phoneCode') || '').trim();
const openid = String(context.getArg('openid') || '').trim();
const token = String(context.getArg('accessToken') || '').trim();
if (!/^[A-Za-z0-9_-]{16,512}$/.test(code)) throw new Error('PHONE_CODE_REQUIRED');
if (!openid || !token) throw new Error('PHONE_PROVIDER_UNAVAILABLE');
let response;
try {
  response = context.callThirdPartyApi('vlqerc842', {g6o8n4oui:token, ylm5isr74:{code,openid}});
} catch (_) { throw new Error('PHONE_PROVIDER_UNAVAILABLE'); }
if (!response || response.code < 200 || response.code >= 300) throw new Error('PHONE_PROVIDER_UNAVAILABLE');
let body = response.data;
if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { throw new Error('PHONE_PROVIDER_UNAVAILABLE'); } }
if (!body || body.errcode !== 0) {
  if (body && [40029,40163].includes(Number(body.errcode))) throw new Error('PHONE_CODE_EXPIRED');
  throw new Error('PHONE_PROVIDER_UNAVAILABLE');
}
const info = body.phone_info || {};
const pure = String(info.purePhoneNumber || '');
const country = String(info.countryCode || '');
if (!/^\d{1,4}$/.test(country) || !/^\d{5,15}$/.test(pure)) throw new Error('PHONE_PROVIDER_UNAVAILABLE');
const phone = country === '86' ? pure : '+' + country + pure;
const collision = context.runGql('CheckPhoneCollision', 'query CheckPhoneCollision($phone:String!,$id:bigint!){account(where:{fz_phone_number:{_eq:$phone},id:{_neq:$id}},limit:1){id}}', {phone,id:accountId}, {role:'admin'});
if ((collision.account || []).length) throw new Error('PHONE_ALREADY_BOUND');
// Unique constraints serialize competing binds; failed flows roll back the reservation.
try {
  context.runGql('ReserveVerifiedPhone', 'mutation ReserveVerifiedPhone($phone:String!,$id:bigint!,$at:timestamptz!){insert_phone_login_binding_one(object:{phone_number:$phone,account_id:$id,verified_at:$at}){id}}', {phone,id:accountId,at:new Date().toISOString()}, {role:'admin'});
} catch (_) { throw new Error('PHONE_ALREADY_BOUND'); }
let result;
try {
  result = context.runGql('BindVerifiedPhone', 'mutation BindVerifiedPhone($id:bigint!,$phone:String!){update_account(where:{id:{_eq:$id},fz_deleted:{_eq:false},_or:[{fz_phone_number:{_is_null:true}},{fz_phone_number:{_eq:""}}]},_set:{fz_phone_number:$phone}){affected_rows}}', {id:accountId,phone}, {role:'admin'});
} catch (_) { throw new Error('PHONE_BIND_FAILED'); }
if (!result.update_account || result.update_account.affected_rows !== 1) throw new Error('PHONE_BIND_CHANGED');
context.setResult({phoneVerified:true});
