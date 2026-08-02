import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useGetMeQuery } from './api';

/**
 * Layout route guarding all authenticated pages.
 *  - loading → splash
 *  - no session (401) → redirect to /login (remembering where they came from)
 *  - mustResetPassword && not already on /change-password → force /change-password
 *  - else → render the nested route via <Outlet/>
 */
export function RequireAuth() {
  const { data: me, isLoading, error } = useGetMeQuery();
  const loc = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!me || error) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }
  if (me.mustResetPassword && loc.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}