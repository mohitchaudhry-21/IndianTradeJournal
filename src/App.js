import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
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


const PAGE_TITLES = {
  '/':           'Dashboard',
  '/positions':  'Open Positions',
  '/history':    'Trade History',
  '/analytics':  'Analytics',
  '/calendar':   'Calendar',
  '/entry':      'Add Trade',
  '/screenshot': 'Screenshot Import',
  '/broker':     'Broker Connect',
  '/settings':   'Settings',
};

function TitleUpdater() {
  const location = useLocation();
  useEffect(() => {
    const page = PAGE_TITLES[location.pathname] || 'OptionsDesk';
    document.title = `${page} | OptionsDesk`;
  }, [location.pathname]);
  return null;
}

export default function App() {
  if (isAuthEnabled() && !isAuthenticated()) {
    return <LoginScreen />;
  }
  return (
    <JournalProvider>
      <HashRouter>
        <TitleUpdater />
        <div className="app-layout" style={{ minHeight:'100vh', display:'flex' }}>
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
      </HashRouter>
    </JournalProvider>
  );
}
