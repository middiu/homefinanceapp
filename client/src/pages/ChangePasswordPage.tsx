import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useChangePasswordMutation, useGetMeQuery, api } from '@/app/api';
import type { AppDispatch } from '@/app/store';

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const { data: me } = useGetMeQuery();
  const [change, { isLoading }] = useChangePasswordMutation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const forced = !!me?.mustResetPassword;

  const strength =
    next.length === 0 ? null
    : next.length < 12 ? 'Too short (min 12 characters)'
    : next === 'admin' ? 'Must not equal the username'
    : next === current ? 'Must differ from the current password'
    : next.length >= 16 ? 'Strong'
    : 'OK';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (next.length < 12) {
      setError('New password must be at least 12 characters.');
      return;
    }
    try {
      const r: any = await change({ currentPassword: current, newPassword: next });
      if (r.error) {
        setError(r.error.data?.error || 'Could not change password.');
        return;
      }
      // Patch the getMe cache optimistically so RequireAuth lets us through to /
      // even before the refetch resolves, AND force a refetch so the cache is
      // server-confirmed before we navigate. Both happen: patch is instant,
      // refetch is authoritative. Without the refetch there is a tiny window
      // where a stale `mustReset=true` could bounce RequireAuth back to
      // /change-password; without the patch the refetch alone leaves a window
      // where the user sees the forced-reset gate. Together: gate-clear at all
      // times. Navigate runs only after the refetch resolves.
      dispatch(
        api.util.updateQueryData('getMe', undefined, (draft) => {
          if (draft) draft.mustResetPassword = false;
        }),
      );
      try {
        await dispatch(
          api.endpoints.getMe.initiate(undefined, { forceRefetch: true }),
        ).unwrap();
      } catch {
        // Refetch failed (transient network) — cache patch is already applied,
        // so RequireAuth will still let us through. Continue to navigate.
      }
      navigate('/', { replace: true });
    } catch {
      setError('Something went wrong. Try again.');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{forced ? 'Set a new password' : 'Change password'}</CardTitle>
          <CardDescription>
            {forced
              ? 'This is your first sign-in. Choose a new password to continue.'
              : 'Update your account password.'}
          </CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="space-y-3">
            {error && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="cur">Current password</Label>
              <Input id="cur" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new">New password</Label>
              <Input id="new" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
              {strength && (
                <p className={`text-xs ${strength === 'Strong' || strength === 'OK' ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                  {strength}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conf">Confirm new password</Label>
              <Input id="conf" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={isLoading || !current || !next || !confirm}>
              {isLoading ? 'Saving…' : 'Update password'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}