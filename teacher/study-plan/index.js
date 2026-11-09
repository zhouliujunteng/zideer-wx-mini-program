const { loadTeacherStudyPlan, updateTeacherStudyPlan } = require('../../services/identity')
const {
  MINUTE_OPTIONS,
  WEEKDAY_OPTIONS,
  ALL_WEEKDAYS,
  normalizeWeekdays,
  weekdaysText,
  monthDay,
  weekday,
  addDays,
  dayLabel,
  fullDayLabel,
  decorateDay,
  planSummary,
  minuteOptionLabel
} = require('../../utils/study-plan-view')

// 老师工作台 → 学生详情 → 学习安排（2026-09-27 用户规则）。
// 老师和学生在服务群里确认每天学多久（15 分钟打底，30 / 45 分钟，1 / 1.5 / 2 小时）→ 点「自动排课」：
// 课程服务把学生还没学完的课按「先修在前、从基础到进阶」排好，按每天时长放进从开始日期起的每一天 →
// 老师在这里逐条改日期、移除、添加。学生在「学习 › 学习任务」按日期看到这些任务。
// 排课期间页面里显示进度条；排好后可以把安排导出成图片发到学习群（2026-10-06，更新日志 1.0.3）。
// 每周学习日与休息日（2026-10-09 用户规则）：和学生确认一周学哪几天，另可单独标某几天休息；
// 自动排课只排学习日，前几天没学完的带到今天（今天休息就带到下一个学习日）。改了要重新自动排课才生效。
// 老师身份与负责关系由课程服务按当前登录账号校验，页面传的 studentProfileId 只是目标。

const MAX_START_OFFSET_DAYS = 30
const MAX_MOVE_OFFSET_DAYS = 365
const MAX_REST_OFFSET_DAYS = 90
const MAX_REST_DAYS = 60

// 自动排课进度条（更新日志 1.0.3）：课程服务一次性返回结果，中间没有真实进度。
// 请求期间按次数渐近地走向 90%（越往后越慢，约 5 秒到一半、30 秒贴近 90%），永远到不了 100%；
// 返回成功后走满 100%，停一下再收起、显示结果；失败直接收起，照原样提示。阶段文案按进度切换。
const PROGRESS_STAGES = ['读取学生的课程', '判断先后顺序', '排进每一天']
const PROGRESS_STAGE_AT = [0, 20, 75]
const PROGRESS_START = 4
const PROGRESS_CEILING = 90
const PROGRESS_RATE = 0.035
const PROGRESS_TICK_MS = 200
const PROGRESS_DONE_HOLD_MS = 500
const PROGRESS_CLOSE_MS = 220

function errorText(error, fallback) {
  return error && error.message ? error.message : fallback
}

// 第 ticks 次走动后的进度与阶段
function progressAt(ticks) {
  const percent = Math.round(PROGRESS_START + (PROGRESS_CEILING - PROGRESS_START) * (1 - Math.pow(1 - PROGRESS_RATE, ticks)))
  let stage = 0
  PROGRESS_STAGE_AT.forEach((at, index) => { if (percent >= at) stage = index })
  return { progressPercent: percent, progressStage: stage }
}

function weekdayItems(selected) {
  return WEEKDAY_OPTIONS.map((item) => ({ ...item, selected: selected.includes(item.value) }))
}

function restItems(restDays) {
  return restDays.map((day) => ({ day, text: `${monthDay(day)} ${weekday(day)}` }))
}

function hasTasks(plan) {
  return Boolean(plan) && (plan.days || []).some((day) => day && Array.isArray(day.tasks) && day.tasks.length)
}

function autoResultText(result, today) {
  const parts = []
  if (result.taskCount) {
    const range = result.firstDay === result.lastDay
      ? dayLabel(result.firstDay, today)
      : `${dayLabel(result.firstDay, today)}到${dayLabel(result.lastDay, today)}`
    parts.push(`排好了 ${result.taskCount} 项学习任务，${range}，共 ${result.dayCount} 天。`)
  }
  if (result.basis === 'ai') parts.push('课程按难度从基础到进阶、先修的课在前排好。')
  if (result.basis === 'fallback') parts.push('这次没能判断课程难度，先按课程的节次和生成先后排了，可以稍后再点一次「重新自动排课」。')
  if (result.unscheduledCount) parts.push(`还有 ${result.unscheduledCount} 门课排满一年也没放下，请减少课程或加长每天学习时长。`)
  parts.push('学生在「学习 › 学习任务」里按日期就能看到。')
  if (result.taskCount) parts.push('也可以点「导出图片」发到学习群。')
  return parts.join('')
}

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    studentName: '',
    loadState: 'loading',
    loadError: '',
    refreshing: false,
    minuteOptions: MINUTE_OPTIONS,
    selectedMinutes: 0,
    weekdayOptions: weekdayItems(ALL_WEEKDAYS),
    weekdaysCaption: '和学生确认，不学的那几天休息',
    restDayItems: [],
    restPickerDay: '',
    maxRestDay: '',
    scheduleTouched: false,
    carryDayText: '今天',
    today: '',
    startDay: '',
    startDayText: '',
    maxStartDay: '',
    maxMoveDay: '',
    revision: 0,
    hasPlan: false,
    summaryText: '',
    days: [],
    overdueCount: 0,
    reviewCount: 0,
    unscheduledCount: 0,
    courseCount: 0,
    schedulableCount: 0,
    addableCourses: [],
    busy: false,
    sheetVisible: false,
    sheetClosing: false,
    addStageId: '',
    addDay: '',
    addDayText: '',
    addError: '',
    progressVisible: false,
    progressClosing: false,
    progressPercent: 0,
    progressStage: 0,
    progressSteps: PROGRESS_STAGES,
    exporting: false
  },

  onLoad(options = {}) {
    this.studentProfileId = String(options.studentProfileId || '')
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { top: (windowInfo.statusBarHeight || 20) + 6, height: 32 }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    // 转屏瞬间状态栏高度与胶囊位置可能对不上（胶囊比状态栏还靠上）：间距至少按 4px 算，顶栏高度不会算成负数。
    const navigationBarHeight = menuButton.height + Math.max(4, menuButton.top - statusBarHeight) * 2
    let studentName = ''
    try {
      studentName = options.name ? decodeURIComponent(String(options.name)).slice(0, 20) : ''
    } catch (error) {
      studentName = ''
    }
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + 18, studentName })
  },

  onShow() {
    // 每次回到页面都刷新：学生在学、课程在生成，任务进度随时在变。
    return this.load()
  },

  onUnload() {
    this._unloaded = true
    if (this._sheetTimer) clearTimeout(this._sheetTimer)
    this.clearProgressTimer()
  },

  handleBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.redirectTo({ url: '/teacher/workspace/index' })
  },

  async handleRefresh() {
    this.setData({ refreshing: true })
    await this.load()
    this.setData({ refreshing: false })
  },

  async load() {
    const requestId = (this._requestId || 0) + 1
    this._requestId = requestId
    if (this.data.loadState === 'failed') this.setData({ loadState: 'loading', loadError: '' })
    try {
      const view = await loadTeacherStudyPlan(this.studentProfileId)
      if (requestId !== this._requestId) return
      this.apply(view)
    } catch (error) {
      if (requestId !== this._requestId) return
      // 读到过一次后刷新失败：保留页面上的安排，只提示一下。
      if (this.data.loadState === 'ready') {
        wx.showToast({ title: errorText(error, '刷新失败，请稍后重试'), icon: 'none' })
        return
      }
      this.setData({ loadState: 'failed', loadError: errorText(error, '请稍后重试。') })
    }
  },

  apply(view = {}) {
    const today = String(view.today || '')
    const plan = view.plan || null
    const courses = Array.isArray(view.courses) ? view.courses : []
    // 还有没学完的页的课，才能排进安排。
    const schedulable = courses.filter((course) => Number(course.remainingMinutes) > 0)
    const maxStartDay = addDays(today, MAX_START_OFFSET_DAYS)
    const keepStart = this.data.startDay && this.data.startDay >= today && this.data.startDay <= maxStartDay
    const startDay = keepStart ? this.data.startDay : today
    // 导出图片按课程服务给的原样安排画（每天的分钟数、任务的页数与时长）
    this._plan = plan
    // 老师改过学习日、休息日还没排课：刷新时保留他的选择；否则显示已保存的。
    if (!this._scheduleTouched) {
      this._weekdays = normalizeWeekdays(plan && plan.studyWeekdays)
      this._restDays = (plan && Array.isArray(plan.restDays) ? plan.restDays : []).filter((day) => day >= today).sort()
    }
    const carryDay = plan && plan.carryDay ? plan.carryDay : today
    this.setData({
      loadState: 'ready',
      loadError: '',
      today,
      revision: Number(view.revision) || 0,
      // 老师点过时长还没排课：刷新时保留他的选择；否则显示已保存的时长。
      selectedMinutes: this._minutesTouched ? this.data.selectedMinutes : (plan ? plan.dailyMinutes : 0),
      startDay,
      startDayText: fullDayLabel(startDay, today),
      maxStartDay,
      maxMoveDay: addDays(today, MAX_MOVE_OFFSET_DAYS),
      maxRestDay: addDays(today, MAX_REST_OFFSET_DAYS),
      restPickerDay: this.data.restPickerDay && this.data.restPickerDay >= today ? this.data.restPickerDay : addDays(today, 1),
      scheduleTouched: Boolean(this._scheduleTouched),
      carryDayText: carryDay === today ? '今天' : `${dayLabel(carryDay, today)}（今天休息）`,
      ...this.scheduleData(),
      hasPlan: Boolean(plan),
      summaryText: planSummary(plan, today),
      days: plan ? (plan.days || []).map((day) => decorateDay(day, today, plan.dailyMinutes)) : [],
      overdueCount: plan ? Number(plan.overdueCount) || 0 : 0,
      reviewCount: plan ? Number(plan.reviewCount) || 0 : 0,
      unscheduledCount: Number(view.unscheduledCount) || 0,
      courseCount: courses.length,
      schedulableCount: schedulable.length,
      addableCourses: schedulable.map((course) => ({
        stageId: course.stageId,
        title: course.title || '定制课程',
        meta: [
          course.learningState === 'in_progress' ? `已学 ${course.completedPages}/${course.totalPages} 页` : '还没开始学',
          `没学的约 ${course.remainingMinutes} 分钟`,
          course.scheduled ? '已排进安排' : '还没排进安排'
        ].join(' · '),
        scheduled: Boolean(course.scheduled)
      }))
    })
  },

  selectMinutes(event) {
    const minutes = Number(event.currentTarget.dataset.minutes)
    if (!MINUTE_OPTIONS.some((option) => option.minutes === minutes)) return
    this._minutesTouched = true
    this.setData({ selectedMinutes: minutes })
  },

  // ---------- 每周学习日与单独休息日 ----------
  scheduleData() {
    const weekdays = this._weekdays || ALL_WEEKDAYS.slice()
    return {
      weekdayOptions: weekdayItems(weekdays),
      weekdaysCaption: weekdays.length === 7 ? '和学生确认，不学的那几天休息' : `${weekdaysText(weekdays)}学习，每周 ${weekdays.length} 天`,
      restDayItems: restItems(this._restDays || [])
    }
  },

  touchSchedule() {
    this._scheduleTouched = true
    this.setData({ scheduleTouched: true, ...this.scheduleData() })
  },

  toggleWeekday(event) {
    const value = Number(event.currentTarget.dataset.value)
    if (!(value >= 1 && value <= 7) || this.data.busy) return
    const current = this._weekdays || ALL_WEEKDAYS.slice()
    if (current.includes(value) && current.length === 1) {
      wx.showToast({ title: '每周至少学一天', icon: 'none' })
      return
    }
    this._weekdays = current.includes(value) ? current.filter((item) => item !== value) : ALL_WEEKDAYS.filter((item) => item === value || current.includes(item))
    this.touchSchedule()
  },

  addRestDay(event) {
    const day = String(event.detail.value || '')
    if (!day || this.data.busy) return
    const current = this._restDays || []
    if (current.includes(day)) return
    if (current.length >= MAX_REST_DAYS) {
      wx.showToast({ title: `最多标 ${MAX_REST_DAYS} 个休息日`, icon: 'none' })
      return
    }
    this._restDays = current.concat(day).sort()
    this.setData({ restPickerDay: day })
    this.touchSchedule()
  },

  removeRestDay(event) {
    const day = String(event.currentTarget.dataset.day || '')
    if (!day || this.data.busy) return
    this._restDays = (this._restDays || []).filter((item) => item !== day)
    this.touchSchedule()
  },

  handleStartDay(event) {
    const startDay = String(event.detail.value || '')
    if (!startDay) return
    this.setData({ startDay, startDayText: fullDayLabel(startDay, this.data.today) })
  },

  confirm(options) {
    return new Promise((resolve) => {
      wx.showModal({
        ...options,
        success: (result) => resolve(Boolean(result.confirm)),
        fail: () => resolve(false)
      })
    })
  },

  handleChangeError(error) {
    wx.showToast({ title: errorText(error, '没有保存成功，请稍后重试'), icon: 'none' })
    // 别人刚改过：刷新到最新，老师再操作一次。
    if (error && (error.code === 'PLAN_CHANGED' || error.code === 'TASK_NOT_FOUND')) this.load()
  },

  async handleAuto() {
    if (this.data.busy || this.data.loadState !== 'ready') return
    const minutes = this.data.selectedMinutes
    if (!minutes) {
      wx.showToast({ title: '先选每天学习多长时间', icon: 'none' })
      return
    }
    if (!this.data.schedulableCount) {
      wx.showToast({ title: this.data.courseCount ? '课程都学完了，或者还在生成中' : '学生还没有生成好的课程', icon: 'none' })
      return
    }
    const startDay = this.data.startDay
    const replacing = this.data.days.some((day) => day.day >= startDay)
    if (replacing) {
      const confirmed = await this.confirm({
        title: '重新排课？',
        content: `${dayLabel(startDay, this.data.today)}起的学习任务会按${weekdaysText(this._weekdays) === '每天' ? '每天' : `${weekdaysText(this._weekdays)}学习、每次`} ${minuteOptionLabel(minutes)} 重新排，手动调整过的也会被替换。`,
        confirmText: '重新排课',
        cancelText: '再想想'
      })
      if (!confirmed) return
    }
    this.setData({ busy: true })
    this.startProgress()
    try {
      const view = await updateTeacherStudyPlan(this.studentProfileId, this.data.revision, {
        action: 'auto',
        dailyMinutes: minutes,
        startDay,
        studyWeekdays: this._weekdays || ALL_WEEKDAYS.slice(),
        restDays: (this._restDays || []).filter((day) => day >= this.data.today)
      })
      if (this._unloaded) return
      this._minutesTouched = false
      this._scheduleTouched = false
      await this.completeProgress()
      // 浮层淡出时下面已经是新的安排
      this.apply(view)
      await this.closeProgress()
      wx.showModal({ title: '已排好学习任务', content: autoResultText(view.result || {}, view.today), showCancel: false, confirmText: '知道了' })
    } catch (error) {
      this.stopProgress()
      this.handleChangeError(error)
    } finally {
      this.setData({ busy: false })
    }
  },

  // ---------- 自动排课进度条 ----------
  clearProgressTimer() {
    if (this._progressTimer) clearTimeout(this._progressTimer)
    this._progressTimer = null
  },

  progressWait(ms) {
    this.clearProgressTimer()
    return new Promise((resolve) => {
      this._progressTimer = setTimeout(() => {
        this._progressTimer = null
        resolve()
      }, ms)
    })
  },

  startProgress() {
    this.clearProgressTimer()
    this._progressTicks = 0
    this.setData({ progressVisible: true, progressClosing: false, ...progressAt(0) })
    const tick = () => {
      this._progressTicks += 1
      const next = progressAt(this._progressTicks)
      if (next.progressPercent !== this.data.progressPercent || next.progressStage !== this.data.progressStage) this.setData(next)
      // 贴到 90% 就停在那里，等请求返回
      this._progressTimer = next.progressPercent < PROGRESS_CEILING ? setTimeout(tick, PROGRESS_TICK_MS) : null
    }
    this._progressTimer = setTimeout(tick, PROGRESS_TICK_MS)
  },

  // 走满 100%（三个阶段都打勾），停一下给老师看到
  completeProgress() {
    this.clearProgressTimer()
    this.setData({ progressPercent: 100, progressStage: PROGRESS_STAGES.length })
    return this.progressWait(PROGRESS_DONE_HOLD_MS)
  },

  async closeProgress() {
    this.setData({ progressClosing: true })
    await this.progressWait(PROGRESS_CLOSE_MS)
    this.setData({ progressVisible: false, progressClosing: false })
  },

  stopProgress() {
    this.clearProgressTimer()
    this.setData({ progressVisible: false, progressClosing: false, progressPercent: 0, progressStage: 0 })
  },

  // ---------- 导出排课图片，发到学习群（更新日志 1.0.3） ----------
  // 把今天起的安排画成竖版长图（teacher/study-plan/plan-poster.js），用微信的分享图片菜单发给学习群；
  // 基础库没有这个菜单（或调不起来）时存进相册，老师自己发。
  async handleExport() {
    if (this.data.exporting || this.data.busy) return
    if (this.data.loadState !== 'ready' || !hasTasks(this._plan)) {
      wx.showToast({ title: '还没有排好的学习任务，先自动排课', icon: 'none' })
      return
    }
    this.setData({ exporting: true })
    let path = ''
    try {
      path = await this.renderPlanImage()
    } catch (error) {
      wx.showToast({ title: '图片没有生成成功，请重试', icon: 'none' })
    }
    this.setData({ exporting: false })
    if (path) this.sharePlanImage(path)
  },

  // 画到页面里藏起来的 2d 画布上（#planExportCanvas），导出成本地图片；同一份安排画过就直接用上次的图。
  renderPlanImage() {
    // 导图代码只在点「导出图片」时用到，用到再加载
    const { buildPlanPoster, drawPlanPoster } = require('./plan-poster')
    const poster = buildPlanPoster({ studentName: this.data.studentName, plan: this._plan })
    if (!poster) return Promise.reject(new Error('没有学习任务'))
    const key = JSON.stringify(poster)
    if (this._planImage && this._planImage.key === key) return Promise.resolve(this._planImage.path)
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery().in(this).select('#planExportCanvas').fields({ node: true, size: true }).exec((result) => {
        const canvas = result && result[0] && result[0].node
        if (!canvas) {
          reject(new Error('画布不可用'))
          return
        }
        const width = Math.round(poster.width * poster.scale)
        const height = Math.round(poster.height * poster.scale)
        try {
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          ctx.scale(poster.scale, poster.scale)
          drawPlanPoster(ctx, poster)
        } catch (error) {
          reject(error)
          return
        }
        wx.canvasToTempFilePath({
          canvas,
          x: 0,
          y: 0,
          width,
          height,
          destWidth: width,
          destHeight: height,
          fileType: 'png',
          success: (file) => {
            const path = (file && file.tempFilePath) || ''
            if (!path) {
              reject(new Error('图片导出失败'))
              return
            }
            this._planImage = { key, path }
            resolve(path)
          },
          fail: reject
        })
      })
    })
  },

  // 微信的分享图片菜单里有「发送给朋友」（选学习群）、收藏、保存图片
  sharePlanImage(path) {
    if (typeof wx.showShareImageMenu !== 'function') {
      this.savePlanImage(path)
      return
    }
    wx.showShareImageMenu({
      path,
      fail: (error) => {
        if (/cancel/i.test(String((error && error.errMsg) || ''))) return
        this.savePlanImage(path)
      }
    })
  },

  savePlanImage(path) {
    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: () => wx.showToast({ title: '已保存到相册，可以发到学习群', icon: 'none' }),
      fail: (error) => {
        if (/cancel/i.test(String((error && error.errMsg) || ''))) return
        // 老师曾拒绝相册授权时，引导去设置页重新打开
        wx.showModal({
          title: '需要相册权限',
          content: '保存排课图片需要允许访问相册，请在设置中打开「保存到相册」。',
          confirmText: '去设置',
          success: (result) => { if (result.confirm && wx.openSetting) wx.openSetting() }
        })
      }
    })
  },

  async mutate(change, successText) {
    if (this.data.busy) return false
    this.setData({ busy: true })
    try {
      this.apply(await updateTeacherStudyPlan(this.studentProfileId, this.data.revision, change))
      if (successText) wx.showToast({ title: successText, icon: 'none' })
      return true
    } catch (error) {
      this.handleChangeError(error)
      return false
    } finally {
      this.setData({ busy: false })
    }
  },

  handleMoveTask(event) {
    const dataset = event.currentTarget.dataset || {}
    const taskId = String(dataset.taskId || '')
    const day = String(event.detail.value || '')
    if (!taskId || !day) return
    // 原地没动（过期的补学任务除外：选今天就是把它挪到今天）
    if (day === dataset.day && !dataset.overdue) return
    return this.mutate({ action: 'move', taskId, day }, `已改到${dayLabel(day, this.data.today)}`)
  },

  async handleRemoveTask(event) {
    const dataset = event.currentTarget.dataset || {}
    const taskId = String(dataset.taskId || '')
    if (!taskId || this.data.busy) return
    const where = dataset.overdue ? '补学任务' : `${dayLabel(dataset.day, this.data.today)}的学习任务`
    const confirmed = await this.confirm({
      title: '移除这条任务？',
      content: `「${dataset.title || '这门课'}」${dataset.pageLabel ? ` ${dataset.pageLabel}` : ''}会从${where}里移除，学生那边也看不到了。之后可以用「添加任务」再放回来。`,
      confirmText: '移除',
      cancelText: '再想想'
    })
    if (!confirmed) return
    return this.mutate({ action: 'remove', taskId }, '已移除')
  },

  async handleClear() {
    if (this.data.busy) return
    const confirmed = await this.confirm({
      title: '清空学习安排？',
      content: '今天起的学习任务会全部移除，学生的「学习任务」里也不再显示；每天学习时长会保留。',
      confirmText: '清空',
      cancelText: '再想想'
    })
    if (!confirmed) return
    return this.mutate({ action: 'clear' }, '已清空')
  },

  // ---------- 添加任务：选一门课 + 一天，把这门课没学、也没排进来的页放到那天 ----------
  openAddSheet() {
    if (this.data.busy) return
    if (!this.data.hasPlan) {
      wx.showToast({ title: '先选每天学习时长并自动排课', icon: 'none' })
      return
    }
    const courses = this.data.addableCourses
    if (!courses.length) {
      wx.showToast({ title: '没有还需要学的课程', icon: 'none' })
      return
    }
    if (this._sheetTimer) clearTimeout(this._sheetTimer)
    const preferred = courses.find((course) => !course.scheduled) || courses[0]
    const addDay = this.data.today
    this.setData({
      sheetVisible: true,
      sheetClosing: false,
      addStageId: preferred.stageId,
      addDay,
      addDayText: fullDayLabel(addDay, this.data.today),
      addError: ''
    })
  },

  closeAddSheet() {
    if (!this.data.sheetVisible || this.data.sheetClosing || this.data.busy) return
    this.setData({ sheetClosing: true })
    this._sheetTimer = setTimeout(() => {
      this._sheetTimer = null
      this.setData({ sheetVisible: false, sheetClosing: false })
    }, 280)
  },

  stopTap() {},

  chooseAddCourse(event) {
    const stageId = String(event.currentTarget.dataset.stageId || '')
    if (stageId) this.setData({ addStageId: stageId, addError: '' })
  },

  handleAddDay(event) {
    const addDay = String(event.detail.value || '')
    if (addDay) this.setData({ addDay, addDayText: fullDayLabel(addDay, this.data.today), addError: '' })
  },

  async submitAdd() {
    if (this.data.busy) return
    if (!this.data.addStageId) {
      this.setData({ addError: '请选择一门课程。' })
      return
    }
    const day = this.data.addDay
    const added = await this.mutate({ action: 'add', stageId: this.data.addStageId, day }, `已添加到${dayLabel(day, this.data.today)}`)
    if (added) this.closeAddSheet()
  }
})
