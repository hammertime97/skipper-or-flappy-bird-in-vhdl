import { useState } from 'react';

import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** Run one AI request; afterwards refresh the user so the quota counter stays right. */
export function useAiRun<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const { refreshUser } = useAuth();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const run = async (...args: A): Promise<R | null> => {
    setRunning(true);
    setError(null);
    try {
      return await fn(...args);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(String(e), 0));
      return null;
    } finally {
      setRunning(false);
      refreshUser().catch(() => {});
    }
  };

  return { run, running, error };
}
