import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import { JournalProvider } from './context/JournalContext';
import Sidebar from './components/Sidebar';
import TickerBar from './components/TickerBar';
import LoginScreen, { isAuthEnabled, isAuthenticated } from './components/LoginScreen';
import Dashboard from './pages/Dashboard';
import Positions from './pages/Positions';
import OptionsAnalyzer from './pages/OptionsAnalyzer';
import StrategyBuilder from './pages/StrategyBuilder';
import TradeHistory from './pages/TradeHistory';
import Analytics from './pages/Analytics';
import ManualEntry from './pages/ManualEntry';
import BrokerConnect from './pages/BrokerConnect';
import StrategyWizard from './pages/StrategyWizard';
import Settings from './pages/Settings';
import ScreenshotImport from './pages/ScreenshotImport';
import Calendar from './pages/Calendar';



// Error boundary — catches crashes and shows error instead of blank page
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: 'monospace', color: '#f87171', background: '#0a0f1e', minHeight: '100vh' }}>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>⚠ OptionsDesk crashed</div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>Share this error so it can be fixed:</div>
          <pre style={{ background: '#1e293b', padding: 16, borderRadius: 8, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack?.slice(0, 600)}
          </pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: 20, padding: '10px 24px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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

// Keeps StrategyBuilder mounted at all times — only toggles visibility.
// This preserves the live option chain poll, leg state, expiry selection,
// and all derived data across navigation without needing sessionStorage hacks.
function StrategyBuilderKeepAlive() {
  const location = useLocation();
  const isActive = location.pathname === '/strategy-builder';
  return (
    <div style={{ display: isActive ? 'block' : 'none' }}>
      <StrategyBuilder />
    </div>
  );
}

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
      <ErrorBoundary>
    <HashRouter>
        <TitleUpdater />
        <div className="app-layout" style={{ minHeight:'100vh', display:'flex' }}>
          <Sidebar />
          <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, marginLeft:'var(--sidebar-w)' }}>
            <TickerBar />
            <main className="main-content" style={{ flex:1, marginLeft:0 }}>
              {/* StrategyBuilder is always mounted (never unmounted on navigation)
                  so its option chain polling, leg state, and expiry data all
                  survive when the user navigates to another page and comes back.
                  We simply hide/show it with CSS instead of mounting/unmounting. */}
              <StrategyBuilderKeepAlive />
              <Routes>
              <Route path="/"           element={<Dashboard />} />
              <Route path="/positions"  element={<Positions />} />
              <Route path="/analyzer"   element={<OptionsAnalyzer />} />
              <Route path="/wizard"     element={<StrategyWizard />} />
              <Route path="/strategy-builder" element={null} />
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
        </div>
      </HashRouter>
    </ErrorBoundary>
    </JournalProvider>
  );
}
