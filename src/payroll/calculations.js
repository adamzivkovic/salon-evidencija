// Generički mehanizam za obračun zarada.
//
// Svaki zaposleni ima "calcType" (npr. "commission", "material_deduction").
// Dodavanje novog tipa obračuna (npr. "fixed_salary", "hybrid") znači samo
// dodavanje novog "case"-a u calculateEmployeeResult — ništa drugo u kodu
// ne zavisi od imena ili broja zaposlenih.

import { round2, dateKey } from "./utils";

function isPaid(appt) {
  return appt.price !== "" && appt.price !== null && appt.price !== undefined && !isNaN(appt.price);
}

/**
 * Izračunava obračun za jednog zaposlenog na osnovu njegovog tipa obračuna.
 */
export function calculateEmployeeResult(employee, appointmentsInRange, percentage) {
  const mine = appointmentsInRange
    .filter((a) => a.staff === employee.id && isPaid(a))
    .slice()
    .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));

  const revenue = round2(mine.reduce((sum, a) => sum + Number(a.price), 0));
  const pct = Number(percentage) || 0;

  const base = {
    employeeId: employee.id,
    name: employee.name,
    color: employee.color,
    calcType: employee.calcType,
    percentage: pct,
    count: mine.length,
    revenue,
  };

  switch (employee.calcType) {
    case "commission": {
      const lines = mine.map((a) => ({
        date: a.date,
        client: a.client || "—",
        service: a.service,
        price: Number(a.price),
        commission: round2((Number(a.price) * pct) / 100),
      }));
      const totalCommission = round2(lines.reduce((s, l) => s + l.commission, 0));
      return { ...base, lines, totalCommission };
    }

    case "material_deduction": {
      const lines = mine.map((a) => {
        const materialDeduction = round2((Number(a.price) * pct) / 100);
        return {
          date: a.date,
          client: a.client || "—",
          service: a.service,
          price: Number(a.price),
          materialDeduction,
          net: round2(Number(a.price) - materialDeduction),
        };
      });
      const totalMaterial = round2(lines.reduce((s, l) => s + l.materialDeduction, 0));
      const netTotal = round2(revenue - totalMaterial);
      return { ...base, lines, totalMaterial, netTotal };
    }

    // ---- Mesto za buduće tipove obračuna (fixed_salary, hybrid, ...) ----
    // case "fixed_salary": { ... }
    // case "hybrid": { ... }

    default: {
      // Nepoznat/još nepodržan tip obračuna — ne rušimo aplikaciju, samo
      // vraćamo sirove podatke sa oznakom da tip nije podržan.
      const lines = mine.map((a) => ({
        date: a.date,
        client: a.client || "—",
        service: a.service,
        price: Number(a.price),
      }));
      return { ...base, lines, unsupported: true };
    }
  }
}

/**
 * Izračunava kompletan obračun za sve zaposlene u datom periodu.
 * `percentages` je mapa { employeeId: procenat } — koristi se SAMO za ovaj
 * obračun i ne menja podrazumevane vrednosti zaposlenih.
 */
export function calculatePayroll({ employees, appointments, percentages, from, to }) {
  const fromKey = dateKey(from);
  const toKey = dateKey(to);
  const inRange = appointments.filter((a) => a.date >= fromKey && a.date <= toKey);

  const results = employees.map((emp) =>
    calculateEmployeeResult(emp, inRange, percentages[emp.id] ?? emp.defaultPercentage ?? 0)
  );

  const totalRevenue = round2(results.reduce((s, r) => s + r.revenue, 0));
  const totalCommission = round2(
    results.filter((r) => r.calcType === "commission").reduce((s, r) => s + (r.totalCommission || 0), 0)
  );
  const totalMaterial = round2(
    results.filter((r) => r.calcType === "material_deduction").reduce((s, r) => s + (r.totalMaterial || 0), 0)
  );

  const recap = {
    totalRevenue,
    perEmployeeRevenue: results.map((r) => ({ employeeId: r.employeeId, name: r.name, revenue: r.revenue })),
    totalCommission,
    perEmployeeMaterial: results
      .filter((r) => r.calcType === "material_deduction")
      .map((r) => ({ employeeId: r.employeeId, name: r.name, material: r.totalMaterial })),
    totalMaterial,
    totalRevenueAllEmployees: totalRevenue,
  };

  return { results, recap };
}
