import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'

function App() {
  return (
    <BrowserRouter>
      <nav className="bg-red-700 text-white px-6 py-3 flex gap-6">
        <span className="font-bold text-lg mr-4">ThidaAI</span>
        <NavLink to="/" end className={({ isActive }) => isActive ? 'underline' : ''}>Dashboard</NavLink>
        <NavLink to="/clients" className={({ isActive }) => isActive ? 'underline' : ''}>Clients</NavLink>
        <NavLink to="/proposals" className={({ isActive }) => isActive ? 'underline' : ''}>Proposals</NavLink>
        <NavLink to="/mdrt" className={({ isActive }) => isActive ? 'underline' : ''}>MDRT</NavLink>
        <NavLink to="/planning" className={({ isActive }) => isActive ? 'underline' : ''}>Planning</NavLink>
      </nav>
      <main className="p-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/proposals" element={<div><h1 className="text-2xl font-bold">Proposals</h1><p className="mt-2 text-gray-500">Coming soon</p></div>} />
          <Route path="/mdrt" element={<div><h1 className="text-2xl font-bold">MDRT Progress</h1><p className="mt-2 text-gray-500">Coming soon</p></div>} />
          <Route path="/planning" element={<div><h1 className="text-2xl font-bold">Financial Planning</h1><p className="mt-2 text-gray-500">Coming soon</p></div>} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}

export default App
