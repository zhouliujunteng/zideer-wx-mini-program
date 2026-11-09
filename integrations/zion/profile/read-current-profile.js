// Deployed after profile/verified-identity.js (verifiedIdentity) by scripts/mp-admin/deploy-verified-profile.mjs.
const accountId = Number(context.getArg('accountId') || 0);

if (!accountId) {
  context.setResult(null);
  return;
}

const identityResult = context.runGql(
  'ReadCurrentProfileIdentity',
  'query ReadCurrentProfileIdentity($accountId: bigint!) { account_identity(where: { account_id: { _eq: $accountId }, disabled_at: { _is_null: true } }, limit: 1) { user_principal_id } }',
  { accountId },
  { role: 'admin' }
);
const identity = (identityResult.account_identity || [])[0];
if (!identity || !identity.user_principal_id) {
  context.setResult(null);
  return;
}

const profileResult = context.runGql(
  'ReadCurrentLearningProfile',
  'query ReadCurrentLearningProfile($principalId: bigint!) { user_profile(where: { user_principal_id: { _eq: $principalId } }, limit: 1) { id nickname account_type gender real_name avatar_id avatar { id url } birthday birthday_change_used status current_grade school_stage semester school_name textbook_version region_detail household_region profile_completed_at } guardian_verification(where: { guardian_principal_id: { _eq: $principalId }, verification_status: { _eq: "verified" } }, limit: 1) { lookup_summary id_number_tail } }',
  { principalId: identity.user_principal_id },
  { role: 'admin' }
);
const profile = (profileResult.user_profile || [])[0] || null;
if (profile) {
  const principal = context.runGql('ReadProfilePublicId', 'query ReadProfilePublicId($principalId:bigint!){user_principal(where:{id:{_eq:$principalId}},limit:1){public_id}}', { principalId: identity.user_principal_id }, { role: 'admin' });
  profile.public_id = (principal.user_principal || [])[0].public_id;
  // 实名认证后锁定的几项（2026-09-26 用户规则，推算见 verified-identity.js）：直接给身份证上的值
  // （实名时写回资料可能失败，或是规则上线前实名的），并告诉页面哪几项不能改
  const locked = verifiedIdentity((profileResult.guardian_verification || [])[0]) || {};
  ['birthday', 'gender', 'household_region'].forEach((key) => {
    profile[key + '_locked'] = Boolean(locked[key]);
    if (locked[key]) profile[key] = locked[key];
  });
}
context.setResult(profile);
