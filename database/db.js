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
  ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS photo_path VARCHAR(500);
`);
await pool.query(`
  ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS basic_salary NUMERIC DEFAULT 0;
`);

await pool.query(`
  ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS hra NUMERIC DEFAULT 0;
`);

await pool.query(`
  ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS allowances NUMERIC DEFAULT 0;
`);

await pool.query(`
  ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS bonus NUMERIC DEFAULT 0;
`);

await pool.query(`
  ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS pf_deduction NUMERIC DEFAULT 0;
`);

await pool.query(`
  ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS esi_deduction NUMERIC DEFAULT 0;
`);

await pool.query(`
  ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS professional_tax NUMERIC DEFAULT 0;
`);

await pool.query(`
  ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS other_deduction NUMERIC DEFAULT 0;
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
  ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
  `);

  await pool.query(`
  ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS email VARCHAR(200);
  `);

  await pool.query(`
  ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS designation VARCHAR(200);
  `);

  await pool.query(`
  ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS joining_date DATE;
  `);

  await pool.query(`
  ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS address TEXT;
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

  await pool.query(`
  ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS check_in TIMESTAMP;
`);

await pool.query(`
  ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS check_out TIMESTAMP;
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS payroll_records (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    month VARCHAR(20) NOT NULL,
    base_salary NUMERIC,
    present_days INTEGER,
    absent_days INTEGER,
    half_days INTEGER,
    deduction NUMERIC,
    final_salary NUMERIC,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, month)
  );
`);
  await pool.query(`
  CREATE TABLE IF NOT EXISTS company_settings (
    id SERIAL PRIMARY KEY,
    company_name VARCHAR(200) DEFAULT 'VLCG',
    company_address TEXT DEFAULT 'Main Road, Navipet, Telangana, 503245',
    company_phone VARCHAR(50) DEFAULT '6302084794',
    company_email VARCHAR(200) DEFAULT 'harikpalem@gmail.com',
    office_start_time VARCHAR(20) DEFAULT '09:30',
    office_end_time VARCHAR(20) DEFAULT '18:00',
    logo_path VARCHAR(255) DEFAULT 'public/images/logo.jpg'
  );
`);
await pool.query(`
  ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS basic_salary NUMERIC DEFAULT 0;
`);

await pool.query(`
  ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS hra NUMERIC DEFAULT 0;
`);

await pool.query(`
  ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS allowances NUMERIC DEFAULT 0;
`);

await pool.query(`
  ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS bonus NUMERIC DEFAULT 0;
`);

await pool.query(`
  ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS pf_deduction NUMERIC DEFAULT 0;
`);

await pool.query(`
  ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS esi_deduction NUMERIC DEFAULT 0;
`);

await pool.query(`
  ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS professional_tax NUMERIC DEFAULT 0;
`);

await pool.query(`
  ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS other_deduction NUMERIC DEFAULT 0;
`);


const settingsCheck = await pool.query(
  "SELECT * FROM company_settings LIMIT 1"
);

if (settingsCheck.rows.length === 0) {
  await pool.query(`
    INSERT INTO company_settings
    (company_name, company_address, company_phone, company_email, office_start_time, office_end_time, logo_path)
    VALUES
    ('VLCG', 'Main Road, Navipet, Telangana, 503245', '6302084794', 'harikpalem@gmail.com', '09:30', '18:00', 'public/images/logo.jpg')
  `);
}
await pool.query(`
  CREATE TABLE IF NOT EXISTS employee_documents (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    document_type VARCHAR(100),
    file_name VARCHAR(255),
    file_path VARCHAR(500),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS leave_balances (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    sick_total INTEGER DEFAULT 6,
    casual_total INTEGER DEFAULT 12,
    paid_total INTEGER DEFAULT 12,
    UNIQUE(employee_id, year)
  );
`);
}

initDatabase();

module.exports = pool;