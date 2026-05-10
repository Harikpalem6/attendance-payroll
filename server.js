const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcrypt");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const db = require("./database/db");

const app = express();

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

function requireAdminLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/");
  }
  next();
}

function requireEmployeeLogin(req, res, next) {
  if (!req.session.employee) {
    return res.redirect("/employee/login");
  }
  next();
}

/* ADMIN LOGIN */

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
    return res.render("login", {
      error: "Invalid username or password"
    });
  }

  const user = result.rows[0];
  const match = await bcrypt.compare(password, user.password);

  if (!match) {
    return res.render("login", {
      error: "Invalid username or password"
    });
  }

  req.session.user = user;
  res.redirect("/dashboard");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

/* EMPLOYEE LOGIN */

app.get("/employee/login", (req, res) => {
  res.render("employee-login");
});

app.post("/employee/login", async (req, res) => {
  const { username, password } = req.body;

  const result = await db.query(
    "SELECT * FROM employees WHERE username = $1",
    [username]
  );

  if (result.rows.length === 0) {
    return res.render("employee-login", {
      error: "Invalid employee login"
    });
  }

  const employee = result.rows[0];

if (!employee.password) {
  return res.render("employee-login", {
    error: "Employee account not activated"
  });
}

      const match = await bcrypt.compare(password, employee.password);
      if (!match) {
      return res.render("employee-login", {
      error: "Invalid employee login"
    });
  }

  req.session.employee = employee;
  res.redirect("/employee/dashboard");
});

app.get("/employee/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/employee/login");
  });
});

/* DASHBOARD */

app.get("/dashboard", requireAdminLogin, async (req, res) => {
  const employees = await db.query(
    "SELECT COUNT(*) FROM employees"
  );

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

app.get("/employees", requireAdminLogin, async (req, res) => {
  const search = req.query.search || "";
  let result;

  if (search) {
    result = await db.query(
      "SELECT * FROM employees WHERE name ILIKE $1 ORDER BY id DESC",
      [`%${search}%`]
    );
  } else {
    result = await db.query(
      "SELECT * FROM employees ORDER BY id DESC"
    );
  }

  res.render("employees", {
    employees: result.rows,
    search,
  });
});

app.post("/employees/add", requireAdminLogin, async (req, res) => {
  const { name, department, salary } = req.body;

  const username = name.toLowerCase().replace(/\s+/g, "");
  const hashedPassword = await bcrypt.hash("employee123", 10);

  await db.query(
    `INSERT INTO employees
    (name, department, salary, username, password)
    VALUES ($1, $2, $3, $4, $5)`,
    [name, department, salary, username, hashedPassword]
  );

  res.redirect("/employees");
});
app.get("/employees/edit/:id", requireAdminLogin, async (req, res) => {
  const result = await db.query(
    "SELECT * FROM employees WHERE id = $1",
    [req.params.id]
  );

  res.render("edit-employee", {
    employee: result.rows[0],
  });
});

app.post("/employees/update/:id", requireAdminLogin, async (req, res) => {
  const { name, department, salary } = req.body;

  await db.query(
    "UPDATE employees SET name = $1, department = $2, salary = $3 WHERE id = $4",
    [name, department, salary, req.params.id]
  );

  res.redirect("/employees");
});

app.post("/employees/delete/:id", requireAdminLogin, async (req, res) => {
  await db.query(
    "DELETE FROM employees WHERE id = $1",
    [req.params.id]
  );

  res.redirect("/employees");
});

/* ADMIN ATTENDANCE */

app.get("/attendance", requireAdminLogin, async (req, res) => {
  const filterDate = req.query.date || "";

  const employees = await db.query(
    "SELECT * FROM employees ORDER BY name ASC"
  );

  let records;

  if (filterDate) {
    records = await db.query(
      `SELECT attendance.*, employees.name
       FROM attendance
       JOIN employees ON attendance.employee_id = employees.id
       WHERE attendance.date = $1
       ORDER BY attendance.id DESC`,
      [filterDate]
    );
  } else {
    records = await db.query(
      `SELECT attendance.*, employees.name
       FROM attendance
       JOIN employees ON attendance.employee_id = employees.id
       ORDER BY attendance.id DESC`
    );
  }

  res.render("attendance", {
    employees: employees.rows,
    records: records.rows,
    filterDate,
  });
});

app.post("/attendance/add", requireAdminLogin, async (req, res) => {
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

/* EMPLOYEE DASHBOARD */

app.get("/employee/dashboard", requireEmployeeLogin, async (req, res) => {
  const attendance = await db.query(
    "SELECT * FROM attendance WHERE employee_id = $1 ORDER BY date DESC",
    [req.session.employee.id]
  );

  const leaves = await db.query(
    "SELECT * FROM leaves WHERE employee_id = $1 ORDER BY id DESC",
    [req.session.employee.id]
  );

  res.render("employee-dashboard", {
    employee: req.session.employee,
    attendance: attendance.rows,
    leaves: leaves.rows,
  });
});

app.post("/employee/attendance", requireEmployeeLogin, async (req, res) => {
  const today = new Date().toISOString().split("T")[0];

  try {
    await db.query(
      "INSERT INTO attendance (employee_id, date, status) VALUES ($1, $2, $3)",
      [req.session.employee.id, today, "Present"]
    );
  } catch (err) {
    console.log(err.message);
  }

  res.redirect("/employee/dashboard");
});
/* LEAVES */

app.get("/leaves", requireAdminLogin, async (req, res) => {
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

app.post("/leaves/add", requireAdminLogin, async (req, res) => {
  const { employee_id, leave_type, start_date, end_date, reason } = req.body;

  await db.query(
    `INSERT INTO leaves
    (employee_id, leave_type, start_date, end_date, reason)
    VALUES ($1, $2, $3, $4, $5)`,
    [employee_id, leave_type, start_date, end_date, reason]
  );

  res.redirect("/leaves");
});

app.post("/leaves/approve/:id", requireAdminLogin, async (req, res) => {
  await db.query(
    "UPDATE leaves SET status = 'Approved' WHERE id = $1",
    [req.params.id]
  );

  res.redirect("/leaves");
});

app.post("/leaves/reject/:id", requireAdminLogin, async (req, res) => {
  await db.query(
    "UPDATE leaves SET status = 'Rejected' WHERE id = $1",
    [req.params.id]
  );

  res.redirect("/leaves");
});

/* EMPLOYEE LEAVES */

app.get("/employee/leaves", requireEmployeeLogin, async (req, res) => {
  const leaves = await db.query(
    "SELECT * FROM leaves WHERE employee_id = $1 ORDER BY id DESC",
    [req.session.employee.id]
  );

  res.render("employee-leaves", {
    employee: req.session.employee,
    leaves: leaves.rows,
  });
});

app.post("/employee/leaves/apply", requireEmployeeLogin, async (req, res) => {
  const { leave_type, start_date, end_date, reason } = req.body;

  await db.query(
    `INSERT INTO leaves
    (employee_id, leave_type, start_date, end_date, reason)
    VALUES ($1, $2, $3, $4, $5)`,
    [
      req.session.employee.id,
      leave_type,
      start_date,
      end_date,
      reason
    ]
  );

  res.redirect("/employee/leaves");
});

/* PAYROLL */

app.get("/payroll", requireAdminLogin, async (req, res) => {
  const employees = await db.query(
    "SELECT * FROM employees ORDER BY name ASC"
  );

  res.render("payroll", {
    employees: employees.rows,
    payroll: null,
  });
});

app.post("/payroll/calculate", requireAdminLogin, async (req, res) => {
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

  const employees = await db.query(
    "SELECT * FROM employees ORDER BY name ASC"
  );

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

/* EMPLOYEE PAYROLL */

app.get("/employee/payroll", requireEmployeeLogin, async (req, res) => {
  res.render("employee-payroll", {
    employee: req.session.employee
  });
});

/* PDF */

app.post("/payroll/payslip", (req, res) => {
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

/* SERVER */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});