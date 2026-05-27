import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'

const STROKES = ['自由泳', '蛙泳', '背泳', '蝶泳', '混合泳']
const MODES = ['正常游', '打腿练习', '划手练习', '冲刺', '放松']

interface SetData {
  id: number
  dist: number
  timeMin: number
  timeSec: number
  restMin: number
  restSec: number
  stroke: string
  mode: string
}

interface GroupData {
  id: number
  stroke: string
  mode: string
  sets: SetData[]
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function getPaceLevel(secPer50: number) {
  if (secPer50 <= 37) return { label: '精英', color: 'bg-blue-100 text-blue-800' }
  if (secPer50 <= 52) return { label: '进阶', color: 'bg-green-100 text-green-800' }
  if (secPer50 <= 75) return { label: '中级', color: 'bg-amber-100 text-amber-800' }
  return { label: '新手', color: 'bg-red-100 text-red-800' }
}

export default function LogPage() {
  const navigate = useNavigate()
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [poolLen, setPoolLen] = useState(50)
  const [customPool, setCustomPool] = useState(false)
  const [groups, setGroups] = useState<GroupData[]>([])
  const [saving, setSaving] = useState(false)

  const addGroup = () => {
    setGroups(prev => [...prev, { id: Date.now(), stroke: '', mode: '正常游', sets: [] }])
  }

  const removeGroup = (gid: number) => {
    setGroups(prev => prev.filter(g => g.id !== gid))
  }

  const updateGroup = (gid: number, field: keyof GroupData, value: string) => {
    setGroups(prev => prev.map(g => g.id === gid ? { ...g, [field]: value } : g))
  }

  const addSet = (gid: number) => {
    setGroups(prev => prev.map(g => g.id === gid
      ? { ...g, sets: [...g.sets, { id: Date.now(), dist: poolLen, timeMin: 0, timeSec: 0, restMin: 0, restSec: 0, stroke: '', mode: '' }] }
      : g
    ))
  }

  const removeSet = (gid: number, sid: number) => {
    setGroups(prev => prev.map(g => g.id === gid
      ? { ...g, sets: g.sets.filter(s => s.id !== sid) }
      : g
    ))
  }

  const updateSet = (gid: number, sid: number, field: keyof SetData, value: string | number) => {
    setGroups(prev => prev.map(g => g.id === gid
      ? { ...g, sets: g.sets.map(s => s.id === sid ? { ...s, [field]: value } : s) }
      : g
    ))
  }

  const handleSave = async () => {
    if (!groups.length) { alert('请至少添加一个训练组'); return }
    for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi]
        if (!g.sets.length) { alert(`训练组 ${gi + 1} 至少需要一个小组`); return }
        for (let si = 0; si < g.sets.length; si++) {
            const s = g.sets[si]
            if (!(s.stroke || g.stroke)) { alert(`训练组 ${gi + 1} 第 ${si + 1} 小组请设置泳姿`); return }
            if (!(s.mode || g.mode)) { alert(`训练组 ${gi + 1} 第 ${si + 1} 小组请设置练习模式`); return }
            if (!s.dist || s.dist <= 0) { alert(`训练组 ${gi + 1} 第 ${si + 1} 小组距离不能为空`); return }
            if (s.timeMin === 0 && s.timeSec === 0) { 
            alert(`训练组 ${gi + 1} 第 ${si + 1} 小组游泳时间不能为 0`) 
            return 
            }
        }
    }
    setSaving(true)
    await api.post('/api/sessions', {
        date,
        note,
        poolLen,
        groups: groups.map((g, gi) => ({
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
    navigate('/')
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium">记录训练</h1>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-medium text-gray-700">泳池信息</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">泳池长度（米）</label>
            <select
              value={customPool ? 'custom' : poolLen}
              onChange={e => {
                if (e.target.value === 'custom') { setCustomPool(true) }
                else { setCustomPool(false); setPoolLen(parseInt(e.target.value)) }
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
            >
              <option value={25}>25 米（短池）</option>
              <option value={50}>50 米（标准池）</option>
              <option value="custom">自定义</option>
            </select>
          </div>
          {customPool && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">自定义长度（米）</label>
              <input
                type="number"
                value={poolLen}
                onChange={e => setPoolLen(parseInt(e.target.value))}
                min={10} max={200}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
              />
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">训练日期</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">备注（可选）</label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="早训、傍晚…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
            />
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-gray-700">训练组</h2>
          <button
            onClick={addGroup}
            className="text-sm text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
          >
            + 添加训练组
          </button>
        </div>

        {groups.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6">点击「添加训练组」开始记录</p>
        )}

        <div className="space-y-4">
          {groups.map((g, gi) => (
            <div key={g.id} className="border border-gray-100 rounded-xl p-4 bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-500">训练组 {gi + 1}</span>
                <button onClick={() => removeGroup(g.id)} className="text-xs text-red-400 hover:text-red-600">删除</button>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">泳姿（组级，可选）</label>
                  <select
                    value={g.stroke}
                    onChange={e => updateGroup(g.id, 'stroke', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-gray-400"
                  >
                    <option value="">不设定（小组必填）</option>
                    {STROKES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">
                    {g.stroke ? '将自动填充到各小组' : '各小组需单独选择'}
                  </p>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">练习模式</label>
                  <select
                    value={g.mode}
                    onChange={e => updateGroup(g.id, 'mode', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-gray-400"
                  >
                    {MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={() => addSet(g.id)}
                    className="w-full text-sm border border-gray-200 bg-white px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    + 添加小组
                  </button>
                </div>
              </div>

              {g.sets.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-2">点击「添加小组」录入每组距离和用时</p>
              )}

              <div>
                {g.sets.map((s, si) => {
                  const totalTimeSec = s.timeMin * 60 + s.timeSec
                  const paceInfo = totalTimeSec > 0 && s.dist > 0 ? getPaceLevel((totalTimeSec / s.dist) * 50) : null
                  const paceStr = totalTimeSec > 0 && s.dist > 0 ? fmtTime((totalTimeSec / s.dist) * 50) : null

                  return (
                    <div key={s.id}>
                      <div className="bg-white border border-gray-100 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-gray-500">
                            第 {si + 1} 组
                            {paceInfo && paceStr && (
                              <span className={`ml-2 px-2 py-0.5 rounded text-xs ${paceInfo.color}`}>
                                {paceInfo.label} {paceStr}/50m
                              </span>
                            )}
                          </span>
                          <button onClick={() => removeSet(g.id, s.id)} className="text-xs text-red-400 hover:text-red-600">×</button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">距离</label>
                                <input
                                type="number"
                                value={s.dist === 0 ? '' : s.dist}
                                onChange={e => {
                                    const val = e.target.value
                                    updateSet(g.id, s.id, 'dist', val === '' ? 0 : parseFloat(val) || 0)
                                }}
                                min={poolLen} step={poolLen}
                                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-gray-400"
                                />
                                <p className="text-xs text-gray-400 mt-0.5">{s.dist > 0 ? s.dist / poolLen + ' 趟' : ''}</p>
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">时间</label>
                                <div className="flex items-center gap-1">
                                <input
                                    type="number"
                                    value={s.timeMin}
                                    onChange={e => updateSet(g.id, s.id, 'timeMin', parseInt(e.target.value) || 0)}
                                    min={0} max={59}
                                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-gray-400"
                                />
                                <span className="text-xs text-gray-400">分</span>
                                <input
                                    type="number"
                                    value={s.timeSec}
                                    onChange={e => updateSet(g.id, s.id, 'timeSec', Math.min(59, parseInt(e.target.value) || 0))}
                                    min={0} max={59}
                                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-gray-400"
                                />
                                <span className="text-xs text-gray-400">秒</span>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">泳姿</label>
                                <select
                                value={s.stroke}
                                onChange={e => updateSet(g.id, s.id, 'stroke', e.target.value)}
                                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-gray-400"
                                >
                                {g.stroke ? <option value="">继承({g.stroke})</option> : <option value="">请选择</option>}
                                {STROKES.map(st => <option key={st} value={st}>{st}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">模式</label>
                                <select
                                value={s.mode}
                                onChange={e => updateSet(g.id, s.id, 'mode', e.target.value)}
                                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-gray-400"
                                >
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
                            <input
                                type="number"
                                value={s.restMin}
                                onChange={e => updateSet(g.id, s.id, 'restMin', parseInt(e.target.value) || 0)}
                                min={0} max={59}
                                className="border border-gray-200 rounded px-2 py-1 text-xs w-12 focus:outline-none"
                            />
                            <span className="text-xs text-gray-400">分</span>
                            <input
                                type="number"
                                value={s.restSec}
                                onChange={e => updateSet(g.id, s.id, 'restSec', Math.min(59, parseInt(e.target.value) || 0))}
                                min={0} max={59}
                                className="border border-gray-200 rounded px-2 py-1 text-xs w-12 focus:outline-none"
                            />
                            <span className="text-xs text-gray-400">秒</span>
                            </div>
                            <div className="flex-1 border-t border-dashed border-gray-200"></div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button
          onClick={() => setGroups([])}
          className="text-sm border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
        >
          清空
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-sm bg-blue-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存训练'}
        </button>
      </div>
    </div>
  )
}