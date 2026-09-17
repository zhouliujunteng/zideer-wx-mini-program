/**
 * 智能体对话页「学习选项」：参考我的宇宙 + 三选一学习模式。
 *
 * 选项不改变用户看到的气泡文字，而是作为附录拼在发给课程智能体的消息末尾：
 *   用户原话
 *
 *   <zhilu-learner-context>          ← 仅「参考我的宇宙」开启且本会话尚未发送过基本盘时
 *   {...学习基本盘 JSON...}
 *   </zhilu-learner-context>
 *   【知鹿学习选项】参考我的宇宙：开 · 学习模式：零基础学习
 *   /learner-baseline-interview /zero-foundation
 *
 * 句柄放在末尾而不是开头：开头的句柄会被服务端冻结为整个会话的 skillId，
 * 用户中途切换模式就不生效了；写在正文任意位置的句柄每一轮都会被预加载。
 * 后端技能说明见 OpenMAIC-sync/skills/agent-runtime/learner-baseline-interview。
 */

const BASELINE_SKILL = 'learner-baseline-interview'
const CONTEXT_TAG = 'zhilu-learner-context'
const OPTIONS_MARK = '【知鹿学习选项】'

const LEARNING_MODES = [
  { id: 'zero-foundation', label: '零基础学习', skill: 'zero-foundation' },
  { id: 'study-plan', label: '制定学习计划', skill: 'curriculum-planner' },
  { id: 'deep-interactive', label: '深度交互学习', skill: 'deep-interactive' }
]

function findLearningMode(modeId) {
  return LEARNING_MODES.find((mode) => mode.id === modeId) || null
}

/** 三个模式互斥；再次点击当前模式即关闭。 */
function toggleLearningMode(currentModeId, tappedModeId) {
  if (!findLearningMode(tappedModeId)) return currentModeId || ''
  return currentModeId === tappedModeId ? '' : tappedModeId
}

function optionsSignature({ universe, modeId }) {
  return `${universe ? 1 : 0}|${modeId || ''}`
}

// JSON 里不允许出现能提前闭合标签的尖括号
function encodeContextJson(value) {
  return JSON.stringify(value).replace(/[<>&]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

/**
 * 组装发往智能体的文本。
 * @param {object} input
 * @param {string} input.text            用户原话（气泡里显示的内容）
 * @param {boolean} input.universe       参考我的宇宙
 * @param {string} input.modeId          学习模式 id，可为空
 * @param {object|null} input.baseline   summarizeLearnerBaseline 的结果，未开启或读取失败为 null
 * @param {boolean} input.attachOptions  是否附加选项行（会话首条或选项变化时）
 * @param {boolean} input.attachBaseline 是否附加基本盘（开启宇宙且本会话尚未发送过）
 */
function buildAgentMessageText({ text, universe, modeId, baseline, attachOptions, attachBaseline }) {
  const body = String(text || '').trim()
  if (!attachOptions && !attachBaseline) return body
  const parts = [body, '']
  if (attachBaseline && universe) {
    const context = baseline || { status: 'unavailable', note: '学习基本盘暂时读取失败，请按没有档案处理并完整摸底。' }
    parts.push(`<${CONTEXT_TAG}>`, encodeContextJson(context), `</${CONTEXT_TAG}>`)
  }
  const mode = findLearningMode(modeId)
  parts.push(`${OPTIONS_MARK}参考我的宇宙：${universe ? '开' : '关'} · 学习模式：${mode ? mode.label : '未选择'}`)
  const handles = [BASELINE_SKILL].concat(mode ? [mode.skill] : [])
  parts.push(handles.map((handle) => `/${handle}`).join(' '))
  return parts.join('\n')
}

/** 回放/历史里的用户消息去掉附录，只保留用户原话。 */
function stripLearningAppendix(text) {
  const value = String(text || '')
  const indexes = [value.indexOf(`<${CONTEXT_TAG}>`), value.indexOf(OPTIONS_MARK)].filter((index) => index >= 0)
  if (!indexes.length) return value
  return value.slice(0, Math.min(...indexes)).trim()
}

module.exports = {
  BASELINE_SKILL,
  LEARNING_MODES,
  findLearningMode,
  toggleLearningMode,
  optionsSignature,
  buildAgentMessageText,
  stripLearningAppendix
}
