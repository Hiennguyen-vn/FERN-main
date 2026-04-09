import { createContext } from 'react';
import type { AuthSession } from '@/api/fern-api';

export interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
