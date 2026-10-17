'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { apiFetch } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Alert, Spinner } from '@/components/ui/feedback';

function useAfterSignIn() {
  const router = useRouter();
  const params = useSearchParams();
  return () => {
    const next = params.get('next');
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    router.replace(safeNext);
    router.refresh();
  };
}

function LoginForm() {
  const done = useAfterSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch('/api/auth/login', { method: 'POST', body: { email, password } });
      done();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" size="md" className="w-full" loading={loading}>
        Sign in
      </Button>
    </form>
  );
}

function SetupForm() {
  const done = useAfterSignIn();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch('/api/auth/setup', { method: 'POST', body: { ...form, name: form.name || undefined } });
      done();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <p className="font-semibold text-slate-900">Create your admin account</p>
        <p className="mt-1 text-sm text-slate-500">
          First-time setup. This account is only for signing in to this dashboard — it is not your ChatGPT or WordPress login.
        </p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Your name" htmlFor="name">
        <Input id="name" autoComplete="name" value={form.name} onChange={set('name')} />
      </Field>
      <Field label="Email" htmlFor="setup-email">
        <Input id="setup-email" type="email" autoComplete="username" required value={form.email} onChange={set('email')} />
      </Field>
      <Field label="Password" htmlFor="setup-password" hint="At least 10 characters">
        <Input id="setup-password" type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={set('password')} />
      </Field>
      <Field label="Confirm password" htmlFor="setup-confirm">
        <Input id="setup-confirm" type="password" autoComplete="new-password" required value={form.confirmPassword} onChange={set('confirmPassword')} />
      </Field>
      <Button type="submit" size="md" className="w-full" loading={loading}>
        Create account & open dashboard
      </Button>
    </form>
  );
}

function AuthCard() {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ needsSetup: boolean }>('/api/auth/setup')
      .then((r) => setNeedsSetup(r.needsSetup))
      .catch((err) => {
        setError((err as Error).message);
        setNeedsSetup(false);
      });
  }, []);

  if (needsSetup === null) {
    return (
      <div className="flex justify-center py-8 text-slate-400">
        <Spinner />
      </div>
    );
  }
  return (
    <>
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {needsSetup ? <SetupForm /> : <LoginForm />}
    </>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5 text-white">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <p className="font-semibold">Blog Automation Studio</p>
            <p className="text-xs text-slate-300">Sign in to your dashboard</p>
          </div>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <Suspense fallback={null}>
            <AuthCard />
          </Suspense>
        </div>
        <p className="mt-4 text-center text-xs text-slate-400">
          Dashboard account only. ChatGPT and WordPress logins are kept in browser profiles, never here.
        </p>
      </div>
    </div>
  );
}
