import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatMoney, formatDateSr } from "./utils";

const INK = [43, 27, 31];
const MUTED = [120, 100, 90];
const ACCENT = [122, 46, 61];

function addHeader(doc, title, run) {
  doc.setFontSize(18);
  doc.setTextColor(...ACCENT);
  doc.text("Salon 2CATS", 14, 16);
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(title, 14, 26);
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(`Period: ${formatDateSr(run.periodFrom)} — ${formatDateSr(run.periodTo)}`, 14, 33);
  doc.text(`Datum izrade: ${formatDateSr(new Date())}`, 14, 38);
  doc.setDrawColor(...ACCENT);
  doc.line(14, 42, 196, 42);
  return 50;
}

/** Generiše PDF za jednog zaposlenog (provizija ili izdvajanje za materijal). */
export function buildEmployeePdf(run, result) {
  const doc = new jsPDF();
  let y = addHeader(doc, `Obračun — ${result.name}`, run);

  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(`Broj izvršenih usluga: ${result.count}`, 14, y);
  y += 7;
  doc.text(`Ukupan promet: ${formatMoney(result.revenue)}`, 14, y);
  y += 7;

  if (result.calcType === "commission") {
    doc.text(`Procenat zarade: ${result.percentage}%`, 14, y);
    y += 7;
    doc.setFontSize(12.5);
    doc.setTextColor(...ACCENT);
    doc.text(`Obračunata zarada: ${formatMoney(result.totalCommission)}`, 14, y);
    y += 10;
  } else if (result.calcType === "material_deduction") {
    doc.text(`Procenat za materijal: ${result.percentage}%`, 14, y);
    y += 7;
    doc.text(`Izdvajanje za materijal: ${formatMoney(result.totalMaterial)}`, 14, y);
    y += 7;
    doc.setFontSize(12.5);
    doc.setTextColor(...ACCENT);
    doc.text(`Preostali (neto) iznos: ${formatMoney(result.netTotal)}`, 14, y);
    y += 10;
  }

  doc.setTextColor(...INK);
  doc.setFontSize(10);
  doc.text("Specifikacija usluga:", 14, y);
  y += 4;

  const head =
    result.calcType === "commission"
      ? [["Datum", "Mušterija", "Usluga", "Naplaćeno", "Provizija"]]
      : result.calcType === "material_deduction"
      ? [["Datum", "Mušterija", "Usluga", "Naplaćeno", "Materijal", "Neto"]]
      : [["Datum", "Mušterija", "Usluga", "Naplaćeno"]];

  const body = result.lines.map((l) =>
    result.calcType === "commission"
      ? [formatDateSr(l.date), l.client, l.service, formatMoney(l.price), formatMoney(l.commission)]
      : result.calcType === "material_deduction"
      ? [formatDateSr(l.date), l.client, l.service, formatMoney(l.price), formatMoney(l.materialDeduction), formatMoney(l.net)]
      : [formatDateSr(l.date), l.client, l.service, formatMoney(l.price)]
  );

  autoTable(doc, {
    head,
    body,
    startY: y,
    styles: { fontSize: 8.5, textColor: INK },
    headStyles: { fillColor: ACCENT, textColor: [251, 246, 238] },
    alternateRowStyles: { fillColor: [245, 237, 224] },
  });

  return doc.output("blob");
}

/** Generiše zbirni rekapitulacioni PDF za ceo salon. */
export function buildRecapPdf(run, results, recap) {
  const doc = new jsPDF();
  let y = addHeader(doc, `Rekapitulacija — ${run.label}`, run);

  doc.setFontSize(12.5);
  doc.setTextColor(...ACCENT);
  doc.text(`Ukupan promet salona: ${formatMoney(recap.totalRevenue)}`, 14, y);
  y += 10;

  doc.setTextColor(...INK);
  doc.setFontSize(10);
  doc.text("Pregled po zaposlenima:", 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [["Zaposleni", "Broj usluga", "Promet", "Tip obračuna", "Procenat", "Iznos"]],
    body: results.map((r) => [
      r.name,
      String(r.count),
      formatMoney(r.revenue),
      r.calcType === "commission" ? "Provizija" : r.calcType === "material_deduction" ? "Materijal" : "—",
      `${r.percentage}%`,
      r.calcType === "commission"
        ? formatMoney(r.totalCommission)
        : r.calcType === "material_deduction"
        ? formatMoney(r.netTotal)
        : "—",
    ]),
    styles: { fontSize: 9, textColor: INK },
    headStyles: { fillColor: ACCENT, textColor: [251, 246, 238] },
    alternateRowStyles: { fillColor: [245, 237, 224] },
  });

  let y2 = doc.lastAutoTable.finalY + 12;
  doc.setFontSize(11);
  doc.text(`Ukupno isplaćeno na ime provizije: ${formatMoney(recap.totalCommission)}`, 14, y2);
  y2 += 7;
  doc.text(`Ukupno izdvojeno za materijal: ${formatMoney(recap.totalMaterial)}`, 14, y2);
  y2 += 7;
  doc.text(`Ukupno isplaćeno zaposlenima (zarade): ${formatMoney(recap.totalEmployeeEarnings)}`, 14, y2);
  y2 += 10;
  doc.setFontSize(13);
  doc.setTextColor(...ACCENT);
  doc.text(`Preostali iznos (za salon): ${formatMoney(recap.remainingForSalon)}`, 14, y2);

  return doc.output("blob");
}
