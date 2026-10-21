// Configuration des comptes (Supabase). Laisse vide pour le mode local uniquement.
// Voir README.md > « Activer la connexion ».
// La clé "anon" est publique par conception : la sécurité vient des règles RLS de supabase/schema.sql.
window.ARCHI_CONFIG = {
  supabaseUrl: '',      // ex. 'https://abcdefgh.supabase.co'
  supabaseAnonKey: '',  // ex. 'eyJhbGciOi...' (Project Settings > API > anon public)
  siteUrl: '',          // ex. 'https://wakforge.github.io/' (liens des e-mails)
};
