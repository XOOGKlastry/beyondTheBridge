require('dotenv').config() // Ładuje Twoje hasło z pliku .env
const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')
const admin = require('firebase-admin')
const serviceAccount = require('./serviceAccountKey.json')
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })

// Middleware weryfikacji tokenu
async function verifyToken(req, res, next) {
	const auth = req.headers.authorization
	if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Brak tokenu' })
	try {
		req.user = await admin.auth().verifyIdToken(auth.slice(7))
		next()
	} catch (e) {
		res.status(403).json({ error: 'Nieprawidłowy token' })
	}
}
const app = express()
const PORT = 3000

app.use(cors())
app.use(express.json())

// Łączenie z chmurą Supabase
const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
})

// 1. ODCZYT (Pobieranie lamp na mapę)
app.get('/api/lamps', async (req, res) => {
	try {
		const result = await pool.query('SELECT * FROM lamps')
		res.json(result.rows)
	} catch (err) {
		console.error('Błąd pobierania bazy:', err)
		res.status(500).json({ error: 'Błąd bazy danych' })
	}
})

// 2. TWORZENIE (Nowy punkt z mapy)
app.post('/api/lamps', verifyToken, async (req, res) => {
	const d = req.body
	try {
		const query = `
            INSERT INTO lamps (id, lat, lng, nr_slupa, rodzaj_slupa, liczba_opraw, kat_wysiegnika, dlugosc_wysiegnika, rodzaj_oprawy, model_oprawy, stan_slupa, stan_oprawy, wysokosc_slupa, szafa_oswietleniowa, rodzaj_linii, miejscowosc, ulica, notes, photo)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        `
		const values = [
			d.id,
			d.lat,
			d.lng,
			d.nr_slupa,
			d.rodzaj_slupa,
			d.liczba_opraw,
			d.kat_wysiegnika,
			d.dlugosc_wysiegnika,
			d.rodzaj_oprawy,
			d.model_oprawy,
			d.stan_slupa,
			d.stan_oprawy,
			d.wysokosc_slupa,
			d.szafa_oswietleniowa,
			d.rodzaj_linii,
			d.miejscowosc,
			d.ulica,
			d.notes,
			d.photo,
		]

		await pool.query(query, values)
		console.log(`Zapisano w Supabase nową lampę: ${d.id}`)
		res.status(201).json({ message: 'Dodano punkt do bazy!' })
	} catch (err) {
		console.error('Błąd dodawania:', err)
		res.status(500).json({ error: 'Błąd dodawania' })
	}
})
// 3. EDYCJA JEDNEJ LAMPY
app.put('/api/lamps/:id', verifyToken, async (req, res) => {
	const id = req.params.id
	const d = req.body
	try {
		const query = `
            INSERT INTO lamps (id, lat, lng, nr_slupa, rodzaj_slupa, liczba_opraw, kat_wysiegnika, dlugosc_wysiegnika, rodzaj_oprawy, model_oprawy, stan_slupa, stan_oprawy, wysokosc_slupa, szafa_oswietleniowa, rodzaj_linii, miejscowosc, ulica, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            ON CONFLICT (id) DO UPDATE SET
            lat = EXCLUDED.lat, lng = EXCLUDED.lng, -- Dodaliśmy to tutaj
            nr_slupa = EXCLUDED.nr_slupa, rodzaj_slupa = EXCLUDED.rodzaj_slupa, liczba_opraw = EXCLUDED.liczba_opraw,
            rodzaj_oprawy = EXCLUDED.rodzaj_oprawy, model_oprawy = EXCLUDED.model_oprawy, stan_slupa = EXCLUDED.stan_slupa,
            stan_oprawy = EXCLUDED.stan_oprawy, wysokosc_slupa = EXCLUDED.wysokosc_slupa, kat_wysiegnika = EXCLUDED.kat_wysiegnika,
            dlugosc_wysiegnika = EXCLUDED.dlugosc_wysiegnika, szafa_oswietleniowa = EXCLUDED.szafa_oswietleniowa,
            rodzaj_linii = EXCLUDED.rodzaj_linii, miejscowosc = EXCLUDED.miejscowosc, ulica = EXCLUDED.ulica, notes = EXCLUDED.notes
        `
		// Przekazujemy lat i lng jako parametry $2 i $3
		const values = [
			id,
			d.lat,
			d.lng,
			d.nr_slupa,
			d.rodzaj_slupa,
			d.liczba_opraw,
			d.kat_wysiegnika,
			d.dlugosc_wysiegnika,
			d.rodzaj_oprawy,
			d.model_oprawy,
			d.stan_slupa,
			d.stan_oprawy,
			d.wysokosc_slupa,
			d.szafa_oswietleniowa,
			d.rodzaj_linii,
			d.miejscowosc,
			d.ulica,
			d.notes,
		]

		await pool.query(query, values)
		console.log(`Zaktualizowano w Supabase lampę: ${id}`)
		res.json({ message: 'Zaktualizowano pomyślnie' })
	} catch (err) {
		console.error('Błąd edycji:', err)
		res.status(500).json({ error: 'Błąd edycji' })
	}
})

// 4. EDYCJA MASOWA ZAZNACZONYCH (Wiele lamp naraz)
app.put('/api/lamps-bulk', verifyToken, async (req, res) => {
	const { ids, changes } = req.body
	try {
		const keys = Object.keys(changes)
		if (keys.length === 0) return res.json({ message: 'Brak zmian' })

		// Dynamicznie budujemy zapytanie na podstawie tego co user zmienił w edytorze
		const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ')

		for (let id of ids) {
			const query = `UPDATE lamps SET ${setClause} WHERE id = $1`
			const values = [id, ...Object.values(changes)]
			await pool.query(query, values)
		}

		console.log(`Edycja masowa dla ${ids.length} lamp`)
		res.json({ message: 'Masowa edycja wykonana w bazie' })
	} catch (err) {
		console.error('Błąd masowej edycji:', err)
		res.status(500).json({ error: 'Błąd masowej edycji' })
	}
})

// 5. USUWANIE LAMPY
app.delete('/api/lamps/:id', verifyToken, async (req, res) => {
	const id = req.params.id
	try {
		// Sprytne usunięcie - jeśli lampy nie było w bazie, nie wyrzuci błędu.
		// Zapisujemy logikę usuwania. W docelowej bazie używamy "miękkiego usuwania", żeby nie zgubić bazowych danych.
		const query = `
            INSERT INTO lamps (id, _deleted) VALUES ($1, true)
            ON CONFLICT (id) DO UPDATE SET _deleted = true
        `
		await pool.query(query, [id])

		console.log(`Zarchiwizowano (usunięto) z Supabase lampę: ${id}`)
		res.json({ message: 'Usunięto pomyślnie' })
	} catch (err) {
		console.error('Błąd usuwania:', err)
		res.status(500).json({ error: 'Błąd usuwania' })
	}
})

// URUCHAMIAMY SILNIK
app.listen(PORT, () => {
	console.log(`🚀 POŁĄCZONO Z CHMURĄ! Serwer działa na http://localhost:${PORT}`)
})
