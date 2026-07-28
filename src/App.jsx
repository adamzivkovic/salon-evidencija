import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, getDocs, writeBatch,
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { db, auth } from "./firebase";
import PayrollView from "./payroll/PayrollView.jsx";
import * as XLSX from "xlsx";
import PinGate from "./PinGate.jsx";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Plus, X, ChevronLeft, ChevronRight, Scissors, Trash2,
  CalendarDays, BarChart3, Banknote, Users, Download, Upload, Pencil, Lock, LogOut,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

// Koristi se samo jednom, da se Firebase baza zaposlenih popuni pri prvom pokretanju.
// Posle toga se sve čuva u Firestore kolekciji "employees" (uređivanje UI dolazi kasnije).
const SEED_EMPLOYEES = [
  { id: "ivana", name: "Ivana", color: "#7A2E3D", calcType: "material_deduction", defaultPercentage: 30, order: 0 },
  { id: "tamara", name: "Tamara", color: "#C4914B", calcType: "material_deduction", defaultPercentage: 30, order: 1 },
  { id: "bilja", name: "Bilja", color: "#4A7A6B", calcType: "commission", defaultPercentage: 40, order: 2 },
];

// Redosled prikaza zaposlenih: prvo po "order" polju (ako postoji), a za već
// postojeće zapise iz baze koji ga još nemaju, po ovoj rezervnoj listi imena —
// tako se redosled ne menja nasumično bez potrebe da se ručno dira baza.
const EMPLOYEE_NAME_ORDER_FALLBACK = { Ivana: 0, Tamara: 1, Bilja: 2 };
function employeeSortKey(emp) {
  if (typeof emp.order === "number") return emp.order;
  if (emp.name in EMPLOYEE_NAME_ORDER_FALLBACK) return EMPLOYEE_NAME_ORDER_FALLBACK[emp.name];
  return 99;
}

// Koristi se samo jednom, da se Firebase baza usluga popuni pri prvom pokretanju.
// Posle toga se sve menja kroz "Uredi usluge" u aplikaciji, ne ovde u kodu.
const SEED_SERVICES = [
  // Šišanje
  { name: "Šišanje žensko", duration: 45 },
  { name: "Muško šišanje sa pranjem", duration: 30 },
  { name: "Muško šišanje bez pranja", duration: 20 },
  { name: "Sređivanje brade", duration: 15 },
  // Feniranje
  { name: "Feniranje kratka", duration: 20 },
  { name: "Feniranje srednja", duration: 30 },
  { name: "Feniranje duga", duration: 40 },
  { name: "Feniranje extra duga", duration: 50 },
  // Farbanje
  { name: "Farbanje izrastak do 1cm", duration: 60 },
  { name: "Farbanje cela kosa (kratka)", duration: 90 },
  { name: "Farbanje cela kosa (paz)", duration: 120 },
  { name: "Farbanje cela kosa (duga)", duration: 150 },
  // Pramenovi (klasični)
  { name: "Pramenovi kratka (gornji deo)", duration: 90 },
  { name: "Pramenovi do brade", duration: 120 },
  { name: "Pramenovi do ramena", duration: 150 },
  { name: "Pramenovi srednja", duration: 180 },
  { name: "Pramenovi duga", duration: 210 },
  { name: "Pramenovi pola glave", duration: 150 },
];

const DAY_NAMES = ["Nedelja", "Ponedeljak", "Utorak", "Sreda", "Četvrtak", "Petak", "Subota"];
const DAY_NAMES_SHORT_MON_FIRST = ["Pon", "Uto", "Sre", "Čet", "Pet", "Sub", "Ned"];
const MONTH_NAMES = [
  "januar", "februar", "mart", "april", "maj", "jun",
  "jul", "avgust", "septembar", "oktobar", "novembar", "decembar",
];

const COLLECTION_APPOINTMENTS = "appointments";
const COLLECTION_CLIENTS = "clients";
const COLLECTION_SERVICES = "services";
const COLLECTION_EMPLOYEES = "employees";

const WORK_START_HOUR = 10;
const WORK_END_HOUR = 20;
const TOTAL_SLOTS = (WORK_END_HOUR - WORK_START_HOUR) * 2; // 30-min slots
const ROW_HEIGHT = 34;
const TIMELINE_HEIGHT = TOTAL_SLOTS * ROW_HEIGHT;
const STAFF_HEADER_HEIGHT = 34;

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const pad2 = (n) => String(n).padStart(2, "0");

function dateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d, n) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}

function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function startOfWeek(d) {
  const nd = new Date(d);
  const day = nd.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(nd, diff);
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function displayDateLong(d) {
  return `${DAY_NAMES[d.getDay()]}, ${d.getDate()}. ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}.`;
}

function displayDateShort(d) {
  return `${d.getDate()}. ${MONTH_NAMES[d.getMonth()]}`;
}

function isSameDay(a, b) {
  return dateKey(a) === dateKey(b);
}

function isToday(d) {
  return isSameDay(d, new Date());
}

function isSameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function formatMoney(n) {
  if (n === null || n === undefined || n === "" || isNaN(n)) return "—";
  return `${Number(n).toLocaleString("sr-RS")} din`;
}

function formatDuration(min) {
  const m = Number(min);
  if (!m) return "";
  if (m < 60) return `${m} min`;
  if (m % 60 === 0) return `${m / 60} h`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function staffById(id, employees) {
  return employees.find((s) => s.id === id) || employees[0] || { id, name: "?", color: "#B4A296" };
}

function slotLabel(i) {
  const totalMin = i * 30;
  const h = WORK_START_HOUR + Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

// 10:00, 10:30, 11:00 ... 20:00 — za padajući meni u formi zakazivanja
const TIME_OPTIONS = Array.from({ length: TOTAL_SLOTS + 1 }, (_, i) => slotLabel(i));

function apptPosition(appt) {
  const [h, m] = (appt.time || `${WORK_START_HOUR}:00`).split(":").map(Number);
  let start = (h - WORK_START_HOUR) * 60 + (m || 0);
  start = Math.max(0, Math.min(TOTAL_SLOTS * 30, start));
  const dur = Number(appt.duration) || 30;
  let end = Math.max(start + 15, Math.min(TOTAL_SLOTS * 30, start + dur));
  return {
    top: (start / 30) * ROW_HEIGHT,
    height: Math.max(((end - start) / 30) * ROW_HEIGHT, 18),
  };
}

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function timeToMinutes(t) {
  const [h, m] = (t || "0:0").split(":").map(Number);
  return h * 60 + (m || 0);
}

// Da li se dati termin (radnik+datum+vreme+trajanje) vremenski preklapa sa
// nekim postojećim terminom istog radnika. Ne uzima u obzir blokirane
// termine drugih radnika niti prazne "pauze" — samo stvarne sudare.
function findOverlap(appointments, staffId, date, time, duration, excludeId) {
  if (!time) return null;
  const start = timeToMinutes(time);
  const end = start + (Number(duration) || 0);
  return (
    appointments.find((a) => {
      if (a.id === excludeId) return false;
      if (a.staff !== staffId || a.date !== date || !a.time) return false;
      const s2 = timeToMinutes(a.time);
      const e2 = s2 + (Number(a.duration) || 30);
      return start < e2 && s2 < end;
    }) || null
  );
}

/* ------------------------------------------------------------------ */
/* Root component                                                     */
/* ------------------------------------------------------------------ */

export default function SalonApp() {
  const [unlocked, setUnlocked] = useState(() => {
    try {
      return localStorage.getItem("salon-unlocked") === "true";
    } catch (e) {
      return false;
    }
  });
  const [appointments, setAppointments] = useState([]);
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const [view, setView] = useState("month"); // 'month' | 'day' | 'clients' | 'stats' | 'payroll'
  const [selectedDate, setSelectedDate] = useState(new Date());

  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [prefill, setPrefill] = useState(null); // { date, time, staff }

  /* ---- load (real-time) ---- */
  useEffect(() => {
    let apptsLoaded = false;
    let clientsLoaded = false;
    let servicesLoaded = false;
    let employeesLoaded = false;
    const checkLoaded = () => {
      if (apptsLoaded && clientsLoaded && servicesLoaded && employeesLoaded) setLoaded(true);
    };

    const unsubAppts = onSnapshot(
      collection(db, COLLECTION_APPOINTMENTS),
      (snap) => {
        setAppointments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setSaveError(false);
        apptsLoaded = true;
        checkLoaded();
      },
      (err) => {
        console.error(err);
        setSaveError(true);
        apptsLoaded = true;
        checkLoaded();
      }
    );

    const unsubClients = onSnapshot(
      collection(db, COLLECTION_CLIENTS),
      (snap) => {
        setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setSaveError(false);
        clientsLoaded = true;
        checkLoaded();
      },
      (err) => {
        console.error(err);
        setSaveError(true);
        clientsLoaded = true;
        checkLoaded();
      }
    );

    let seeded = false;
    const unsubServices = onSnapshot(
      collection(db, COLLECTION_SERVICES),
      (snap) => {
        if (snap.empty && !seeded) {
          // Prvi put — popuni bazu podrazumevanim uslugama. Posle ovoga se
          // sve menja isključivo kroz "Uredi usluge" u aplikaciji.
          seeded = true;
          SEED_SERVICES.forEach((s) => addDoc(collection(db, COLLECTION_SERVICES), s).catch(() => {}));
        } else {
          setServices(
            snap.docs
              .map((d) => ({ id: d.id, ...d.data() }))
              .sort((a, b) => a.name.localeCompare(b.name, "sr"))
          );
        }
        setSaveError(false);
        servicesLoaded = true;
        checkLoaded();
      },
      (err) => {
        console.error(err);
        setSaveError(true);
        servicesLoaded = true;
        checkLoaded();
      }
    );

    let employeesSeeded = false;
    const unsubEmployees = onSnapshot(
      collection(db, COLLECTION_EMPLOYEES),
      (snap) => {
        if (snap.empty && !employeesSeeded) {
          // Prvi put — popuni bazu sa Ivana/Bilja/Tamara, sa istim ID-jevima
          // koje već koriste postojeći termini (appt.staff), da se ne izgubi veza.
          employeesSeeded = true;
          SEED_EMPLOYEES.forEach((e) => {
            const { id, ...rest } = e;
            setDoc(doc(db, COLLECTION_EMPLOYEES, id), rest).catch(() => {});
          });
        } else {
          setEmployees(
            snap.docs
              .map((d) => ({ id: d.id, ...d.data() }))
              .sort((a, b) => employeeSortKey(a) - employeeSortKey(b))
          );
        }
        setSaveError(false);
        employeesLoaded = true;
        checkLoaded();
      },
      (err) => {
        console.error(err);
        setSaveError(true);
        employeesLoaded = true;
        checkLoaded();
      }
    );

    return () => {
      unsubAppts();
      unsubClients();
      unsubServices();
      unsubEmployees();
    };
  }, []);

  /* ---- auth (za obračun zarada) ---- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthChecked(true);
    });
    return unsub;
  }, []);

  const handleLogin = async (email, password) => {
    setLoginError("");
    setLoginLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      setLoginOpen(false);
      setView("payroll");
    } catch (e) {
      setLoginError("Pogrešno korisničko ime ili šifra.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    signOut(auth);
    setView("stats");
  };

  const openPayroll = () => {
    if (user) setView("payroll");
    else setLoginOpen(true);
  };

  /* ---- appointment CRUD ---- */
  const addAppointment = (appt) => {
    addDoc(collection(db, COLLECTION_APPOINTMENTS), appt).catch((e) => {
      console.error(e);
      setSaveError(true);
    });
  };
  const updateAppointment = (id, patch) => {
    updateDoc(doc(db, COLLECTION_APPOINTMENTS, id), patch).catch((e) => {
      console.error(e);
      setSaveError(true);
    });
  };
  const deleteAppointment = (id) => {
    deleteDoc(doc(db, COLLECTION_APPOINTMENTS, id)).catch((e) => {
      console.error(e);
      setSaveError(true);
    });
  };

  /* ---- client CRUD ---- */
  const saveClient = useCallback(
    (id, name, phone, note) => {
      const trimmed = (name || "").trim();
      if (!trimmed) return;
      if (id) {
        updateDoc(doc(db, COLLECTION_CLIENTS, id), { name: trimmed, phone: phone || "", note: note || "" }).catch((e) => {
          console.error(e);
          setSaveError(true);
        });
        return;
      }
      const existing = clients.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
      if (existing) {
        updateDoc(doc(db, COLLECTION_CLIENTS, existing.id), { phone: phone || "", note: note || "" }).catch((e) => {
          console.error(e);
          setSaveError(true);
        });
      } else {
        addDoc(collection(db, COLLECTION_CLIENTS), { name: trimmed, phone: phone || "", note: note || "" }).catch((e) => {
          console.error(e);
          setSaveError(true);
        });
      }
    },
    [clients]
  );
  const deleteClient = (id) => {
    deleteDoc(doc(db, COLLECTION_CLIENTS, id)).catch((e) => {
      console.error(e);
      setSaveError(true);
    });
  };

  /* ---- service CRUD ---- */
  const addService = (name, duration) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    addDoc(collection(db, COLLECTION_SERVICES), { name: trimmed, duration: Number(duration) || 30 }).catch((e) => {
      console.error(e);
      setSaveError(true);
    });
  };
  const updateService = (id, patch) => {
    updateDoc(doc(db, COLLECTION_SERVICES, id), patch).catch((e) => {
      console.error(e);
      setSaveError(true);
    });
  };
  const deleteService = (id) => {
    deleteDoc(doc(db, COLLECTION_SERVICES, id)).catch((e) => {
      console.error(e);
      setSaveError(true);
    });
  };

  /* ---- bulk replace (used by backup import & reset) ---- */
  const replaceCollection = async (collectionName, items) => {
    const snap = await getDocs(collection(db, collectionName));
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    items.forEach((item) => {
      const { id, ...rest } = item;
      const ref = doc(collection(db, collectionName));
      batch.set(ref, rest);
    });
    await batch.commit();
  };

  const handleImportData = async (data) => {
    try {
      if (data.appointments !== undefined) await replaceCollection(COLLECTION_APPOINTMENTS, data.appointments);
      if (data.clients !== undefined) await replaceCollection(COLLECTION_CLIENTS, data.clients);
      setSaveError(false);
    } catch (e) {
      console.error(e);
      setSaveError(true);
    }
  };

  const editingAppt = editingId ? appointments.find((a) => a.id === editingId) : null;

  const openNewForm = (pre) => {
    setEditingId(null);
    setPrefill(pre || null);
    setFormOpen(true);
  };
  const openEditForm = (id) => {
    setEditingId(id);
    setPrefill(null);
    setFormOpen(true);
  };
  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setPrefill(null);
  };

  return (
    <>
      <GlobalStyle />
      {!unlocked ? (
        <PinGate
          onUnlock={() => {
            try {
              localStorage.setItem("salon-unlocked", "true");
            } catch (e) {}
            setUnlocked(true);
          }}
        />
      ) : (
      <div className="app-root" style={styles.appRoot}>
      <Header view={view} setView={setView} saveError={saveError} />

      {!loaded ? (
        <div style={styles.loadingWrap}>
          <div style={styles.loadingText}>Učitavanje evidencije…</div>
        </div>
      ) : view === "month" ? (
        <MonthView
          appointments={appointments}
          employees={employees}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          onSelectDay={(d) => {
            setSelectedDate(d);
            setView("day");
          }}
        />
      ) : view === "day" ? (
        <DayTimelineView
          appointments={appointments}
          employees={employees}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          onBack={() => setView("month")}
          onSlotClick={(staffId, time) =>
            openNewForm({ date: dateKey(selectedDate), time, staff: staffId })
          }
          onEditAppt={openEditForm}
        />
      ) : view === "clients" ? (
        <ClientsView clients={clients} onSave={saveClient} onDelete={deleteClient} />
      ) : view === "payroll" ? (
        <PayrollView
          appointments={appointments}
          employees={employees}
          user={user}
          onLogout={handleLogout}
          onBack={() => setView("stats")}
        />
      ) : (
        <StatsView
          appointments={appointments}
          employees={employees}
          clients={clients}
          onImportData={handleImportData}
          onOpenPayroll={openPayroll}
        />
      )}

      {loginOpen && (
        <LoginModal
          onClose={() => {
            setLoginOpen(false);
            setLoginError("");
          }}
          onLogin={handleLogin}
          error={loginError}
          loading={loginLoading}
        />
      )}

      {view === "day" && (
        <button style={styles.fab} onClick={() => openNewForm({ date: dateKey(selectedDate) })} aria-label="Dodaj zakazivanje">
          <Plus size={26} strokeWidth={2.5} color="#FBF6EE" />
        </button>
      )}

      {formOpen && (
        <ApptForm
          initial={editingAppt}
          prefill={prefill}
          defaultDate={selectedDate}
          appointments={appointments}
          employees={employees}
          services={services}
          onAddService={addService}
          onUpdateService={updateService}
          onDeleteService={deleteService}
          clients={clients}
          onSaveClientNote={(name, phone, note) => saveClient(null, name, phone, note)}
          onClose={closeForm}
          onSave={(data) => {
            const { linkToId, ...apptData } = data;
            if (editingAppt) {
              updateAppointment(editingAppt.id, apptData);
            } else {
              let groupId = null;
              if (linkToId) {
                const target = appointments.find((a) => a.id === linkToId);
                if (target) {
                  groupId = target.groupId || genId();
                  if (!target.groupId) updateAppointment(target.id, { groupId });
                }
              }
              addAppointment({ ...apptData, groupId });
            }
            closeForm();
          }}
          onDelete={
            editingAppt
              ? () => {
                  deleteAppointment(editingAppt.id);
                  closeForm();
                }
              : null
          }
        />
      )}
    </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

function Header({ view, setView, saveError }) {
  return (
    <div style={styles.header}>
      <div style={styles.headerTop}>
        <div style={styles.brandRow}>
          <Scissors size={20} color="#7A2E3D" strokeWidth={2} />
          <span style={styles.brandText}>Salon 2CATS · Evidencija</span>
        </div>
        {saveError && <span style={styles.saveError}>Čuvanje nije uspelo</span>}
      </div>
      <div style={styles.tabRow}>
        <button
          style={{ ...styles.tabBtn, ...(view === "month" || view === "day" ? styles.tabBtnActive : {}) }}
          onClick={() => setView("month")}
        >
          <CalendarDays size={16} />
          <span>Kalendar</span>
        </button>
        <button
          style={{ ...styles.tabBtn, ...(view === "clients" ? styles.tabBtnActive : {}) }}
          onClick={() => setView("clients")}
        >
          <Users size={16} />
          <span>Klijenti</span>
        </button>
        <button
          style={{ ...styles.tabBtn, ...(view === "stats" || view === "payroll" ? styles.tabBtnActive : {}) }}
          onClick={() => setView("stats")}
        >
          <BarChart3 size={16} />
          <span>Statistika</span>
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Month view                                                         */
/* ------------------------------------------------------------------ */

function MonthView({ appointments, employees, selectedDate, setSelectedDate, onSelectDay }) {
  const apptsByDay = useMemo(() => {
    const map = {};
    appointments.forEach((a) => {
      if (!map[a.date]) map[a.date] = [];
      map[a.date].push(a);
    });
    return map;
  }, [appointments]);

  const cells = useMemo(() => {
    const first = startOfMonth(selectedDate);
    const firstWeekday = (first.getDay() + 6) % 7; // 0 = Monday
    const daysInMonth = endOfMonth(selectedDate).getDate();
    const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    const arr = [];
    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - firstWeekday + 1;
      const d = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), dayNum);
      arr.push(d);
    }
    return arr;
  }, [selectedDate]);

  const monthLabel = `${MONTH_NAMES[selectedDate.getMonth()][0].toUpperCase()}${MONTH_NAMES[selectedDate.getMonth()].slice(1)} ${selectedDate.getFullYear()}.`;
  const notCurrentMonthReal = !isSameMonth(selectedDate, new Date());

  const touchStart = useRef(null);
  const handleTouchStart = (e) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const handleTouchEnd = (e) => {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      setSelectedDate((d) => addMonths(d, dx < 0 ? 1 : -1));
    }
  };

  return (
    <div style={styles.monthWrap} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <div style={styles.dateNav}>
        <button style={styles.navBtn} onClick={() => setSelectedDate((d) => addMonths(d, -1))} aria-label="Prethodni mesec">
          <ChevronLeft size={20} />
        </button>
        <div style={styles.dateNavCenter}>
          <div style={styles.monthTitle}>{monthLabel}</div>
          {notCurrentMonthReal && (
            <button style={styles.todayLink} onClick={() => setSelectedDate(new Date())}>
              Vrati se na tekući mesec
            </button>
          )}
        </div>
        <button style={styles.navBtn} onClick={() => setSelectedDate((d) => addMonths(d, 1))} aria-label="Sledeći mesec">
          <ChevronRight size={20} />
        </button>
      </div>

      <div style={styles.swipeHint}>Prevuci levo ili desno za promenu meseca</div>

      <div style={styles.weekdayRow}>
        {DAY_NAMES_SHORT_MON_FIRST.map((d) => (
          <div key={d} style={styles.weekdayCell}>{d}</div>
        ))}
      </div>

      <div style={styles.monthGrid}>
        {cells.map((d, i) => {
          const key = dateKey(d);
          const inMonth = isSameMonth(d, selectedDate);
          const today = isToday(d);
          const dayAppts = apptsByDay[key] || [];
          const staffPresent = employees.filter((s) => dayAppts.some((a) => a.staff === s.id));
          return (
            <button
              key={i}
              className="day-cell"
              onClick={() => onSelectDay(d)}
              style={{
                ...styles.dayCell,
                opacity: inMonth ? 1 : 0.32,
                ...(today ? styles.dayCellToday : {}),
              }}
            >
              <span style={{ ...styles.dayCellNum, ...(today ? styles.dayCellNumToday : {}) }}>{d.getDate()}</span>
              <span className="day-cell-name">{DAY_NAMES_SHORT_MON_FIRST[(d.getDay() + 6) % 7]}</span>
              <span style={styles.dayCellDots}>
                {staffPresent.slice(0, 3).map((s) => (
                  <span key={s.id} style={{ ...styles.dayDot, background: s.color }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Day timeline view                                                   */
/* ------------------------------------------------------------------ */

function DayTimelineView({
  appointments, employees, selectedDate, setSelectedDate, onBack, onSlotClick, onEditAppt,
}) {
  const [staffFilter, setStaffFilter] = useState("all");
  const key = dateKey(selectedDate);

  const dayAppts = useMemo(() => appointments.filter((a) => a.date === key), [appointments, key]);
  const dayTotal = dayAppts.reduce((sum, a) => sum + (a.blocked ? 0 : Number(a.price) || 0), 0);

  const columns = staffFilter === "all" ? employees : [staffById(staffFilter, employees)];
  const wide = columns.length === 1;

  return (
    <div style={styles.dayViewWrap}>
      <button style={styles.backLink} onClick={onBack}>
        <ChevronLeft size={15} />
        <span>{MONTH_NAMES[selectedDate.getMonth()]} {selectedDate.getFullYear()}.</span>
      </button>

      <div style={styles.dateNav}>
        <button style={styles.navBtn} onClick={() => setSelectedDate((d) => addDays(d, -1))} aria-label="Prethodni dan">
          <ChevronLeft size={20} />
        </button>
        <div style={styles.dateNavCenter}>
          <div style={styles.dateNavDate}>{displayDateLong(selectedDate)}</div>
          {!isToday(selectedDate) && (
            <button style={styles.todayLink} onClick={() => setSelectedDate(new Date())}>
              Vrati se na danas
            </button>
          )}
        </div>
        <button style={styles.navBtn} onClick={() => setSelectedDate((d) => addDays(d, 1))} aria-label="Sledeći dan">
          <ChevronRight size={20} />
        </button>
      </div>

      <div style={styles.ribbonRow}>
        <RibbonTab label="Svi" active={staffFilter === "all"} color="#8A7368" onClick={() => setStaffFilter("all")} />
        {employees.map((s) => (
          <RibbonTab key={s.id} label={s.name} active={staffFilter === s.id} color={s.color} onClick={() => setStaffFilter(s.id)} />
        ))}
      </div>

      <div style={styles.dayTotalRow}>
        <span style={styles.dayTotalLabel}>{dayAppts.length} {dayAppts.length === 1 ? "termin" : "termina"}</span>
        <span style={styles.dayTotalValue}>{formatMoney(dayTotal)}</span>
      </div>

      <div style={styles.timelineScrollWrap}>
        <div style={styles.timelineOuter}>
          <div style={styles.timeLabelCol}>
            <div style={styles.timeLabelColHeader} />
            {Array.from({ length: TOTAL_SLOTS + 1 }).map((_, i) => (
              <div
                key={i}
                style={{
                  ...styles.timeLabelLine,
                  top: STAFF_HEADER_HEIGHT + i * ROW_HEIGHT,
                  borderTop: i % 2 === 0 ? "1px solid #D9C4A8" : "1px dashed #E3D4BD",
                }}
              >
                <span style={styles.timeLabel}>{slotLabel(i)}</span>
              </div>
            ))}
          </div>
          {columns.map((staff) => (
            <StaffTimelineColumn
              key={staff.id}
              staff={staff}
              appts={dayAppts.filter((a) => a.staff === staff.id)}
              wide={wide}
              clickableHeader={staffFilter === "all"}
              onHeaderClick={() => setStaffFilter(staff.id)}
              onSlotClick={(time) => onSlotClick(staff.id, time)}
              onEditAppt={onEditAppt}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RibbonTab({ label, active, color, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...styles.ribbonTab,
        background: active ? color : "#FFFDF9",
        color: active ? "#FBF6EE" : "#5A473F",
        borderColor: color,
      }}
    >
      {label}
    </button>
  );
}

function StaffTimelineColumn({ staff, appts, wide, clickableHeader, onHeaderClick, onSlotClick, onEditAppt }) {
  const groupInfo = useMemo(() => {
    const byGroup = {};
    appts.forEach((a) => {
      if (!a.groupId) return;
      if (!byGroup[a.groupId]) byGroup[a.groupId] = [];
      byGroup[a.groupId].push(a);
    });
    Object.values(byGroup).forEach((group) => group.sort((a, b) => (a.time || "").localeCompare(b.time || "")));
    return byGroup;
  }, [appts]);

  const connectors = useMemo(() => {
    const gaps = [];
    Object.values(groupInfo).forEach((group) => {
      if (group.length < 2) return;
      for (let i = 0; i < group.length - 1; i++) {
        const posA = apptPosition(group[i]);
        const posB = apptPosition(group[i + 1]);
        const top = posA.top + posA.height;
        const height = posB.top - top;
        if (height > 6) gaps.push({ key: `${group[i].id}-${group[i + 1].id}`, top, height });
      }
    });
    return gaps;
  }, [groupInfo]);

  return (
    <div style={styles.staffCol}>
      {clickableHeader ? (
        <button
          style={{ ...styles.staffColHeader, ...styles.staffColHeaderBtn, background: staff.color }}
          onClick={onHeaderClick}
          aria-label={`Prikaži samo ${staff.name}`}
        >
          {staff.name}
        </button>
      ) : (
        <div style={{ ...styles.staffColHeader, background: staff.color }}>{staff.name}</div>
      )}
      <div style={styles.staffColBody}>
        {Array.from({ length: TOTAL_SLOTS }).map((_, i) => (
          <button
            key={i}
            onClick={() => onSlotClick(slotLabel(i))}
            style={{
              ...styles.slotBtn,
              top: i * ROW_HEIGHT,
              height: ROW_HEIGHT,
              borderTop: i % 2 === 0 ? "1px solid #D9C4A8" : "1px dashed #E3D4BD",
            }}
            aria-label={`Zakaži u ${slotLabel(i)}`}
          />
        ))}
        {connectors.map((c) => (
          <div key={c.key} style={{ ...styles.groupConnector, top: c.top, height: c.height }}>
            {c.height > 22 && <span style={styles.groupConnectorLabel}>pauza</span>}
          </div>
        ))}
        {appts.map((a) => {
          const pos = apptPosition(a);
          const blockHeight = Math.max(pos.height - 3, 16);
          const hasOwnPrice = a.price !== "" && a.price !== null && a.price !== undefined && !isNaN(a.price);

          const group = a.groupId ? groupInfo[a.groupId] : null;
          const groupTag = group && group.length > 1 ? ` (${group.findIndex((g) => g.id === a.id) + 1}/${group.length})` : "";
          const siblingHasPrice = group ? group.some((g) => g.id !== a.id && g.price !== "" && g.price !== null && g.price !== undefined && !isNaN(g.price)) : false;
          const priceText = hasOwnPrice ? formatMoney(a.price) : siblingHasPrice ? "Naplaćeno" : "Nije naplaćeno";

          // Koliko redova teksta stane u blok, zavisno od njegove visine (trajanja usluge).
          const showClient = blockHeight >= 46;
          const showPrice = blockHeight >= 30;

          return (
            <button
              key={a.id}
              onClick={() => onEditAppt(a.id)}
              style={{
                ...styles.apptBlock,
                top: pos.top,
                height: blockHeight,
                background: a.blocked ? undefined : staff.color,
                ...(a.blocked ? styles.apptBlockBlocked : {}),
              }}
            >
              {a.blocked ? (
                <>
                  <span style={styles.apptBlockService}>🚫 Blokirano</span>
                  {showClient && a.client && <span style={styles.apptBlockClient}>{a.client}</span>}
                </>
              ) : (
                <>
                  <span style={styles.apptBlockService}>{a.groupId ? "🔗 " : ""}{a.service}{groupTag}</span>
                  {showClient && a.client && <span style={styles.apptBlockClient}>{a.client}</span>}
                  {showPrice && <span style={styles.apptBlockPrice}>{priceText}</span>}
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Appointment form (modal)                                            */
/* ------------------------------------------------------------------ */

function ApptForm({
  initial, prefill, defaultDate, appointments, employees, services, onAddService, onUpdateService, onDeleteService,
  clients, onSaveClientNote, onClose, onSave, onDelete,
}) {
  const [date, setDate] = useState(initial?.date || prefill?.date || dateKey(defaultDate));
  const [time, setTime] = useState(initial?.time || prefill?.time || "");
  const [useCustomTime, setUseCustomTime] = useState(
    initial ? !TIME_OPTIONS.includes(initial.time) : prefill ? !TIME_OPTIONS.includes(prefill.time) : false
  );
  const [staff, setStaff] = useState(initial?.staff || prefill?.staff || employees[0]?.id || "ivana");
  const isKnownService = (name) => services.some((s) => s.name === name);
  const [service, setService] = useState(
    !initial || isKnownService(initial.service) ? initial?.service || services[0]?.name || "" : services[0]?.name || ""
  );
  const [customService, setCustomService] = useState(
    initial && !isKnownService(initial.service) ? initial.service : ""
  );
  const [useCustom, setUseCustom] = useState(initial ? !isKnownService(initial.service) : false);
  const [manageOpen, setManageOpen] = useState(false);
  const [client, setClient] = useState(initial?.client || "");
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [price, setPrice] = useState(
    initial && initial.price !== undefined && initial.price !== null && initial.price !== "" ? String(initial.price) : ""
  );
  const [duration, setDuration] = useState(
    initial?.duration ?? services.find((s) => s.name === (initial?.service || service))?.duration ?? 30
  );
  const [blocked, setBlocked] = useState(initial?.blocked || false);
  const [isContinuation, setIsContinuation] = useState(false);
  const [linkToId, setLinkToId] = useState("");

  const canSave = date && (blocked || (useCustom ? customService.trim() : service));

  const matchedClient = useMemo(() => {
    const name = client.trim().toLowerCase();
    if (!name) return null;
    return clients.find((c) => c.name.toLowerCase() === name) || null;
  }, [client, clients]);

  // Termini istog radnika, istog dana, koji bi mogli biti "prvi deo" ove usluge
  // (npr. nanošenje boje pre pauze) — nudi se samo pri kreiranju novog termina.
  const linkCandidates = useMemo(() => {
    if (initial) return [];
    return appointments
      .filter((a) => a.staff === staff && a.date === date && !a.blocked)
      .slice()
      .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  }, [appointments, staff, date, initial]);

  const overlap = useMemo(
    () => findOverlap(appointments, staff, date, time, duration, initial?.id),
    [appointments, staff, date, time, duration, initial]
  );

  const handleServiceChange = (name) => {
    setService(name);
    const match = services.find((s) => s.name === name);
    if (match) setDuration(match.duration);
  };

  const handleClientChange = (val) => {
    setClient(val);
    setEditingNote(false);
  };

  const handleSaveNote = () => {
    onSaveClientNote(client.trim(), phoneDraft, noteDraft);
    setEditingNote(false);
  };

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      date,
      time,
      staff,
      service: blocked ? "Blokirano" : useCustom ? customService.trim() : service,
      client: client.trim(),
      price: blocked ? "" : price === "" ? "" : Number(price),
      duration: Number(duration) || 30,
      blocked,
      linkToId: isContinuation && linkToId ? linkToId : null,
    });
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>{initial ? "Izmeni zakazivanje" : "Novo zakazivanje"}</span>
          <button style={styles.iconBtn} onClick={onClose} aria-label="Zatvori">
            <X size={20} />
          </button>
        </div>

        <div style={styles.modalBody}>
          <div style={styles.fieldRowHalf}>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Datum</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={styles.input} />
            </div>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Vreme</label>
              {!useCustomTime ? (
                <select value={time} onChange={(e) => setTime(e.target.value)} style={styles.input}>
                  <option value="">Izaberi…</option>
                  {TIME_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              ) : (
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={styles.input} />
              )}
              <button style={styles.linkToggle} onClick={() => setUseCustomTime((v) => !v)}>
                {useCustomTime ? "Izaberi sa liste" : "Unesi ručno"}
              </button>
            </div>
          </div>

          {overlap && (
            <p style={styles.overlapWarning}>
              ⚠️ Preklapa se sa terminom: {overlap.blocked ? "Blokirano" : overlap.service} u {overlap.time}
              {overlap.client ? ` (${overlap.client})` : ""}. Ako je ovo namerno (npr. nastavak iste
              usluge), koristi opciju "Nastavak ranijeg termina" ispod.
            </p>
          )}

          <div style={styles.fieldRow}>
            <label style={styles.label}>Radi kod</label>
            <div style={styles.staffChoiceRow}>
              {employees.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStaff(s.id)}
                  style={{
                    ...styles.staffChoiceBtn,
                    background: staff === s.id ? s.color : "#FFFDF9",
                    color: staff === s.id ? "#FBF6EE" : "#5A473F",
                    borderColor: s.color,
                  }}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          <div style={styles.fieldRow}>
            <label style={styles.blockedCheckRow}>
              <input type="checkbox" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} />
              <span>🚫 Blokiran termin (nedostupno za zakazivanje)</span>
            </label>
          </div>

          {!initial && !blocked && linkCandidates.length > 0 && (
            <div style={styles.fieldRow}>
              <label style={styles.blockedCheckRow}>
                <input
                  type="checkbox"
                  checked={isContinuation}
                  onChange={(e) => {
                    setIsContinuation(e.target.checked);
                    if (!e.target.checked) setLinkToId("");
                  }}
                />
                <span>🔗 Nastavak ranijeg termina (npr. posle pauze)</span>
              </label>
              {isContinuation && (
                <select value={linkToId} onChange={(e) => setLinkToId(e.target.value)} style={{ ...styles.input, marginTop: 8 }}>
                  <option value="">Izaberi termin na koji se nastavlja…</option>
                  {linkCandidates.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.time} — {a.service}{a.client ? ` (${a.client})` : ""}
                    </option>
                  ))}
                </select>
              )}
              <p style={styles.linkHint}>
                Poveži ovaj termin sa ranijim da bi se na vremenskoj osi prikazali kao jedna
                povezana usluga sa pauzom — a taj slobodan prostor između njih i dalje može da se
                zakaže za nekog drugog.
              </p>
            </div>
          )}

          {!blocked && (
          <div style={styles.fieldRow}>
            <label style={styles.label}>Usluga</label>
            {!useCustom ? (
              <div style={styles.serviceSelectRow}>
                <select value={service} onChange={(e) => handleServiceChange(e.target.value)} style={{ ...styles.input, flex: 1 }}>
                  {services.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name} · {formatDuration(s.duration)}
                    </option>
                  ))}
                </select>
                <button style={styles.editServicesBtn} onClick={() => setManageOpen(true)} aria-label="Uredi usluge" title="Uredi usluge">
                  <Pencil size={16} />
                </button>
              </div>
            ) : (
              <input
                type="text"
                value={customService}
                onChange={(e) => setCustomService(e.target.value)}
                placeholder="Upiši uslugu"
                style={styles.input}
              />
            )}
            <button style={styles.linkToggle} onClick={() => setUseCustom((v) => !v)}>
              {useCustom ? "Izaberi sa liste" : "Nema na listi — upiši drugu uslugu"}
            </button>
          </div>
          )}

          <div style={styles.fieldRowHalf}>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Trajanje (min)</label>
              <input
                type="number"
                min="5"
                step="10"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                style={styles.input}
              />
            </div>
            {!blocked && (
            <div style={styles.fieldRow}>
              <label style={styles.label}>Naplaćeno (din)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Upiši kad se naplati"
                style={styles.input}
              />
            </div>
            )}
          </div>

          <div style={styles.fieldRow}>
            <label style={styles.label}>{blocked ? "Napomena (opciono)" : "Klijent (opciono)"}</label>
            <input
              type="text"
              list={blocked ? undefined : "clients-datalist"}
              value={client}
              onChange={(e) => handleClientChange(e.target.value)}
              placeholder={blocked ? "npr. godišnji odmor, pauza…" : "Ime klijenta"}
              style={styles.input}
            />
            {!blocked && (
            <datalist id="clients-datalist">
              {clients.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
            )}

            {!blocked && client.trim() && !editingNote && (
              <div style={styles.clientNoteBox}>
                {matchedClient?.phone && <p style={styles.clientPhoneText}>{matchedClient.phone}</p>}
                {matchedClient ? (
                  matchedClient.note ? (
                    <p style={styles.clientNoteText}>{matchedClient.note}</p>
                  ) : (
                    <p style={styles.clientNoteTextMuted}>Nema sačuvane recepture.</p>
                  )
                ) : (
                  <p style={styles.clientNoteTextMuted}>Novi klijent — nema još recepturu.</p>
                )}
                <button
                  style={styles.linkToggle}
                  onClick={() => {
                    setNoteDraft(matchedClient?.note || "");
                    setPhoneDraft(matchedClient?.phone || "");
                    setEditingNote(true);
                  }}
                >
                  {matchedClient ? "Izmeni podatke" : "Dodaj telefon / recepturu"}
                </button>
              </div>
            )}

            {!blocked && client.trim() && editingNote && (
              <div style={styles.clientNoteBox}>
                <input
                  type="tel"
                  value={phoneDraft}
                  onChange={(e) => setPhoneDraft(e.target.value)}
                  placeholder="Broj telefona (opciono)"
                  style={{ ...styles.input, marginBottom: 8 }}
                />
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="npr. boja 6.0 + 20 vol oksidant, 35 min"
                  style={styles.textarea}
                  rows={3}
                />
                <div style={styles.clientNoteBtnRow}>
                  <button style={styles.saveBtnSmall} onClick={handleSaveNote}>Sačuvaj</button>
                  <button style={styles.cancelBtnSmall} onClick={() => setEditingNote(false)}>Otkaži</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={styles.modalFooter}>
          {onDelete && (
            <button style={styles.deleteBtn} onClick={onDelete}>
              <Trash2 size={16} />
              <span>Obriši</span>
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button style={styles.cancelBtn} onClick={onClose}>Otkaži</button>
          <button style={{ ...styles.saveBtn, opacity: canSave ? 1 : 0.5 }} onClick={handleSave} disabled={!canSave}>
            Sačuvaj
          </button>
        </div>
      </div>

      {manageOpen && (
        <ServicesManager
          services={services}
          onAdd={onAddService}
          onUpdate={onUpdateService}
          onDelete={onDeleteService}
          onClose={() => setManageOpen(false)}
        />
      )}
    </div>
  );
}

function ServicesManager({ services, onAdd, onUpdate, onDelete, onClose }) {
  const [newName, setNewName] = useState("");
  const [newDuration, setNewDuration] = useState(30);

  const sorted = useMemo(() => [...services].sort((a, b) => a.name.localeCompare(b.name, "sr")), [services]);

  const handleAdd = () => {
    if (!newName.trim()) return;
    onAdd(newName.trim(), newDuration);
    setNewName("");
    setNewDuration(30);
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>Uredi usluge</span>
          <button style={styles.iconBtn} onClick={onClose} aria-label="Zatvori">
            <X size={20} />
          </button>
        </div>
        <div style={styles.modalBody}>
          <p style={styles.manageHint}>
            Ovde menjaš spisak usluga i njihovo podrazumevano trajanje koje se nudi pri zakazivanju.
          </p>
          {sorted.map((s) => (
            <ServiceRow key={s.id} service={s} onUpdate={onUpdate} onDelete={onDelete} />
          ))}

          <div style={styles.addServiceRow}>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nova usluga"
              style={{ ...styles.input, flex: 1 }}
            />
            <input
              type="number"
              min="5"
              step="5"
              value={newDuration}
              onChange={(e) => setNewDuration(e.target.value)}
              style={styles.serviceDurationInput}
            />
            <button style={styles.editServicesBtn} onClick={handleAdd} aria-label="Dodaj uslugu">
              <Plus size={18} />
            </button>
          </div>
        </div>
        <div style={styles.modalFooter}>
          <div style={{ flex: 1 }} />
          <button style={styles.saveBtn} onClick={onClose}>Gotovo</button>
        </div>
      </div>
    </div>
  );
}

function ServiceRow({ service, onUpdate, onDelete }) {
  const [name, setName] = useState(service.name);
  const [duration, setDuration] = useState(service.duration);

  const commit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(service.name);
      return;
    }
    if (trimmed !== service.name || Number(duration) !== service.duration) {
      onUpdate(service.id, { name: trimmed, duration: Number(duration) || 30 });
    }
  };

  return (
    <div style={styles.serviceRowEdit}>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        style={{ ...styles.input, flex: 1 }}
      />
      <input
        type="number"
        min="5"
        step="5"
        value={duration}
        onChange={(e) => setDuration(e.target.value)}
        onBlur={commit}
        style={styles.serviceDurationInput}
      />
      <span style={styles.serviceDurationUnit}>min</span>
      <button style={styles.iconBtnDanger} onClick={() => onDelete(service.id)} aria-label="Obriši uslugu">
        <Trash2 size={16} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Clients view                                                        */
/* ------------------------------------------------------------------ */

function ClientsView({ clients, onSave, onDelete }) {
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = !q ? clients : clients.filter((c) => c.name.toLowerCase().includes(q));
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "sr"));
  }, [clients, search]);

  return (
    <div style={styles.clientsWrap}>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Pretraži klijente…"
        style={styles.input}
      />

      <div style={styles.clientsList}>
        {filtered.length === 0 ? (
          <div style={styles.emptyState}>
            <Users size={28} color="#C9BBAE" />
            <div style={styles.emptyStateText}>
              {clients.length === 0 ? "Još uvek nema unetih klijenata." : "Nema rezultata za pretragu."}
            </div>
            <div style={styles.emptyStateSub}>Dodirni + da dodaš klijenta.</div>
          </div>
        ) : (
          filtered.map((c) => (
            <button
              key={c.id}
              style={styles.clientRow}
              onClick={() => {
                setEditing(c);
                setFormOpen(true);
              }}
            >
              <div style={styles.clientRowName}>{c.name}</div>
              {c.phone && <div style={styles.clientRowPhone}>{c.phone}</div>}
              {c.note && <div style={styles.clientRowNote}>{c.note}</div>}
            </button>
          ))
        )}
      </div>

      <button
        style={styles.fab}
        onClick={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        aria-label="Dodaj klijenta"
      >
        <Plus size={26} strokeWidth={2.5} color="#FBF6EE" />
      </button>

      {formOpen && (
        <ClientForm
          initial={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSave={(name, phone, note) => {
            onSave(editing ? editing.id : null, name, phone, note);
            setFormOpen(false);
            setEditing(null);
          }}
          onDelete={
            editing
              ? () => {
                  onDelete(editing.id);
                  setFormOpen(false);
                  setEditing(null);
                }
              : null
          }
        />
      )}
    </div>
  );
}

function ClientForm({ initial, onClose, onSave, onDelete }) {
  const [name, setName] = useState(initial?.name || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [note, setNote] = useState(initial?.note || "");

  const canSave = name.trim().length > 0;

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>{initial ? "Izmeni klijenta" : "Novi klijent"}</span>
          <button style={styles.iconBtn} onClick={onClose} aria-label="Zatvori">
            <X size={20} />
          </button>
        </div>

        <div style={styles.modalBody}>
          <div style={styles.fieldRow}>
            <label style={styles.label}>Ime i prezime</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ime klijenta"
              style={styles.input}
              autoFocus
            />
          </div>
          <div style={styles.fieldRow}>
            <label style={styles.label}>Broj telefona (opciono)</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="npr. 06X XXX XXXX"
              style={styles.input}
            />
          </div>
          <div style={styles.fieldRow}>
            <label style={styles.label}>Receptura / beleška</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="npr. boja 6.0 + 20 vol oksidant, 35 min"
              style={styles.textarea}
              rows={5}
            />
          </div>
        </div>

        <div style={styles.modalFooter}>
          {onDelete && (
            <button style={styles.deleteBtn} onClick={onDelete}>
              <Trash2 size={16} />
              <span>Obriši</span>
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button style={styles.cancelBtn} onClick={onClose}>Otkaži</button>
          <button style={{ ...styles.saveBtn, opacity: canSave ? 1 : 0.5 }} onClick={() => canSave && onSave(name, phone, note)} disabled={!canSave}>
            Sačuvaj
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
const PERIODS = [
  { id: "day", label: "Danas" },
  { id: "week", label: "Ova nedelja" },
  { id: "month", label: "Ovaj mesec" },
  { id: "all", label: "Sve vreme" },
  { id: "custom", label: "Period" },
];

/* ------------------------------------------------------------------ */
/* Login & payroll (obračun zarada)                                    */
/* ------------------------------------------------------------------ */

function LoginModal({ onClose, onLogin, error, loading }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit = email.trim() && password && !loading;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onLogin(email.trim(), password);
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>Prijava — Obračun zarada</span>
          <button style={styles.iconBtn} onClick={onClose} aria-label="Zatvori">
            <X size={20} />
          </button>
        </div>
        <div style={styles.modalBody}>
          <div style={styles.fieldRow}>
            <label style={styles.label}>Korisničko ime (email)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="npr. ivana@primer.com"
              style={styles.input}
              autoFocus
            />
          </div>
          <div style={styles.fieldRow}>
            <label style={styles.label}>Šifra</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              style={styles.input}
            />
          </div>
          {error && <p style={styles.loginError}>{error}</p>}
        </div>
        <div style={styles.modalFooter}>
          <div style={{ flex: 1 }} />
          <button style={styles.cancelBtn} onClick={onClose}>Otkaži</button>
          <button style={{ ...styles.saveBtn, opacity: canSubmit ? 1 : 0.5 }} onClick={handleSubmit} disabled={!canSubmit}>
            {loading ? "Prijavljivanje…" : "Prijavi se"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stats view                                                          */
/* ------------------------------------------------------------------ */

function StatsView({ appointments, employees, clients, onImportData, onOpenPayroll }) {
  const fileInputRef = useRef(null);
  const [period, setPeriod] = useState("month");
  const [customFrom, setCustomFrom] = useState(dateKey(startOfMonth(new Date())));
  const [customTo, setCustomTo] = useState(dateKey(new Date()));

  const range = useMemo(() => {
    const today = new Date();
    if (period === "day") return { from: today, to: today };
    if (period === "week") return { from: startOfWeek(today), to: addDays(startOfWeek(today), 6) };
    if (period === "month") return { from: startOfMonth(today), to: endOfMonth(today) };
    if (period === "custom") return { from: parseDateKey(customFrom), to: parseDateKey(customTo) };
    return null;
  }, [period, customFrom, customTo]);

  const filtered = useMemo(() => {
    if (!range) return appointments;
    const fromKey = dateKey(range.from);
    const toKey = dateKey(range.to);
    return appointments.filter((a) => a.date >= fromKey && a.date <= toKey);
  }, [appointments, range]);

  const paid = filtered.filter((a) => a.price !== "" && a.price !== null && a.price !== undefined && !isNaN(a.price));
  const totalRevenue = paid.reduce((s, a) => s + Number(a.price), 0);
  const avgPrice = paid.length ? Math.round(totalRevenue / paid.length) : 0;

  const staffStats = employees.map((s) => {
    const mine = paid.filter((a) => a.staff === s.id);
    return {
      name: s.name,
      total: mine.reduce((sum, a) => sum + Number(a.price), 0),
      count: mine.length,
      color: s.color,
    };
  });

  const serviceStatsMap = {};
  paid.forEach((a) => {
    if (!serviceStatsMap[a.service]) serviceStatsMap[a.service] = { name: a.service, total: 0, count: 0 };
    serviceStatsMap[a.service].total += Number(a.price);
    serviceStatsMap[a.service].count += 1;
  });
  const serviceStats = Object.values(serviceStatsMap).sort((a, b) => b.total - a.total);

  const handleExport = () => {
    const payload = { appointments, clients, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `salon-bekap-${dateKey(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = () => {
    const apptRows = appointments
      .slice()
      .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")))
      .map((a) => ({
        Datum: a.date,
        Vreme: a.time || "",
        Radnik: staffById(a.staff, employees).name,
        Usluga: a.service,
        "Trajanje (min)": a.duration || "",
        Klijent: a.client || "",
        "Naplaćeno (din)": a.price === "" || a.price === undefined || a.price === null ? "" : Number(a.price),
      }));
    const clientRows = clients
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "sr"))
      .map((c) => ({ Ime: c.name, Telefon: c.phone || "", Receptura: c.note || "" }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(apptRows), "Zakazivanja");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(clientRows), "Klijenti");
    XLSX.writeFile(wb, `salon-bekap-${dateKey(new Date())}.xlsx`);
  };

  const handleImportClick = () => fileInputRef.current && fileInputRef.current.click();

  const handleImportFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        let newAppointments, newClients, apptCount, clientCount;
        if (Array.isArray(parsed)) {
          // old backup format: appointments only
          newAppointments = parsed;
          newClients = clients;
          apptCount = parsed.length;
          clientCount = clients.length;
        } else {
          newAppointments = parsed.appointments !== undefined ? parsed.appointments : appointments;
          newClients = parsed.clients !== undefined ? parsed.clients : clients;
          apptCount = newAppointments.length;
          clientCount = newClients.length;
        }
        const ok = window.confirm(
          `Uvoz će zameniti trenutne podatke sa: ${apptCount} zakazivanja i ${clientCount} klijenata iz fajla. Nastaviti?`
        );
        if (ok) onImportData({ appointments: newAppointments, clients: newClients });
      } catch (err) {
        window.alert("Fajl nije validan bekap (očekivan je .json fajl izvezen iz ove aplikacije).");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  };

  const handleResetAll = () => {
    const ok = window.confirm(
      `Ovo će TRAJNO obrisati sve podatke iz aplikacije (${appointments.length} zakazivanja i ${clients.length} klijenata). Preporučujemo da prvo klikneš "Izvezi bekap" ako želiš da sačuvaš probne unose. Nastaviti sa brisanjem?`
    );
    if (ok) onImportData({ appointments: [], clients: [] });
  };

  return (
    <div style={styles.statsWrap}>
      <div style={styles.periodRow}>
        {PERIODS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            style={{ ...styles.periodBtn, ...(period === p.id ? styles.periodBtnActive : {}) }}
          >
            {p.label}
          </button>
        ))}
        <button style={styles.payrollBtn} onClick={onOpenPayroll}>
          <Lock size={13} />
          <span>Obračun</span>
        </button>
      </div>

      {period === "custom" && (
        <div style={styles.customRangeRow}>
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={styles.input} />
          <span style={styles.toLabel}>do</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={styles.input} />
        </div>
      )}

      <div style={styles.summaryCards}>
        <SummaryCard icon={<Banknote size={18} color="#7A2E3D" />} label="Ukupno naplaćeno" value={formatMoney(totalRevenue)} />
        <SummaryCard icon={<CalendarDays size={18} color="#7A2E3D" />} label="Broj termina" value={filtered.length} />
        <SummaryCard icon={<Users size={18} color="#7A2E3D" />} label="Prosečna cena" value={paid.length ? formatMoney(avgPrice) : "—"} />
      </div>

      <SectionTitle text="Po radniku" />
      <div style={styles.chartCard}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={staffStats} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E8DCC8" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: "#5A473F", fontSize: 12, fontFamily: "'Work Sans', sans-serif" }} axisLine={{ stroke: "#E8DCC8" }} tickLine={false} />
            <YAxis tick={{ fill: "#8A7368", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={54} />
            <Tooltip
              formatter={(value) => [formatMoney(value), "Naplaćeno"]}
              contentStyle={{ fontFamily: "'Work Sans', sans-serif", borderRadius: 8, border: "1px solid #E8DCC8" }}
            />
            <Bar dataKey="total" radius={[6, 6, 0, 0]}>
              {staffStats.map((s, i) => (
                <Cell key={i} fill={s.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={styles.staffStatsList}>
          {staffStats.map((s) => (
            <div key={s.name} style={styles.staffStatsRow}>
              <span style={{ ...styles.staffDot, background: s.color }} />
              <span style={styles.staffStatsName}>{s.name}</span>
              <span style={styles.staffStatsCount}>{s.count} {s.count === 1 ? "termin" : "termina"}</span>
              <span style={styles.staffStatsTotal}>{formatMoney(s.total)}</span>
            </div>
          ))}
        </div>
      </div>

      <SectionTitle text="Po usluzi" />
      <div style={styles.chartCard}>
        {serviceStats.length === 0 ? (
          <div style={styles.emptyStateSmall}>Nema naplaćenih usluga u ovom periodu.</div>
        ) : (
          <div style={styles.serviceList}>
            {serviceStats.map((s) => (
              <div key={s.name} style={styles.serviceRow}>
                <div style={styles.serviceRowTop}>
                  <span style={styles.serviceName}>{s.name}</span>
                  <span style={styles.serviceTotal}>{formatMoney(s.total)}</span>
                </div>
                <div style={styles.serviceBarTrack}>
                  <div style={{ ...styles.serviceBarFill, width: `${Math.max(4, (s.total / serviceStats[0].total) * 100)}%` }} />
                </div>
                <span style={styles.serviceCount}>{s.count} {s.count === 1 ? "put" : "puta"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <SectionTitle text="Bekap podataka" />
      <div style={styles.backupCard}>
        <p style={styles.backupText}>
          Preporučujemo da s vremena na vreme sačuvaš kopiju svih podataka (zakazivanja i klijenti) na telefon ili računar, za svaki slučaj.
        </p>
        <div style={styles.backupBtnRow}>
          <button style={styles.backupBtn} onClick={handleExport}>
            <Download size={15} />
            <span>Izvezi bekap (.json)</span>
          </button>
          <button style={styles.backupBtn} onClick={handleExportExcel}>
            <Download size={15} />
            <span>Izvezi u Excel (.xlsx)</span>
          </button>
          <button style={styles.backupBtn} onClick={handleImportClick}>
            <Upload size={15} />
            <span>Uvezi bekap</span>
          </button>
          <input ref={fileInputRef} type="file" accept="application/json" onChange={handleImportFile} style={{ display: "none" }} />
        </div>
        <div style={styles.resetZone}>
          <button style={styles.resetBtn} onClick={handleResetAll}>
            Obriši sve podatke (za kraj testiranja)
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value }) {
  return (
    <div style={styles.summaryCard}>
      {icon}
      <div style={styles.summaryValue}>{value}</div>
      <div style={styles.summaryLabel}>{label}</div>
    </div>
  );
}

function SectionTitle({ text }) {
  return <div style={styles.sectionTitle}>{text}</div>;
}

/* ------------------------------------------------------------------ */
/* Global style                                                        */
/* ------------------------------------------------------------------ */

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Work+Sans:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap');
      * { box-sizing: border-box; }
      html, body, #root { height: 100%; margin: 0; background: #FBF6EE; }
      button { font-family: inherit; cursor: pointer; }
      input, select { font-family: inherit; }
      input[type="date"]::-webkit-calendar-picker-indicator,
      input[type="time"]::-webkit-calendar-picker-indicator {
        filter: invert(28%) sepia(15%) saturate(1000%) hue-rotate(310deg);
      }

      .app-root { max-width: 560px; margin: 0 auto; min-height: 100vh; }
      .day-cell { aspect-ratio: 1; }
      .day-cell-name { display: none; }

      @media (min-width: 900px) {
        .app-root { max-width: 1100px; }
        .day-cell { aspect-ratio: 4 / 3; }
        .day-cell-name { display: block; font-size: 11px; color: #B4A296; margin-top: 2px; }
      }
    `}</style>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const FONT_DISPLAY = "'Fraunces', serif";
const FONT_BODY = "'Work Sans', sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

const styles = {
  appRoot: {
    fontFamily: FONT_BODY, background: "#FBF6EE", color: "#2B1B1F",
    position: "relative", paddingBottom: 90,
  },
  loadingWrap: { padding: 48, textAlign: "center" },
  loadingText: { color: "#8A7368", fontSize: 14 },

  header: {
    padding: "18px 18px 0", borderBottom: "1px solid #EFE3D0", position: "sticky", top: 0,
    background: "#FBF6EE", zIndex: 5,
  },
  headerTop: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 },
  brandRow: { display: "flex", alignItems: "center", gap: 8 },
  brandText: { fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 600, letterSpacing: 0.2 },
  saveError: { fontSize: 11, color: "#A13A3A" },
  tabRow: { display: "flex", gap: 4, marginTop: 14 },
  tabBtn: {
    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    padding: "10px 8px", border: "none", background: "transparent", color: "#8A7368",
    fontSize: 13.5, fontWeight: 500, borderBottom: "2px solid transparent",
  },
  tabBtnActive: { color: "#7A2E3D", borderBottom: "2px solid #7A2E3D", fontWeight: 600 },

  monthWrap: { padding: "16px 18px 8px" },
  dateNav: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  navBtn: {
    width: 36, height: 36, borderRadius: "50%", border: "1px solid #E8DCC8", background: "#FFFDF9",
    display: "flex", alignItems: "center", justifyContent: "center", color: "#7A2E3D", flexShrink: 0,
  },
  dateNavCenter: { textAlign: "center", flex: 1 },
  monthTitle: { fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600 },
  dateNavDate: { fontFamily: FONT_DISPLAY, fontSize: 16.5, fontWeight: 600 },
  todayLink: { border: "none", background: "none", color: "#7A2E3D", fontSize: 11.5, textDecoration: "underline", padding: 2, marginTop: 2 },

  swipeHint: { textAlign: "center", fontSize: 11, color: "#C9BBAE", marginBottom: 10 },
  weekdayRow: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 4 },
  weekdayCell: { textAlign: "center", fontSize: 11, color: "#B4A296", fontWeight: 600, padding: "4px 0" },

  monthGrid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 },
  dayCell: {
    border: "1px solid #EFE3D0", background: "#FFFDF9", borderRadius: 9,
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    padding: "4px 2px", gap: 3, position: "relative",
  },
  dayCellToday: { borderColor: "#7A2E3D", borderWidth: 2 },
  dayCellNum: { fontSize: 13, fontWeight: 500, color: "#2B1B1F" },
  dayCellNumToday: { color: "#7A2E3D", fontWeight: 700 },
  dayCellDots: { display: "flex", gap: 2, minHeight: 6 },
  dayDot: { width: 5, height: 5, borderRadius: "50%" },

  backLink: {
    display: "flex", alignItems: "center", gap: 2, border: "none", background: "none",
    color: "#8A7368", fontSize: 12.5, padding: "0 0 10px", fontWeight: 500,
  },

  ribbonRow: { display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" },
  ribbonTab: {
    padding: "6px 14px", borderRadius: "3px 3px 8px 8px", border: "1.5px solid",
    fontSize: 12.5, fontWeight: 600, boxShadow: "0 2px 3px rgba(43,27,31,0.08)",
  },

  dayViewWrap: { padding: "14px 18px 0" },
  dayTotalRow: {
    display: "flex", justifyContent: "space-between", alignItems: "baseline",
    padding: "6px 2px 12px", borderBottom: "1px dashed #D9C9B4",
  },
  dayTotalLabel: { fontSize: 12.5, color: "#8A7368" },
  dayTotalValue: { fontFamily: FONT_MONO, fontSize: 15, fontWeight: 500, color: "#7A2E3D" },

  timelineScrollWrap: { maxHeight: "min(640px, calc(100vh - 320px))", overflowY: "auto", marginTop: 10, borderRadius: 8 },
  timelineOuter: { display: "flex", position: "relative", gap: 6 },
  timeLabelCol: { width: 42, flexShrink: 0, position: "relative", height: STAFF_HEADER_HEIGHT + TIMELINE_HEIGHT },
  timeLabelColHeader: { height: STAFF_HEADER_HEIGHT, position: "sticky", top: 0, background: "#FBF6EE", zIndex: 6 },
  timeLabelLine: { position: "absolute", left: 0, right: 0 },
  timeLabel: { display: "block", fontSize: 10.5, color: "#8A7368", fontFamily: FONT_MONO, lineHeight: 1, padding: "2px 4px 0 0", textAlign: "right" },

  staffCol: { flex: 1, minWidth: 0 },
  staffColHeader: {
    fontSize: 11, fontWeight: 600, color: "#FBF6EE", textAlign: "center",
    height: 26, marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center",
    borderRadius: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    position: "sticky", top: 0, zIndex: 6,
  },
  staffColHeaderBtn: { width: "100%", border: "none", cursor: "pointer" },
  staffColBody: { position: "relative", height: TIMELINE_HEIGHT, background: "#FFFDF9", borderLeft: "1px solid #EFE3D0" },
  slotBtn: { position: "absolute", left: 0, right: 0, border: "none", background: "transparent", padding: 0 },
  apptBlock: {
    position: "absolute", left: 2, right: 2, borderRadius: 6, border: "1px solid rgba(255,255,255,0.4)",
    padding: "2px 5px", display: "flex", flexDirection: "column", alignItems: "flex-start",
    justifyContent: "center", gap: 1,
    overflow: "hidden", textAlign: "left", boxShadow: "0 2px 4px rgba(43,27,31,0.22)", zIndex: 2,
  },
  apptBlockBlocked: {
    background: "repeating-linear-gradient(45deg, #A8927F, #A8927F 6px, #96806D 6px, #96806D 12px)",
  },
  apptBlockService: { fontSize: 11, fontWeight: 700, color: "#FBF6EE", lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" },
  apptBlockClient: { fontSize: 10.5, color: "rgba(251,246,238,0.9)", lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" },
  apptBlockPrice: { fontFamily: FONT_MONO, fontSize: 10, color: "rgba(251,246,238,0.95)", lineHeight: 1.15 },
  groupConnector: {
    position: "absolute", left: "50%", width: 0, borderLeft: "2px dashed #B99A4D",
    transform: "translateX(-50%)", pointerEvents: "none", zIndex: 1,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  groupConnectorLabel: {
    fontSize: 9, color: "#8A6216", background: "#FBF3E4", padding: "1px 4px",
    borderRadius: 4, transform: "translateX(6px)", whiteSpace: "nowrap",
  },

  fab: {
    position: "fixed", bottom: 24, right: "max(24px, calc(50% - 256px))",
    width: 58, height: 58, borderRadius: "50%", background: "#7A2E3D",
    border: "none", display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 6px 16px rgba(122,46,61,0.35)", zIndex: 10,
  },

  modalOverlay: {
    position: "fixed", inset: 0, background: "rgba(43,27,31,0.45)",
    display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 20,
  },
  modalCard: {
    background: "#FBF6EE", width: "100%", maxWidth: 560, borderRadius: "16px 16px 0 0",
    maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden",
  },
  modalHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderBottom: "1px solid #EFE3D0" },
  modalTitle: { fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 600 },
  iconBtn: { border: "none", background: "none", color: "#5A473F", padding: 4 },
  modalBody: { padding: "14px 18px", overflowY: "auto", flex: 1 },
  fieldRow: { marginBottom: 16, flex: 1 },
  fieldRowHalf: { display: "flex", gap: 12 },
  label: { display: "block", fontSize: 12.5, color: "#8A7368", marginBottom: 6, fontWeight: 500 },
  input: {
    width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #E8DCC8",
    background: "#FFFDF9", fontSize: 14.5, color: "#2B1B1F",
  },
  staffChoiceRow: { display: "flex", gap: 8 },
  blockedCheckRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#5A473F", cursor: "pointer" },
  overlapWarning: {
    fontSize: 12, color: "#8A6216", background: "#FBF3E4", border: "1px solid #E8D2A0",
    borderRadius: 8, padding: "9px 12px", margin: "-6px 0 16px", lineHeight: 1.5,
  },
  linkHint: { fontSize: 11.5, color: "#B4A296", marginTop: 8, lineHeight: 1.5 },
  staffChoiceBtn: { flex: 1, padding: "9px 4px", borderRadius: 8, border: "1.5px solid", fontSize: 13, fontWeight: 600 },
  linkToggle: { border: "none", background: "none", color: "#7A2E3D", fontSize: 12, textDecoration: "underline", padding: "6px 0 0", textAlign: "left" },

  modalFooter: { display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", borderTop: "1px solid #EFE3D0" },
  deleteBtn: { display: "flex", alignItems: "center", gap: 6, border: "none", background: "none", color: "#A13A3A", fontSize: 13.5, fontWeight: 500, padding: "8px 4px" },
  cancelBtn: { border: "1px solid #E8DCC8", background: "#FFFDF9", color: "#5A473F", borderRadius: 8, padding: "10px 16px", fontSize: 13.5, fontWeight: 500 },
  saveBtn: { border: "none", background: "#7A2E3D", color: "#FBF6EE", borderRadius: 8, padding: "10px 18px", fontSize: 13.5, fontWeight: 600 },

  statsWrap: { padding: "16px 18px 0" },
  periodRow: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 },
  periodBtn: { padding: "7px 13px", borderRadius: 20, border: "1px solid #E8DCC8", background: "#FFFDF9", color: "#5A473F", fontSize: 12.5, fontWeight: 500 },
  periodBtnActive: { background: "#7A2E3D", borderColor: "#7A2E3D", color: "#FBF6EE" },
  payrollBtn: {
    display: "flex", alignItems: "center", gap: 5, padding: "7px 13px", borderRadius: 20,
    border: "1px solid #C4914B", background: "#FBF3E4", color: "#8A6216", fontSize: 12.5, fontWeight: 600,
    marginLeft: "auto",
  },
  loginError: { color: "#A13A3A", fontSize: 12.5, margin: "-4px 0 0" },

  payrollWrap: { padding: "14px 18px 30px" },
  payrollCard: {
    background: "#FFFDF9", border: "1px solid #EFE3D0", borderRadius: 14, padding: "36px 20px",
    display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10, marginTop: 8,
  },
  payrollTitle: { fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600 },
  payrollText: { fontSize: 13, color: "#8A7368", lineHeight: 1.6, maxWidth: 340 },
  logoutBtn: {
    display: "flex", alignItems: "center", gap: 6, border: "1px solid #E8DCC8", background: "#FFFDF9",
    color: "#5A473F", borderRadius: 8, padding: "9px 16px", fontSize: 12.5, fontWeight: 500, margin: "16px auto 0",
  },
  customRangeRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 14 },
  toLabel: { fontSize: 12.5, color: "#8A7368" },

  summaryCards: { display: "flex", gap: 8, marginBottom: 20 },
  summaryCard: { flex: 1, background: "#FFFDF9", border: "1px solid #EFE3D0", borderRadius: 12, padding: "14px 10px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, textAlign: "center" },
  summaryValue: { fontFamily: FONT_MONO, fontSize: 15, fontWeight: 600, color: "#2B1B1F" },
  summaryLabel: { fontSize: 11, color: "#8A7368" },

  sectionTitle: { fontFamily: FONT_DISPLAY, fontSize: 15.5, fontWeight: 600, margin: "4px 0 10px" },
  chartCard: { background: "#FFFDF9", border: "1px solid #EFE3D0", borderRadius: 12, padding: "14px 8px 10px", marginBottom: 22 },

  staffStatsList: { padding: "6px 10px 4px" },
  staffStatsRow: { display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #F2E9DB" },
  staffDot: { width: 9, height: 9, borderRadius: "50%", flexShrink: 0 },
  staffStatsName: { fontSize: 13, fontWeight: 600, flex: 1 },
  staffStatsCount: { fontSize: 11.5, color: "#8A7368" },
  staffStatsTotal: { fontFamily: FONT_MONO, fontSize: 12.5, fontWeight: 500, minWidth: 78, textAlign: "right" },

  emptyStateSmall: { textAlign: "center", color: "#8A7368", fontSize: 13, padding: "20px 8px" },
  serviceList: { padding: "4px 10px" },
  serviceRow: { padding: "9px 0", borderBottom: "1px solid #F2E9DB" },
  serviceRowTop: { display: "flex", justifyContent: "space-between", marginBottom: 5 },
  serviceName: { fontSize: 13, fontWeight: 500 },
  serviceTotal: { fontFamily: FONT_MONO, fontSize: 12.5, color: "#7A2E3D", fontWeight: 600 },
  serviceBarTrack: { height: 6, background: "#EFE3D0", borderRadius: 3, overflow: "hidden" },
  serviceBarFill: { height: "100%", background: "#C4914B", borderRadius: 3 },
  serviceCount: { fontSize: 10.5, color: "#B4A296", marginTop: 3, display: "block" },

  backupCard: { background: "#FFFDF9", border: "1px solid #EFE3D0", borderRadius: 12, padding: "14px 14px 16px", marginBottom: 30 },
  backupText: { fontSize: 12.5, color: "#8A7368", margin: "0 0 12px", lineHeight: 1.5 },
  backupBtnRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  backupBtn: {
    display: "flex", alignItems: "center", gap: 6, border: "1px solid #E8DCC8", background: "#FBF6EE",
    color: "#5A473F", borderRadius: 8, padding: "9px 14px", fontSize: 12.5, fontWeight: 500,
  },
  resetZone: { marginTop: 14, paddingTop: 12, borderTop: "1px dashed #E8DCC8" },
  resetBtn: {
    border: "1px solid #E3B8B8", background: "#FDF3F3", color: "#A13A3A",
    borderRadius: 8, padding: "9px 14px", fontSize: 12, fontWeight: 500,
  },

  emptyState: { textAlign: "center", padding: "48px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 },
  emptyStateText: { color: "#8A7368", fontSize: 14, marginTop: 4 },
  emptyStateSub: { color: "#B4A296", fontSize: 12.5 },

  clientsWrap: { padding: "16px 18px 0" },
  clientsList: { marginTop: 12 },
  clientRow: {
    display: "block", width: "100%", textAlign: "left", background: "#FFFDF9", border: "1px solid #EFE3D0",
    borderRadius: 10, padding: "11px 14px", marginBottom: 8,
  },
  clientRowName: { fontSize: 14.5, fontWeight: 600, marginBottom: 3 },
  clientRowPhone: { fontSize: 12, color: "#B99A4D", fontFamily: FONT_MONO, marginBottom: 3 },
  clientRowNote: {
    fontSize: 12, color: "#8A7368", overflow: "hidden", textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  textarea: {
    width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #E8DCC8",
    background: "#FFFDF9", fontSize: 13.5, color: "#2B1B1F", fontFamily: FONT_BODY, resize: "vertical",
  },
  clientNoteBox: { marginTop: 8, padding: "10px 12px", background: "#F5EDE0", borderRadius: 8 },
  clientPhoneText: { fontSize: 13, color: "#7A2E3D", fontFamily: FONT_MONO, fontWeight: 600, margin: "0 0 6px" },
  clientNoteText: { fontSize: 13, color: "#3E2E28", margin: "0 0 6px", lineHeight: 1.5, whiteSpace: "pre-wrap" },
  clientNoteTextMuted: { fontSize: 12.5, color: "#A8927F", margin: "0 0 6px", fontStyle: "italic" },
  clientNoteBtnRow: { display: "flex", gap: 8, marginTop: 6 },
  saveBtnSmall: { border: "none", background: "#7A2E3D", color: "#FBF6EE", borderRadius: 6, padding: "7px 12px", fontSize: 12, fontWeight: 600 },
  cancelBtnSmall: { border: "1px solid #E8DCC8", background: "#FFFDF9", color: "#5A473F", borderRadius: 6, padding: "7px 12px", fontSize: 12, fontWeight: 500 },

  serviceSelectRow: { display: "flex", gap: 8, alignItems: "stretch" },
  editServicesBtn: {
    width: 40, flexShrink: 0, border: "1px solid #E8DCC8", background: "#FFFDF9", color: "#7A2E3D",
    borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
  },
  manageHint: { fontSize: 12.5, color: "#8A7368", lineHeight: 1.5, margin: "0 0 14px" },
  serviceRowEdit: { display: "flex", gap: 6, alignItems: "center", marginBottom: 8 },
  serviceDurationInput: { width: 62, padding: "10px 6px", borderRadius: 8, border: "1px solid #E8DCC8", background: "#FFFDF9", fontSize: 13.5, textAlign: "center" },
  serviceDurationUnit: { fontSize: 11.5, color: "#8A7368" },
  addServiceRow: { display: "flex", gap: 6, alignItems: "center", marginTop: 10, paddingTop: 12, borderTop: "1px dashed #E8DCC8" },
  iconBtnDanger: { border: "1px solid #E3B8B8", background: "#FDF3F3", color: "#A13A3A", borderRadius: 8, width: 36, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
};
