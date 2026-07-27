// Male, samostalne pomoćne funkcije za modul obračuna — namerno odvojeno
// od glavnog App.jsx da bi ovaj modul mogao da se razvija nezavisno.

export const MONTH_NAMES = [
  "januar", "februar", "mart", "april", "maj", "jun",
  "jul", "avgust", "septembar", "oktobar", "novembar", "decembar",
];

const pad2 = (n) => String(n).padStart(2, "0");

export function dateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function formatDateSr(d) {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}.`;
}

export function formatMoney(n) {
  if (n === null || n === undefined || n === "" || isNaN(n)) return "—";
  return `${Number(n).toLocaleString("sr-RS")} din`;
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function monthLabel(year, monthIndex0) {
  const name = MONTH_NAMES[monthIndex0];
  return `${name[0].toUpperCase()}${name.slice(1)} ${year}.`;
}

export function periodForMonth(year, monthIndex0) {
  const from = new Date(year, monthIndex0, 1);
  const to = new Date(year, monthIndex0 + 1, 0);
  return { from, to };
}
