// 奖杯 / 勋章「拿在手里转」的画法（2026-11-13 用户要求：照小米汽车勋章那样，随手机转动有反光）。
// 纯画布绘制，不依赖小程序接口：components/honor-shine 和本地预览页共用。
//
// - tiltX / tiltY ∈ [-1, 1]：手机左右 / 前后倾的程度（或手指拖动、没有陀螺仪时的自动摆动）。
// - 倾斜：用仿射变换近似三维转动（横向压窄 + 轻微错切），不用每帧 setData 改样式。
// - 反光：一条斜的高光带随倾斜扫过，用 source-atop 只画在图案自己的像素上（图是透明底 PNG）；
//   再叠一层很淡的冷暖色，转动时金属有一点变色。
// - flip ∈ [0, 1]：进场翻转的进度（0 = 刚出现，1 = 停稳），像硬币转一圈半后落定。

const MAX_ANGLE = 0.46 // 约 26°
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3)

/**
 * @param ctx 2d 画布上下文（已按像素比缩放好，画布逻辑边长 size）
 * @param image 已加载的图（方图）
 * @param size 画布逻辑边长
 * @param state { tiltX, tiltY, flip }
 */
function drawHonor(ctx, image, size, state) {
  const tiltX = clamp(state.tiltX || 0, -1, 1)
  const tiltY = clamp(state.tiltY || 0, -1, 1)
  const flip = state.flip === undefined ? 1 : clamp(state.flip, 0, 1)
  const settle = easeOut(flip)
  // 进场：绕竖轴转一圈半（540° → 0），越转越慢
  const spin = (1 - settle) * Math.PI * 3
  const ry = tiltX * MAX_ANGLE + spin
  const rx = tiltY * MAX_ANGLE
  const half = size / 2
  const art = size * 0.8 // 图案占画布的比例，四周留出倾斜和阴影的余地
  const scale = 0.6 + 0.4 * settle

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  const ratio = ctx.canvas.width / size
  ctx.scale(ratio, ratio)
  ctx.globalAlpha = clamp(flip * 4, 0, 1)

  // 地上的影子：往倾斜的反方向挪一点
  ctx.save()
  ctx.translate(half - tiltX * size * 0.05, size * 0.93)
  ctx.scale(1, 0.16)
  const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, art * 0.42 * scale)
  shadow.addColorStop(0, 'rgba(30, 24, 12, 0.28)')
  shadow.addColorStop(1, 'rgba(30, 24, 12, 0)')
  ctx.fillStyle = shadow
  ctx.beginPath()
  ctx.arc(0, 0, art * 0.42 * scale, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // 图案 + 反光
  const cosY = Math.cos(ry)
  ctx.save()
  ctx.translate(half, half * 0.96)
  ctx.transform(cosY * scale, Math.sin(ry) * 0.1 * scale, Math.sin(rx) * 0.1 * scale, Math.cos(rx) * scale, 0, 0)
  ctx.drawImage(image, -art / 2, -art / 2, art, art)
  ctx.globalCompositeOperation = 'source-atop'
  // 背面（翻转时转到背后）压暗一点
  if (cosY < 0) {
    ctx.fillStyle = 'rgba(20, 16, 10, 0.45)'
    ctx.fillRect(-art / 2, -art / 2, art, art)
  }
  // 高光带：位置跟着倾斜走
  const sweep = (tiltX * 0.75 - tiltY * 0.35 + (1 - settle) * 1.6) * art
  const band = ctx.createLinearGradient(sweep - art * 0.55, -art * 0.3, sweep + art * 0.55, art * 0.3)
  band.addColorStop(0, 'rgba(255, 255, 255, 0)')
  band.addColorStop(0.42, 'rgba(255, 255, 255, 0)')
  band.addColorStop(0.5, 'rgba(255, 255, 255, 0.62)')
  band.addColorStop(0.58, 'rgba(255, 255, 255, 0)')
  band.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = band
  ctx.fillRect(-art, -art, art * 2, art * 2)
  // 第二条细一点的，离得远一些
  const thin = ctx.createLinearGradient(sweep - art * 1.05, -art * 0.3, sweep - art * 0.25, art * 0.3)
  thin.addColorStop(0, 'rgba(255, 255, 255, 0)')
  thin.addColorStop(0.5, 'rgba(255, 255, 255, 0.26)')
  thin.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = thin
  ctx.fillRect(-art, -art, art * 2, art * 2)
  // 冷暖变色
  const tint = ctx.createLinearGradient(-art / 2, -art / 2, art / 2, art / 2)
  const warm = 0.1 * Math.max(0, tiltX) + 0.04
  const cool = 0.1 * Math.max(0, -tiltX) + 0.04
  tint.addColorStop(0, `rgba(255, 196, 120, ${warm})`)
  tint.addColorStop(1, `rgba(120, 170, 255, ${cool})`)
  ctx.fillStyle = tint
  ctx.fillRect(-art / 2, -art / 2, art, art)
  ctx.globalCompositeOperation = 'source-over'
  ctx.restore()
  ctx.globalAlpha = 1
}

/** 手机姿态（度）相对刚打开时的姿态 → tilt。gamma 左右倾，beta 前后倾。 */
function tiltFromMotion(motion, base) {
  const dx = (Number(motion.gamma) || 0) - (Number(base.gamma) || 0)
  let dy = (Number(motion.beta) || 0) - (Number(base.beta) || 0)
  if (dy > 180) dy -= 360
  if (dy < -180) dy += 360
  return { x: clamp(dx / 28, -1, 1), y: clamp(dy / 28, -1, 1) }
}

/** 没有陀螺仪时自己慢慢摆。t 毫秒。 */
function idleTilt(t) {
  return { x: Math.sin(t / 1300) * 0.55, y: Math.sin(t / 1900 + 1) * 0.25 }
}

module.exports = { drawHonor, tiltFromMotion, idleTilt, clamp }
