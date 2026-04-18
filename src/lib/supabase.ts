import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

export function createSupabaseServerClient() {
  const url = env.MANEX_REST_API_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    env.MANEX_REST_API_KEY ??
    env.SUPABASE_SERVICE_ROLE_KEY ??
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    },
  });
}
