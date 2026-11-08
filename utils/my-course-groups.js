/**
 * 「我的课程」里的「我的定制课程」与课程库的系列筛选（2026-10-06，更新日志 1.0.3）。纯函数，页面只管 setData。
 *
 * - 学习页「我的课程」分两栏：全部课程 / 我的定制课程；「我的定制课程」再分「未学 / 已学」两种状态，
 *   并按系列（诊断会议一次定制的几节课）分组。已学 = 整门课学完（与学习端「本课已学完」同一口径），
 *   其余都算未学：没开始的、学了一半的、还在制作的。
 * - 「我的课程库」（learning/library?scope=mine）按系列分别查看：全部 / 每个系列 / 单节课程。
 *
 * 课程卡片字段见 utils/agent-course-view.js agentCourseCard（kind / seriesId / seriesTitle / learned）。
 */
const MY_COURSE_TABS = [
  { id: 'all', label: '全部课程' },
  { id: 'custom', label: '我的定制课程' }
]

const CUSTOM_FILTERS = [
  { id: 'unlearned', label: '未学' },
  { id: 'learned', label: '已学' }
]

const SINGLE_SERIES_ID = 'single'
const SINGLE_SERIES_TITLE = '单节课程'

function isCustomCourse(course) {
  return Boolean(course) && course.kind === 'agent'
}

function matchesFilter(course, filter) {
  return filter === 'learned' ? course.learned === true : course.learned !== true
}

function customFilterTabs(courses, active) {
  const custom = (courses || []).filter(isCustomCourse)
  return CUSTOM_FILTERS.map((item) => ({
    ...item,
    count: custom.filter((course) => matchesFilter(course, item.id)).length,
    active: item.id === active
  }))
}

/**
 * 按系列分组，系列的先后按列表里第一次出现的位置（列表本身制作中在前、新的在前）。
 * 没有系列的课放在最后一组；整份列表都没有系列时这一组不写标题，和原来一样平铺。
 */
function seriesGroups(courses) {
  const groups = []
  const byId = {}
  const singles = []
  for (const course of courses || []) {
    if (!course.seriesId) {
      singles.push(course)
      continue
    }
    if (!byId[course.seriesId]) {
      byId[course.seriesId] = { id: course.seriesId, title: course.seriesTitle || '定制系列', courses: [] }
      groups.push(byId[course.seriesId])
    }
    byId[course.seriesId].courses.push(course)
  }
  if (singles.length) groups.push({ id: SINGLE_SERIES_ID, title: groups.length ? SINGLE_SERIES_TITLE : '', courses: singles })
  return groups.map((group) => ({ ...group, meta: group.title ? `${group.courses.length} 节` : '' }))
}

/** 「我的定制课程」一栏要显示的内容：两种状态的计数、按系列分组的课程、空状态文案。 */
function customCourseView(courses, filter = 'unlearned') {
  const active = CUSTOM_FILTERS.some((item) => item.id === filter) ? filter : 'unlearned'
  const visible = (courses || []).filter((course) => isCustomCourse(course) && matchesFilter(course, active))
  return {
    filter: active,
    filters: customFilterTabs(courses, active),
    groups: seriesGroups(visible),
    count: visible.length,
    emptyText: active === 'learned' ? '还没有学完的定制课程，学完一节就会出现在这里' : '定制课程都学完了，可以联系老师再定制新课'
  }
}

/** 课程库的系列筛选：至少有一个系列才显示（全部 / 各系列 / 单节课程）；只有单节课时返回空数组，页面不画筛选条。 */
function seriesFilterTabs(courses, active = 'all') {
  const groups = seriesGroups((courses || []).filter(isCustomCourse))
  const series = groups.filter((group) => group.id !== SINGLE_SERIES_ID)
  if (!series.length) return []
  const others = (courses || []).filter((course) => !isCustomCourse(course) || !course.seriesId).length
  const tabs = [{ id: 'all', label: '全部', count: (courses || []).length }]
    .concat(series.map((group) => ({ id: group.id, label: group.title, count: group.courses.length })))
  if (others) tabs.push({ id: SINGLE_SERIES_ID, label: SINGLE_SERIES_TITLE, count: others })
  const current = tabs.some((tab) => tab.id === active) ? active : 'all'
  return tabs.map((tab) => ({ ...tab, active: tab.id === current }))
}

/** 按课程库的系列筛选取课程；single 是不属于任何系列的课（单节定制课与学习计划课）。 */
function filterBySeries(courses, seriesId = 'all') {
  if (!seriesId || seriesId === 'all') return (courses || []).slice()
  if (seriesId === SINGLE_SERIES_ID) return (courses || []).filter((course) => !course.seriesId)
  return (courses || []).filter((course) => course.seriesId === seriesId)
}

module.exports = {
  MY_COURSE_TABS,
  CUSTOM_FILTERS,
  SINGLE_SERIES_ID,
  customCourseView,
  customFilterTabs,
  seriesGroups,
  seriesFilterTabs,
  filterBySeries
}
