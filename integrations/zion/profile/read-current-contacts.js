const buyerId = context.getArg("buyerId");
if (!buyerId) throw new Error("Login required.");

const identityResult = context.runGql("FindCurrentPrincipal", 'query FindCurrentPrincipal($buyerId: bigint!) { account_identity(where: { account_id: { _eq: $buyerId }, disabled_at: { _is_null: true } }, limit: 1) { user_principal_id } }', { buyerId }, { role: "admin" });
const currentIdentity = (identityResult.account_identity || [])[0];
if (!currentIdentity) throw new Error("Current account is not initialized.");

const result = context.runGql("ReadCurrentLoginIdentities", 'query ReadCurrentLoginIdentities($principalId: bigint!) { user_principal(where: { id: { _eq: $principalId } }, limit: 1) { id principal_no status created_source merged_at suspended_at account_identities(order_by: { created_at: asc }) { id login_channel is_default verified_at last_login_at disabled_at } role_assignments(where: { status: { _eq: "active" } }, order_by: { granted_at: asc }) { role_code status granted_at } guardian_verification { verification_status verified_at expires_at verification_method risk_level } } }', { principalId: currentIdentity.user_principal_id }, { role: "admin" });
const principal = (result.user_principal || [])[0];
if (!principal) throw new Error("Business principal is unavailable.");

const accountResult = context.runGql('ReadOwnContacts', 'query ReadOwnContacts($id:bigint!){account(where:{id:{_eq:$id}},limit:1){fz_phone_number fz_email}}', {id:buyerId}, {role:'admin'});
const account = (accountResult.account || [])[0];
if (!account) throw new Error('当前登录账号不可用。');
const phone = String(account.fz_phone_number || '').trim();
const email = String(account.fz_email || '').trim();
principal.contacts = {
  phone: phone ? (phone.length > 7 ? phone.slice(0,3) + '****' + phone.slice(-4) : '已绑定（已隐藏）') : null,
  email: email ? (email.indexOf('@') > 0 ? email.slice(0,1) + '***' + email.slice(email.indexOf('@')) : '已绑定（已隐藏）') : null
};
context.setResult({ principal });
