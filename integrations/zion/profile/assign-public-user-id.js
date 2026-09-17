// Runs after identity initialization, inside the same synchronous transaction.
const accountId = context.getArg('accountId');
if (!accountId) throw new Error('请先登录。');
function query(name, gql, variables) { return context.runGql(name, gql, variables, { role: 'admin' }); }
const identity = (query('PublicIdOwner', 'query PublicIdOwner($accountId:bigint!){account_identity(where:{account_id:{_eq:$accountId},disabled_at:{_is_null:true}},limit:1){user_principal_id}}', { accountId }).account_identity || [])[0];
if (!identity || !identity.user_principal_id) throw new Error('登录身份不可用，请重新登录。');
const principalId = identity.user_principal_id;
function readId() {
  const row = (query('ReadPublicId', 'query ReadPublicId($principalId:bigint!){user_principal(where:{id:{_eq:$principalId}},limit:1){id public_id}}', { principalId }).user_principal || [])[0];
  if (!row) throw new Error('用户资料不存在。');
  if (row.public_id != null && !/^[1-9][0-9]{5}$/.test(row.public_id)) throw new Error('用户编号异常，请联系服务人员。');
  return row.public_id;
}
let publicId = readId();
if (publicId) { context.setResult(publicId); return; }
const candidates = [];
for (let index = 0; index < 32; index++) candidates.push(String(100000 + Math.floor(Math.random() * 900000)));
const occupied = query('OccupiedPublicIds', 'query OccupiedPublicIds($candidates:[String!]!){user_principal(where:{public_id:{_in:$candidates}}){public_id}}', { candidates }).user_principal || [];
publicId = candidates.find(candidate => !occupied.some(row => row.public_id === candidate));
if (!publicId) throw new Error('PUBLIC_ID_RETRY');
try {
  // The null guard preserves a concurrent winner; the unique constraint prevents cross-user collisions.
  const result = query('AssignPublicId', 'mutation AssignPublicId($principalId:bigint!,$publicId:String!){update_user_principal(where:{id:{_eq:$principalId},public_id:{_is_null:true}},_set:{public_id:$publicId}){returning{public_id}}}', { principalId, publicId });
  const row = (result.update_user_principal.returning || [])[0];
  publicId = row ? row.public_id : readId();
} catch (error) {
  // A uniqueness error aborts PostgreSQL's transaction. Retry the whole flow, not another write here.
  if (/user_principal_public_id_unique/.test(String(error && error.message || error))) throw new Error('PUBLIC_ID_RETRY');
  throw error;
}
if (!publicId) throw new Error('PUBLIC_ID_RETRY');
context.setResult(publicId);
