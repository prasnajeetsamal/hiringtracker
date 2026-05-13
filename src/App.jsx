// src/App.jsx
import React from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';

import AuthScreen from './components/auth/AuthScreen.jsx';
import AppShell from './components/layout/AppShell.jsx';
import CandidateStatusPage from './pages/CandidateStatusPage.jsx';
import { AuthProvider, useAuth } from './lib/AuthContext.jsx';
import { isSupabaseConfigured } from './lib/supabase.js';
import { queryClient } from './lib/queryClient.js';

function FullPageLoader() {
  return (
    <div className="min-h-screen grid place-items-center text-slate-300">
      <div className="flex items-center gap-3">
        <Loader2 size={20} className="animate-spin text-indigo-400" />
        <span className="text-sm">Loading…</span>
      </div>
    </div>
  );
}

function ConfigError() {
  return (
    <div className="min-h-screen grid place-items-center px-4 text-slate-200">
      <div className="max-w-md rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 backdrop-blur">
        <div className="flex items-start gap-3">
          <AlertCircle className="text-amber-400 shrink-0 mt-0.5" size={20} />
          <div>
            <h2 className="font-semibold text-slate-100">Supabase isn't configured</h2>
            <p className="text-sm text-slate-300 mt-2">
              Slate needs these env vars in <code className="text-slate-100">.env</code>:
            </p>
            <ul className="text-sm text-slate-300 mt-2 space-y-1 list-disc list-inside">
              <li><code className="text-slate-100">VITE_SUPABASE_URL</code></li>
              <li><code className="text-slate-100">VITE_SUPABASE_ANON_KEY</code></li>
              <li><code className="text-slate-100">SUPABASE_SERVICE_ROLE_KEY</code> <span className="text-slate-500">(server-side)</span></li>
            </ul>
            <p className="text-xs text-slate-400 mt-3">
              Find them in your Supabase project under <em>Settings → API</em>. After adding them, restart the dev server.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Gate() {
  const { session, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!session) return <AuthScreen />;
  return <AppShell />;
}

export default function App() {
  if (!isSupabaseConfigured) return <ConfigError />;
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* PUBLIC routes - rendered outside the auth Gate so candidates
                without a Slate login can view their own status by token. */}
            <Route path="/c/:token" element={<CandidateStatusPage />} />
            {/* Everything else hits the auth gate. */}
            <Route path="*" element={<Gate />} />
          </Routes>
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: 'rgb(15 23 42)',
                color: 'rgb(226 232 240)',
                border: '1px solid rgb(51 65 85)',
              },
            }}
          />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
