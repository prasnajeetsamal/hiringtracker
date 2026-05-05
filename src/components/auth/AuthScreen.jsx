// src/components/auth/AuthScreen.jsx
import React, { useState } from 'react';
import { ClipboardList, Sparkles, Mail, Lock, Loader2, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';

export default function AuthScreen() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');

    if (!email.trim()) return setError('Email is required.');

    if (mode === 'reset') {
      setLoading(true);
      const { error: err } = await resetPassword(email.trim());
      setLoading(false);
      if (err) return setError(err.message);
      setInfo('Check your email for a password reset link.');
      return;
    }

    if (!password) return setError('Password is required.');
    if (mode === 'signup') {
      if (password.length < 8) return setError('Password must be at least 8 characters.');
      if (password !== confirm) return setError('Passwords do not match.');
    }

    setLoading(true);
    const fn = mode === 'signin' ? signIn : signUp;
    const { data, error: err } = await fn(email.trim(), password);
    setLoading(false);

    if (err) return setError(err.message);

    if (mode === 'signup') {
      if (!data?.session) {
        setInfo('Account created. Check your email to confirm, then sign in.');
        setMode('signin');
        setPassword('');
        setConfirm('');
      }
    }
  };

  const switchMode = (m) => {
    setMode(m);
    setError('');
    setInfo('');
    setPassword('');
    setConfirm('');
  };

  return (
    <div className="min-h-screen text-slate-200 flex items-center justify-center px-4 py-12 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full bg-violet-500/15 blur-3xl" />
        <div className="absolute top-1/3 left-1/2 w-[400px] h-[400px] rounded-full bg-pink-500/10 blur-3xl" />
      </div>

      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-6">
          <div className="relative">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-500 blur-md opacity-60" />
            <div className="relative w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-500 text-white grid place-items-center shadow-lg shadow-indigo-500/40">
              <ClipboardList size={22} />
            </div>
          </div>
          <div className="leading-tight">
            <div className="text-lg font-semibold tracking-tight text-gradient">Slate</div>
            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <Sparkles size={10} /> Hiring tracker · powered by Claude
            </div>
          </div>
        </div>

        <div className="relative rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/80 via-slate-900/60 to-slate-900/40 backdrop-blur p-6 shadow-2xl shadow-slate-950/50">
          <h1 className="text-xl font-semibold text-slate-100 tracking-tight">
            {mode === 'signin' && 'Welcome back'}
            {mode === 'signup' && 'Create your account'}
            {mode === 'reset' && 'Reset your password'}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            {mode === 'signin' && 'Sign in to manage your hiring pipeline.'}
            {mode === 'signup' && 'It only takes a moment.'}
            {mode === 'reset' && 'We’ll email you a reset link.'}
          </p>

          {mode !== 'reset' && (
            <div className="mt-5 flex rounded-lg bg-slate-800/80 p-0.5 text-sm border border-slate-700">
              <button
                onClick={() => switchMode('signin')}
                className={`flex-1 px-3 py-1.5 rounded-md transition ${mode === 'signin' ? 'bg-slate-700 text-slate-100 font-medium shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
              >
                Sign in
              </button>
              <button
                onClick={() => switchMode('signup')}
                className={`flex-1 px-3 py-1.5 rounded-md transition ${mode === 'signup' ? 'bg-slate-700 text-slate-100 font-medium shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
              >
                Sign up
              </button>
            </div>
          )}

          <form onSubmit={submit} className="mt-5 space-y-3">
            <Field icon={Mail} label="Email">
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
                required
              />
            </Field>

            {mode !== 'reset' && (
              <Field icon={Lock} label="Password">
                <input
                  type="password"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                  className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  required
                />
              </Field>
            )}

            {mode === 'signup' && (
              <Field icon={Lock} label="Confirm password">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter your password"
                  className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  required
                />
              </Field>
            )}

            {error && (
              <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            {info && (
              <div className="flex items-start gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
                <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                <span>{info}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-white shadow-lg shadow-indigo-900/40 transition disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-indigo-600 via-violet-600 to-pink-600 hover:from-indigo-500 hover:via-violet-500 hover:to-pink-500"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Please wait…
                </>
              ) : (
                <>
                  {mode === 'signin' && 'Sign in'}
                  {mode === 'signup' && 'Create account'}
                  {mode === 'reset' && 'Send reset link'}
                  <ArrowRight size={16} />
                </>
              )}
            </button>

            {mode === 'signin' && (
              <div className="text-center">
                <button type="button" onClick={() => switchMode('reset')} className="text-xs text-slate-400 hover:text-indigo-300 transition">
                  Forgot your password?
                </button>
              </div>
            )}
            {mode === 'reset' && (
              <div className="text-center">
                <button type="button" onClick={() => switchMode('signin')} className="text-xs text-slate-400 hover:text-indigo-300 transition">
                  Back to sign in
                </button>
              </div>
            )}
          </form>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          Slate is for internal hiring use. Be thoughtful with candidate data.
        </p>
      </div>
    </div>
  );
}

function Field({ icon: Icon, label, children }) {
  return (
    <label className="block">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 bg-slate-950/60 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent">
        <Icon size={14} className="text-slate-500 shrink-0" />
        {children}
      </div>
    </label>
  );
}
