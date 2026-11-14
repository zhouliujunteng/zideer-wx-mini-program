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

/* ------------------------------------------------------------------------------------------------
 * 三维画法（2026-11-13 夜，用户：「感觉是 2D 的，不是 3D 的感觉」）：WebGL。
 * - 实体：同一张图沿厚度方向叠十几层，侧面压暗，转起来能看到厚度（像一枚真的金属章）；
 * - 真透视：近大远小，不是平面错切；
 * - 光照在凹凸上：用图的明暗当高度算出每个像素的朝向，转动时高光、环境反光在浮雕上逐像素移动；
 * - 转到背面是一块压暗的金属背板。
 * 小程序 canvas type="webgl" 和浏览器预览共用。建不起来（不支持 WebGL）返回 null，调用方退回上面的二维画法。
 * ---------------------------------------------------------------------------------------------- */

const VERTEX = `
attribute vec2 aPos;
uniform vec2 uRot;
uniform float uZ;
uniform float uScale;
varying vec2 vUv;
void main() {
  vec3 p = vec3(aPos * uScale, uZ);
  float cy = cos(uRot.y), sy = sin(uRot.y), cx = cos(uRot.x), sx = sin(uRot.x);
  vec3 q = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
  vec3 r = vec3(q.x, q.y * cx - q.z * sx, q.y * sx + q.z * cx);
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(r.x, r.y + 0.04, 0.0, 1.0 - r.z * 0.42);
}`

const FRAGMENT = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform vec2 uTurn; // 和顶点着色器的 uRot 同一个值：两边精度不同，同名会链接失败
uniform float uFace;
uniform float uBack;
uniform float uAlpha;
varying vec2 vUv;
float lum(vec2 uv) { vec4 c = texture2D(uTex, uv); return dot(c.rgb, vec3(0.299, 0.587, 0.114)) * c.a; }
void main() {
  vec4 c = texture2D(uTex, vUv);
  float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 col;
  if (uFace < 0.5) {
    // 侧面：压暗，带一点原来的颜色
    col = c.rgb * 0.34 + vec3(0.03);
  } else {
    vec2 t = uTexel * 1.5;
    float hx = lum(vUv + vec2(t.x, 0.0)) - lum(vUv - vec2(t.x, 0.0));
    float hy = lum(vUv + vec2(0.0, t.y)) - lum(vUv - vec2(0.0, t.y));
    float relief = uBack > 0.5 ? 0.5 : 2.6; // 背面只留一点浮雕
    vec3 n = normalize(vec3(-hx * relief, hy * relief, 1.0));
    float cy = cos(uTurn.y), sy = sin(uTurn.y), cx = cos(uTurn.x), sx = sin(uTurn.x);
    vec3 q = vec3(n.x * cy + n.z * sy, n.y, -n.x * sy + n.z * cy);
    n = vec3(q.x, q.y * cx - q.z * sx, q.y * sx + q.z * cx);
    if (uBack > 0.5) n.z = -n.z;
    vec3 L = normalize(vec3(-0.45, 0.6, 0.75));
    float diffuse = max(dot(n, L), 0.0);
    vec3 R = reflect(-L, n);
    float spec = pow(max(R.z, 0.0), 22.0);
    // 环境反光：几条亮带，随朝向在金属上滑动
    vec3 E = reflect(vec3(0.0, 0.0, -1.0), n);
    float env = smoothstep(0.62, 0.98, sin(E.x * 7.0 + E.y * 3.5 + 0.8) * 0.5 + 0.5);
    float metal = smoothstep(0.2, 0.85, l);
    if (uBack > 0.5) {
      // 背面：压暗的金属背板，留一点正面图案的浮雕
      vec3 base = vec3(0.34, 0.33, 0.32) + vec3(0.10) * l;
      col = base * (0.6 + 0.6 * diffuse) + vec3(spec * 0.45 + env * 0.2);
    } else {
      col = c.rgb * (0.58 + 0.56 * diffuse) + (spec * 0.6 + env * 0.26) * (0.25 + 0.75 * metal) * mix(vec3(1.0), c.rgb, 0.35);
    }
  }
  gl_FragColor = vec4(col * c.a, c.a) * uAlpha;
}`

const LAYERS = 28 // 层数少了大角度时侧面会露出一道道缝
const DEPTH = 0.11 // 厚度（相对半宽）
const MAX_ANGLE_3D = 0.62 // 约 35°

/**
 * @param gl WebGL 上下文
 * @param image 已加载的图
 * @returns {{ draw(state): void, dispose(): void } | null}
 */
function createHonorRenderer(gl, image) {
  try {
    const compile = (type, source) => {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader')
      return shader
    }
    const program = gl.createProgram()
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link')
    gl.useProgram(program)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(program, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const uniform = (name) => gl.getUniformLocation(program, name)
    const u = { rot: uniform('uRot'), turn: uniform('uTurn'), z: uniform('uZ'), scale: uniform('uScale'), texel: uniform('uTexel'), face: uniform('uFace'), back: uniform('uBack'), alpha: uniform('uAlpha') }
    gl.uniform2f(u.texel, 1 / (image.width || 440), 1 / (image.height || 440))
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.disable(gl.DEPTH_TEST)

    return {
      draw(state) {
        const flip = state.flip === undefined ? 1 : clamp(state.flip, 0, 1)
        const settle = easeOut(flip)
        const ry = clamp(state.tiltX || 0, -1, 1) * MAX_ANGLE_3D + (1 - settle) * Math.PI * 3
        const rx = clamp(state.tiltY || 0, -1, 1) * MAX_ANGLE_3D * 0.7
        const facing = Math.cos(ry) * Math.cos(rx) >= 0
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.uniform2f(u.rot, rx, ry)
        gl.uniform2f(u.turn, rx, ry)
        gl.uniform1f(u.scale, 0.74 * (0.6 + 0.4 * settle))
        gl.uniform1f(u.alpha, clamp(flip * 4, 0, 1))
        // 从远到近一层层画：正面朝外时最后画最前面那层，转到背面时反过来
        for (let step = 0; step < LAYERS; step += 1) {
          const index = facing ? step : LAYERS - 1 - step
          const last = step === LAYERS - 1
          gl.uniform1f(u.z, -DEPTH * (1 - index / (LAYERS - 1)) + DEPTH / 2)
          gl.uniform1f(u.face, last ? 1 : 0)
          gl.uniform1f(u.back, last && !facing ? 1 : 0)
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        }
      },
      dispose() {
        try { gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program) } catch (error) { /* 上下文已经没了 */ }
      }
    }
  } catch (error) {
    return null
  }
}

module.exports.createHonorRenderer = createHonorRenderer
