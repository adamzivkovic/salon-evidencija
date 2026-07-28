import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatMoney, formatDateSr } from "./utils";
import { LIBERATION_SANS_REGULAR_B64 } from "./fonts/LiberationSans-Regular";
import { LIBERATION_SANS_BOLD_B64 } from "./fonts/LiberationSans-Bold";

const INK = [43, 27, 31];
const MUTED = [120, 100, 90];
const ACCENT = [122, 46, 61];
const FOOT_BG = [237, 224, 201];

const FONT_NAME = "LiberationSans";

// jsPDF-ovi ugrađeni fontovi (Helvetica i sl.) ne podržavaju č/ć/š/ž/đ ispravno
// (slova se prikazuju razvučeno/pogrešno). Zato ugrađujemo pravi TTF font koji
// ih ispravno prikazuje, jednom po dokumentu.
function registerFont(doc) {
  doc.addFileToVFS("LiberationSans-Regular.ttf", LIBERATION_SANS_REGULAR_B64);
  doc.addFont("LiberationSans-Regular.ttf", FONT_NAME, "normal");
  doc.addFileToVFS("LiberationSans-Bold.ttf", LIBERATION_SANS_BOLD_B64);
  doc.addFont("LiberationSans-Bold.ttf", FONT_NAME, "bold");
  doc.setFont(FONT_NAME, "normal");
}

function addHeader(doc, title, run) {
  doc.setFont(FONT_NAME, "bold");
  doc.setFontSize(18);
  doc.setTextColor(...ACCENT);
  doc.text("Salon 2CATS", 14, 16);
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(title, 14, 26);
  doc.setFont(FONT_NAME, "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(`Period: ${formatDateSr(run.periodFrom)} — ${formatDateSr(run.periodTo)}`, 14, 33);
  doc.text(`Datum izrade: ${formatDateSr(new Date())}`, 14, 38);
  doc.setDrawColor(...ACCENT);
  doc.line(14, 42, 196, 42);
  return 50;
}

const baseTableOptions = {
  styles: { font: FONT_NAME, fontSize: 8.5, textColor: INK },
  headStyles: { font: FONT_NAME, fontStyle: "bold", fillColor: ACCENT, textColor: [251, 246, 238] },
  footStyles: { font: FONT_NAME, fontStyle: "bold", fillColor: FOOT_BG, textColor: INK },
  alternateRowStyles: { fillColor: [245, 237, 224] },
};

/** Generiše PDF za jednog zaposlenog (provizija ili izdvajanje za materijal). */
export function buildEmployeePdf(run, result) {
  const doc = new jsPDF();
  registerFont(doc);
  let y = addHeader(doc, `Obračun — ${result.name}`, run);

  doc.setFont(FONT_NAME, "normal");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(`Broj izvršenih usluga: ${result.count}`, 14, y);
  y += 7;
  doc.text(`Ukupan promet: ${formatMoney(result.revenue)}`, 14, y);
  y += 7;

  if (result.calcType === "commission") {
    doc.text(`Procenat zarade: ${result.percentage}%`, 14, y);
    y += 7;
    doc.setFont(FONT_NAME, "bold");
    doc.setFontSize(12.5);
    doc.setTextColor(...ACCENT);
    doc.text(`Obračunata zarada: ${formatMoney(result.totalCommission)}`, 14, y);
    y += 10;
  } else if (result.calcType === "material_deduction") {
    doc.setFont(FONT_NAME, "normal");
    doc.text(`Procenat za materijal: ${result.percentage}%`, 14, y);
    y += 7;
    doc.text(`Izdvajanje za materijal: ${formatMoney(result.totalMaterial)}`, 14, y);
    y += 7;
    doc.setFont(FONT_NAME, "bold");
    doc.setFontSize(12.5);
    doc.setTextColor(...ACCENT);
    doc.text(`Preostali (neto) iznos: ${formatMoney(result.netTotal)}`, 14, y);
    y += 10;
  }

  doc.setFont(FONT_NAME, "normal");
  doc.setTextColor(...INK);
  doc.setFontSize(10);
  doc.text("Specifikacija usluga:", 14, y);
  y += 4;

  const head =
    result.calcType === "commission"
      ? [["RB", "Datum", "Mušterija", "Usluga", "Naplaćeno", "Provizija"]]
      : result.calcType === "material_deduction"
      ? [["RB", "Datum", "Mušterija", "Usluga", "Naplaćeno", "Materijal", "Neto"]]
      : [["RB", "Datum", "Mušterija", "Usluga", "Naplaćeno"]];

  const body = result.lines.map((l, i) =>
    result.calcType === "commission"
      ? [String(i + 1), formatDateSr(l.date), l.client, l.service, formatMoney(l.price), formatMoney(l.commission)]
      : result.calcType === "material_deduction"
      ? [String(i + 1), formatDateSr(l.date), l.client, l.service, formatMoney(l.price), formatMoney(l.materialDeduction), formatMoney(l.net)]
      : [String(i + 1), formatDateSr(l.date), l.client, l.service, formatMoney(l.price)]
  );

  const totalPrice = result.lines.reduce((s, l) => s + (Number(l.price) || 0), 0);
  const foot =
    result.calcType === "commission"
      ? [["", "", "", "Ukupno", formatMoney(totalPrice), formatMoney(result.totalCommission)]]
      : result.calcType === "material_deduction"
      ? [["", "", "", "Ukupno", formatMoney(totalPrice), formatMoney(result.totalMaterial), formatMoney(result.netTotal)]]
      : [["", "", "", "Ukupno", formatMoney(totalPrice)]];

  autoTable(doc, {
    head,
    body,
    foot,
    startY: y,
    ...baseTableOptions,
    columnStyles: { 0: { cellWidth: 10 } },
  });

  return doc.output("blob");
}

/** Generiše zbirni rekapitulacioni PDF za ceo salon. */
export function buildRecapPdf(run, results, recap) {
  const doc = new jsPDF();
  registerFont(doc);
  let y = addHeader(doc, `Rekapitulacija — ${run.label}`, run);

  doc.setFont(FONT_NAME, "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(...ACCENT);
  doc.text(`Ukupan promet salona: ${formatMoney(recap.totalRevenue)}`, 14, y);
  y += 10;

  doc.setFont(FONT_NAME, "normal");
  doc.setTextColor(...INK);
  doc.setFontSize(10);
  doc.text("Pregled po zaposlenima:", 14, y);
  y += 4;

  const totalCount = results.reduce((s, r) => s + (r.count || 0), 0);
  const totalRevenueSum = results.reduce((s, r) => s + (r.revenue || 0), 0);
  const totalIznos = results.reduce(
    (s, r) => s + (r.calcType === "commission" ? r.totalCommission || 0 : r.calcType === "material_deduction" ? r.netTotal || 0 : 0),
    0
  );

  autoTable(doc, {
    startY: y,
    head: [["RB", "Zaposleni", "Broj usluga", "Promet", "Tip obračuna", "Procenat", "Iznos"]],
    body: results.map((r, i) => [
      String(i + 1),
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
    foot: [["", "Ukupno", String(totalCount), formatMoney(totalRevenueSum), "", "", formatMoney(totalIznos)]],
    ...baseTableOptions,
    styles: { ...baseTableOptions.styles, fontSize: 9 },
    columnStyles: { 0: { cellWidth: 10 } },
  });

  let y2 = doc.lastAutoTable.finalY + 12;
  doc.setFont(FONT_NAME, "normal");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(`Ukupno isplaćeno na ime provizije: ${formatMoney(recap.totalCommission)}`, 14, y2);
  y2 += 7;
  doc.text(`Ukupno izdvojeno za materijal: ${formatMoney(recap.totalMaterial)}`, 14, y2);
  y2 += 7;
  doc.text(`Ukupno isplaćeno zaposlenima (zarade): ${formatMoney(recap.totalEmployeeEarnings)}`, 14, y2);
  y2 += 10;
  doc.setFont(FONT_NAME, "bold");
  doc.setFontSize(13);
  doc.setTextColor(...ACCENT);
  doc.text(`Preostali iznos (za salon): ${formatMoney(recap.remainingForSalon)}`, 14, y2);

  return doc.output("blob");
}
