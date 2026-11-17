import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configFaltante = !url || !anonKey

// La "anon key" es pública por diseño: la seguridad real la dan el login y RLS.
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'falta-configurar')
