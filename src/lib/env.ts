const readEnv = (name: string) => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

const readUrl = (name: string) => {
  const value = readEnv(name);

  if (!value) {
    return undefined;
  }

  try {
    new URL(value);
    return value;
  } catch {
    return undefined;
  }
};

const readUrlFrom = (...names: string[]) => {
  for (const name of names) {
    const value = readUrl(name);

    if (value) {
      return value;
    }
  }

  return undefined;
};

const readEnvFrom = (...names: string[]) => {
  for (const name of names) {
    const value = readEnv(name);

    if (value) {
      return value;
    }
  }

  return undefined;
};

export const env = {
  DATABASE_URL: readEnv("DATABASE_URL"),
  NEXT_PUBLIC_SUPABASE_URL: readUrlFrom(
    "NEXT_PUBLIC_SUPABASE_URL",
    "MANEX_REST_API_URL",
  ),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: readEnvFrom(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "MANEX_REST_API_KEY",
  ),
  SUPABASE_SERVICE_ROLE_KEY: readEnv("SUPABASE_SERVICE_ROLE_KEY"),
  MANEX_REST_API_URL: readUrlFrom(
    "MANEX_REST_API_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
  ),
  MANEX_REST_API_KEY: readEnvFrom(
    "MANEX_REST_API_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ),
  MANEX_STUDIO_URL: readUrl("MANEX_STUDIO_URL"),
  MANEX_ASSET_BASE_URL: readUrl("MANEX_ASSET_BASE_URL"),
  OPENAI_API_KEY: readEnv("OPENAI_API_KEY"),
  OPENAI_MODEL: readEnv("OPENAI_MODEL") ?? "gpt-5.4-mini",
} as const;

export const capabilities = {
  hasPostgres: Boolean(env.DATABASE_URL),
  hasRest: Boolean(env.MANEX_REST_API_URL && env.MANEX_REST_API_KEY),
  hasAi: Boolean(env.OPENAI_API_KEY),
} as const;
