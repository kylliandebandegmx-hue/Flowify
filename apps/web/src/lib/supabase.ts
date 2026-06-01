import { createClient } from '@supabase/supabase-js';

const defaultSupabaseUrl = 'https://gjphlxpdgwbwfdgayhis.supabase.co';
const defaultSupabaseKey = 'sb_publishable_X850AIpTtbPs0VHDmkNAmg_7PLHRaHa';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || defaultSupabaseUrl;
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || defaultSupabaseKey;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
