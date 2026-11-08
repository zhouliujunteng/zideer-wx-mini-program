// 读取当前家长学生看板（动作流 eb5ff197 / 节点 n5lvrlysl）。2026-09-25 从线上取回后扩充，供「学生看板」页（设计稿 M50）使用。
// 只读家长本人有效关系（active、未过期、未撤销）下的孩子；原有字段（诊断、估分、计划头、积分）原样保留，旧版小程序照常可用。
// 新增：近 60 天每日学习时长、当前学习状态、计划任务项、知识点验收报告、摸底测评错题摘要、老师陪跑预约。
// 摸底测评报告很大（每题带选项与解析），这里只挑出答错的题目标题与知识点，不把整份报告交给前端。
// 2026-10-11 起只读选中那一个孩子的完整数据（见下），其余孩子只有称呼、年级、头像。
const buyerId = context.getArg("buyerId");
if (!buyerId) throw new Error("Login required.");

const identityResult = context.runGql("FindGuardianPrincipal", 'query FindGuardianPrincipal($buyerId: bigint!) { account_identity(where: { account_id: { _eq: $buyerId } }, limit: 1) { user_principal_id } }', { buyerId }, { role: "admin" });
const principal = (identityResult.account_identity || [])[0];
if (!principal) throw new Error("Current account is not initialized.");

const HISTORY_DAYS = 60;
const nowMs = Date.now();
const sinceDate = new Date(nowMs + 8 * 3600000 - HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
const sinceTime = sinceDate + "T00:00:00+08:00";

// 2026-10-11 服务商：一个账号可能绑几十个孩子，一次读全部孩子的学习数据会很慢甚至超时。
// 改成先列孩子（只读称呼、年级、头像），再只读当前选中那一个孩子的完整数据；入参 payload.studentProfileId 指定看哪个，
// 不带或不在名下就看第一个（最近绑定的）。返回的 children 里只有选中那个带 detail_loaded 和完整数据。
const payload = context.getArg("payload");
const wanted = payload && typeof payload === "object" && payload.studentProfileId != null ? String(payload.studentProfileId) : "";

const listResult = context.runGql("ListGuardianDashboardChildren", 'query ListGuardianDashboardChildren($principalId: bigint!) { relations: guardian_student_relation(where: { guardian_principal_id: { _eq: $principalId }, status: { _eq: "active" }, revoked_at: { _is_null: true } }, order_by: { effective_at: desc }) { id relationship_type effective_at expires_at student_profile { id nickname real_name current_grade school_stage avatar { url } } } }', { principalId: principal.user_principal_id }, { role: "admin" });
const relations = (listResult.relations || []).filter(function (relation) {
  return relation.student_profile && (!relation.expires_at || Date.parse(relation.expires_at) > nowMs);
});
const selected = relations.filter(function (relation) { return String(relation.student_profile.id) === wanted; })[0] || relations[0] || null;

const detailResult = selected ? context.runGql("ReadGuardianDashboardChild", 'query ReadGuardianDashboardChild($relationId: bigint!, $sinceDate: date!, $sinceTime: timestamptz!) { relations: guardian_student_relation(where: { id: { _eq: $relationId } }, limit: 1) { student_profile { id diagnostic_reports(limit: 1, order_by: { generated_at: desc }) { id status summary confidence generated_at } score_predictions(limit: 1, order_by: { predicted_at: desc }) { id subject_code score_lower score_upper confidence predicted_at } learning_plans(limit: 1, order_by: { generated_at: desc }) { id plan_no name status start_at target_end_at planned_credits generated_at plan_items(order_by: { sequence_no: asc }) { id sequence_no status scheduled_at knowledge_topic { display_name } } } credit_account { available_credits frozen_credits } learning_time_rollups(where: { period_type: { _eq: "daily" }, period_start: { _gte: $sinceDate } }, order_by: { period_start: desc }) { period_start effective_seconds session_count } current_learning_state { state progress last_event_at knowledge_topic { display_name } } topic_learning_reports(limit: 30, order_by: { generated_at: desc }) { id report_no status teacher_review_status generated_at effective_seconds feynman_acceptance { id knowledge_topic { display_name } audio_assets(order_by: { segment_no: asc }) { duration_ms } } } k12_assessments(where: { status: { _eq: "submitted" }, submitted_at: { _gte: $sinceTime } }, limit: 30, order_by: { submitted_at: desc }) { id submitted_at exam_scope { name subject_code } report } received_agent_invites(where: { scheduled_online_at: { _gte: $sinceTime } }, limit: 30, order_by: { scheduled_online_at: desc }) { id subject_label scheduled_online_at meeting_minutes status teacher_profile { display_name } } } } }', { relationId: selected.id, sinceDate: sinceDate, sinceTime: sinceTime }, { role: "admin" }) : { relations: [] };

function text(value, max) {
  const clean = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

// 每次测评只留答错的题（作答了且不对），最多 10 道
function assessmentMistakes(attempt) {
  const report = attempt.report && typeof attempt.report === "object" ? attempt.report : {};
  const review = Array.isArray(report.review) ? report.review : [];
  const wrong = review.filter(function (item) { return item && item.correct !== true && item.selected; });
  const scope = attempt.exam_scope || {};
  return {
    id: attempt.id,
    submitted_at: attempt.submitted_at,
    scope_name: scope.name || "",
    subject_code: scope.subject_code || "",
    question_count: review.length,
    wrong_count: wrong.length,
    wrong: wrong.slice(0, 10).map(function (item) {
      return { number: item.number || null, prompt: text(item.prompt, 60), topic_name: text(item.topicName, 30) };
    })
  };
}

const detail = ((detailResult.relations || [])[0] || {}).student_profile || null;
const children = relations.map(function (relation) {
  if (relation !== selected || !detail) return relation;
  const attempts = detail.k12_assessments || [];
  delete detail.k12_assessments;
  detail.assessment_mistakes = attempts.map(assessmentMistakes);
  const profile = relation.student_profile;
  Object.keys(detail).forEach(function (key) { profile[key] = detail[key]; });
  relation.detail_loaded = true;
  return relation;
});

context.setResult({ status: children.length ? "ready" : "no-active-children", history_since: sinceDate, selected_student_profile_id: selected && detail ? selected.student_profile.id : null, children });
