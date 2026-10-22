// src/lib/supabase.ts — direct Supabase access, same anon key the real
// website's own bundle embeds (not a secret — this is the public,
// anon-role key, safe to ship in client code; every widget config table
// is deliberately anon-readable/writable by design, since an OBS browser
// source has no login session at all — see kickpulse-new's own CLAUDE.md
// RLS-category-2 note). This is the core of "read my settings and edit
// whatever": the same mechanism the website's own settings pages use for
// every widget, used natively here instead of loading the website's pages.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://blqnhiatjjzuqpujhdmr.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJscW5oaWF0amp6dXFwdWpoZG1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2MDUxMDAsImV4cCI6MjA4MzE4MTEwMH0.Q2WKOKEIWJl1bT3GJZ-Mu0UQftUQ7mIXc4jUAUwneHI';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
