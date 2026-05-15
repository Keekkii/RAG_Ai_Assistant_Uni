import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase URL or Anon Key is missing in .env')
}

// Singleton pattern to prevent multiple instances during HMR (Hot Module Replacement)
if (!window.supabaseInstance) {
    window.supabaseInstance = createClient(supabaseUrl, supabaseAnonKey)
}

export const supabase = window.supabaseInstance
