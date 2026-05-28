/*
  ReservaBus · Backend Node.js / Express + MySQL
  ─────────────────────────────────────────────────────────────
  Instalación:
    npm install express cors mysql2

  Uso:
    node server.js
  ─────────────────────────────────────────────────────────────
*/

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const mysql   = require('mysql2/promise');

const app  = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

/* ── Configuración de MySQL ─────────────────────────────────
   Cambia host, user y password según tu instalación local.
   ─────────────────────────────────────────────────────────── */
const dbConfig = {
  host:             'localhost',
  user:             'root',        // ← cambia si tu usuario es diferente
  password:         '',            // ← pon tu contraseña de MySQL aquí
  database:         'reservabus',
  waitForConnections: true,
  connectionLimit:  10,            // máximo 10 usuarios simultáneos
  queueLimit:       0
};

let db;

async function conectarDB() {
  try {
    db = mysql.createPool(dbConfig);
    // Verificar que la conexión funciona
    await db.execute('SELECT 1');
    console.log('✅ Conectado a MySQL · base de datos: reservabus');
  } catch (err) {
    console.error('❌ Error al conectar a MySQL:', err.message);
    process.exit(1);
  }
}

/* ── GET /api/seats
   Devuelve los ids de asientos ocupados ──────────────────── */
app.get('/api/seats', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT id FROM asientos WHERE ocupado = 1');
    res.json({ taken: rows.map(r => r.id) });
  } catch (err) {
    res.status(500).json({ error: 'Error al leer asientos.' });
  }
});

/* ── POST /api/reserve
   Body: { seats: [1, 5, 12] }
   Verifica conflictos y confirma la reserva. ─────────────── */
app.post('/api/reserve', async (req, res) => {
  const seats = req.body.seats;

  if (!Array.isArray(seats) || seats.length === 0) {
    return res.status(400).json({ error: 'Envía un array "seats" con al menos un asiento.' });
  }

  // Obtener una conexión individual del pool para poder usar transacciones
  const conn = await db.getConnection();

  try {
    const placeholders = seats.map(() => '?').join(',');

    // Iniciar transacción — bloquea los registros para evitar
    // que dos usuarios reserven el mismo asiento simultáneamente
    await conn.beginTransaction();

    // SELECT ... FOR UPDATE bloquea esas filas hasta que
    // la transacción termine, ningún otro proceso puede tocarlas
    const [rows] = await conn.execute(
      `SELECT id, ocupado FROM asientos WHERE id IN (${placeholders}) FOR UPDATE`,
      seats
    );

    const conflicts = rows.filter(r => r.ocupado === 1);

    if (conflicts.length > 0) {
      await conn.rollback();
      conn.release(); // devolver conexión al pool
      const ids = conflicts.map(r => r.id);
      return res.status(409).json({
        error: `Los asientos ${ids.join(', ')} ya fueron reservados por otro usuario.`,
        conflicts: ids
      });
    }

    // Marcar como ocupados de forma segura
    await conn.execute(
      `UPDATE asientos SET ocupado = 1 WHERE id IN (${placeholders})`,
      seats
    );

    await conn.commit(); // confirmar cambios y liberar bloqueo
    conn.release();      // devolver conexión al pool

    console.log(`✅ Reservados: [${seats.join(', ')}]`);

    const [taken] = await db.execute('SELECT id FROM asientos WHERE ocupado = 1');
    res.json({ ok: true, taken: taken.map(r => r.id) });

  } catch (err) {
    await conn.rollback();
    conn.release(); // siempre devolver la conexión al pool
    console.error(err);
    res.status(500).json({ error: 'Error al procesar la reserva.' });
  }
});

/* ── DELETE /api/reset  (solo para desarrollo/pruebas) ────── */
app.delete('/api/reset', async (req, res) => {
  try {
    await db.execute('UPDATE asientos SET ocupado = 0');
    console.log('🔄 Todos los asientos liberados');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al resetear asientos.' });
  }
});

/* ── Arranque ────────────────────────────────────────────── */
(async () => {
  await conectarDB();
  app.listen(PORT, () => {
    console.log(`🚌 ReservaBus corriendo en http://localhost:${PORT}`);
  });
})();