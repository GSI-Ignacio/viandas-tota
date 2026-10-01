/* ============================================================
   CONFIGURACIÓN DE SUPABASE
   Supabase → Project Settings → API → Project URL / anon public key
   Antes de usar esta versión hay que correr migracion-v2.sql en el
   SQL Editor de Supabase (una sola vez, conserva los datos).
============================================================= */
const SUPABASE_URL_PROD = 'https://dhgcqmfvqtkzdplwztfh.supabase.co';
const SUPABASE_ANON_KEY_PROD = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoZ2NxbWZ2cXRremRwbHd6dGZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyODY3MDksImV4cCI6MjA5ODg2MjcwOX0.5i7SC9EosNVtk42IYjojT1CD-TtVYUSMEag_48ty-d8';
// js/config.local.js (no se sube a git) define window.SUPABASE_LOCAL = { url, anonKey } para trabajar con la base local
const BASE_LOCAL = !!(window.SUPABASE_LOCAL && window.SUPABASE_LOCAL.url);
const SUPABASE_URL = BASE_LOCAL ? window.SUPABASE_LOCAL.url : SUPABASE_URL_PROD;
const SUPABASE_ANON_KEY = BASE_LOCAL ? window.SUPABASE_LOCAL.anonKey : SUPABASE_ANON_KEY_PROD;
