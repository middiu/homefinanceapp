import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Wallet, Eye, EyeOff } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLoginMutation } from '@/app/api';

export default function LoginPage() {
  const navigate = useNavigate();
  const loc = useLocation();
  const [login, { isLoading }] = useLoginMutation();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockUntil, setLockUntil] = useState<number | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLockUntil(null);
    try {
      const r: any = await login({ username, password });
      if (r.error) {
        const status = r.error.status;
        const body: any = r.error.data;
        if (status === 429 && body?.lockedUntil) {
          setLockUntil(body.lockedUntil);
          setError(body.error === 'account locked' ? 'Account temporarily locked. Try again later.' : 'Too many attempts. Try again later.');
        } else if (status === 429) {
          setError('Too many login attempts. Try again later.');
        } else {
          setError('Invalid username or password.');
        }
        return;
      }
      const dest = (loc.state as { from?: string } | null)?.from;
      navigate(dest && dest !== '/login' ? dest : '/', { replace: true });
    } catch {
      setError('Something went wrong. Try again.');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
            <Wallet className="h-5 w-5 text-primary" />
          </div>
          <CardTitle>HomeFinance</CardTitle>
          <CardDescription>Sign in to your household finance</CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="space-y-3">
            {error && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex-col gap-2">
            <Button type="submit" className="w-full" disabled={isLoading || !password || !!lockUntil}>
              {isLoading ? 'Signing in…' : lockUntil ? 'Locked' : 'Sign in'}
            </Button>
            {lockUntil && (
              <p className="text-xs text-muted-foreground">
                Account locked. Try again in {Math.max(1, Math.ceil((lockUntil - Date.now()) / 1000))}s.
              </p>
            )}
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}