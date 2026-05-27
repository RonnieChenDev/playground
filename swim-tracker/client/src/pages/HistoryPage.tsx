import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line,
} from 'recharts'

interface SetRecord {
  id: number
  dist: number
  time: string | null
  rest: string | null
  stroke: string | null
  mode: string | null
  order: number
}

interface GroupRecord {
  id: number
  stroke: string | null
  mode: string
  order: number
  sets: SetRecord[]
}

interface SessionRecord {
  id: number
  date: string
  note: string | null
  poolLen: number
  createdAt: string
  groups: GroupRecord[]
}

interface Profile {
  weight?: number
}

interface EditSet {
  id: number
  dist: number
  timeMin: number
  timeSec: number
  restMin: number
  restSec: number
  stroke: string
  mode: string
}

interface EditGroup {
  id: number
  stroke: string
  mode: string
  sets: EditSet[]
}

const STROKES = ['自由泳', '蛙泳', '背泳', '蝶泳', '混合泳']
const MODES = ['正常游', '打腿练习', '划手练习', '冲刺', '放松']

const STROKE_MET: Record<string, { slow: number; mid: number; fast: number }> = {
  '自由泳': { slow: 5.8, mid: 8.0, fast: 11.0 },
  '蛙泳':   { slow: 5.3, mid: 7.5, fast: 10.3 },
  '背泳':   { slow: 4.8, mid: 6.5, fast: 9.5  },
  '蝶泳':   { slow: 9.0, mid: 11.0, fast: 13.8 },
  '混合泳': { slow: 7.0, mid: 9.0, fast: 11.5  },
}

const MODE_FACTOR: Record<string, number> = {
  '正常游': 1, '打腿练习': 0.75, '划手练习': 0.8, '冲刺': 1.2, '放松': 0.7
}

function parseDuration(str: string | null): number | null {
  if (!str) return null
  str = str.trim()
  if (/^\d+$/.test(str)) return parseInt(str)
  const m = str.match(/^(\d+):(\d+)$/)
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2])
  return null
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function getPaceLevel(secPer50: number) {
  if (secPer50 <= 37) return { label: '精英', color: '#1d4ed8', bg: 'bg-blue-100', text: 'text-blue-800' }
  if (secPer50 <= 52) return { label: '进阶', color: '#15803d', bg: 'bg-green-100', text: 'text-green-800' }
  if (secPer50 <= 75) return { label: '中级', color: '#b45309', bg: 'bg-amber-100', text: 'text-amber-800' }
  return { label: '新手', color: '#b91c1c', bg: 'bg-red-100', text: 'text-red-800' }
}

function getMET(stroke: string, mode: string, paceSec50: number): number {
  const base = STROKE_MET[stroke] || STROKE_MET['自由泳']
  const intensity = paceSec50 <= 37 ? base.fast : paceSec50 <= 52 ? base.mid : base.slow
  return intensity * (MODE_FACTOR[mode] || 1)
}

function calcCalories(timeSec: number, stroke: string, mode: string, paceSec50: number, weightKg: number): number {
  const met = getMET(stroke, mode, paceSec50)
  return Math.round((met * 3.5 * weightKg * (timeSec / 60)) / 200)
}

function computeStats(session: SessionRecord, weight?: number) {
  let totalDist = 0, totalTime = 0, totalRest = 0, totalCal = 0
  let bestPace: number | null = null
  for (const g of session.groups) {
    for (const s of g.sets) {
      const t = parseDuration(s.time)
      const r = parseDuration(s.rest)
      if (s.dist) totalDist += s.dist
      if (t) totalTime += t
      if (r) totalRest += r
      if (t && s.dist > 0) {
        const pace = (t / s.dist) * 50
        if (bestPace === null || pace < bestPace) bestPace = pace
        if (weight) {
          const stroke = s.stroke || g.stroke || '自由泳'
          const mode = s.mode || g.mode
          totalCal += calcCalories(t, stroke, mode, pace, weight)
        }
      }
    }
  }
  return { totalDist, totalTime, totalRest, totalCal, bestPace }
}

function sessionToEditGroups(session: SessionRecord): EditGroup[] {
  return session.groups.map(g => ({
    id: g.id,
    stroke: g.stroke || '',
    mode: g.mode,
    sets: g.sets.map(s => {
      const t = parseDuration(s.time)
      const r = parseDuration(s.rest)
      return {
        id: s.id,
        dist: s.dist,
        timeMin: t ? Math.floor(t / 60) : 0,
        timeSec: t ? t % 60 : 0,
        restMin: r ? Math.floor(r / 60) : 0,
        restSec: r ? r % 60 : 0,
        stroke: s.stroke || '',
        mode: s.mode || '',
      }
    })
  }))
}

const CustomDot = (props: any) => {
  const { cx, cy, payload } = props
  return <circle cx={cx} cy={cy} r={5} fill={payload.color} stroke="white" strokeWidth={1.5} />
}

function SessionCard({
  session, profile, onDelete, onUpdate,
}: {
  session: SessionRecord
  profile: Profile
  onDelete: (id: number) => void
  onUpdate: (id: number, updated: SessionRecord) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editDate, setEditDate] = useState(session.date)
  const [editNote, setEditNote] = useState(session.note || '')
  const [editPoolLen, setEditPoolLen] = useState(session.poolLen)
  const [editGroups, setEditGroups] = useState<EditGroup[]>([])
  const [saving, setSaving] = useState(false)

  const stats = computeStats(session, profile.weight)

  const startEdit = () => {
    setEditDate(session.date)
    setEditNote(session.note || '')
    setEditPoolLen(session.poolLen)
    setEditGroups(sessionToEditGroups(session))
    setEditing(true)
  }

  const cancelEdit = () => setEditing(false)

  const handleSave = async () => {
    for (let gi = 0; gi < editGroups.length; gi++) {
      const g = editGroups[gi]
      if (!g.sets.length) { alert('每个训练组至少需要一个小组'); return }
      for (let si = 0; si < g.sets.length; si++) {
        const s = g.sets[si]
        if (!(s.stroke || g.stroke)) { alert(`训练组 ${gi + 1} 第 ${si + 1} 小组请设置泳姿`); return }
        if (!(s.mode || g.mode)) { alert(`训练组 ${gi + 1} 第 ${si + 1} 小组请设置练习模式`); return }
        if (!s.dist || s.dist <= 0) { alert(`训练组 ${gi + 1} 第 ${si + 1} 小组距离不能为空`); return }
        if (s.timeMin === 0 && s.timeSec === 0) { alert(`训练组 ${gi + 1} 第 ${si + 1} 小组游泳时间不能为 0`); return }
      }
    }
    setSaving(true)
    const updated = await api.put(`/api/sessions/${session.id}`, {
      date: editDate,
      note: editNote,
      poolLen: editPoolLen,
      groups: editGroups.map((g, gi) => ({
        stroke: g.stroke || null,
        mode: g.mode,
        order: gi,
        sets: g.sets.map((s, si) => ({
          dist: s.dist,
          time: `${s.timeMin}:${String(s.timeSec).padStart(2, '0')}`,
          rest: (s.restMin > 0 || s.restSec > 0)
            ? `${s.restMin}:${String(s.restSec).padStart(2, '0')}`
            : null,
          stroke: s.stroke || null,
          mode: s.mode || null,
          order: si,
        }))
      }))
    })
    setSaving(false)
    setEditing(false)
    onUpdate(session.id, updated)
  }

  const addGroup = () =>
    setEditGroups(prev => [...prev, { id: Date.now(), stroke: '', mode: '正常游', sets: [] }])

  const removeGroup = (gid: number) =>
    setEditGroups(prev => prev.filter(g => g.id !== gid))

  const updateGroup = (gid: number, field: keyof EditGroup, value: string) =>
    setEditGroups(prev => prev.map(g => g.id === gid ? { ...g, [field]: value } : g))

  const addSet = (gid: number) =>
    setEditGroups(prev => prev.map(g => g.id === gid
      ? { ...g, sets: [...g.sets, { id: Date.now(), dist: editPoolLen, timeMin: 0, timeSec: 0, restMin: 0, restSec: 0, stroke: '', mode: '' }] }
      : g
    ))

  const removeSet = (gid: number, sid: number) =>
    setEditGroups(prev => prev.map(g => g.id === gid
      ? { ...g, sets: g.sets.filter(s => s.id !== sid) }
      : g
    ))

  const updateSet = (gid: number, sid: number, field: keyof EditSet, value: string | number) =>
    setEditGroups(prev => prev.map(g => g.id === gid
      ? { ...g, sets: g.sets.map(s => s.id === sid ? { ...s, [field]: value } : s) }
      : g
    ))

  const summaryData = session.groups.flatMap((g, gi) =>
    g.sets.map((s, si) => {
      const t = parseDuration(s.time)
      const pace = t && s.dist > 0 ? (t / s.dist) * 50 : null
      const lv = pace ? getPaceLevel(pace) : null
      return { name: `G${gi + 1}-${si + 1}`, pace, color: lv?.color ?? '#9ca3af' }
    })
  )

  const hasChartData = summaryData.some(d => d.pace !== null)

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">

      <div className="flex items-start justify-between">
        <div className="space-y-1">
          {editing ? (
            <>
              <div className="flex items-center gap-2">
                <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                  className="border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-gray-400" />
                <input type="text" value={editNote} onChange={e => setEditNote(e.target.value)}
                  placeholder="备注（可选）"
                  className="border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-gray-400 w-36" />
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-gray-400">泳池</span>
                <input type="number" value={editPoolLen} onChange={e => setEditPoolLen(parseInt(e.target.value))}
                  className="border border-gray-200 rounded px-2 py-1 text-sm w-16 focus:outline-none" />
                <span className="text-xs text-gray-400">米</span>
              </div>
            </>
          ) : (
            <>
              <div className="font-medium">
                {session.date}
                {session.note && <span className="text-gray-400 font-normal ml-2">— {session.note}</span>}
              </div>
              <div className="text-xs text-gray-400">泳池 {session.poolLen}m</div>
            </>
          )}
        </div>
        <div className="flex gap-2">
          {!editing ? (
            <>
              <button onClick={startEdit}
                className="text-xs text-blue-500 border border-blue-100 px-2 py-1 rounded hover:bg-blue-50">
                编辑
              </button>
              <button onClick={() => onDelete(session.id)}
                className="text-xs text-red-400 border border-red-100 px-2 py-1 rounded hover:bg-red-50">
                删除
              </button>
            </>
          ) : (
            <>
              <button onClick={cancelEdit}
                className="text-xs border border-gray-200 px-2 py-1 rounded hover:bg-gray-50">
                取消
              </button>
              <button onClick={handleSave} disabled={saving}
                className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-50">
                {saving ? '保存中…' : '保存修改'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: '总距离', value: `${stats.totalDist}m` },
          { label: '游泳时间', value: fmtTime(stats.totalTime) },
          { label: '休息时间', value: fmtTime(stats.totalRest) },
          { label: '最佳配速', value: stats.bestPace ? fmtTime(stats.bestPace) + '/50m' : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-400 mb-1">{label}</div>
            <div className="text-sm font-medium">{value}</div>
          </div>
        ))}
        {stats.totalCal > 0 && (
          <div className="bg-purple-50 rounded-lg p-3">
            <div className="text-xs text-purple-400 mb-1">热量消耗</div>
            <div className="text-sm font-medium text-purple-700">~{stats.totalCal} kcal</div>
          </div>
        )}
      </div>

      {/* 查看模式 */}
      {!editing && (
        <div className="space-y-4 border-t border-gray-100 pt-4">
          <div className="flex gap-3 text-xs text-gray-400 flex-wrap">
            {[
              { color: '#1d4ed8', label: '精英 <0:37' },
              { color: '#15803d', label: '进阶 0:37–0:52' },
              { color: '#b45309', label: '中级 0:52–1:15' },
              { color: '#b91c1c', label: '新手 >1:15' },
            ].map(({ color, label }) => (
              <span key={label} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: color }}></span>
                {label}
              </span>
            ))}
          </div>

          {session.groups.map((g, gi) => (
            <div key={g.id}>
              <div className="text-sm font-medium text-gray-600 mb-2">
                训练组 {gi + 1} — {g.mode}{g.stroke && ` · ${g.stroke}`}
              </div>

              <div className="mb-3">
                {g.sets.map((s, si) => {
                  const t = parseDuration(s.time)
                  const r = parseDuration(s.rest)
                  const pace = t && s.dist > 0 ? (t / s.dist) * 50 : null
                  const lv = pace ? getPaceLevel(pace) : null
                  const stroke = s.stroke || g.stroke
                  const mode = s.mode || g.mode
                  const cal = pace && t && profile.weight
                    ? calcCalories(t, stroke || '自由泳', mode, pace, profile.weight)
                    : null

                  return (
                    <div key={s.id}>
                      <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-xs text-gray-400 w-8">#{si + 1}</span>
                          <span className="font-medium">{s.dist}m</span>
                          {stroke && <span className="text-xs text-gray-400">{stroke}</span>}
                          {s.mode && s.mode !== g.mode && <span className="text-xs text-gray-400">{s.mode}</span>}
                          {t && <span className="text-xs text-gray-500">{fmtTime(t)}</span>}
                          {cal && <span className="text-xs text-purple-500">~{cal}kcal</span>}
                        </div>
                        <div className="ml-2">
                          {lv && pace && (
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${lv.bg} ${lv.text}`}>
                              {lv.label} {fmtTime(pace)}/50m
                            </span>
                          )}
                        </div>
                      </div>
                      {si < g.sets.length - 1 && (
                        <div className="flex items-center gap-2 py-1.5 px-3">
                          <div className="flex-1 border-t border-dashed border-gray-200"></div>
                          <span className="text-xs text-gray-400">
                            {r ? `休息 ${fmtTime(r)}` : '↓'}
                          </span>
                          <div className="flex-1 border-t border-dashed border-gray-200"></div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {g.sets.some(s => parseDuration(s.time) !== null) && (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart
                    data={g.sets.map((s, i) => {
                      const t = parseDuration(s.time)
                      const pace = t && s.dist > 0 ? (t / s.dist) * 50 : null
                      const lv = pace ? getPaceLevel(pace) : null
                      return { name: `#${i + 1}`, pace, color: lv?.color ?? '#9ca3af' }
                    })}
                    margin={{ top: 16, right: 8, left: 8, bottom: 0 }}
                  >
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={v => fmtTime(v)} tick={{ fontSize: 10 }} width={36} />
                    <Tooltip formatter={(v: any) => [`${fmtTime(v)}/50m`, '配速']} />
                    <Bar
                      dataKey="pace"
                      radius={[4, 4, 0, 0]}
                      shape={(props: any) => {
                        const { x, y, width, height, index } = props
                        const s = g.sets[index]
                        const t = parseDuration(s.time)
                        const pace = t && s.dist > 0 ? (t / s.dist) * 50 : null
                        const lv = pace ? getPaceLevel(pace) : null
                        return <rect x={x} y={y} width={width} height={height} fill={lv?.color ?? '#9ca3af'} rx={4} />
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          ))}

          {hasChartData && (
            <div>
              <div className="text-sm font-medium text-gray-600 mb-2">本次训练配速总览</div>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={summaryData} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={v => fmtTime(v)} tick={{ fontSize: 10 }} width={36} />
                  <Tooltip formatter={(v: any) => [`${fmtTime(v)}/50m`, '配速']} />
                  <Line type="monotone" dataKey="pace" stroke="#60a5fa" strokeWidth={2}
                    dot={<CustomDot />} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* 编辑模式 */}
      {editing && (
        <div className="space-y-4 border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">训练组</span>
            <button onClick={addGroup}
              className="text-sm text-blue-600 border border-blue-200 px-3 py-1 rounded-lg hover:bg-blue-50">
              + 添加训练组
            </button>
          </div>

          {editGroups.map((g, gi) => (
            <div key={g.id} className="border border-gray-100 rounded-xl p-4 bg-gray-50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500">训练组 {gi + 1}</span>
                <button onClick={() => removeGroup(g.id)} className="text-xs text-red-400 hover:text-red-600">删除组</button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">泳姿（组级）</label>
                  <select value={g.stroke} onChange={e => updateGroup(g.id, 'stroke', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none">
                    <option value="">不设定</option>
                    {STROKES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">练习模式</label>
                  <select value={g.mode} onChange={e => updateGroup(g.id, 'mode', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none">
                    {MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="flex items-end">
                  <button onClick={() => addSet(g.id)}
                    className="w-full text-sm border border-gray-200 bg-white px-2 py-1.5 rounded-lg hover:bg-gray-100">
                    + 添加小组
                  </button>
                </div>
              </div>

              <div>
                {g.sets.map((s, si) => {
                  const totalTimeSec = s.timeMin * 60 + s.timeSec
                  const pace = totalTimeSec > 0 && s.dist > 0 ? (totalTimeSec / s.dist) * 50 : null
                  const lv = pace ? getPaceLevel(pace) : null
                  return (
                    <div key={s.id}>
                      <div className="bg-white border border-gray-100 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-gray-500">
                            第 {si + 1} 组
                            {lv && pace && (
                              <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${lv.bg} ${lv.text}`}>
                                {lv.label} {fmtTime(pace)}/50m
                              </span>
                            )}
                          </span>
                          <button onClick={() => removeSet(g.id, s.id)} className="text-xs text-red-400 hover:text-red-600">×</button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">距离</label>
                            <input type="number"
                              value={s.dist === 0 ? '' : s.dist}
                              onChange={e => {
                                const val = e.target.value
                                updateSet(g.id, s.id, 'dist', val === '' ? 0 : parseFloat(val) || 0)
                              }}
                              min={editPoolLen} step={editPoolLen}
                              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none" />
                            <p className="text-xs text-gray-400 mt-0.5">{s.dist > 0 ? s.dist / editPoolLen + ' 趟' : ''}</p>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">时间</label>
                            <div className="flex items-center gap-1">
                              <input type="number" value={s.timeMin}
                                onChange={e => updateSet(g.id, s.id, 'timeMin', parseInt(e.target.value) || 0)}
                                min={0} max={59}
                                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none" />
                              <span className="text-xs text-gray-400 shrink-0">分</span>
                              <input type="number" value={s.timeSec}
                                onChange={e => updateSet(g.id, s.id, 'timeSec', Math.min(59, parseInt(e.target.value) || 0))}
                                min={0} max={59}
                                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none" />
                              <span className="text-xs text-gray-400 shrink-0">秒</span>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">泳姿</label>
                            <select value={s.stroke} onChange={e => updateSet(g.id, s.id, 'stroke', e.target.value)}
                              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none">
                              {g.stroke ? <option value="">继承({g.stroke})</option> : <option value="">请选择</option>}
                              {STROKES.map(st => <option key={st} value={st}>{st}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">模式</label>
                            <select value={s.mode} onChange={e => updateSet(g.id, s.id, 'mode', e.target.value)}
                              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none">
                              {g.mode ? <option value="">继承({g.mode})</option> : <option value="">请选择</option>}
                              {MODES.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                      {si < g.sets.length - 1 && (
                        <div className="flex items-center gap-3 py-1.5 px-2">
                          <div className="flex-1 border-t border-dashed border-gray-200"></div>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-gray-400">休息</span>
                            <input type="number" value={s.restMin}
                              onChange={e => updateSet(g.id, s.id, 'restMin', parseInt(e.target.value) || 0)}
                              min={0} max={59}
                              className="border border-gray-200 rounded px-2 py-1 text-xs w-12 focus:outline-none" />
                            <span className="text-xs text-gray-400">分</span>
                            <input type="number" value={s.restSec}
                              onChange={e => updateSet(g.id, s.id, 'restSec', Math.min(59, parseInt(e.target.value) || 0))}
                              min={0} max={59}
                              className="border border-gray-200 rounded px-2 py-1 text-xs w-12 focus:outline-none" />
                            <span className="text-xs text-gray-400">秒</span>
                          </div>
                          <div className="flex-1 border-t border-dashed border-gray-200"></div>
                        </div>
                      )}
                    </div>
                  )
                })}
                {g.sets.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-2">点击「添加小组」录入数据</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function HistoryPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [profile, setProfile] = useState<Profile>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get('/api/sessions'),
      api.get('/api/profile'),
    ]).then(([s, p]) => {
      setSessions(s)
      setProfile(p)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [location.key])

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除这条训练记录？')) return
    await api.delete(`/api/sessions/${id}`)
    setSessions(prev => prev.filter(s => s.id !== id))
  }

  const handleUpdate = (id: number, updated: SessionRecord) => {
    setSessions(prev => prev.map(s => s.id === id ? updated : s))
  }

  if (loading) return <div className="text-gray-400 text-sm">加载中…</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">历史记录</h1>
        <button
          onClick={() => navigate('/log')}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          + 新增训练
        </button>
      </div>

      {!sessions.length ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">还没有训练记录</p>
          <p className="text-xs mt-1">点击右上角「新增训练」开始记录</p>
        </div>
      ) : (
        sessions.map(session => (
          <SessionCard
            key={session.id}
            session={session}
            profile={profile}
            onDelete={handleDelete}
            onUpdate={handleUpdate}
          />
        ))
      )}
    </div>
  )
}