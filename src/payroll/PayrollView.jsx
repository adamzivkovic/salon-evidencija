import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "../firebase";
import { APP_PIN } from "../appLock";
import { ChevronLeft, Lock, LogOut, Loader2, FileDown, Eye, Ban, AlertTriangle, Trash2, CalendarDays } from "lucide-react";
import { calculatePayroll } from "./calculations";
import { buildEmployeePdf, buildRecapPdf } from "./pdf";
import { MONTH_NAMES, formatMoney, formatDateSr, monthLabel, periodForMonth, dateKey } from "./utils";

const COLLECTION_PAYROLL_RUNS = "payrollRuns";

// Postavi na true tek kad Firebase Storage bude stvarno aktiviran (Blaze plan).
// Dok je false, "Zaključi mesec" uopšte ne pokušava mrežni poziv ka Storage-u —
// PDF-ovi se odmah preuzimaju direktno na računar, bez čekanja i grešaka u konzoli.
const STORAGE_ENABLED = false;

const STATUS_LABELS = {
  draft: "Nacrt",
  closed: "Zaključen",
  void: "Storniran",
};

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Da li ovaj browser uopšte ume da otvori kalendar programski (showPicker) —
// Android Chrome i desktop browseri umeju, ali Safari na iPhone-u NIKAD nije
// implementirao ovu funkciju (provereno zvanično, WebKit bug 261703).
const supportsShowPicker =
  typeof window !== "undefined" &&
  typeof HTMLInputElement !== "undefined" &&
  "showPicker" in HTMLInputElement.prototype;

// Zamena za <input type="date"> koja UVEK prikazuje dd.mm.gggg, bez obzira
// na jezik uređaja/browsera (nativni prikaz to ne poštuje pouzdano svuda).
// Na browserima koji podržavaju showPicker, klik bilo gde na okvir programski
// otvara kalendar. Na iPhone-u (Safari showPicker uopšte ne podržava) se
// pušta da nativno polje samo "oseti" dodir direktno — jedini način da se
// tamo kalendar zaista otvori.
function DateField({ value, onChange, disabled }) {
  const inputRef = useRef(null);

  const openPicker = () => {
    if (disabled || !supportsShowPicker) return;
    const el = inputRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch (e) {
      el.focus();
    }
  };

  return (
    <div style={styles.dateFieldWrap} onClick={supportsShowPicker ? openPicker : undefined}>
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={onChange}
        disabled={disabled}
        style={{ ...styles.dateFieldNative, pointerEvents: supportsShowPicker ? "none" : "auto" }}
      />
      <div style={{ ...styles.dateFieldDisplay, ...(disabled ? styles.dateFieldDisplayDisabled : {}) }}>
        <span>{value ? formatDateSr(value) : "dd.mm.gggg."}</span>
        <CalendarDays size={15} color="#8A7368" />
      </div>
    </div>
  );
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Isteklo vreme čekanja (timeout).")), ms)),
  ]);
}

async function uploadAllPdfs(basePath, recapBlob, employeeBlobs) {
  const recapRef = ref(storage, `${basePath}/rekapitulacija.pdf`);
  await uploadBytes(recapRef, recapBlob);
  const recapUrl = await getDownloadURL(recapRef);
  const paths = { rekapitulacija: recapUrl };
  for (const eb of employeeBlobs) {
    const empRef = ref(storage, `${basePath}/${eb.employeeId}.pdf`);
    await uploadBytes(empRef, eb.blob);
    paths[eb.employeeId] = await getDownloadURL(empRef);
  }
  return paths;
}

export default function PayrollView({ appointments, employees, user, onLogout, onBack }) {
  const [tab, setTab] = useState("calc"); // 'calc' | 'history'

  return (
    <div style={styles.wrap}>
      <div style={styles.topRow}>
        <button style={styles.backLink} onClick={onBack}>
          <ChevronLeft size={15} />
          <span>Statistika</span>
        </button>
        <button style={styles.logoutBtn} onClick={onLogout}>
          <LogOut size={14} />
          <span>Odjavi se</span>
        </button>
      </div>

      <div style={styles.titleRow}>
        <Lock size={20} color="#C4914B" />
        <span style={styles.title}>Obračun zarada</span>
      </div>

      <div style={styles.tabRow}>
        <button
          style={{ ...styles.tabBtn, ...(tab === "calc" ? styles.tabBtnActive : {}) }}
          onClick={() => setTab("calc")}
        >
          Obračun
        </button>
        <button
          style={{ ...styles.tabBtn, ...(tab === "history" ? styles.tabBtnActive : {}) }}
          onClick={() => setTab("history")}
        >
          Istorija obračuna
        </button>
      </div>

      {tab === "calc" ? (
        <CalculationTab appointments={appointments} employees={employees} user={user} />
      ) : (
        <HistoryTab employees={employees} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab 1 — obračun (izračunaj, kartice, rekapitulacija, zaključi)      */
/* ------------------------------------------------------------------ */

function CalculationTab({ appointments, employees, user }) {
  const now = new Date();
  const [mode, setMode] = useState("monthly"); // 'monthly' | 'custom'
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [customFrom, setCustomFrom] = useState(dateKey(now));
  const [customTo, setCustomTo] = useState(dateKey(now));

  const [percentages, setPercentages] = useState({});
  const [status, setStatus] = useState("idle"); // 'idle' | 'draft' | 'closed'
  const [result, setResult] = useState(null);
  const [closedRun, setClosedRun] = useState(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Popuni podrazumevane procente kad se učitaju zaposleni (samo ako nije već uneto).
  useEffect(() => {
    setPercentages((prev) => {
      const next = { ...prev };
      employees.forEach((e) => {
        if (next[e.id] === undefined) next[e.id] = e.defaultPercentage ?? 0;
      });
      return next;
    });
  }, [employees]);

  const period = useMemo(() => {
    if (mode === "monthly") {
      const { from, to } = periodForMonth(year, month);
      return { from, to, label: monthLabel(year, month) };
    }
    const from = new Date(customFrom);
    const to = new Date(customTo);
    return { from, to, label: `${formatDateSr(from)} — ${formatDateSr(to)}` };
  }, [mode, month, year, customFrom, customTo]);

  const resetToDraft = () => {
    if (status === "closed") return; // zaključen obračun se više ne dira
    setStatus("idle");
    setResult(null);
  };

  const handleCalculate = () => {
    const calc = calculatePayroll({ employees, appointments, percentages, from: period.from, to: period.to });
    setResult(calc);
    setStatus("draft");
  };

  const handleFinalize = async () => {
    setFinalizing(true);
    setFinalizeError("");
    try {
      const runDraft = {
        label: period.label,
        periodFrom: dateKey(period.from),
        periodTo: dateKey(period.to),
        year: period.from.getFullYear(),
        month: mode === "monthly" ? month : null,
        mode,
        percentages,
        results: result.results,
        recap: result.recap,
      };

      // 1) Generiši PDF-ove (u memoriji, kao blob-ove)
      const recapBlob = buildRecapPdf(runDraft, result.results, result.recap);
      const employeeBlobs = result.results.map((r) => ({
        employeeId: r.employeeId,
        name: r.name,
        blob: buildEmployeePdf(runDraft, r),
      }));

      // 2) Pokušaj otpremanje u Firebase Storage. Dok Storage nije aktiviran
      // na Firebase nalogu (STORAGE_ENABLED = false ispod), ovaj deo se
      // potpuno preskače — nema mrežnih poziva, nema čekanja, nema greške u
      // konzoli. Kad se Storage jednom uključi, promeni STORAGE_ENABLED na
      // true (na vrhu ovog fajla) da počne stvarno otpremanje.
      const basePath = `payroll/${runDraft.year}/${runDraft.periodFrom}_${runDraft.periodTo}`;
      let pdfPaths = null;
      let storageFailed = false;

      if (!STORAGE_ENABLED) {
        storageFailed = true;
        downloadBlob(recapBlob, `Obracun_${runDraft.label.replace(/\s+/g, "_")}_Rekapitulacija.pdf`);
        employeeBlobs.forEach((eb) =>
          downloadBlob(eb.blob, `Obracun_${runDraft.label.replace(/\s+/g, "_")}_${eb.name}.pdf`)
        );
      } else {
        try {
          const paths = await withTimeout(uploadAllPdfs(basePath, recapBlob, employeeBlobs), 10000);
          pdfPaths = paths;
        } catch (storageErr) {
          console.error("Storage upload nije uspeo, prelazim na lokalno preuzimanje:", storageErr);
          storageFailed = true;
          downloadBlob(recapBlob, `Obracun_${runDraft.label.replace(/\s+/g, "_")}_Rekapitulacija.pdf`);
          employeeBlobs.forEach((eb) =>
            downloadBlob(eb.blob, `Obracun_${runDraft.label.replace(/\s+/g, "_")}_${eb.name}.pdf`)
          );
        }
      }

      // 3) Sačuvaj "zamrznut" dokument u Firestore (uvek, bez obzira na Storage)
      const docRef = await addDoc(collection(db, COLLECTION_PAYROLL_RUNS), {
        ...runDraft,
        status: "closed",
        createdAt: serverTimestamp(),
        createdBy: user?.email || "nepoznato",
        pdfPaths,
        pdfStorageFailed: storageFailed,
      });

      setClosedRun({ id: docRef.id, ...runDraft, status: "closed", pdfPaths, pdfStorageFailed: storageFailed });
      setStatus("closed");
      setConfirmOpen(false);
    } catch (e) {
      console.error(e);
      setFinalizeError("Greška prilikom zaključivanja. Proveri internet konekciju i pokušaj ponovo.");
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <div>
      <Section title="1. Izbor perioda">
        <div style={styles.radioRow}>
          <label style={styles.radioLabel}>
            <input type="radio" checked={mode === "monthly"} onChange={() => { setMode("monthly"); resetToDraft(); }} />
            <span>Mesečni obračun</span>
          </label>
          <label style={styles.radioLabel}>
            <input type="radio" checked={mode === "custom"} onChange={() => { setMode("custom"); resetToDraft(); }} />
            <span>Prilagođeni period</span>
          </label>
        </div>

        {mode === "monthly" ? (
          <div style={styles.fieldRowHalf}>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Mesec</label>
              <select
                value={month}
                onChange={(e) => { setMonth(Number(e.target.value)); resetToDraft(); }}
                style={styles.input}
                disabled={status === "closed"}
              >
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={i}>{m[0].toUpperCase() + m.slice(1)}</option>
                ))}
              </select>
            </div>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Godina</label>
              <select
                value={year}
                onChange={(e) => { setYear(Number(e.target.value)); resetToDraft(); }}
                style={styles.input}
                disabled={status === "closed"}
              >
                {yearOptions(now.getFullYear()).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div style={styles.fieldRowHalf}>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Od</label>
              <DateField value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); resetToDraft(); }} disabled={status === "closed"} />
            </div>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Do</label>
              <DateField value={customTo} onChange={(e) => { setCustomTo(e.target.value); resetToDraft(); }} disabled={status === "closed"} />
            </div>
          </div>
        )}

        <p style={styles.periodPreview}>
          {formatDateSr(period.from)} – {formatDateSr(period.to)}
        </p>
      </Section>

      <Section title="2. Parametri obračuna">
        {employees.map((emp) => (
          <div key={emp.id} style={styles.paramRow}>
            <span style={{ ...styles.paramDot, background: emp.color }} />
            <span style={styles.paramName}>{emp.name}</span>
            <span style={styles.paramLabel}>
              {emp.calcType === "commission" ? "Procenat zarade" : emp.calcType === "material_deduction" ? "Troškovi materijala" : "Procenat"}
            </span>
            <input
              type="number"
              min="0"
              max="100"
              value={percentages[emp.id] ?? ""}
              onChange={(e) => {
                setPercentages((p) => ({ ...p, [emp.id]: Number(e.target.value) }));
                resetToDraft();
              }}
              style={styles.paramInput}
              disabled={status === "closed"}
            />
            <span style={styles.paramPercentSign}>%</span>
          </div>
        ))}
        <p style={styles.paramHint}>
          Ovi procenti važe samo za ovaj obračun i ne menjaju podrazumevana podešavanja zaposlenih.
        </p>
      </Section>

      {status !== "closed" && (
        <button style={styles.calcBtn} onClick={handleCalculate}>
          Izračunaj
        </button>
      )}

      {status === "draft" && (
        <p style={styles.draftBadge}>Status: Nacrt — možeš menjati procente i ponovo izračunati.</p>
      )}
      {status === "closed" && (
        <p style={styles.closedBadge}>Status: Zaključen — obračun je trajno sačuvan i ne može se menjati.</p>
      )}

      {result && (
        <>
          <Section title="3. Kartice zaposlenih">
            {result.results.map((r) => (
              <EmployeeCard key={r.employeeId} result={r} />
            ))}
          </Section>

          <Section title="4. Rekapitulacija">
            <RecapCard recap={result.recap} results={result.results} />
          </Section>

          {status === "draft" && (
            <button style={styles.finalizeBtn} onClick={() => setConfirmOpen(true)}>
              Zaključi mesec
            </button>
          )}

          {status === "closed" && closedRun && (
            closedRun.pdfPaths ? (
              <div style={styles.pdfLinksBox}>
                <p style={styles.pdfLinksTitle}>PDF dokumenti su generisani:</p>
                <a href={closedRun.pdfPaths.rekapitulacija} target="_blank" rel="noreferrer" style={styles.pdfLink}>
                  <FileDown size={14} /> Rekapitulacija.pdf
                </a>
                {result.results.map((r) => (
                  <a key={r.employeeId} href={closedRun.pdfPaths[r.employeeId]} target="_blank" rel="noreferrer" style={styles.pdfLink}>
                    <FileDown size={14} /> {r.name}.pdf
                  </a>
                ))}
              </div>
            ) : (
              <div style={styles.pdfWarnBox}>
                <AlertTriangle size={16} color="#8A6216" />
                <p style={styles.pdfWarnText}>
                  PDF dokumenti su preuzeti direktno na tvoj računar (proveri "Downloads" folder) —
                  Firebase Storage nije aktivan na ovom projektu (zahteva plaćeni plan), pa nisu
                  sačuvani u istoriji. Sam obračun (brojevi, kartice, rekapitulacija) jeste trajno
                  sačuvan i dostupan kroz "Pregled" u Istoriji obračuna.
                </p>
              </div>
            )
          )}
        </>
      )}

      {confirmOpen && (
        <div style={styles.modalOverlay} onClick={() => !finalizing && setConfirmOpen(false)}>
          <div style={styles.confirmCard} onClick={(e) => e.stopPropagation()}>
            <AlertTriangle size={26} color="#A13A3A" />
            <p style={styles.confirmText}>
              Nakon zaključivanja, ovaj obračun postaje trajan i više se ne može menjati. Generisaće se
              PDF dokumenti za sve zaposlene i sačuvati u istoriju. Da li si sigurna da želiš da nastaviš?
            </p>
            {finalizeError && <p style={styles.loginError}>{finalizeError}</p>}
            <div style={styles.confirmBtnRow}>
              <button style={styles.cancelBtn} onClick={() => setConfirmOpen(false)} disabled={finalizing}>
                Otkaži
              </button>
              <button style={styles.finalizeBtnSmall} onClick={handleFinalize} disabled={finalizing}>
                {finalizing ? (
                  <>
                    <Loader2 size={14} className="spin" /> Zaključujem…
                  </>
                ) : (
                  "Da, zaključi"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmployeeCard({ result, run }) {
  const isCommission = result.calcType === "commission";
  const isMaterial = result.calcType === "material_deduction";

  return (
    <div style={styles.empCard}>
      <div style={styles.empCardHeader}>
        <span style={{ ...styles.paramDot, background: result.color }} />
        <span style={styles.empCardName}>{result.name}</span>
        <span style={styles.empCardType}>
          {isCommission ? "Provizija" : isMaterial ? "Izdvajanje za materijal" : "Nepodržan tip obračuna"}
        </span>
      </div>

      <div style={styles.empCardStats}>
        <Stat label="Broj usluga" value={result.count} />
        <Stat label="Ukupan promet" value={formatMoney(result.revenue)} />
        <Stat label="Procenat" value={`${result.percentage}%`} />
        {isCommission && <Stat label="Obračunata zarada" value={formatMoney(result.totalCommission)} highlight />}
        {isMaterial && <Stat label="Izdvajanje za materijal" value={formatMoney(result.totalMaterial)} />}
        {isMaterial && <Stat label="Preostali iznos" value={formatMoney(result.netTotal)} highlight />}
      </div>

      {result.lines.length > 0 ? (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Datum</th>
                <th style={styles.th}>Mušterija</th>
                <th style={styles.th}>Usluga</th>
                <th style={styles.thRight}>Naplaćeno</th>
                {isCommission && <th style={styles.thRight}>Provizija</th>}
                {isMaterial && <th style={styles.thRight}>Materijal</th>}
                {isMaterial && <th style={styles.thRight}>Neto</th>}
              </tr>
            </thead>
            <tbody>
              {result.lines.map((l, i) => (
                <tr key={i}>
                  <td style={styles.td}>{formatDateSr(l.date)}</td>
                  <td style={styles.td}>{l.client}</td>
                  <td style={styles.td}>{l.service}</td>
                  <td style={styles.tdRight}>{formatMoney(l.price)}</td>
                  {isCommission && <td style={styles.tdRight}>{formatMoney(l.commission)}</td>}
                  {isMaterial && <td style={styles.tdRight}>{formatMoney(l.materialDeduction)}</td>}
                  {isMaterial && <td style={styles.tdRight}>{formatMoney(l.net)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={styles.emptyLine}>Nema naplaćenih usluga u ovom periodu.</p>
      )}

      {run && (
        <button
          style={styles.downloadPdfBtn}
          onClick={() => downloadBlob(buildEmployeePdf(run, result), `Obracun_${run.label.replace(/\s+/g, "_")}_${result.name}.pdf`)}
        >
          <FileDown size={14} /> Preuzmi PDF
        </button>
      )}
    </div>
  );
}

function RecapCard({ recap, results, run }) {
  return (
    <div style={styles.recapCard}>
      <Stat label="Ukupan promet salona" value={formatMoney(recap.totalRevenue)} highlight big />
      <div style={styles.recapDivider} />
      {recap.perEmployeeRevenue.map((r) => (
        <div key={r.employeeId} style={styles.recapRow}>
          <span>{r.name} — promet</span>
          <span style={styles.recapValue}>{formatMoney(r.revenue)}</span>
        </div>
      ))}
      <div style={styles.recapDivider} />
      <div style={styles.recapRow}>
        <span>Ukupno isplaćeno na ime provizije</span>
        <span style={styles.recapValue}>{formatMoney(recap.totalCommission)}</span>
      </div>
      {recap.perEmployeeMaterial.map((r) => (
        <div key={r.employeeId} style={styles.recapRow}>
          <span>{r.name} — izdvajanje za materijal</span>
          <span style={styles.recapValue}>{formatMoney(r.material)}</span>
        </div>
      ))}
      <div style={styles.recapRow}>
        <span style={{ fontWeight: 700 }}>Ukupno izdvojeno za materijal</span>
        <span style={{ ...styles.recapValue, fontWeight: 700 }}>{formatMoney(recap.totalMaterial)}</span>
      </div>
      <div style={styles.recapDivider} />
      {(recap.perEmployeeEarnings || []).map((r) => (
        <div key={r.employeeId} style={styles.recapRow}>
          <span>{r.name} — zarada</span>
          <span style={styles.recapValue}>{formatMoney(r.earnings)}</span>
        </div>
      ))}
      <div style={styles.recapRow}>
        <span style={{ fontWeight: 700 }}>Ukupno isplaćeno zaposlenima</span>
        <span style={{ ...styles.recapValue, fontWeight: 700 }}>{formatMoney(recap.totalEmployeeEarnings)}</span>
      </div>
      <div style={styles.recapDivider} />
      <div style={styles.recapRowFinal}>
        <span>Preostali iznos (za salon)</span>
        <span style={styles.recapValueFinal}>{formatMoney(recap.remainingForSalon)}</span>
      </div>
      {run && (
        <button
          style={styles.downloadPdfBtn}
          onClick={() => downloadBlob(buildRecapPdf(run, results, recap), `Obracun_${run.label.replace(/\s+/g, "_")}_Rekapitulacija.pdf`)}
        >
          <FileDown size={14} /> Preuzmi PDF
        </button>
      )}
    </div>
  );
}

function Stat({ label, value, highlight, big }) {
  return (
    <div style={styles.statBox}>
      <div style={{ ...styles.statValue, ...(highlight ? styles.statValueHighlight : {}), ...(big ? styles.statValueBig : {}) }}>
        {value}
      </div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}

function yearOptions(current) {
  const arr = [];
  for (let y = current + 1; y >= current - 4; y--) arr.push(y);
  return arr;
}

/* ------------------------------------------------------------------ */
/* Tab 2 — istorija obračuna                                            */
/* ------------------------------------------------------------------ */

function HistoryTab({ employees }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [runs, setRuns] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [voidingId, setVoidingId] = useState(null);
  const [confirmDeleteRun, setConfirmDeleteRun] = useState(null);
  const [pinModalRun, setPinModalRun] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, COLLECTION_PAYROLL_RUNS),
      (snap) => {
        setRuns(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoaded(true);
      },
      () => setLoaded(true)
    );
    return unsub;
  }, []);

  const years = useMemo(() => {
    const set = new Set(runs.map((r) => r.year));
    set.add(now.getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  }, [runs]);

  const filtered = useMemo(
    () => runs.filter((r) => r.year === year).sort((a, b) => (b.periodFrom || "").localeCompare(a.periodFrom || "")),
    [runs, year]
  );

  const handleVoid = async (run) => {
    const ok = window.confirm(
      `Stornirati obračun "${run.label}"? Ovaj obračun ostaje vidljiv u istoriji sa statusom "Storniran", ali se više ne računa kao važeći. Nakon toga možeš napraviti novi obračun za isti period.`
    );
    if (!ok) return;
    setVoidingId(run.id);
    try {
      await updateDoc(doc(db, COLLECTION_PAYROLL_RUNS, run.id), { status: "void" });
    } catch (e) {
      console.error(e);
      window.alert("Greška prilikom storniranja. Pokušaj ponovo.");
    } finally {
      setVoidingId(null);
    }
  };

  const handleDeleteConfirmed = async () => {
    const run = pinModalRun;
    setPinModalRun(null);
    setDeletingId(run.id);
    try {
      await deleteDoc(doc(db, COLLECTION_PAYROLL_RUNS, run.id));
      // Ako su PDF-ovi bili sačuvani u Storage-u, pokušaj obrisati i njih
      // (bez greške ako Storage nije aktivan ili fajlovi ne postoje).
      if (run.pdfPaths) {
        const basePath = `payroll/${run.year}/${run.periodFrom}_${run.periodTo}`;
        const names = ["rekapitulacija", ...(run.results || []).map((r) => r.employeeId)];
        for (const n of names) {
          try {
            await deleteObject(ref(storage, `${basePath}/${n}.pdf`));
          } catch (e) {
            /* ignoriši — fajl možda ne postoji ili Storage nije aktivan */
          }
        }
      }
    } catch (e) {
      console.error(e);
      window.alert("Greška prilikom brisanja. Pokušaj ponovo.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div style={styles.fieldRow}>
        <label style={styles.label}>Godina</label>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={styles.input}>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {!loaded ? (
        <p style={styles.emptyLine}>Učitavanje…</p>
      ) : filtered.length === 0 ? (
        <p style={styles.emptyLine}>Nema sačuvanih obračuna za {year}.</p>
      ) : (
        filtered.map((run) => (
          <div key={run.id} style={styles.historyCard}>
            <div style={styles.historyRow}>
              <div>
                <div style={styles.historyLabel}>{run.label}</div>
                <div style={styles.historyMeta}>
                  Status:{" "}
                  <span style={run.status === "closed" ? styles.statusClosed : run.status === "void" ? styles.statusVoid : styles.statusDraft}>
                    {STATUS_LABELS[run.status] || run.status}
                  </span>
                  {run.createdAt?.toDate && <span> · Datum: {formatDateSr(run.createdAt.toDate())}</span>}
                </div>
              </div>
              <div style={styles.historyActions}>
                <button style={styles.historyBtn} onClick={() => setExpandedId(expandedId === run.id ? null : run.id)}>
                  <Eye size={14} /> Pregled
                </button>
                {run.pdfPaths?.rekapitulacija && (
                  <a style={styles.historyBtn} href={run.pdfPaths.rekapitulacija} target="_blank" rel="noreferrer">
                    <FileDown size={14} /> PDF
                  </a>
                )}
                {run.status === "closed" && (
                  <button style={styles.historyBtnDanger} onClick={() => handleVoid(run)} disabled={voidingId === run.id}>
                    <Ban size={14} /> Storniraj
                  </button>
                )}
                <button
                  style={styles.historyBtnDanger}
                  onClick={() => setConfirmDeleteRun(run)}
                  disabled={deletingId === run.id}
                >
                  <Trash2 size={14} /> {deletingId === run.id ? "Brišem…" : "Obriši"}
                </button>
              </div>
            </div>

            {expandedId === run.id && (
              <div style={styles.historyExpanded}>
                {(run.results || []).map((r) => (
                  <EmployeeCard key={r.employeeId} result={r} run={run} />
                ))}
                {run.recap && <RecapCard recap={run.recap} results={run.results} run={run} />}
                {run.pdfPaths &&
                  (run.results || []).map((r) => (
                    <a key={r.employeeId} style={styles.pdfLink} href={run.pdfPaths[r.employeeId]} target="_blank" rel="noreferrer">
                      <FileDown size={14} /> {r.name}.pdf
                    </a>
                  ))}
              </div>
            )}
          </div>
        ))
      )}

      {confirmDeleteRun && (
        <div style={styles.modalOverlay} onClick={() => setConfirmDeleteRun(null)}>
          <div style={styles.confirmCard} onClick={(e) => e.stopPropagation()}>
            <AlertTriangle size={26} color="#A13A3A" />
            <p style={styles.confirmText}>
              Da li si sigurna da želiš da trajno obrišeš obračun <strong>"{confirmDeleteRun.label}"</strong>?
              Ova akcija se ne može opozvati.
            </p>
            <div style={styles.confirmBtnRow}>
              <button style={styles.cancelBtn} onClick={() => setConfirmDeleteRun(null)}>Otkaži</button>
              <button
                style={styles.finalizeBtnSmall}
                onClick={() => {
                  setPinModalRun(confirmDeleteRun);
                  setConfirmDeleteRun(null);
                }}
              >
                Da, obriši
              </button>
            </div>
          </div>
        </div>
      )}

      {pinModalRun && (
        <PinConfirmModal onCancel={() => setPinModalRun(null)} onCorrect={handleDeleteConfirmed} />
      )}
    </div>
  );
}

function PinConfirmModal({ onCancel, onCorrect }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  const handleChange = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, APP_PIN.length);
    setPin(digits);
    setError(false);
    if (digits.length === APP_PIN.length) {
      if (digits === APP_PIN) {
        onCorrect();
      } else {
        setError(true);
        setTimeout(() => setPin(""), 400);
      }
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onCancel}>
      <div style={styles.confirmCard} onClick={(e) => e.stopPropagation()}>
        <Lock size={24} color="#A13A3A" />
        <p style={styles.confirmText}>Za potvrdu brisanja, unesi PIN kod aplikacije.</p>
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          autoFocus
          maxLength={APP_PIN.length}
          value={pin}
          onChange={handleChange}
          style={styles.pinConfirmInput}
        />
        {error && <p style={styles.loginError}>Pogrešan PIN, pokušaj ponovo.</p>}
        <div style={styles.confirmBtnRow}>
          <button style={styles.cancelBtn} onClick={onCancel}>Otkaži</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                               */
/* ------------------------------------------------------------------ */

const FONT_DISPLAY = "'Fraunces', serif";
const FONT_BODY = "'Work Sans', sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

const styles = {
  wrap: { padding: "14px 18px 40px", fontFamily: FONT_BODY, color: "#2B1B1F" },
  topRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  backLink: { display: "flex", alignItems: "center", gap: 2, border: "none", background: "none", color: "#8A7368", fontSize: 12.5, fontWeight: 500, padding: 0 },
  logoutBtn: { display: "flex", alignItems: "center", gap: 6, border: "1px solid #E8DCC8", background: "#FFFDF9", color: "#5A473F", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 500 },
  titleRow: { display: "flex", alignItems: "center", gap: 8, margin: "6px 0 14px" },
  title: { fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 600 },

  tabRow: { display: "flex", gap: 4, marginBottom: 18, borderBottom: "1px solid #EFE3D0" },
  tabBtn: { flex: 1, padding: "9px 8px", border: "none", background: "transparent", color: "#8A7368", fontSize: 13, fontWeight: 500, borderBottom: "2px solid transparent" },
  tabBtnActive: { color: "#7A2E3D", borderBottom: "2px solid #7A2E3D", fontWeight: 600 },

  section: { marginBottom: 20 },
  sectionTitle: { fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 600, marginBottom: 10 },

  radioRow: { display: "flex", gap: 18, marginBottom: 12 },
  radioLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 13.5 },

  fieldRowHalf: { display: "flex", gap: 12 },
  fieldRow: { marginBottom: 12, flex: 1 },
  label: { display: "block", fontSize: 12, color: "#8A7368", marginBottom: 5, fontWeight: 500 },
  input: { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #E8DCC8", background: "#FFFDF9", fontSize: 13.5, color: "#2B1B1F" },
  dateFieldWrap: { position: "relative", flex: 1 },
  dateFieldNative: { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", border: "none", padding: 0, pointerEvents: "none" },
  dateFieldDisplay: {
    width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #E8DCC8",
    background: "#FFFDF9", fontSize: 13.5, color: "#2B1B1F", boxSizing: "border-box",
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, pointerEvents: "none",
  },
  dateFieldDisplayDisabled: { color: "#B4A296", background: "#F5EFE4" },
  periodPreview: { fontFamily: FONT_MONO, fontSize: 13, color: "#7A2E3D", fontWeight: 600, marginTop: 4 },

  paramRow: { display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid #F2E9DB" },
  paramDot: { width: 9, height: 9, borderRadius: "50%", flexShrink: 0 },
  paramName: { fontSize: 13.5, fontWeight: 600, minWidth: 60 },
  paramLabel: { fontSize: 12, color: "#8A7368", flex: 1 },
  paramInput: { width: 60, padding: "7px 8px", borderRadius: 6, border: "1px solid #E8DCC8", background: "#FFFDF9", fontSize: 13, textAlign: "center" },
  paramPercentSign: { fontSize: 12.5, color: "#8A7368" },
  paramHint: { fontSize: 11.5, color: "#B4A296", marginTop: 8, lineHeight: 1.5 },

  calcBtn: { width: "100%", border: "none", background: "#7A2E3D", color: "#FBF6EE", borderRadius: 10, padding: "13px", fontSize: 14, fontWeight: 600, marginBottom: 16 },
  draftBadge: { fontSize: 12, color: "#8A6216", background: "#FBF3E4", border: "1px solid #E8D2A0", borderRadius: 8, padding: "8px 12px", marginBottom: 16 },
  closedBadge: { fontSize: 12, color: "#3E6B52", background: "#EAF3EC", border: "1px solid #BEDCC9", borderRadius: 8, padding: "8px 12px", marginBottom: 16 },

  empCard: { background: "#FFFDF9", border: "1px solid #EFE3D0", borderRadius: 12, padding: "14px", marginBottom: 14 },
  empCardHeader: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  empCardName: { fontSize: 14.5, fontWeight: 700, flex: 1 },
  empCardType: { fontSize: 11, color: "#8A7368", background: "#F2E9DB", padding: "3px 9px", borderRadius: 10 },
  empCardStats: { display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 },

  statBox: { minWidth: 90 },
  statValue: { fontFamily: FONT_MONO, fontSize: 14, fontWeight: 600 },
  statValueHighlight: { color: "#7A2E3D" },
  statValueBig: { fontSize: 19 },
  statLabel: { fontSize: 10.5, color: "#8A7368", marginTop: 2 },

  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #E8DCC8", color: "#8A7368", fontWeight: 600, fontSize: 11, whiteSpace: "nowrap" },
  thRight: { textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #E8DCC8", color: "#8A7368", fontWeight: 600, fontSize: 11, whiteSpace: "nowrap" },
  td: { padding: "6px 8px", borderBottom: "1px solid #F2E9DB", whiteSpace: "nowrap" },
  tdRight: { padding: "6px 8px", borderBottom: "1px solid #F2E9DB", textAlign: "right", fontFamily: FONT_MONO, whiteSpace: "nowrap" },
  emptyLine: { fontSize: 12.5, color: "#8A7368", padding: "10px 0" },

  recapCard: { background: "#FFFDF9", border: "1px solid #EFE3D0", borderRadius: 12, padding: "16px" },
  recapDivider: { height: 1, background: "#F2E9DB", margin: "10px 0" },
  recapRow: { display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0" },
  recapValue: { fontFamily: FONT_MONO },
  recapRowFinal: { display: "flex", justifyContent: "space-between", fontSize: 15.5, fontWeight: 700, color: "#7A2E3D", padding: "4px 0" },
  recapValueFinal: { fontFamily: FONT_MONO, fontSize: 16 },
  downloadPdfBtn: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%",
    marginTop: 14, border: "1px solid #E8DCC8", background: "#FBF6EE", color: "#7A2E3D",
    borderRadius: 8, padding: "9px 14px", fontSize: 12.5, fontWeight: 600,
  },

  finalizeBtn: { width: "100%", border: "none", background: "#A13A3A", color: "#FBF6EE", borderRadius: 10, padding: "13px", fontSize: 14, fontWeight: 600, marginTop: 6 },
  finalizeBtnSmall: { border: "none", background: "#A13A3A", color: "#FBF6EE", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 },
  cancelBtn: { border: "1px solid #E8DCC8", background: "#FFFDF9", color: "#5A473F", borderRadius: 8, padding: "10px 16px", fontSize: 13, fontWeight: 500 },

  pdfLinksBox: { background: "#EAF3EC", border: "1px solid #BEDCC9", borderRadius: 10, padding: "12px 14px", marginTop: 8, display: "flex", flexDirection: "column", gap: 6 },
  pdfLinksTitle: { fontSize: 12.5, fontWeight: 600, color: "#3E6B52", marginBottom: 2 },
  pdfLink: { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#3E6B52", textDecoration: "underline" },
  pdfWarnBox: { background: "#FBF3E4", border: "1px solid #E8D2A0", borderRadius: 10, padding: "12px 14px", marginTop: 8, display: "flex", gap: 10, alignItems: "flex-start" },
  pdfWarnText: { fontSize: 12, color: "#6B5416", lineHeight: 1.6, margin: 0 },

  modalOverlay: { position: "fixed", inset: 0, background: "rgba(43,27,31,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30, padding: 20 },
  confirmCard: { background: "#FBF6EE", borderRadius: 14, padding: "24px 20px", maxWidth: 380, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" },
  confirmText: { fontSize: 13.5, color: "#3E2E28", lineHeight: 1.6 },
  confirmBtnRow: { display: "flex", gap: 10, marginTop: 4 },
  loginError: { color: "#A13A3A", fontSize: 12.5 },
  pinConfirmInput: {
    width: 160, padding: "10px 12px", borderRadius: 8, border: "1px solid #E8DCC8",
    background: "#FFFDF9", fontSize: 20, letterSpacing: 8, textAlign: "center", fontFamily: "'JetBrains Mono', monospace",
  },

  historyCard: { background: "#FFFDF9", border: "1px solid #EFE3D0", borderRadius: 12, padding: "12px 14px", marginBottom: 10 },
  historyRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 },
  historyLabel: { fontSize: 14.5, fontWeight: 700 },
  historyMeta: { fontSize: 11.5, color: "#8A7368", marginTop: 2 },
  historyActions: { display: "flex", gap: 6, flexWrap: "wrap" },
  historyBtn: { display: "flex", alignItems: "center", gap: 5, border: "1px solid #E8DCC8", background: "#FBF6EE", color: "#5A473F", borderRadius: 7, padding: "6px 10px", fontSize: 11.5, fontWeight: 500, textDecoration: "none" },
  historyBtnDanger: { display: "flex", alignItems: "center", gap: 5, border: "1px solid #E3B8B8", background: "#FDF3F3", color: "#A13A3A", borderRadius: 7, padding: "6px 10px", fontSize: 11.5, fontWeight: 500 },
  historyExpanded: { marginTop: 12, paddingTop: 12, borderTop: "1px dashed #E8DCC8" },

  statusClosed: { color: "#3E6B52", fontWeight: 600 },
  statusVoid: { color: "#A13A3A", fontWeight: 600, textDecoration: "line-through" },
  statusDraft: { color: "#8A6216", fontWeight: 600 },
};
