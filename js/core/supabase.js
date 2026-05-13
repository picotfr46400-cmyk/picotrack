// ══ PicoTrack — Supabase Client ══
// Base de données partagée PAD ↔ PC

const SUPA_URL  = 'https://jcanufkmcslxwmheqccp.supabase.co';
const SUPA_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjYW51ZmttY3NseHdtaGVxY2NwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NjAyNDksImV4cCI6MjA5NDIzNjI0OX0.Vt9ZhmEZ0HaBiByRTOHYm65doZn5z09Cjg4AvzntgMU';

// ── Client léger sans npm ─────────────────────────────────────
// On utilise l'API REST directement (pas besoin du SDK)

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error ${res.status}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// ── FORMS ─────────────────────────────────────────────────────

const DB = {

  // Charger tous les formulaires actifs
  async getForms() {
    return sbFetch('forms?select=*&order=created_at.asc');
  },

  // Créer un formulaire
  async createForm(data) {
    return sbFetch('forms', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Mettre à jour un formulaire
  async updateForm(id, data) {
    return sbFetch(`forms?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  },

  // Supprimer un formulaire
  async deleteForm(id) {
    return sbFetch(`forms?id=eq.${id}`, { method: 'DELETE', prefer: '' });
  },

  // ── SUBMISSIONS ───────────────────────────────────────────

  // Charger les saisies d'un formulaire
  async getSubmissions(formId) {
    return sbFetch(`submissions?form_id=eq.${formId}&select=*&order=created_at.desc`);
  },

  // Toutes les saisies
  async getAllSubmissions() {
    return sbFetch('submissions?select=*&order=created_at.desc');
  },

  // Créer une saisie
  async createSubmission(formId, values, device = 'desktop') {
    return sbFetch('submissions', {
      method: 'POST',
      body: JSON.stringify({ form_id: formId, values, device })
    });
  },

  // ── SERVICES ─────────────────────────────────────────────

  async getServices() {
    return sbFetch('services?select=*&order=created_at.asc');
  },

  async createService(data) {
    return sbFetch('services', { method: 'POST', body: JSON.stringify(data) });
  },

  async updateService(id, data) {
    return sbFetch(`services?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  // ── SERVICE INSTANCES ────────────────────────────────────

  async getInstances(serviceId) {
    return sbFetch(`service_instances?service_id=eq.${serviceId}&select=*&order=created_at.desc`);
  },

  async getAllInstances() {
    return sbFetch('service_instances?select=*&order=created_at.desc');
  },

  async createInstance(data) {
    return sbFetch('service_instances', { method: 'POST', body: JSON.stringify(data) });
  },

  async updateInstance(id, data) {
    return sbFetch(`service_instances?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...data, updated_at: new Date().toISOString() })
    });
  },
};

// ── REALTIME ─────────────────────────────────────────────────
// Écoute les changements en temps réel via WebSocket Supabase

class SupaRealtime {
  constructor() {
    this.ws = null;
    this.listeners = {};
    this.connected = false;
    this._connect();
  }

  _connect() {
    const wsUrl = `wss://jcanufkmcslxwmheqccp.supabase.co/realtime/v1/websocket?apikey=${SUPA_KEY}&vsn=1.0.0`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.connected = true;
      console.log('[Realtime] Connecté');
      // S'abonner aux tables
      ['submissions', 'service_instances', 'forms'].forEach(table => this._subscribe(table));
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === 'INSERT' || msg.event === 'UPDATE' || msg.event === 'DELETE') {
          const table = msg.topic?.replace('realtime:', '')?.split(':')[1];
          if (table && this.listeners[table]) {
            this.listeners[table].forEach(cb => cb(msg.event, msg.payload?.record || msg.payload));
          }
        }
        // Heartbeat
        if (msg.event === 'heartbeat') {
          this.ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: null }));
        }
      } catch {}
    };

    this.ws.onclose = () => {
      this.connected = false;
      console.log('[Realtime] Déconnecté, reconnexion dans 3s...');
      setTimeout(() => this._connect(), 3000);
    };
  }

  _subscribe(table) {
    this.ws.send(JSON.stringify({
      topic: `realtime:public:${table}`,
      event: 'phx_join',
      payload: { config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [{ event: '*', schema: 'public', table }] } },
      ref: null
    }));
  }

  on(table, callback) {
    if (!this.listeners[table]) this.listeners[table] = [];
    this.listeners[table].push(callback);
  }
}

// Instance globale
const realtime = new SupaRealtime();

// ── MIGRATION : données JS → Supabase ────────────────────────
// Appelée une seule fois pour peupler la base avec les données demo

async function migrateDataToSupabase() {
  if (localStorage.getItem('pt_migrated')) {
    console.log('[DB] Migration déjà effectuée');
    return;
  }

  console.log('[DB] Migration des données demo vers Supabase...');

  try {
    // Migrer les formulaires
    for (const f of (FORMS_DATA || [])) {
      await DB.createForm({
        nom: f.nom,
        description: f.desc || '',
        couleur: f.couleur || '#3b82f6',
        actif: f.actif !== false,
        modules: f.modules || [],
        fields: f.fields || []
      });
    }

    // Migrer les services
    for (const s of (SERVICES_DATA || [])) {
      await DB.createService({
        nom: s.nom,
        description: s.desc || '',
        couleur: s.couleur || '#3b82f6',
        actif: s.actif !== false,
        statuses: s.statuses || [],
        actions: s.actions || []
      });
    }

    localStorage.setItem('pt_migrated', '1');
    console.log('[DB] Migration terminée ✅');
  } catch (err) {
    console.error('[DB] Erreur migration:', err);
  }
}
