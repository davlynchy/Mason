import { createClient } from '@supabase/supabase-js';

function getEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}

// Server-side (service role — full access)
export function createServerClient() {
  const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  return createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${serviceRoleKey}` } },
    }
  );
}

// Server-side auth client (anon key — use when you want normal user auth behavior)
export function createServerAuthClient() {
  return createClient(
    getEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Browser client (anon key — respects RLS)
export function createBrowserClient() {
  return createClient(
    getEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  );
}

// Database types
export interface Report {
  id: string;
  user_id: string | null;
  email: string;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  contract_type: 'subcontract' | 'head_contract';
  jurisdiction: 'AU' | 'UK' | 'USA';
  analysis_stage: 'preview' | 'full';
  file_count: number;
  preview_data: Record<string, unknown> | null;
  full_data: Record<string, unknown> | null;
  paid: boolean;
  stripe_session_id: string | null;
  error_message: string | null;
  processing_phase: 'queued' | 'extracting' | 'summarising' | 'counting' | 'top_risk' | 'complete' | 'error' | null;
  processing_message: string | null;
  processing_error: string | null;
  processing_started_at: string | null;
  processing_updated_at: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Profile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  company_name: string;
  country: 'AU' | 'UK' | 'USA' | null;
  phone: string | null;
  website: string | null;
  created_at: string;
}
