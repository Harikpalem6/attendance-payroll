const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");
const PDFDocument = require("pdfkit");
const bcrypt = require("bcrypt");
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
    cookie: { maxAge: 30 * 60 * 1000 }
  })
);

function requireLogin(req, res, next) {
  if (!req.session.admin) return res.redirect("/");
  next();
}

/* LOGIN */

app.get("/", (req, res) => {
  res.render("login");
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  db.get(
    "SELECT * FROM admins WHERE username=?",
    [username],
    async (err, admin) => {
      if (err || !admin) {
        return res.render("login", {
          error: "Invalid username or password"
        });
      }

      const valid = await bcrypt.compare(password, admin.password);

      if (!valid) {
        return res.render("login", {
          error: "Invalid username or password"
        });
      }

      req.session.admin = admin;
      res.redirect("/dashboard");
    }
  );
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

/* DASHBOARD */

app.get("/dashboard", requireLogin, (req, res) => {
  const today = new Date().toISOString().split("T")[0];

  db.get("SELECT COUNT(*) totalEmployees FROM employees", [], (e1, emp) => {
    db.get(
      "SELECT COUNT(*) presentToday FROM attendance WHERE date=? AND status='Present'",
      [today],
      (e2, present) => {
        db.get(
          "SELECT COUNT(*) absentToday FROM attendance WHERE date=? AND status='Absent'",
          [today],
          (e3, absent) => {
            res.render("dashboard", {
              totalEmployees: emp?.totalEmployees || 0,
              presentToday: present?.presentToday || 0,
              absentToday: absent?.absentToday || 0
            });
          }
        );
      }
    );
  });
});

/* EMPLOYEES */

app.get("/employees", requireLogin, (req, res) => {
  const search = req.query.search || "";

  db.all(
    "SELECT * FROM employees WHERE name LIKE ? ORDER BY id DESC",
    [`%${search}%`],
    (err, rows) => {
      res.render("employees", {
        employees: rows || [],
        search
      });
    }
  );
});

app.post("/employees/add", requireLogin, (req, res) => {
  const { name, department, salary } = req.body;

  db.run(
    "INSERT INTO employees (name, department, salary) VALUES (?, ?, ?)",
    [name, department, salary],
    () => res.redirect("/employees")
  );
});

app.get("/employees/edit/:id", requireLogin, (req, res) => {
  db.get(
    "SELECT * FROM employees WHERE id=?",
    [req.params.id],
    (err, employee) => {
      res.render("edit-employee", { employee });
    }
  );
});

app.post("/employees/update/:id", requireLogin, (req, res) => {
  const { name, department, salary } = req.body;

  db.run(
    "UPDATE employees SET name=?, department=?, salary=? WHERE id=?",
    [name, department, salary, req.params.id],
    () => res.redirect("/employees")
  );
});

app.post("/employees/delete/:id", requireLogin, (req, res) => {
  db.run(
    "DELETE FROM employees WHERE id=?",
    [req.params.id],
    () => res.redirect("/employees")
  );
});

/* ATTENDANCE */

app.get("/attendance", requireLogin, (req, res) => {
  const filterDate = req.query.date || "";

  db.all("SELECT * FROM employees", [], (err, employees) => {
    let query = `
      SELECT attendance.id, attendance.employee_id, employees.name, attendance.date, attendance.status
      FROM attendance
      JOIN employees ON attendance.employee_id = employees.id
    `;

    let params = [];

    if (filterDate) {
      query += " WHERE attendance.date = ?";
      params.push(filterDate);
    }

    query += " ORDER BY attendance.date DESC";

    db.all(query, params, (err2, records) => {
      res.render("attendance", {
        employees,
        records: records || [],
        filterDate
      });
    });
  });
});

app.post("/attendance/add", requireLogin, (req, res) => {
  const { employee_id, date, status } = req.body;

  db.get(
    "SELECT * FROM attendance WHERE employee_id=? AND date=?",
    [employee_id, date],
    (err, existing) => {
      if (existing) {
        return res.redirect("/attendance");
      }

      db.run(
        "INSERT INTO attendance (employee_id, date, status) VALUES (?, ?, ?)",
        [employee_id, date, status],
        () => res.redirect("/attendance")
      );
    }
  );
});

app.get("/attendance/edit/:id", requireLogin, (req, res) => {
  db.get(
    "SELECT * FROM attendance WHERE id=?",
    [req.params.id],
    (err, attendance) => {
      db.all("SELECT * FROM employees", [], (err2, employees) => {
        res.render("edit-attendance", {
          attendance,
          employees
        });
      });
    }
  );
});

app.post("/attendance/update/:id", requireLogin, (req, res) => {
  const { employee_id, date, status } = req.body;

  db.run(
    "UPDATE attendance SET employee_id=?, date=?, status=? WHERE id=?",
    [employee_id, date, status, req.params.id],
    () => res.redirect("/attendance")
  );
});

app.post("/attendance/delete/:id", requireLogin, (req, res) => {
  db.run(
    "DELETE FROM attendance WHERE id=?",
    [req.params.id],
    () => res.redirect("/attendance")
  );
});

/* LEAVES */

app.get("/leaves", requireLogin, (req, res) => {
  db.all("SELECT * FROM employees", [], (err, employees) => {
    db.all(
      `
      SELECT leaves.*, employees.name
      FROM leaves
      JOIN employees ON leaves.employee_id = employees.id
      ORDER BY leaves.id DESC
      `,
      [],
      (err2, leaves) => {
        res.render("leaves", {
          employees,
          leaves: leaves || []
        });
      }
    );
  });
});

app.post("/leaves/add", requireLogin, (req, res) => {
  const { employee_id, leave_type, start_date, end_date, reason } = req.body;

  db.run(
    "INSERT INTO leaves (employee_id, leave_type, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?)",
    [employee_id, leave_type, start_date, end_date, reason],
    () => res.redirect("/leaves")
  );
});

app.post("/leaves/approve/:id", requireLogin, (req, res) => {
  db.run(
    "UPDATE leaves SET status='Approved' WHERE id=?",
    [req.params.id],
    () => res.redirect("/leaves")
  );
});

app.post("/leaves/reject/:id", requireLogin, (req, res) => {
  db.run(
    "UPDATE leaves SET status='Rejected' WHERE id=?",
    [req.params.id],
    () => res.redirect("/leaves")
  );
});

/* PAYROLL */

app.get("/payroll", requireLogin, (req, res) => {
  db.all("SELECT * FROM employees", [], (err, employees) => {
    res.render("payroll", {
      employees,
      payroll: null
    });
  });
});

app.post("/payroll/calculate", requireLogin, (req, res) => {
  const { employee_id, month } = req.body;

  db.get(
    "SELECT * FROM employees WHERE id=?",
    [employee_id],
    (err, employee) => {
      if (!employee) return res.redirect("/payroll");

      db.all(
        "SELECT * FROM attendance WHERE employee_id=? AND date LIKE ?",
        [employee_id, `${month}%`],
        (err2, attendance) => {
          let present = 0;
          let absent = 0;
          let halfday = 0;

          (attendance || []).forEach((r) => {
            if (r.status === "Present") present++;
            if (r.status === "Absent") absent++;
            if (r.status === "Half Day") halfday++;
          });

          const dailySalary = employee.salary / 30;
          const deduction =
            absent * dailySalary + (halfday * dailySalary) / 2;

          const finalSalary = employee.salary - deduction;

          db.all("SELECT * FROM employees", [], (e3, employees) => {
            res.render("payroll", {
              employees,
              payroll: {
                month,
                employee,
                present,
                absent,
                halfday,
                deduction,
                finalSalary
              }
            });
          });
        }
      );
    }
  );
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

  [
    `Employee Name: ${data.employeeName}`,
    `Department: ${data.department}`,
    `Payroll Month: ${data.month}`,
    `Base Salary: ₹${data.salary}`,
    `Present Days: ${data.present}`,
    `Absent Days: ${data.absent}`,
    `Half Days: ${data.halfday}`,
    `Deductions: ₹${data.deduction}`,
    `Final Salary: ₹${data.finalSalary}`
  ].forEach((line) => doc.fontSize(14).text(line));

  doc.end();
});

/* EXPORTS */

async function exportQuery(res, filename, sheet, columns, query) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheet);

  worksheet.columns = columns;

  db.all(query, [], async (err, rows) => {
    (rows || []).forEach((r) => worksheet.addRow(r));

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${filename}`
    );

    await workbook.xlsx.write(res);
    res.end();
  });
}

app.get("/export/employees", requireLogin, (req, res) =>
  exportQuery(
    res,
    "employees.xlsx",
    "Employees",
    [
      { header: "ID", key: "id", width: 10 },
      { header: "Name", key: "name", width: 25 },
      { header: "Department", key: "department", width: 20 },
      { header: "Salary", key: "salary", width: 15 }
    ],
    "SELECT * FROM employees"
  )
);

app.get("/export/attendance", requireLogin, (req, res) =>
  exportQuery(
    res,
    "attendance.xlsx",
    "Attendance",
    [
      { header: "ID", key: "id", width: 10 },
      { header: "Employee", key: "name", width: 25 },
      { header: "Date", key: "date", width: 20 },
      { header: "Status", key: "status", width: 20 }
    ],
    `
    SELECT attendance.id, employees.name, attendance.date, attendance.status
    FROM attendance
    JOIN employees ON attendance.employee_id=employees.id
    `
  )
);

app.get("/export/leaves", requireLogin, (req, res) =>
  exportQuery(
    res,
    "leaves.xlsx",
    "Leaves",
    [
      { header: "ID", key: "id", width: 10 },
      { header: "Employee", key: "name", width: 25 },
      { header: "Type", key: "leave_type", width: 20 },
      { header: "Start", key: "start_date", width: 15 },
      { header: "End", key: "end_date", width: 15 },
      { header: "Reason", key: "reason", width: 30 },
      { header: "Status", key: "status", width: 15 }
    ],
    `
    SELECT leaves.*, employees.name
    FROM leaves
    JOIN employees ON leaves.employee_id=employees.id
    `
  )
);

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});