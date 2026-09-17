// Zion synchronous custom-code node; accountId is bound to the server login template.
const accountId = context.getArg('accountId');
if (!accountId) throw new Error('请先登录。');
const identityResult = context.runGql('ResolveProfileOwner', 'query ResolveProfileOwner($accountId:bigint!){account_identity(where:{account_id:{_eq:$accountId},disabled_at:{_is_null:true}},limit:1){user_principal_id}}', {accountId}, {role:'admin'});
const identity = (identityResult.account_identity || [])[0];
if (!identity || !identity.user_principal_id) throw new Error('登录身份不可用，请重新登录。');
const principalId = identity.user_principal_id;
const ownerResult = context.runGql('CheckProfileOwner', 'query CheckProfileOwner($id:bigint!){user_principal(where:{id:{_eq:$id},status:{_eq:"active"}},limit:1){id}}', {id:principalId}, {role:'admin'});
if (!(ownerResult.user_principal || []).length) throw new Error('当前账号不可修改资料。');
function textArg(key, max) {
  const value = String(context.getArg(key) || '').trim();
  if (!value || value.length > max) throw new Error('请填写完整且长度合适的个人资料。');
  return value;
}
const grade = Number(context.getArg('grade'));
// grade = 0 表示「都不是」（不在常规年级中）：允许为空学段与学期。
if (!Number.isInteger(grade) || grade < 0 || grade > 12) throw new Error('请选择有效年级。');
const term = String(context.getArg('semester') || '').trim().toLowerCase();
const semester = ['上学期','上册','秋季','first'].includes(term) ? '上学期' : ['下学期','下册','春季','second'].includes(term) ? '下学期' : '';
if (grade > 0 && !semester) throw new Error('请选择上学期或下学期。');
const object = {
  user_principal_id: principalId,
  nickname: textArg('nickname', 24),
  current_grade: grade,
  school_stage: grade === 0 ? '' : grade <= 6 ? '小学' : grade <= 9 ? '初中' : '高中',
  semester: grade === 0 ? '' : semester,
  school_name: textArg('school_name', 50),
  // 「都不是」（grade=0）没有教材概念：允许为空
  textbook_version: grade === 0 ? String(context.getArg('textbook_version') || '').trim() : textArg('textbook_version', 40),
  region_detail: textArg('region_detail', 40),
  profile_completed_at: new Date().toISOString()
};
const columns = ['nickname','current_grade','school_stage','semester','school_name','textbook_version','region_detail','profile_completed_at'];
const details = context.getArg('personal_details');
if (details != null) {
  if (typeof details !== 'object' || Array.isArray(details) || Object.keys(details).some(key => !['birthday','avatar_id','account_type','gender'].includes(key))) throw new Error('个人资料参数无效。');
  if (Object.prototype.hasOwnProperty.call(details, 'account_type')) {
    if (!['student','guardian'].includes(details.account_type)) throw new Error('请选择学生或家长身份。');
    object.account_type = details.account_type;
    columns.push('account_type');
  }
  if (Object.prototype.hasOwnProperty.call(details, 'gender')) {
    const gender = details.gender;
    if (gender !== null && gender !== '' && !['male','female'].includes(gender)) throw new Error('请选择有效的性别。');
    object.gender = gender || null;
    columns.push('gender');
  }
  if (Object.prototype.hasOwnProperty.call(details, 'birthday')) {
    const birthday = details.birthday;
    if (birthday !== null && birthday !== '') {
      const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
      const date = new Date(String(birthday) + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) || birthday < '1900-01-01' || birthday > today || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== birthday) throw new Error('请选择有效的出生日期。');
    }
    // 生日首次设置后仅允许修改一次：birthday_change_used 为 true 后拒绝再次修改。
    const existingRow = (context.runGql('ReadOwnBirthday', 'query ReadOwnBirthday($id:bigint!){user_profile(where:{user_principal_id:{_eq:$id}},limit:1){birthday birthday_change_used}}', {id:principalId}, {role:'admin'}).user_profile || [])[0] || null;
    const currentBirthday = existingRow ? String(existingRow.birthday || '') : '';
    const incomingBirthday = birthday === null || birthday === '' ? '' : String(birthday);
    if (!incomingBirthday && currentBirthday) {
      // 已设置的生日不接受清空：忽略空值，避免编辑页本地空值误覆盖。
    } else if (!currentBirthday || incomingBirthday === currentBirthday) {
      object.birthday = incomingBirthday || null;
      columns.push('birthday');
    } else if (existingRow && existingRow.birthday_change_used === true) {
      throw new Error('生日仅能在首次设置后修改一次，修改机会已用完。');
    } else {
      object.birthday = incomingBirthday;
      object.birthday_change_used = true;
      columns.push('birthday');
      columns.push('birthday_change_used');
    }
  }
  if (Object.prototype.hasOwnProperty.call(details, 'avatar_id')) {
    const id = String(details.avatar_id || '');
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('头像上传信息无效，请重新选择。');
    object.avatar_id = id;
    columns.push('avatar_id');
  }
}
const result = context.runGql('SaveOwnProfile', 'mutation SaveOwnProfile($object:user_profile_insert_input!,$columns:[user_profile_update_column!]!){insert_user_profile_one(object:$object,on_conflict:{constraint:user_profile_user_principal_id_key,update_columns:$columns}){id}}', {object,columns}, {role:'admin'});
if (!result.insert_user_profile_one) throw new Error('资料未保存，请重试。');
// 档案完成即保证零余额权益账户存在；on_conflict 幂等，编辑档案与并发创建（签到/兑换/管理端）均无副作用。
// 账户创建失败不阻断档案保存，消费端（兑换/签到）仍各有兜底。
try {
  context.runGql('EnsureStudentBenefitAccounts', 'mutation EnsureStudentBenefitAccounts($profileId:bigint!){credit:insert_learner_credit_account_one(object:{learner_profile_id:$profileId,status:"active",available_credits:0,frozen_credits:0,consumed_credits:0,expired_credits:0},on_conflict:{constraint:learner_credit_account_learner_profile_id_key,update_columns:[]}){id} coin:insert_coin_account_one(object:{learner_profile_id:$profileId,status:"active",available_coins:0,frozen_coins:0,withdrawn_coins:0,expired_coins:0},on_conflict:{constraint:coin_account_learner_profile_id_key,update_columns:[]}){id}}', {profileId: result.insert_user_profile_one.id}, {role:'admin'});
} catch (error) {}
context.setResult(result.insert_user_profile_one.id);
