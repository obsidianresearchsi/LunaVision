/**
 * @deprecated This file is deprecated. Use supabaseDb from './supabaseDb' instead.
 * 
 * This file previously contained the localStorage-based DatabaseService.
 * All data operations have been migrated to Supabase.
 * 
 * Migration guide:
 * - Replace: import { db } from './services/db'
 * - With:    import { supabaseDb } from './services/supabaseDb'
 * - Note:    All methods are now async and return Promises
 */

// Re-export supabaseDb for backwards compatibility during migration
export { supabaseDb as db } from './supabaseDb';
