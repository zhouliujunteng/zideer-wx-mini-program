const id = context.getArg('accountId');
if (!id) throw new Error('PHONE_REQUIRED');
const result = context.runGql('RequirePhone', 'query RequirePhone($id:bigint!){account(where:{id:{_eq:$id},fz_deleted:{_eq:false}},limit:1){fz_phone_number}}', {id}, {role:'admin'});
if (!(result.account || []).some(account => String(account.fz_phone_number || '').trim())) throw new Error('PHONE_REQUIRED');
