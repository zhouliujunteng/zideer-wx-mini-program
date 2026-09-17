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
  'query ReadCurrentLearningProfile($principalId: bigint!) { user_profile(where: { user_principal_id: { _eq: $principalId } }, limit: 1) { id nickname account_type gender real_name avatar_id avatar { id url } birthday birthday_change_used status current_grade school_stage semester school_name textbook_version region_detail profile_completed_at } }',
  { principalId: identity.user_principal_id },
  { role: 'admin' }
);
const profile = (profileResult.user_profile || [])[0] || null;
if (profile) {
  const principal = context.runGql('ReadProfilePublicId', 'query ReadProfilePublicId($principalId:bigint!){user_principal(where:{id:{_eq:$principalId}},limit:1){public_id}}', { principalId: identity.user_principal_id }, { role: 'admin' });
  profile.public_id = (principal.user_principal || [])[0].public_id;
}
context.setResult(profile);
