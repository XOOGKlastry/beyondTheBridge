/**
 * index.js — Backend UrbanLux v2 (Node.js / Express)
 * Hosting: Render.com lub własny VPS
 */

require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const { Pool }  = require('pg');
const admin     = require('firebase-admin');
const multer    = require('multer');
const path      = require('path');
const crypto    = require('crypto');
const fs        = require('fs');

const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/gif'];
    allowed.includes(file.mimetype) ? cb(null,true) : cb(new Error('Tylko obrazy JPG/PNG/WebP'));
  },
});

async function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer '))
    return res.status(401).json({ error: 'Brak tokenu' });
  try {
    req.user = await admin.auth().verifyIdToken(auth.slice(7));
    next();
  } catch (e) {
    res.status(403).json({ error: 'Nieprawidłowy token' });
  }
}

const ALLOWED_LAMP_COLUMNS = new Set([
  'nr_slupa','rodzaj_slupa','liczba_opraw','kat_wysiegnika','dlugosc_wysiegnika',
  'rodzaj_oprawy','model_oprawy','stan_slupa','stan_oprawy','wysokosc_slupa',
  'szafa_oswietleniowa','rodzaj_linii','miejscowosc','ulica','notes',
  'usterka','usterka_typ','usterka_opis','photo',
]);

const TRACKED_FIELDS = [
  'nr_slupa','rodzaj_oprawy','model_oprawy','stan_slupa','stan_oprawy',
  'wysokosc_slupa','szafa_oswietleniowa','rodzaj_linii','miejscowosc',
  'ulica','notes','usterka','usterka_typ','usterka_opis',
];

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: process.env.FRONTEND_URL || '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'] }));
app.use(express.json({ limit: '10mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
pool.query('SELECT 1').then(() => console.log('✅ Połączono z bazą')).catch(e => console.error('❌ Baza:', e.message));

async function saveHistory(lampId, userEmail, action, oldData, newData) {
  try {
    const changes = [];
    if (oldData && newData) {
      for (const field of TRACKED_FIELDS) {
        const o = String(oldData[field] ?? ''), n = String(newData[field] ?? '');
        if (o !== n) changes.push({ field, old: o, new: n });
      }
    }
    if (action !== 'edycja' || changes.length > 0) {
      await pool.query(
        `INSERT INTO lamp_history (lamp_id, changed_by, action, changes) VALUES ($1,$2,$3,$4)`,
        [lampId, userEmail, action, JSON.stringify(changes)]
      );
    }
  } catch (e) {
    console.warn('[History] Błąd zapisu:', e.message);
  }
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString(), version: '2.0' }));

app.get('/api/lamps', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM lamps WHERE _deleted IS NOT TRUE ORDER BY id');
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: 'Błąd bazy' });
  }
});

app.post('/api/lamps', verifyToken, async (req, res) => {
  const d = req.body;
  if (!d.id || d.lat == null || d.lng == null)
    return res.status(400).json({ error: 'Brakuje: id, lat, lng' });
  try {
    await pool.query(`
      INSERT INTO lamps (id,lat,lng,nr_slupa,rodzaj_slupa,liczba_opraw,kat_wysiegnika,
        dlugosc_wysiegnika,rodzaj_oprawy,model_oprawy,stan_slupa,stan_oprawy,
        wysokosc_slupa,szafa_oswietleniowa,rodzaj_linii,miejscowosc,ulica,notes,photo)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [d.id,d.lat,d.lng,d.nr_slupa,d.rodzaj_slupa,d.liczba_opraw,d.kat_wysiegnika,
       d.dlugosc_wysiegnika,d.rodzaj_oprawy,d.model_oprawy,d.stan_slupa,d.stan_oprawy,
       d.wysokosc_slupa,d.szafa_oswietleniowa,d.rodzaj_linii,d.miejscowosc,d.ulica,d.notes,d.photo||null]);
    await saveHistory(d.id, req.user.email, 'dodanie', null, d);
    res.status(201).json({ message: 'Dodano', id: d.id });
  } catch (e) {
    console.error('[POST /api/lamps]', e.message);
    res.status(500).json({ error: 'Błąd dodawania' });
  }
});

app.put('/api/lamps/:id', verifyToken, async (req, res) => {
  const id = req.params.id;
  const d  = req.body;
  try {
    const old = await pool.query('SELECT * FROM lamps WHERE id=$1', [id]);
    const oldData = old.rows[0] || null;
    await pool.query(`
      INSERT INTO lamps (id,lat,lng,nr_slupa,rodzaj_slupa,liczba_opraw,kat_wysiegnika,
        dlugosc_wysiegnika,rodzaj_oprawy,model_oprawy,stan_slupa,stan_oprawy,
        wysokosc_slupa,szafa_oswietleniowa,rodzaj_linii,miejscowosc,ulica,notes,
        photo,usterka,usterka_typ,usterka_opis)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      ON CONFLICT (id) DO UPDATE SET
        lat=EXCLUDED.lat, lng=EXCLUDED.lng,
        nr_slupa=EXCLUDED.nr_slupa, rodzaj_slupa=EXCLUDED.rodzaj_slupa,
        liczba_opraw=EXCLUDED.liczba_opraw, rodzaj_oprawy=EXCLUDED.rodzaj_oprawy,
        model_oprawy=EXCLUDED.model_oprawy, stan_slupa=EXCLUDED.stan_slupa,
        stan_oprawy=EXCLUDED.stan_oprawy, wysokosc_slupa=EXCLUDED.wysokosc_slupa,
        kat_wysiegnika=EXCLUDED.kat_wysiegnika,
        dlugosc_wysiegnika=EXCLUDED.dlugosc_wysiegnika,
        szafa_oswietleniowa=EXCLUDED.szafa_oswietleniowa,
        rodzaj_linii=EXCLUDED.rodzaj_linii, miejscowosc=EXCLUDED.miejscowosc,
        ulica=EXCLUDED.ulica, notes=EXCLUDED.notes,
        photo=COALESCE(EXCLUDED.photo, lamps.photo),
        usterka=EXCLUDED.usterka, usterka_typ=EXCLUDED.usterka_typ,
        usterka_opis=EXCLUDED.usterka_opis`,
      [id,d.lat,d.lng,d.nr_slupa,d.rodzaj_slupa,d.liczba_opraw,d.kat_wysiegnika,
       d.dlugosc_wysiegnika,d.rodzaj_oprawy,d.model_oprawy,d.stan_slupa,d.stan_oprawy,
       d.wysokosc_slupa,d.szafa_oswietleniowa,d.rodzaj_linii,d.miejscowosc,d.ulica,d.notes,
       d.photo||null, d.usterka||'NIE', d.usterka_typ||'', d.usterka_opis||'']);
    await saveHistory(id, req.user.email, 'edycja', oldData, d);
    res.json({ message: 'Zaktualizowano' });
  } catch (e) {
    console.error(`[PUT /api/lamps/${id}]`, e.message);
    res.status(500).json({ error: 'Błąd edycji' });
  }
});

app.put('/api/lamps-bulk', verifyToken, async (req, res) => {
  const { ids, changes } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Brak ID' });
  const keys = Object.keys(changes||{}).filter(k => ALLOWED_LAMP_COLUMNS.has(k));
  if (!keys.length) return res.json({ message: 'Brak zmian' });
  try {
    const set = keys.map((k,i) => `${k}=$${i+2}`).join(',');
    const vals = keys.map(k => changes[k]);
    for (const id of ids) {
      await pool.query(`UPDATE lamps SET ${set} WHERE id=$1`, [id,...vals]);
      await saveHistory(id, req.user.email, 'edycja masowa', null, changes);
    }
    res.json({ message: `Edycja masowa: ${ids.length}` });
  } catch (e) {
    res.status(500).json({ error: 'Błąd edycji masowej' });
  }
});

app.delete('/api/lamps/:id', verifyToken, async (req, res) => {
  const id = req.params.id;
  try {
    await pool.query(
      `INSERT INTO lamps (id,_deleted) VALUES ($1,true) ON CONFLICT (id) DO UPDATE SET _deleted=true`, [id]);
    await saveHistory(id, req.user.email, 'usunięcie', null, null);
    res.json({ message: 'Usunięto' });
  } catch (e) {
    res.status(500).json({ error: 'Błąd usuwania' });
  }
});

// ─── HISTORIA ZMIAN ───────────────────────────────────────────────────
app.get('/api/history/:id', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id,lamp_id,changed_by,changed_at,action,changes,note
       FROM lamp_history WHERE lamp_id=$1 ORDER BY changed_at DESC LIMIT 50`,
      [req.params.id]
    );
    const rows = r.rows.map(row => ({
      ...row,
      changes: typeof row.changes === 'string' ? JSON.parse(row.changes || '[]') : (row.changes || []),
    }));
    res.json(rows);
  } catch (e) {
    if (e.message.includes('lamp_history') && e.message.includes('does not exist')) {
      return res.status(404).json({
        error: 'Tabela lamp_history nie istnieje. Wykonaj migrację SQL.',
        sql: `CREATE TABLE lamp_history (
  id SERIAL PRIMARY KEY,
  lamp_id TEXT NOT NULL,
  changed_by TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  action TEXT DEFAULT 'edycja',
  changes JSONB,
  note TEXT
);
CREATE INDEX idx_lamp_history_lamp_id ON lamp_history(lamp_id);
CREATE INDEX idx_lamp_history_ts ON lamp_history(changed_at DESC);`
      });
    }
    res.status(500).json({ error: 'Błąd historii' });
  }
});

// ─── UPLOAD ZDJĘCIA ───────────────────────────────────────────────────
app.post('/api/upload-photo', verifyToken, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Brak pliku (pole: photo)' });

  const lampId = req.body.lamp_id || 'unknown';
  const ext    = req.file.mimetype.split('/')[1] || 'jpg';
  const fname  = `lamps/${lampId}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const mode   = process.env.PHOTO_STORAGE || 'local';

  // TRYB SUPABASE STORAGE
  if (mode === 'supabase') {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      const { error } = await sb.storage
        .from(process.env.SUPABASE_BUCKET || 'lamp-photos')
        .upload(fname, req.file.buffer, { contentType: req.file.mimetype });
      if (error) throw error;
      const { data } = sb.storage.from(process.env.SUPABASE_BUCKET || 'lamp-photos').getPublicUrl(fname);
      return res.json({ url: data.publicUrl });
    } catch (e) {
      return res.status(500).json({ error: 'Błąd Supabase Storage: ' + e.message });
    }
  }

  // TRYB LOKALNY (VPS)
  try {
    const dir = path.join(__dirname, 'uploads', 'lamps', lampId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'uploads', fname), req.file.buffer);
    const base = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    res.json({ url: `${base}/uploads/${fname}` });
  } catch (e) {
    res.status(500).json({ error: 'Błąd zapisu pliku' });
  }
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── STREET VIEW PROXY ────────────────────────────────────────────────
app.get('/api/streetview/metadata', async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'Wymagane: lat, lng' });
  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key) return res.status(503).json({ error: 'Brak klucza Google Maps' });
  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${key}`);
    const d = await r.json();
    res.json({ status: d.status, date: d.date || null });
  } catch (e) {
    res.status(502).json({ error: 'Błąd Google API' });
  }
});

app.listen(PORT, () => console.log(`🚀 UrbanLux Backend v2 — port ${PORT} | storage: ${process.env.PHOTO_STORAGE||'local'}`));
