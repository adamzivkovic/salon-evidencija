import React, { useState } from "react";
import { Lock, Delete } from "lucide-react";
import { APP_PIN } from "./appLock";

const FONT_DISPLAY = "'Fraunces', serif";
const FONT_BODY = "'Work Sans', sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

// Sopstvena, na ekranu iscrtana numerička tastatura — namerno se NE koristi
// nijedno <input> polje niti sistemska tastatura telefona. Ovo izbegava
// razlike u ponašanju između uređaja/browsera (autofill, predlozi koda iz
// SMS poruka i sl.) koje su ranije pravile probleme sa unosom PIN-a.
export default function PinGate({ onUnlock }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  const submitIfComplete = (next) => {
    if (next.length < APP_PIN.length) return;
    if (next === APP_PIN) {
      onUnlock();
    } else {
      setError(true);
      setTimeout(() => {
        setPin("");
        setError(false);
      }, 450);
    }
  };

  const pressDigit = (d) => {
    if (error) return;
    setPin((prev) => {
      if (prev.length >= APP_PIN.length) return prev;
      const next = prev + d;
      submitIfComplete(next);
      return next;
    });
  };

  const pressBackspace = () => {
    if (error) return;
    setPin((prev) => prev.slice(0, -1));
  };

  const pressClear = () => {
    if (error) return;
    setPin("");
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <Lock size={26} color="#C4914B" />
        <div style={styles.title}>Salon 2CATS</div>
        <p style={styles.subtitle}>Unesi šifru za pristup</p>

        <div style={styles.dots}>
          {Array.from({ length: APP_PIN.length }).map((_, i) => (
            <span
              key={i}
              style={{
                ...styles.dot,
                ...(i < pin.length ? styles.dotFilled : {}),
                ...(error ? styles.dotError : {}),
              }}
            />
          ))}
        </div>

        {error && <p style={styles.errorText}>Pogrešna šifra, pokušaj ponovo.</p>}

        <div style={styles.keypad}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} type="button" style={styles.key} onClick={() => pressDigit(d)}>
              {d}
            </button>
          ))}
          <button type="button" style={{ ...styles.key, ...styles.keySecondary }} onClick={pressClear}>
            Obriši
          </button>
          <button type="button" style={styles.key} onClick={() => pressDigit("0")}>
            0
          </button>
          <button type="button" style={{ ...styles.key, ...styles.keySecondary }} onClick={pressBackspace} aria-label="Izbriši poslednju cifru">
            <Delete size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "#FBF6EE", fontFamily: FONT_BODY, padding: 20,
  },
  card: {
    display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
    gap: 10, background: "#FFFDF9", border: "1px solid #EFE3D0", borderRadius: 16,
    padding: "28px 24px", maxWidth: 320, width: "100%",
  },
  title: { fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, color: "#2B1B1F" },
  subtitle: { fontSize: 13, color: "#8A7368", margin: "0 0 4px" },
  dots: { display: "flex", gap: 10, margin: "6px 0" },
  dot: { width: 14, height: 14, borderRadius: "50%", border: "2px solid #E8DCC8", background: "#FBF6EE" },
  dotFilled: { background: "#7A2E3D", borderColor: "#7A2E3D" },
  dotError: { background: "#A13A3A", borderColor: "#A13A3A" },
  errorText: { color: "#A13A3A", fontSize: 12.5, margin: "-4px 0 4px" },
  keypad: {
    display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10,
    width: "100%", marginTop: 10,
  },
  key: {
    fontFamily: FONT_MONO, fontSize: 20, fontWeight: 600, color: "#2B1B1F",
    background: "#FBF6EE", border: "1px solid #E8DCC8", borderRadius: 12,
    height: 56, display: "flex", alignItems: "center", justifyContent: "center",
    userSelect: "none", WebkitTapHighlightColor: "transparent",
  },
  keySecondary: { fontSize: 12.5, fontFamily: FONT_BODY, fontWeight: 600, color: "#8A7368" },
};
