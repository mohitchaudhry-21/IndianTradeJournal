import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { JournalProvider } from './context/JournalContext';
import Sidebar from './components/Sidebar';
import LoginScreen, { isAuthEnabled, isAuthenticated } from './components/LoginScreen';
import Dashboard from './pages/Dashboard';
import Positions from './pages/Positions';
import TradeHistory from './pages/TradeHistory';
import Analytics from './pages/Analytics';
import ManualEntry from './pages/ManualEntry';
import BrokerConnect from './pages/BrokerConnect';
import Settings from './pages/Settings';
import ScreenshotImport from './pages/ScreenshotImport';
import Calendar from './pages/Calendar';

export default function App() {
  if (isAuthEnabled() && !isAuthenticated()) {
    return <LoginScreen />;
  }
  return (
    <JournalProvider>
      <BrowserRouter>
        <div className="app-layout">
          <Sidebar />
          <main className="main-content">
            <Routes>
              <Route path="/"           element={<Dashboard />} />
              <Route path="/positions"  element={<Positions />} />
              <Route path="/history"    element={<TradeHistory />} />
              <Route path="/analytics"  element={<Analytics />} />
              <Route path="/entry"      element={<ManualEntry />} />
              <Route path="/broker"     element={<BrokerConnect />} />
              <Route path="/settings"   element={<Settings />} />
              <Route path="/screenshot" element={<ScreenshotImport />} />
              <Route path="/calendar"   element={<Calendar />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </JournalProvider>
  );
}
