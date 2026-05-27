import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface Profile {
  name?: string
  gender?: string
  weight?: number
  height?: number
  birthYear?: number
  experience?: string
}

export default function ProfilePage() {
  const [form, setForm] = useState<Profile>({})
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
  api.get('/api/profile').then((data: Profile) => {
    if (data && typeof data === 'object') {
      setForm(data)
    }
    setLoading(false)
  }).catch(() => {
    setLoading(false)
  })}, [])

  const handleChange = (field: keyof Profile, value: string | number) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    await api.put('/api/profile', form)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading) return <div className="text-gray-400 text-sm">加载中…</div>

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium">个人档案</h1>

      {saved && (
        <div className="bg-green-50 text-green-700 text-sm px-4 py-2 rounded-lg">
          已保存
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">姓名</label>
            <input
              type="text"
              value={form.name ?? ''}
              onChange={e => handleChange('name', e.target.value)}
              placeholder="你的名字"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">性别</label>
            <select
              value={form.gender ?? ''}
              onChange={e => handleChange('gender', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
            >
              <option value="">不设置</option>
              <option value="male">男</option>
              <option value="female">女</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">体重（kg）</label>
            <input
              type="number"
              value={form.weight ?? ''}
              onChange={e => handleChange('weight', parseFloat(e.target.value))}
              placeholder="70"
              min={30}
              max={200}
              step={0.5}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">身高（cm）</label>
            <input
              type="number"
              value={form.height ?? ''}
              onChange={e => handleChange('height', parseFloat(e.target.value))}
              placeholder="170"
              min={100}
              max={220}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">出生年份</label>
            <input
              type="number"
              value={form.birthYear ?? ''}
              onChange={e => handleChange('birthYear', parseInt(e.target.value))}
              placeholder="1990"
              min={1930}
              max={2010}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">泳龄 / 经验</label>
          <select
            value={form.experience ?? ''}
            onChange={e => handleChange('experience', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
          >
            <option value="">不设置</option>
            <option value="beginner">新手（&lt; 1年）</option>
            <option value="intermediate">中级（1–3年）</option>
            <option value="advanced">进阶（3–5年）</option>
            <option value="expert">资深（5年以上）</option>
          </select>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          保存档案
        </button>
      </div>
    </div>
  )
}