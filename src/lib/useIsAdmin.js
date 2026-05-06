// src/lib/useIsAdmin.js
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase.js';
import { useAuth } from './AuthContext.jsx';

/**
 * Returns { isAdmin, role, loading }. Admin role is required for destructive
 * actions (delete candidate / role / project).
 */
export function useIsAdmin() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['profile-role', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      return data;
    },
  });
  return {
    isAdmin: data?.role === 'admin',
    role: data?.role,
    loading: isLoading,
  };
}
