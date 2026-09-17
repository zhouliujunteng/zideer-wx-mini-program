/**
 * 流式回复的「匀速吐字 + 逐字渐显」。
 *
 * 服务端的 message_update 往往成批到达（一次几十个字），直接展示会一块一块往外蹦。
 * 这里把服务端快照当作目标文本，按固定节拍匀速释放字符：积压越多释放越快，
 * 既不会明显落后，也不会整块跳出。每个字从释放时刻起在 FADE_MS 内由浅到深，
 * 通过给 rich-text 尾部字符包 opacity 渐变的 span 实现（节点每帧重建，CSS 动画无法持续）。
 *
 * 纯逻辑，时间由调用方传入，便于 node --test 单测。
 */

const REVEAL_TICK_MS = 50
const FADE_MS = 420
const MIN_OPACITY = 0.12
// 正常流式：约 0.8 秒追平积压；回复已结束：约 0.4 秒收尾
const CATCH_UP_TICKS = 16
const FINAL_CATCH_UP_TICKS = 8
// 单帧最多处理的渐变尾巴长度，避免长文本每帧遍历全部字符
const MAX_FADE_CHARS = 80

function easeOut(progress) {
  const p = Math.min(1, Math.max(0, progress))
  return 1 - (1 - p) * (1 - p)
}

function createStreamReveal() {
  let target = []
  let shown = 0
  let final = false
  let batches = []

  function setTarget(text, { final: isFinal = false } = {}) {
    const next = Array.from(String(text || ''))
    // 快照不是在原文基础上追加（极少见的改写）：退回到公共前缀重新吐字
    let common = 0
    const limit = Math.min(shown, next.length)
    while (common < limit && next[common] === target[common]) common += 1
    if (common < shown) {
      shown = common
      batches = batches
        .filter((batch) => batch.start < common)
        .map((batch) => ({ ...batch, end: Math.min(batch.end, common) }))
    }
    target = next
    if (isFinal) final = true
  }

  function tick(now) {
    const backlog = target.length - shown
    if (backlog > 0) {
      const step = Math.max(1, Math.ceil(backlog / (final ? FINAL_CATCH_UP_TICKS : CATCH_UP_TICKS)))
      batches.push({ start: shown, end: shown + step, time: now })
      shown += step
    }
    batches = batches.filter((batch) => now - batch.time < FADE_MS + REVEAL_TICK_MS)
    return {
      text: target.slice(0, shown).join(''),
      shown,
      total: target.length,
      fading: batches.length > 0,
      done: final && shown >= target.length && batches.length === 0
    }
  }

  /** 第 index 个字符（按码点计）此刻的不透明度。 */
  function opacityAt(index, now) {
    const batch = batches.find((item) => index >= item.start && index < item.end)
    if (!batch) return 1
    // 同一批里的字按先后错开，批内也是逐字渐显
    const within = (index - batch.start) / Math.max(1, batch.end - batch.start)
    const age = now - (batch.time + within * REVEAL_TICK_MS)
    const opacity = MIN_OPACITY + (1 - MIN_OPACITY) * easeOut(age / FADE_MS)
    return Math.round(opacity * 100) / 100
  }

  return {
    setTarget,
    tick,
    opacityAt,
    get target() { return target.join('') },
    get final() { return final }
  }
}

const HTML_TOKEN = /(<[^>]*>)|(&#?[a-zA-Z0-9]+;)|([\uD800-\uDBFF][\uDC00-\uDFFF]|[\s\S])/g

/**
 * 给 rich-text HTML 尾部的可见字符包上 opacity。
 * opacityForDistance(d)：距末尾第 d 个可见字符（0 = 最新）的不透明度，返回 1 表示不再需要包裹。
 * Markdown 语法符号不会出现在 HTML 可见文本里，所以按「距末尾距离」对齐原文，尾部误差至多几个字。
 */
function fadeTailHtml(html, opacityForDistance) {
  const tokens = String(html || '').match(HTML_TOKEN) || []
  let distance = 0
  for (let i = tokens.length - 1; i >= 0 && distance < MAX_FADE_CHARS; i -= 1) {
    const token = tokens[i]
    if (token[0] === '<' && token.length > 1 && token[token.length - 1] === '>') continue
    const opacity = opacityForDistance(distance)
    distance += 1
    if (opacity >= 1) break
    tokens[i] = `<span style="opacity:${opacity};">${token}</span>`
  }
  return tokens.join('')
}

/**
 * 原文前缀 text 的尾部字符在全文中的码点下标，按距末尾距离排列（换行不计，
 * 因为换行在 HTML 里变成标签，不是可见字符）。
 */
function tailSourceIndexes(text) {
  const characters = Array.from(String(text || ''))
  const indexes = []
  for (let i = characters.length - 1; i >= 0 && indexes.length < MAX_FADE_CHARS; i -= 1) {
    if (characters[i] !== '\n' && characters[i] !== '\r') indexes.push(i)
  }
  return indexes
}

/**
 * 流式中途的最后一行常有未闭合的 **粗体** 或 `代码`，直接渲染会露出星号。
 * 临时补上闭合符号（不改原文），让粗体边打字边生效；补的是语法符号，不影响渐显对齐。
 */
function closeDanglingMarkers(text) {
  const source = String(text || '')
  const lastLine = source.slice(source.lastIndexOf('\n') + 1)
  if (/^\s*```/.test(lastLine)) return source
  let closing = ''
  const withoutCode = lastLine.replace(/`[^`]*`/g, '')
  if ((withoutCode.match(/`/g) || []).length % 2 === 1) return source + '`'
  if ((withoutCode.match(/\*\*/g) || []).length % 2 === 1) closing += '**'
  if (/\*\*$/.test(source) && closing) return source.slice(0, -2)
  return source + closing
}

/** 渲染一帧：Markdown → HTML，尾部按字符年龄渐显。 */
function renderRevealFrame(text, reveal, now, renderMarkdown) {
  const html = renderMarkdown(closeDanglingMarkers(text))
  const indexes = tailSourceIndexes(text)
  return fadeTailHtml(html, (distance) => (
    distance < indexes.length ? reveal.opacityAt(indexes[distance], now) : 1
  ))
}

module.exports = {
  REVEAL_TICK_MS,
  FADE_MS,
  MIN_OPACITY,
  createStreamReveal,
  fadeTailHtml,
  tailSourceIndexes,
  closeDanglingMarkers,
  renderRevealFrame
}
