const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcrypt");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");

const app = express();
const db = require("./database/db");

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(
  session({
    secret: "attendance_secret_key",
    resave: false,
    saveUninitialized: false,
  })
);

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/");
  }
  next();
}

/* LOGIN */

app.get("/", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const result = await db.query(
    "SELECT * FROM users WHERE username = $1",
    [username]
  );

  if (result.rows.length === 0) {
    return res.render("login", { error: "Invalid username or password" });
  }

  const user = result.rows[0];
  const match = await bcrypt.compare(password, user.password);

  if (!match) {
    return res.render("login", { error: "Invalid username or password" });
  }

  req.session.user = user;
  res.redirect("/dashboard");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

/* DASHBOARD */

app.get("/dashboard", requireLogin, async (req, res) => {
  const employees = await db.query("SELECT COUNT(*) FROM employees");

  const present = await db.query(
    "SELECT COUNT(*) FROM attendance WHERE date = CURRENT_DATE AND status = 'Present'"
  );

  const absent = await db.query(
    "SELECT COUNT(*) FROM attendance WHERE date = CURRENT_DATE AND status = 'Absent'"
  );

  res.render("dashboard", {
    totalEmployees: employees.rows[0].count,
    presentToday: present.rows[0].count,
    absentToday: absent.rows[0].count,
  });
});

/* EMPLOYEES */

app.get("/employees", requireLogin, async (req, res) => {
  const search = req.query.search || "";

  let result;

  if (search) {
    result = await db.query(
      "SELECT * FROM employees WHERE name ILIKE $1 ORDER BY id DESC",
      [`%${search}%`]
    );
  } else {
    result = await db.query("SELECT * FROM employees ORDER BY id DESC");
  }

  res.render("employees", {
    employees: result.rows,
    search,
  });
});

app.post("/employees/add", requireLogin, async (req, res) => {
  const { name, department, salary } = req.body;

  await db.query(
    "INSERT INTO employees (name, department, salary) VALUES ($1, $2, $3)",
    [name, department, salary]
  );

  res.redirect("/employees");
});

app.get("/employees/edit/:id", requireLogin, async (req, res) => {
  const result = await db.query(
    "SELECT * FROM employees WHERE id = $1",
    [req.params.id]
  );

  res.render("edit-employee", {
    employee: result.rows[0],
  });
});

app.post("/employees/update/:id", requireLogin, async (req, res) => {
  const { name, department, salary } = req.body;

  await db.query(
    "UPDATE employees SET name = $1, department = $2, salary = $3 WHERE id = $4",
    [name, department, salary, req.params.id]
  );

  res.redirect("/employees");
});

app.post("/employees/delete/:id", requireLogin, async (req, res) => {
  await db.query("DELETE FROM employees WHERE id = $1", [req.params.id]);
  res.redirect("/employees");
});

/* ATTENDANCE */

app.get("/attendance", requireLogin, async (req, res) => {
  const filterDate = req.query.date || "";

  const employees = await db.query(
    "SELECT * FROM employees ORDER BY name ASC"
  );

  let records;

  if (filterDate) {
    records = await db.query(`
      SELECT attendance.*, employees.name
      FROM attendance
      JOIN employees ON attendance.employee_id = employees.id
      WHERE attendance.date = $1
      ORDER BY attendance.id DESC
    `, [filterDate]);
  } else {
    records = await db.query(`
      SELECT attendance.*, employees.name
      FROM attendance
      JOIN employees ON attendance.employee_id = employees.id
      ORDER BY attendance.id DESC
    `);
  }

  res.render("attendance", {
    employees: employees.rows,
    records: records.rows,
    filterDate
  });
});

app.post("/attendance/add", requireLogin, async (req, res) => {
  const { employee_id, date, status } = req.body;

  try {
    await db.query(
      "INSERT INTO attendance (employee_id, date, status) VALUES ($1, $2, $3)",
      [employee_id, date, status]
    );
  } catch (err) {
    console.log(err.message);
  }

  res.redirect("/attendance");
});

app.get("/attendance/edit/:id", requireLogin, async (req, res) => {
  const attendance = await db.query(
    "SELECT * FROM attendance WHERE id = $1",
    [req.params.id]
  );

  const employees = await db.query(
    "SELECT * FROM employees ORDER BY name ASC"
  );

  res.render("edit-attendance", {
    attendance: attendance.rows[0],
    employees: employees.rows,
  });
});

app.post("/attendance/update/:id", requireLogin, async (req, res) => {
  const { employee_id, date, status } = req.body;

  await db.query(
    "UPDATE attendance SET employee_id = $1, date = $2, status = $3 WHERE id = $4",
    [employee_id, date, status, req.params.id]
  );

  res.redirect("/attendance");
});

app.post("/attendance/delete/:id", requireLogin, async (req, res) => {
  await db.query(
    "DELETE FROM attendance WHERE id = $1",
    [req.params.id]
  );

  res.redirect("/attendance");
});

/* LEAVES */

app.get("/leaves", requireLogin, async (req, res) => {
  const employees = await db.query("SELECT * FROM employees ORDER BY name ASC");

  const leaves = await db.query(`
    SELECT leaves.*, employees.name
    FROM leaves
    JOIN employees ON leaves.employee_id = employees.id
    ORDER BY leaves.id DESC
  `);

  res.render("leaves", {
    employees: employees.rows,
    leaves: leaves.rows,
  });
});

app.post("/leaves/add", requireLogin, async (req, res) => {
  const { employee_id, leave_type, start_date, end_date, reason } = req.body;

  await db.query(
    `INSERT INTO leaves
    (employee_id, leave_type, start_date, end_date, reason)
    VALUES ($1, $2, $3, $4, $5)`,
    [employee_id, leave_type, start_date, end_date, reason]
  );

  res.redirect("/leaves");
});

app.post("/leaves/approve/:id", requireLogin, async (req, res) => {
  await db.query(
    "UPDATE leaves SET status = 'Approved' WHERE id = $1",
    [req.params.id]
  );

  res.redirect("/leaves");
});

app.post("/leaves/reject/:id", requireLogin, async (req, res) => {
  await db.query(
    "UPDATE leaves SET status = 'Rejected' WHERE id = $1",
    [req.params.id]
  );

  res.redirect("/leaves");
});

/* PAYROLL */

app.get("/payroll", requireLogin, async (req, res) => {
  const employees = await db.query("SELECT * FROM employees ORDER BY name ASC");

  res.render("payroll", {
    employees: employees.rows,
    payroll: null,
  });
});

app.post("/payroll/calculate", requireLogin, async (req, res) => {
  const { employee_id, month } = req.body;

  const employeeResult = await db.query(
    "SELECT * FROM employees WHERE id = $1",
    [employee_id]
  );

  const employee = employeeResult.rows[0];

  const attendance = await db.query(
    `SELECT * FROM attendance
     WHERE employee_id = $1
     AND TO_CHAR(date, 'YYYY-MM') = $2`,
    [employee_id, month]
  );

  let present = 0;
  let absent = 0;
  let halfday = 0;

  attendance.rows.forEach((row) => {
    if (row.status === "Present") present++;
    if (row.status === "Absent") absent++;
    if (row.status === "Half Day") halfday++;
  });

  const dailySalary = employee.salary / 30;
  const deduction = (absent * dailySalary) + ((halfday * dailySalary) / 2);
  const finalSalary = employee.salary - deduction;

  const employees = await db.query("SELECT * FROM employees ORDER BY name ASC");

  res.render("payroll", {
    employees: employees.rows,
    payroll: {
      employee,
      month,
      present,
      absent,
      halfday,
      deduction,
      finalSalary,
    },
  });
});

app.post("/payroll/payslip", requireLogin, (req, res) => {
  const data = req.body;
  const doc = new PDFDocument();

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=payslip-${data.employeeName}.pdf`
  );

  doc.pipe(res);

  doc.fontSize(22).text("PAYSLIP", { align: "center" });
  doc.moveDown();

  doc.fontSize(14).text(`Employee Name: ${data.employeeName}`);
  doc.text(`Department: ${data.department}`);
  doc.text(`Month: ${data.month}`);
  doc.text(`Base Salary: ₹ ${data.salary}`);
  doc.text(`Present Days: ${data.present}`);
  doc.text(`Absent Days: ${data.absent}`);
  doc.text(`Half Days: ${data.halfday}`);
  doc.text(`Deductions: ₹ ${data.deduction}`);
  doc.text(`Final Salary: ₹ ${data.finalSalary}`);

  doc.end();
});

/* START SERVER */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});