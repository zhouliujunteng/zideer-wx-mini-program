const accountId = context.getArg('accountId');
if (!accountId) { context.setResult({ authenticated: false, phoneVerified: false }); return; }
const result = context.runGql('ReadPhoneLoginState', 'query ReadPhoneLoginState($id:bigint!){account(where:{id:{_eq:$id},fz_deleted:{_eq:false}},limit:1){id fz_phone_number}}', {id:accountId}, {role:'admin'});
const account = (result.account || [])[0];
const phone = String(account && account.fz_phone_number || '').trim();
context.setResult({ authenticated: !!account, phoneVerified: !!phone });
