// 彩色纸屑（成就卡抽卡揭晓、碎片商店兑换共用）：2d 画布上从一点炸开、带重力飘落，约 1.9 秒后淡掉。
// owner 是页面或组件（用它的 createSelectorQuery，组件里才找得到自己的画布）；alive() 返回 false 时提前停。
const CONFETTI_MS = 1900
const COLORS = ['#FF5A5F', '#FFB400', '#00C2A8', '#4F8BFF', '#B06BFF', '#7ED957', '#FF8A3D', '#FF6FB5', '#38D0F5']

function burstConfetti(owner, selector, origin, alive = () => true, count = 150) {
  let query
  try {
    query = owner.createSelectorQuery ? owner.createSelectorQuery() : wx.createSelectorQuery()
  } catch (error) {
    return
  }
  query.select(selector).fields({ node: true, size: true }).exec((res) => {
    const target = res && res[0]
    const canvas = target && target.node
    if (!canvas || !canvas.getContext) return
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const dpr = info.pixelRatio || 2
    canvas.width = target.width * dpr
    canvas.height = target.height * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    const spread = origin.spread || 120
    const pieces = []
    for (let i = 0; i < count; i += 1) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.25
      const speed = 6 + Math.random() * 11
      pieces.push({
        x: origin.x + (Math.random() - 0.5) * spread,
        y: origin.y + (Math.random() - 0.5) * 30,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: 3 + Math.random() * 2,
        h: 8 + Math.random() * 5,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        color: COLORS[i % COLORS.length]
      })
    }
    const started = Date.now()
    const raf = canvas.requestAnimationFrame ? canvas.requestAnimationFrame.bind(canvas) : (fn) => setTimeout(fn, 16)
    const frame = () => {
      const t = Date.now() - started
      ctx.clearRect(0, 0, target.width, target.height)
      if (t > CONFETTI_MS || !alive()) return
      ctx.globalAlpha = t > CONFETTI_MS - 450 ? Math.max(0, (CONFETTI_MS - t) / 450) : 1
      pieces.forEach((p) => {
        p.vx *= 0.985
        p.vy = p.vy * 0.985 + 0.38
        p.x += p.vx
        p.y += p.vy
        p.r += p.vr
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.r)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      })
      raf(frame)
    }
    raf(frame)
  })
}

module.exports = { burstConfetti }
