import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import LogPage from './pages/LogPage.tsx'
import HistoryPage from './pages/HistoryPage.tsx'
import ProfilePage from './pages/ProfilePage.tsx'

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-2xl mx-auto px-4 flex gap-1 py-2">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-100'
                }`
              }
            >
              历史记录
            </NavLink>
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-100'
                }`
              }
            >
              个人档案
            </NavLink>
          </div>
        </nav>

        <main className="max-w-2xl mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<HistoryPage />} />
            <Route path="/log" element={<LogPage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}