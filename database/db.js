const { Pool } = require("pg");
const bcrypt = require("bcrypt");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL
    );
  `);

  await pool.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'Super Admin';
`);

await pool.query(`
  UPDATE users
  SET role = 'Super Admin'
  WHERE username = 'admin' AND (role IS NULL OR role = '');
`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      department VARCHAR(200),
      salary NUMERIC
    );
  `);

  await pool.query(`
    ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS username VARCHAR(100);
  `);

  await pool.query(`
    ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS password VARCHAR(255);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      status VARCHAR(50),
      UNIQUE(employee_id, date)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS leaves (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
      leave_type VARCHAR(100),
      start_date DATE,
      end_date DATE,
      reason TEXT,
      status VARCHAR(50) DEFAULT 'Pending'
    );
  `);

  const userCheck = await pool.query(
    "SELECT * FROM users WHERE username = $1",
    ["admin"]
  );

  if (userCheck.rows.length === 0) {
    const hashedPassword = await bcrypt.hash("admin123", 10);

    await pool.query(
    "INSERT INTO users (username, password, role) VALUES ($1, $2, $3)",
    ["admin", hashedPassword, "Super Admin"]
    );
  }
}

initDatabase();

module.exports = pool;