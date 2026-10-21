// Connexion et synchronisation via Supabase (optionnel).
// Sans configuration (js/config.js vide), l'appli fonctionne en mode local.

import { t } from './i18n.js';

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';

/**
 * @param {object} o
 * @param {{supabaseUrl?:string, supabaseAnonKey?:string, siteUrl?:string}} o.config
 * @param {() => object} o.getState         état local courant
 * @param {(remote: object, merge: boolean) => void} o.applyRemote
 * @param {(state: string, detail?: string) => void} o.onStatus  local | sync | ok | error
 * @param {(user: object|null) => void} o.onUser
 * @param {() => void} o.onRecovery         lien « mot de passe oublié » ouvert
 */
export async function createSync({ config, getState, applyRemote, onStatus, onUser, onRecovery }) {
  const off = { enabled: false, user: null, schedulePush() {}, async pushNow() {} };
  if (!config?.supabaseUrl || !config?.supabaseAnonKey) { onStatus('local'); return off; }

  let lib;
  try {
    lib = await import(SUPABASE_ESM);
  } catch (e) {
    onStatus('error', t('Service de connexion injoignable (hors ligne ?)'));
    return { ...off, error: true };
  }

  const client = lib.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  let user = null;
  let channel = null;
  let pushTimer = null;
  let lastError = '';

  const redirectUrl = () => config.siteUrl || (location.origin + location.pathname);

  async function pushNow() {
    if (!user) return;
    clearTimeout(pushTimer);
    const state = getState();
    onStatus('sync');
    const { error } = await client.from('user_state').upsert({
      user_id: user.id,
      state,
      updated_at: new Date().toISOString(),
    });
    if (error) { lastError = error.message; onStatus('error', error.message); }
    else { lastError = ''; onStatus('ok'); }
  }

  function schedulePush() {
    if (!user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 600);
  }

  function subscribe() {
    if (channel) client.removeChannel(channel);
    channel = client
      .channel(`user_state:${user.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'user_state', filter: `user_id=eq.${user.id}` },
        payload => {
          const remote = payload.new?.state;
          if (!remote) return;
          if ((remote.updatedAt || 0) > (getState().updatedAt || 0)) applyRemote(remote, false);
          if (!lastError) onStatus('ok');
        })
      .subscribe();
  }

  async function firstSync() {
    onStatus('sync');
    const { data, error } = await client
      .from('user_state').select('state').eq('user_id', user.id).maybeSingle();
    if (error) {
      lastError = error.message;
      onStatus('error', error.message.includes('user_state')
        ? t('Table user_state introuvable : exécute supabase/schema.sql')
        : error.message);
      return;
    }
    if (data?.state && Object.keys(data.state).length) applyRemote(data.state, true);
    await pushNow();
    subscribe();
  }

  client.auth.onAuthStateChange((event, session) => {
    const next = session?.user ?? null;
    const changed = next?.id !== user?.id;
    user = next;
    onUser(user);
    if (event === 'PASSWORD_RECOVERY') setTimeout(onRecovery, 0);
    if (!changed) return;
    // Pas d'appel Supabase directement dans ce rappel (recommandation de la bibliothèque).
    setTimeout(() => {
      if (user) firstSync();
      else {
        if (channel) { client.removeChannel(channel); channel = null; }
        onStatus('local');
      }
    }, 0);
  });

  const errText = e => {
    const m = e?.message || String(e);
    if (/invalid login credentials/i.test(m)) return t('E-mail ou mot de passe incorrect.');
    if (/email not confirmed/i.test(m)) return t('Confirme d\'abord ton e-mail (lien reçu par mail).');
    if (/already registered/i.test(m)) return t('Un compte existe déjà avec cet e-mail.');
    if (/password should be at least/i.test(m)) return t('Mot de passe trop court (6 caractères minimum).');
    if (/rate limit/i.test(m)) return t('Trop de tentatives, réessaie dans quelques minutes.');
    if (/fetch/i.test(m)) return t('Impossible de joindre le serveur (connexion internet ?).');
    return m;
  };
  const wrap = p => p.then(({ data, error }) => { if (error) throw new Error(errText(error)); return data; },
    e => { throw new Error(errText(e)); });

  return {
    enabled: true,
    get user() { return user; },
    get lastError() { return lastError; },
    schedulePush,
    pushNow,
    signIn: (email, password) => wrap(client.auth.signInWithPassword({ email, password })),
    signUp: (email, password) => wrap(client.auth.signUp({ email, password, options: { emailRedirectTo: redirectUrl() } })),
    signOut: () => wrap(client.auth.signOut()),
    resetPassword: email => wrap(client.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() })),
    updatePassword: password => wrap(client.auth.updateUser({ password })),
  };
}
