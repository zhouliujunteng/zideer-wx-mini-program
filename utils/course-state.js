const learnable = ['ready', 'in_progress', 'lesson_completed', 'awaiting_acceptance', 'passed']
const terminal = ['closed', 'voided_credit_limit', 'voided_quality_issue', 'failed', 'cancelled', 'completed']
const generationStages = {
  initializing: '正在准备课程', researching: '正在整理课程资料', generating_outlines: '正在编写课程大纲',
  generating_scenes: '正在生成课程内容', generating_media: '正在生成图片与视频', generating_tts: '正在生成课程讲解音频',
  persisting: '正在保存课程', reporting_ready: '正在同步课程并结算积分', completed: '正在确认课程可用状态',
  callback_retry_required: '课程内容已生成，正在同步可用状态'
}

function validProgress(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
}

function courseTaskProgress(course, planJob, itemStatus) {
  const status = course && course.status || itemStatus
  const job = course && course.generationJob || planJob || {}
  if (['done', 'passed', 'completed'].includes(itemStatus)) return { progress: 100, progressText: '100%', progressLabel: '已完成' }
  if (course && learnable.includes(status) && course.contentVersionRef) {
    const learned = validProgress(course.learningProgress) ? Math.round(course.learningProgress) : null
    if (learned !== null && learned > 0) return { progress: learned, progressText: `${learned}%`, progressLabel: '学习进度' }
    return { progress: 100, progressText: '已生成', progressLabel: '待学习' }
  }
  if (terminal.includes(status)) return { progress: 0, progressText: status.startsWith('voided') ? '已作废' : '已结束', progressLabel: '生成结束' }
  if (validProgress(job.progress)) {
    const progress = Math.min(99, Math.round(job.progress))
    return { progress, progressText: `${progress}%`, progressLabel: '生成中' }
  }
  return { progress: 0, progressText: job.progressSyncFailed ? '同步中' : job.status === 'queued' ? '排队中' : status === 'locked' ? '待解锁' : job.status ? '生成中' : '待生成', progressLabel: '课程状态' }
}
const states = {
  planned: { label: '等待生成', detail: '课程已纳入学习计划，正在等待生成任务开始。', tone: 'pending' },
  available: { key: 'planned', label: '等待生成', detail: '获取本次课程报价后即可确认生成。', tone: 'pending' },
  locked: { label: '任务尚未解锁', detail: '请先完成前置学习任务。', tone: 'pending' },
  queued: { label: '等待生成', detail: '课程生成任务已排队。', tone: 'pending' },
  generating: { label: '课程生成中', detail: '正在生成本节课程内容。', tone: 'working' },
  usage_collecting: { key: 'generating', label: '课程生成中', detail: '正在生成课程并同步本次生成用量。', tone: 'working' },
  validating: { label: '内容校验中', detail: '正在校验课程内容与学习目标。', tone: 'working' },
  settling: { key: 'validating', label: '积分结算中', detail: '正在按已确认的实际用量结算课程积分。', tone: 'working' },
  ready: { label: '课程已就绪', detail: '课程内容已准备完成，可以开始学习。', tone: 'ready' },
  in_progress: { label: '学习进行中', detail: '可以继续上次的课程学习。', tone: 'ready' },
  lesson_completed: { label: '需要复述', detail: '课程学习已完成，可以开始复述。', tone: 'ready' },
  awaiting_acceptance: { label: '需要复述', detail: '课程学习已完成，可以开始复述。', tone: 'ready' },
  ai_verified_passed: { label: 'AI 验收通过', detail: '知识点已进入学习宇宙。', tone: 'complete' },
  ai_retake_required: { label: '需继续巩固', detail: '复述证据不足，可重新学习后再验收。', tone: 'ready' },
  passed: { label: '课程已通过', detail: '可以再次打开课程复习。', tone: 'ready' },
  completed: { label: '课程已完成', detail: '本节课程已完成，等待后续验收或下一项任务。', tone: 'ready' },
  failed: { label: '生成失败', detail: '课程生成未完成，请稍后刷新学习计划。', tone: 'error' },
  cancelled: { label: '课程已取消', detail: '本次课程已取消，不可继续进入。', tone: 'error' },
  closed: { label: '课程已关闭', detail: '本次课程已关闭，无法继续进入。', tone: 'error' },
  voided_credit_limit: { key: 'voided', label: '课程已作废', detail: '本次课程超过结算上限，已作废且不可访问。', tone: 'error' },
  voided_quality_issue: { key: 'voided', label: '课程已作废', detail: '课程因质量问题被停用，不可访问。', tone: 'error' }
}

function canRetryCourseGeneration(course) {
  return Boolean(course && ['failed', 'cancelled', 'voided_credit_limit'].includes(course.status) &&
    course.creditSettlement && course.creditSettlement.status === 'released' && course.generationJob &&
    ['failed', 'cancelled', 'limit_exceeded_cancelled'].includes(course.generationJob.status))
}

function courseGenerationState(course, planGenerationJob, fallbackStatus = 'planned') {
  const courseStatus = String(course && course.status || fallbackStatus).toLowerCase()
  const job = course && course.generationJob || planGenerationJob
  const jobStatus = String(job && job.status || '').toLowerCase()
  const status = course && (learnable.includes(courseStatus) || terminal.includes(courseStatus))
    ? courseStatus : jobStatus || courseStatus
  const hasContent = Boolean(String(course && (course.contentVersionRef || course.content_version_ref) || '').trim())
  const canLaunch = Boolean(course && learnable.includes(courseStatus) && hasContent)
  const synchronizing = !canLaunch && (learnable.includes(status) || (status === 'completed' && courseStatus !== 'completed'))
  let state = synchronizing
    ? { key: 'validating', label: '课程内容同步中', detail: '正在确认课程可用状态，请稍候。', tone: 'working' }
    : states[status] || { key: 'unknown', label: '课程状态待确认', detail: '暂时无法确认当前课程状态，请刷新后查看。', tone: 'pending' }
  if (!canLaunch && !terminal.includes(courseStatus) && job && generationStages[job.stage]) {
    state = { ...state, label: generationStages[job.stage], detail: `${generationStages[job.stage]}${validProgress(job.progress) ? `，生成进度 ${Math.min(99, Math.round(job.progress))}%` : ''}。` }
  }
  if (!canLaunch && !terminal.includes(courseStatus) && job && job.progressSyncFailed) {
    state = { ...state, detail: '生成进度暂时未同步，正在重新查询；课程任务仍在后台处理。' }
  }
  return {
    ...state,
    key: state.key || status,
    status,
    courseStatus: status,
    canLaunch,
    canPoll: !canLaunch && (synchronizing || ['queued', 'generating', 'usage_collecting', 'validating', 'settling'].includes(status)),
    canStartAcceptance: Boolean(course && hasContent && ['lesson_completed', 'awaiting_acceptance', 'completed'].includes(courseStatus)),
    launchLabel: courseStatus === 'in_progress' ? '继续学习' : courseStatus === 'ready' ? '开始学习' : '复习课程'
  }
}

function courseCreditState(settlement) {
  if (!settlement) return null
  const status = String(settlement.status || '').toLowerCase()
  const amount = (value) => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0
    ? Math.round(Number(value)) : null
  if (status === 'released') {
    const returned = amount(settlement.voidedCredits)
    return returned === null
      ? { summary: '积分已释放', note: '本次冻结积分已释放。' }
      : { summary: `已退回 ${returned} 积分`, note: `本次冻结积分已退回 ${returned} 积分。` }
  }
  const actual = amount(settlement.actualCredits)
  if ((!status || status === 'settled') && actual !== null) {
    const returned = amount(settlement.returnedCredits)
    return { summary: `已结算 ${actual} 积分`, note: `实际结算 ${actual} 积分${returned ? `，退回 ${returned} 积分` : ''}` }
  }
  const frozen = amount(settlement.frozenCredits)
  if ((!status || status === 'frozen') && frozen !== null) {
    return { summary: `已冻结 ${frozen} 积分`, note: `已冻结 ${frozen} 积分，等待最终结算。` }
  }
  return null
}

module.exports = { courseGenerationState, courseCreditState, canRetryCourseGeneration, courseTaskProgress }
