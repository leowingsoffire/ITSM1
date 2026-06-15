import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'

function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-dark-bg">
        <Sidebar />
        <main className="ml-60 flex-1 p-8 overflow-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/proposals" element={<Placeholder title="Proposals" />} />
            <Route path="/mdrt" element={<Placeholder title="MDRT Progress" />} />
            <Route path="/planning" element={<Placeholder title="Financial Planning" />} />
            <Route path="/applications" element={<Placeholder title="Applications" />} />
            <Route path="/calendar" element={<Placeholder title="Calendar" />} />
            <Route path="/reports" element={<Placeholder title="Monthly Reports" />} />
            <Route path="/docs" element={<Placeholder title="DS Documentation" />} />
            <Route path="/tests" element={<Placeholder title="2023 Test Reports" />} />
            <Route path="/add" element={<Placeholder title="Add Function" />} />
            <Route path="/archive" element={<Placeholder title="Archive" />} />
            <Route path="/settings" element={<Placeholder title="Settings" />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

function Placeholder({ title }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white">{title}</h1>
      <p className="mt-2 text-dark-muted">Coming soon</p>
    </div>
  )
}

export default App
