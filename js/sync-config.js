// The Supabase project URL and publishable key are intentionally browser-visible.
// They identify the project; they grant no data access on their own. Privacy is
// enforced by sign-in plus the Row Level Security policies in supabase/schema.sql,
// which restrict every tracker row to its own authenticated owner.
//
// Never place a Supabase secret key, service-role key, database password, or
// access token in this file. It is committed to a public repository.
//
// The owner email is deliberately NOT stored here. It is typed once per device
// and cached in that browser only, so the public repository never names an
// account for anyone to target.
export const SYNC_CONFIG = Object.freeze({
  supabaseUrl: "https://hqsfeunkuvzuhbivlyla.supabase.co",
  supabasePublishableKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhxc2ZldW5rdXZ6dWhiaXZseWxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5OTAwNjcsImV4cCI6MjEwMjU2NjA2N30.UECgTJEjfEhwVjncaNIunyaA38hK1iEBy1j5YEBbUAo",
});
