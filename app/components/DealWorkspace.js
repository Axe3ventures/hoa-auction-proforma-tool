"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { computeDeal, computeMaxBid } from "../../lib/proforma";
import { DEAL_CONFIG } from "../../lib/dealConfig";
import { isSelfPurchase } from "../../lib/purchaseClassification";
import NavTabs from "./NavTabs";

const fmtDate = (s) => (s ? new Date(s).toLocaleDateString("en-US") : "—");
const isPurchasedTab = (dealType) => dealType === "purchased" || dealType === "purchased-other";

const fmtUSD = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtPct = (n) => `${(n * 100).toFixed(1)}%`;

function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "dark") {
      setIsDark(true);
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }, []);

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  return (
    <label className="themeSwitch">
      <input type="checkbox" checked={isDark} onChange={toggle} />
      <span className="themeSwitchTrack">
        <span className="themeSwitchThumb" />
      </span>
      <span>{isDark ? "Dark" : "Light"}</span>
    </label>
  );
}

function ReadOnlyField({ label, value, hint }) {
  return (
    <div className="numberFieldRow">
      <label>
        <span>{label}</span>
      </label>
      <div className="numberFieldInputWrap disabled">
        <span className="computedFieldValue">{value}</span>
        <span className="numberFieldAffix">computed</span>
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function NumberField({ label, value, step, prefix, suffix, disabled, onChange, hint }) {
  return (
    <div className="numberFieldRow">
      <label>
        <span>{label}</span>
      </label>
      <div className={`numberFieldInputWrap ${disabled ? "disabled" : ""}`}>
        {prefix && <span className="numberFieldAffix">{prefix}</span>}
        <input
          type="number"
          step={step || 1}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === "" ? 0 : parseFloat(e.target.value))}
        />
        {suffix && <span className="numberFieldAffix">{suffix}</span>}
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function NotesPanel({ property, noteText, onNoteChange, onSaveNote, savingNote, onClearNotes }) {
  const notes = [
    { label: "Condition / Drive-By Notes", text: property.driveByNotes, clearable: true },
    { label: "Deal Notes", text: property.dealNotes },
    { label: "Loan / Lien History Notes", text: property.loanNotes },
    { label: "HUD Notes (raw)", text: property.hudNotes },
  ].filter((n) => n.text && n.text.trim());

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <p className="sectionTitle">Manual Notes</p>
      <div className="factRow">
        <span>Owner</span>
        <span className="val">{property.owner || "—"}</span>
      </div>
      <div className="factRow">
        <span>Case Number</span>
        <span className="val">{property.caseNumber || "—"}</span>
      </div>
      {notes.length === 0 ? (
        <div className="hint" style={{ marginTop: 10 }}>No manually typed notes on file for this property.</div>
      ) : (
        <div className="notesBox">
          {notes.map((n) => (
            <div className="noteItem" key={n.label}>
              <div className="noteItemHeader">
                <div className="noteLabel">{n.label}</div>
                {n.clearable && (
                  <button type="button" className="noteDeleteBtn" onClick={onClearNotes}>
                    Delete
                  </button>
                )}
              </div>
              <div className="noteText">{n.text}</div>
            </div>
          ))}
        </div>
      )}
      <div className="addNoteBox">
        <label className="purchaseField">
          Add a Drive-By Note{" "}
          <span className="hint">
            (saved to the sheet, added to Condition / Drive-By Notes above — tap the mic icon on your iPhone
            keyboard to dictate)
          </span>
          <textarea
            className="noteTextarea"
            rows={3}
            placeholder="e.g. Front yard overgrown, garage door dented, no cars in driveway..."
            value={noteText}
            onChange={(e) => onNoteChange(e.target.value)}
          />
        </label>
        <button type="button" className="purchaseButton small" onClick={onSaveNote} disabled={savingNote}>
          {savingNote ? "Saving…" : "Save Note"}
        </button>
      </div>
    </div>
  );
}

function PhotosPanel({ photos, uploading, onUpload, onDelete, onReorder, hasProperty }) {
  const [enlargedIndex, setEnlargedIndex] = useState(null);
  const open = enlargedIndex !== null && enlargedIndex >= 0 && enlargedIndex < photos.length;
  const current = open ? photos[enlargedIndex] : null;

  const closeLightbox = () => setEnlargedIndex(null);
  const goPrev = () => setEnlargedIndex((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
  const goNext = () => setEnlargedIndex((i) => (i === null ? i : (i + 1) % photos.length));

  const movePhoto = (from, to) => {
    if (to < 0 || to >= photos.length || from === to) return;
    const next = photos.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next);
  };

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, photos.length]);

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <p className="sectionTitle">Photos</p>
      {!hasProperty ? (
        <div className="hint" style={{ marginTop: 10 }}>
          Select a property from the list to view and add its photos.
        </div>
      ) : (
        <>
          <div className="photoInputsRow">
            <label className="purchaseButton small photoUploadLabel">
              Take Photo
              <input type="file" accept="image/*" capture="environment" onChange={(e) => onUpload(e.target.files)} />
            </label>
            <label className="purchaseButton small secondary photoUploadLabel">
              Choose from Library
              <input type="file" accept="image/*" multiple onChange={(e) => onUpload(e.target.files)} />
            </label>
            {uploading && <span className="hint">Uploading…</span>}
          </div>
          {photos.length === 0 ? (
            <div className="hint" style={{ marginTop: 10 }}>
              No photos yet — take one from your phone or upload from your library.
            </div>
          ) : (
            <>
              {photos.length > 1 && (
                <div className="hint" style={{ marginTop: 10 }}>
                  Tap a photo to enlarge; use the ‹ › buttons to reorder.
                </div>
              )}
              <div className="photoGrid">
                {photos.map((photo, i) => (
                  <div className="photoThumb" key={photo.id}>
                    <img
                      src={`/api/photos/${photo.id}`}
                      alt={photo.name}
                      loading="lazy"
                      onClick={() => setEnlargedIndex(i)}
                    />
                    <button
                      type="button"
                      className="photoDeleteBtn"
                      onClick={() => onDelete(photo.id)}
                      aria-label="Delete photo"
                    >
                      &times;
                    </button>
                    {photos.length > 1 && (
                      <>
                        <button
                          type="button"
                          className="photoMoveBtn left"
                          onClick={() => movePhoto(i, i - 1)}
                          disabled={i === 0}
                          aria-label="Move photo earlier"
                        >
                          &#8249;
                        </button>
                        <button
                          type="button"
                          className="photoMoveBtn right"
                          onClick={() => movePhoto(i, i + 1)}
                          disabled={i === photos.length - 1}
                          aria-label="Move photo later"
                        >
                          &#8250;
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {open && (
        <div className="photoLightbox" onClick={closeLightbox}>
          <button
            type="button"
            className="photoLightboxClose"
            onClick={closeLightbox}
            aria-label="Close"
          >
            &times;
          </button>
          {photos.length > 1 && (
            <button
              type="button"
              className="photoLightboxNav prev"
              onClick={(e) => {
                e.stopPropagation();
                goPrev();
              }}
              aria-label="Previous photo"
            >
              &#8249;
            </button>
          )}
          <img src={`/api/photos/${current.id}`} alt={current.name} onClick={(e) => e.stopPropagation()} />
          {photos.length > 1 && (
            <button
              type="button"
              className="photoLightboxNav next"
              onClick={(e) => {
                e.stopPropagation();
                goNext();
              }}
              aria-label="Next photo"
            >
              &#8250;
            </button>
          )}
          {photos.length > 1 && (
            <div className="photoLightboxCount">
              {enlargedIndex + 1} / {photos.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DealWorkspace({ dealType, title, goalDays, targetProfit, judgmentLabel }) {
  const [properties, setProperties] = useState([]);
  const [source, setSource] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");

  const [purchasePrice, setPurchasePrice] = useState(0);
  const [remodelCost, setRemodelCost] = useState(30000);
  const [salePrice, setSalePrice] = useState(0);
  const [sellerClosingCost, setSellerClosingCost] = useState(0);
  const [investorSplitPct, setInvestorSplitPct] = useState(0.5);
  const [cycleDays, setCycleDays] = useState(goalDays || 180);
  const [locked, setLocked] = useState(false);
  const [savingLock, setSavingLock] = useState(false);
  const [researched, setResearched] = useState(false);
  const [savingResearched, setSavingResearched] = useState(false);

  const [purchaseFormPrice, setPurchaseFormPrice] = useState("");
  const [purchaseFormBuyer, setPurchaseFormBuyer] = useState("");
  const [finalSaleFormPrice, setFinalSaleFormPrice] = useState("");

  const [photos, setPhotos] = useState([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // The Purchase/Bid Price last known to match the sheet's AF cell — used by
  // the debounced sync effect below to skip writes when the value came FROM
  // the sheet (or was already synced), so selecting a property never fires a
  // pointless write and typing only syncs actual edits.
  const syncedBidPrice = useRef(null);
  const bidSyncTimer = useRef(null);

  // The Purchased tab mixes properties originally sourced from Sheriff Sales and
  // NTS, each with their own goal/profit conventions — look those up per property
  // instead of using one static config for the whole page.
  function configFor(p) {
    if (isPurchasedTab(dealType) && p) {
      return DEAL_CONFIG[p.sourceType] || DEAL_CONFIG.sheriff;
    }
    return {
      title: title || "Properties",
      goalDays: goalDays || 180,
      targetProfit: targetProfit ?? 50000,
      judgmentLabel: judgmentLabel || "Judgment",
    };
  }

  function refreshProperties(selectFirstIfMissing) {
    return fetch(`/api/properties?type=${dealType}`)
      .then((r) => r.json())
      .then((data) => {
        setProperties(data.properties);
        setSource(data.source);
        if (selectFirstIfMissing && !data.properties.some((p) => p.id === selectedId)) {
          if (data.properties.length) selectProperty(data.properties[0]);
          else setSelectedId(null);
        }
        return data.properties;
      });
  }

  useEffect(() => {
    refreshProperties(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealType]);

  function selectProperty(p) {
    setSelectedId(p.id);
    const cfg = configFor(p);
    const arv = Math.round((p.redfin + p.zillow + p.caliber) / 3) || p.zillow || p.redfin || p.caliber || 0;
    // A price already in the sheet's AF column (typed there manually, or
    // synced from a previous session) overrides the judgment-based default.
    const sheetBid = p.purchasePrice > 0 ? p.purchasePrice : 0;
    if (p.lockedScenario) {
      // A previously locked scenario persists across refreshes/relaunches —
      // restore those exact numbers instead of recomputing fresh defaults.
      const s = p.lockedScenario;
      const initialBid = s.purchasePrice ?? (sheetBid || Math.round(p.judgment));
      setPurchasePrice(initialBid);
      syncedBidPrice.current = { id: p.id, price: initialBid };
      setRemodelCost(s.remodelCost ?? 30000);
      setSalePrice(s.salePrice ?? arv);
      setSellerClosingCost(s.sellerClosingCost ?? Math.round(p.mortgageBalance + p.hudAmount));
      setInvestorSplitPct(s.investorSplitPct ?? 0.5);
      setCycleDays(s.cycleDays ?? cfg.goalDays ?? 180);
      setLocked(true);
    } else {
      const initialBid = sheetBid || Math.round(p.judgment);
      setPurchasePrice(initialBid);
      syncedBidPrice.current = { id: p.id, price: initialBid };
      setRemodelCost(30000);
      // Once a final sale price has actually been recorded, that's the real
      // number to build the proforma around — otherwise fall back to the ARV
      // estimate (average of Redfin/Zillow/Caliber).
      setSalePrice(p.finalSalePrice > 0 ? p.finalSalePrice : arv);
      setSellerClosingCost(Math.round(p.mortgageBalance + p.hudAmount));
      setInvestorSplitPct(0.5);
      setCycleDays(cfg.goalDays || 180);
      setLocked(false);
    }
    setResearched(!!p.fullyResearched);
    setPurchaseFormPrice("");
    setPurchaseFormBuyer("");
    setFinalSaleFormPrice(p.finalSalePrice > 0 ? String(p.finalSalePrice) : "");
    setNoteText("");
    refreshPhotos(p);
  }

  function refreshPhotos(p) {
    if (!p) {
      setPhotos([]);
      return;
    }
    fetch(`/api/photos?id=${encodeURIComponent(p.id)}&dealType=${encodeURIComponent(p.sourceType)}`)
      .then((r) => r.json())
      .then((data) => setPhotos(data.photos || []))
      .catch(() => setPhotos([]));
  }

  async function handleUploadPhoto(fileList) {
    if (!selected || !fileList || fileList.length === 0) return;
    setUploadingPhoto(true);
    for (const file of Array.from(fileList)) {
      const formData = new FormData();
      formData.append("id", selected.id);
      formData.append("dealType", selected.sourceType);
      formData.append("address", selected.address || "");
      formData.append("file", file);
      try {
        const res = await fetch("/api/photos", { method: "POST", body: formData });
        const result = await res.json();
        if (!res.ok || result.ok === false) {
          alert(`Couldn't upload photo: ${result.error || "unknown error"}`);
        }
      } catch (err) {
        alert(`Couldn't upload photo: ${err.message}`);
      }
    }
    setUploadingPhoto(false);
    refreshPhotos(selected);
  }

  async function handleReorderPhotos(newOrder) {
    // Optimistically show the new order, then persist it to Drive. On failure,
    // reload the server's order so the UI can't drift out of sync.
    setPhotos(newOrder);
    try {
      const res = await fetch("/api/photos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: newOrder.map((p) => p.id) }),
      });
      const result = await res.json();
      if (!res.ok || result.ok === false) {
        alert(`Couldn't save photo order: ${result.error || "unknown error"}`);
        if (selected) refreshPhotos(selected);
      }
    } catch (err) {
      alert(`Couldn't save photo order: ${err.message}`);
      if (selected) refreshPhotos(selected);
    }
  }

  async function handleDeletePhoto(fileId) {
    if (!confirm("Delete this photo?")) return;
    try {
      const res = await fetch(`/api/photos?fileId=${encodeURIComponent(fileId)}`, { method: "DELETE" });
      const result = await res.json();
      if (!res.ok || result.ok === false) {
        alert(`Couldn't delete photo: ${result.error || "unknown error"}`);
        return;
      }
    } catch (err) {
      alert(`Couldn't delete photo: ${err.message}`);
      return;
    }
    refreshPhotos(selected);
  }

  async function handleSaveNote() {
    if (!selected || !noteText.trim()) return;
    setSavingNote(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, dealType: selected.sourceType, note: noteText }),
      });
      const result = await res.json();
      if (!res.ok || result.ok === false) {
        alert(`Couldn't save note: ${result.error || "unknown error"}`);
        setSavingNote(false);
        return;
      }
    } catch (err) {
      alert(`Couldn't save note: ${err.message}`);
      setSavingNote(false);
      return;
    }
    setNoteText("");
    setSavingNote(false);
    refreshProperties(true);
  }

  async function handleClearNotes() {
    if (!selected) return;
    if (!confirm("Delete all Drive-By Notes for this property? This can't be undone.")) return;
    try {
      const res = await fetch(
        `/api/notes?id=${encodeURIComponent(selected.id)}&dealType=${encodeURIComponent(selected.sourceType)}`,
        { method: "DELETE" }
      );
      const result = await res.json();
      if (!res.ok || result.ok === false) {
        alert(`Couldn't delete notes: ${result.error || "unknown error"}`);
        return;
      }
    } catch (err) {
      alert(`Couldn't delete notes: ${err.message}`);
      return;
    }
    refreshProperties(true);
  }

  function warnIfLocalOnly(result) {
    if (result.persistedTo === "local") {
      alert(
        "Saved locally only — this won't persist online. Make sure the Google Sheet is connected " +
          "with Editor access to record purchases there instead."
      );
    }
  }

  async function handleMarkPurchased(p) {
    const price = parseFloat(purchaseFormPrice);
    if (!price || price <= 0) {
      alert("Enter a valid sale price before marking this purchased.");
      return;
    }
    let result;
    try {
      const res = await fetch("/api/purchased", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, dealType: p.sourceType, price, purchaser: purchaseFormBuyer.trim() }),
      });
      result = await res.json();
      if (!res.ok || result.ok === false) {
        alert(`Couldn't mark as purchased: ${result.error || "unknown error"}`);
        return;
      }
    } catch (err) {
      alert(`Couldn't mark as purchased: ${err.message}`);
      return;
    }
    warnIfLocalOnly(result);
    setPurchaseFormPrice("");
    setPurchaseFormBuyer("");
    refreshProperties(true);
  }

  async function handleUnpurchase(p) {
    let result;
    try {
      const res = await fetch(
        `/api/purchased?id=${encodeURIComponent(p.id)}&dealType=${encodeURIComponent(p.sourceType)}`,
        { method: "DELETE" }
      );
      result = await res.json();
      if (!res.ok || result.ok === false) {
        alert(`Couldn't move this back: ${result.error || "unknown error"}`);
        return;
      }
    } catch (err) {
      alert(`Couldn't move this back: ${err.message}`);
      return;
    }
    warnIfLocalOnly(result);
    refreshProperties(true);
  }

  async function handleSetFinalSalePrice(p) {
    const finalSalePrice = parseFloat(finalSaleFormPrice);
    if (!finalSalePrice || finalSalePrice <= 0) {
      alert("Enter a valid final sale price.");
      return;
    }
    try {
      const res = await fetch("/api/final-sale-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, dealType: p.sourceType, finalSalePrice }),
      });
      const result = await res.json();
      if (!res.ok || result.ok === false) {
        alert(`Couldn't save final sale price: ${result.error || "unknown error"}`);
        return;
      }
    } catch (err) {
      alert(`Couldn't save final sale price: ${err.message}`);
      return;
    }
    // Immediately drive the Sale Price (ARV) slider / profit calc from the
    // real number instead of waiting on a refetch + reselect round trip.
    setSalePrice(finalSalePrice);
    refreshProperties(true);
  }

  async function handleToggleResearched() {
    const selectedNow = properties.find((p) => p.id === selectedId);
    if (!selectedNow) return;
    const next = !researched;
    setSavingResearched(true);
    try {
      const res = await fetch("/api/researched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedNow.id, dealType: selectedNow.sourceType, researched: next }),
      });
      const result = await res.json();
      if (!res.ok || result.ok === false) {
        alert(`Couldn't save research status: ${result.error || "unknown error"}`);
        setSavingResearched(false);
        return;
      }
    } catch (err) {
      alert(`Couldn't save research status: ${err.message}`);
      setSavingResearched(false);
      return;
    }
    setResearched(next);
    setSavingResearched(false);
    // Update the list immediately so the 👍 badge appears without re-selecting.
    setProperties((prev) => prev.map((p) => (p.id === selectedNow.id ? { ...p, fullyResearched: next } : p)));
  }

  async function handleToggleLock() {
    const selectedNow = properties.find((p) => p.id === selectedId);
    if (!selectedNow) return;
    setSavingLock(true);
    try {
      if (locked) {
        const res = await fetch(
          `/api/locked-scenario?id=${encodeURIComponent(selectedNow.id)}&dealType=${encodeURIComponent(selectedNow.sourceType)}`,
          { method: "DELETE" }
        );
        const result = await res.json();
        if (!res.ok || result.ok === false) {
          alert(`Couldn't unlock: ${result.error || "unknown error"}`);
          setSavingLock(false);
          return;
        }
        setLocked(false);
      } else {
        const scenario = {
          purchasePrice,
          remodelCost,
          salePrice,
          sellerClosingCost,
          investorSplitPct,
          cycleDays,
        };
        const res = await fetch("/api/locked-scenario", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: selectedNow.id, dealType: selectedNow.sourceType, scenario }),
        });
        const result = await res.json();
        if (!res.ok || result.ok === false) {
          alert(`Couldn't lock numbers: ${result.error || "unknown error"}`);
          setSavingLock(false);
          return;
        }
        setLocked(true);
      }
    } catch (err) {
      alert(`Couldn't ${locked ? "unlock" : "lock numbers"}: ${err.message}`);
      setSavingLock(false);
      return;
    }
    setSavingLock(false);
    refreshProperties(false);
  }

  const selected = properties.find((p) => p.id === selectedId);

  // Sync Purchase/Bid Price edits into the sheet's AF column, debounced so a
  // burst of keystrokes lands as one write. Values that came FROM the sheet
  // (set in selectProperty, tracked in syncedBidPrice) are skipped, so this
  // only fires on genuine user edits. AF-only write — never marks purchased.
  useEffect(() => {
    if (!selected || locked) return;
    const last = syncedBidPrice.current;
    if (last && last.id === selected.id && last.price === purchasePrice) return;

    const id = selected.id;
    const sourceType = selected.sourceType;
    if (bidSyncTimer.current) clearTimeout(bidSyncTimer.current);
    bidSyncTimer.current = setTimeout(() => {
      syncedBidPrice.current = { id, price: purchasePrice };
      fetch("/api/bid-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, dealType: sourceType, price: purchasePrice }),
      })
        .then((r) => r.json())
        .then((result) => {
          if (result.ok === false) console.error("Bid price sync failed:", result.error);
        })
        .catch((err) => console.error("Bid price sync failed:", err.message));
    }, 1200);
    return () => {
      if (bidSyncTimer.current) clearTimeout(bidSyncTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchasePrice, selected?.id, locked]);
  const activeConfig = configFor(selected);

  const result = useMemo(
    () =>
      computeDeal({
        purchasePrice,
        remodelCost,
        salePrice,
        sellerClosingCost,
        investorSplitPct,
        cycleDays,
      }),
    [purchasePrice, remodelCost, salePrice, sellerClosingCost, investorSplitPct, cycleDays]
  );

  const maxBid = useMemo(
    () => computeMaxBid({ remodelCost, salePrice, sellerClosingCost, targetProfit: activeConfig.targetProfit }),
    [remodelCost, salePrice, sellerClosingCost, activeConfig.targetProfit]
  );

  const filtered = properties.filter((p) =>
    `${p.address} ${p.city} ${p.plaintiff}`.toLowerCase().includes(search.toLowerCase())
  );

  const arv = selected ? Math.round((selected.redfin + selected.zillow + selected.caliber) / 3) : 0;
  const profitClass = result.totalProfit >= 0 ? "positive" : "negative";
  const bidRoom = maxBid - purchasePrice;
  const bidRoomClass = bidRoom >= 0 ? "positive" : "negative";

  return (
    <div className="wrap">
      <div className="header">
        <h1>Auction ProForma</h1>
        <div className="headerRight">
          {source && (
            <span className={`badge ${source === "google-sheets" ? "live" : "sample"}`}>
              {source === "google-sheets" ? "Live: Google Sheets" : "Sample data (Google Sheets not configured)"}
            </span>
          )}
          <ThemeToggle />
        </div>
      </div>

      <NavTabs />

      <div className="layout">
        <div className="panel">
          <p className="sectionTitle">{title} Properties</p>
          <input
            className="searchInput"
            placeholder="Search address, city, HOA..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="propList">
            {filtered.length === 0 && source && (
              <div className="hint">
                {dealType === "purchased"
                  ? "No purchased homes yet — enter a sale price on a property's Base Figures panel (Sheriff Sales or NTS tab), leave Purchased By blank (or type \"I Purchased\"), and click I Purchased to move it here."
                  : dealType === "purchased-other"
                  ? "No deals purchased by someone else yet — enter a sale price and a different buyer's name on a property's Base Figures panel (Sheriff Sales or NTS tab) to move it here."
                  : "No properties match."}
              </div>
            )}
            {filtered.map((p) => (
              <div
                key={p.id}
                className={`propItem ${p.id === selectedId ? "active" : ""}`}
                onClick={() => selectProperty(p)}
              >
                <div className="addr">
                  {p.address || `Property ${p.id}`}
                  {p.fullyResearched && (
                    <span className="researchedBadge" title="Fully researched">
                      👍
                    </span>
                  )}
                  {p.auctionDate && <span className="auctionDateBadge">{p.auctionDate}</span>}
                  {isPurchasedTab(dealType) && (
                    <span className="sourceBadge">{DEAL_CONFIG[p.sourceType]?.title || p.sourceType}</span>
                  )}
                </div>
                <div className="sub">
                  {p.city} &middot; {configFor(p).judgmentLabel} {fmtUSD(p.judgment)} &middot; Loan {fmtUSD(p.mortgageBalance)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <PhotosPanel
            photos={photos}
            uploading={uploadingPhoto}
            onUpload={handleUploadPhoto}
            onDelete={handleDeletePhoto}
            onReorder={handleReorderPhotos}
            hasProperty={!!selected}
          />

          {selected && (
            <div className="panel" style={{ marginBottom: 20 }}>
              <p className="sectionTitle">Base Figures &mdash; {selected.address}</p>
              <div className="grid2">
                <div>
                  <div className="factRow"><span>{activeConfig.judgmentLabel}</span><span className="val">{fmtUSD(selected.judgment)}</span></div>
                  <div className="factRow"><span>Mortgage Balance</span><span className="val">{fmtUSD(selected.mortgageBalance)}</span></div>
                  <div className="factRow"><span>HUD / Additional Lien</span><span className="val">{fmtUSD(selected.hudAmount)}</span></div>
                  {selected.mortgageModified && (
                    <div className="hint">Mortgage balance reflects a loan modification — treated as the current mortgage, not an add-on.</div>
                  )}
                  <div className="factRow"><span>Bed / Bath / SqFt</span><span className="val">{selected.bed}bd / {selected.bath}ba / {selected.sqft}sf</span></div>
                </div>
                <div>
                  <div className="factRow"><span>Redfin</span><span className="val">{fmtUSD(selected.redfin)}</span></div>
                  <div className="factRow"><span>Zillow</span><span className="val">{fmtUSD(selected.zillow)}</span></div>
                  <div className="factRow"><span>Caliber</span><span className="val">{fmtUSD(selected.caliber)}</span></div>
                  <div className="factRow"><span>Avg Comp (ARV)</span><span className="val">{fmtUSD(arv)}</span></div>
                </div>
              </div>

              {isPurchasedTab(dealType) ? (
                <div className="purchaseBox">
                  <div className="factRow"><span>Purchased By</span><span className="val">{selected.purchaser || "(you)"}</span></div>
                  <div className="factRow"><span>Purchase Price</span><span className="val">{fmtUSD(selected.purchasePrice)}</span></div>
                  <form
                    style={{ margin: "8px 0" }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSetFinalSalePrice(selected);
                    }}
                  >
                    <label className="purchaseField">
                      Final Sale Price <span className="hint">(sets the Sale Price field below once recorded)</span>
                      <div className="buyerInputRow">
                        <input
                          type="number"
                          placeholder="e.g. 410000"
                          value={finalSaleFormPrice}
                          onChange={(e) => setFinalSaleFormPrice(e.target.value)}
                        />
                        <button type="submit" className="purchaseButton small">
                          Save
                        </button>
                      </div>
                    </label>
                  </form>
                  <div className="factRow"><span>Purchase Date</span><span className="val">{fmtDate(selected.purchasedDate)}</span></div>
                  {dealType === "purchased-other" && (
                    <div className="factRow"><span>Follow-Up Reminder</span><span className="val">{fmtDate(selected.followUpDate)}</span></div>
                  )}
                  <button className="purchaseButton secondary" onClick={() => handleUnpurchase(selected)}>
                    Move Back / Undo Purchase
                  </button>
                </div>
              ) : (
                <div className="purchaseBox">
                  <form
                    className="purchaseInputsRow"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleMarkPurchased(selected);
                    }}
                  >
                    <label className="purchaseField">
                      Sale Price
                      <input
                        type="number"
                        placeholder="e.g. 350000"
                        value={purchaseFormPrice}
                        onChange={(e) => setPurchaseFormPrice(e.target.value)}
                      />
                    </label>
                    <label className="purchaseField">
                      Purchased By <span className="hint">(leave blank or "I Purchased" if it's you — any other name moves it to Purchased by Other)</span>
                      <div className="buyerInputRow">
                        <input
                          type="text"
                          placeholder="Name"
                          value={purchaseFormBuyer}
                          onChange={(e) => setPurchaseFormBuyer(e.target.value)}
                        />
                        <button type="submit" className="purchaseButton small">
                          Enter
                        </button>
                      </div>
                    </label>
                    <button type="submit" className="purchaseButton">
                      {isSelfPurchase(purchaseFormBuyer) ? "I Purchased" : "Mark Purchased by Other"}
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}

          <div className="panel maxBidPanel" style={{ marginBottom: 20 }}>
            <p className="sectionTitle">Max Bid &mdash; {fmtUSD(activeConfig.targetProfit)} Minimum Profit Target</p>
            <div className="bigNumber">{fmtUSD(Math.max(maxBid, 0))}</div>
            <div className="hint">
              The most you can bid at auction and still clear {fmtUSD(activeConfig.targetProfit)} in profit, given the
              Remodel Cost, Sale Price, and Seller Closing Cost figures below (goal: sell within {activeConfig.goalDays} days).
            </div>
            <div className={`bidRoom ${bidRoomClass}`}>
              {bidRoom >= 0
                ? `${fmtUSD(bidRoom)} of room below max bid at your current Purchase/Bid Price`
                : `${fmtUSD(Math.abs(bidRoom))} OVER max bid at your current Purchase/Bid Price`}
            </div>
            <div className="atBidCallout">
              <div className="label">Likely Profit at Your Bid Price ({fmtUSD(purchasePrice)})</div>
              <div className={`amount ${profitClass}`}>{fmtUSD(result.totalProfit)}</div>
              <div className="sub">
                {result.totalProfit >= activeConfig.targetProfit
                  ? `${fmtUSD(result.totalProfit - activeConfig.targetProfit)} above target`
                  : `${fmtUSD(activeConfig.targetProfit - result.totalProfit)} below target`}
              </div>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="sectionHeaderRow">
              <p className="sectionTitle">The Numbers</p>
              <div className="sectionHeaderButtons">
                <button
                  type="button"
                  className={`purchaseButton small ${researched ? "" : "secondary"}`}
                  onClick={handleToggleResearched}
                  disabled={savingResearched || !selected}
                >
                  {savingResearched ? "Saving…" : researched ? "👍 Fully Researched" : "Fully Researched"}
                </button>
                <button
                  type="button"
                  className={`purchaseButton small ${locked ? "" : "secondary"}`}
                  onClick={handleToggleLock}
                  disabled={savingLock}
                >
                  {savingLock ? "Saving…" : locked ? "🔒 Unlock to Edit" : "🔓 Lock Numbers"}
                </button>
              </div>
            </div>
            <div className="grid2">
              <div>
                <NumberField
                  label="Purchase / Bid Price"
                  value={purchasePrice}
                  step={500}
                  prefix="$"
                  disabled={locked}
                  onChange={setPurchasePrice}
                  hint={`What you bid at auction — syncs with the sheet's Price Paid column (defaults to ${activeConfig.judgmentLabel.toLowerCase()})`}
                />
                <NumberField
                  label="Remodel Cost"
                  value={remodelCost}
                  step={500}
                  prefix="$"
                  disabled={locked}
                  onChange={setRemodelCost}
                />
                <NumberField
                  label="Sale Price (ARV)"
                  value={salePrice}
                  step={1000}
                  prefix="$"
                  disabled={locked}
                  onChange={setSalePrice}
                  hint={
                    selected?.finalSalePrice > 0
                      ? "Using the recorded Final Sale Price"
                      : "Defaults to average of Redfin/Zillow/Caliber"
                  }
                />
              </div>
              <div>
                <NumberField
                  label="Seller Paid Closing Cost"
                  value={sellerClosingCost}
                  step={500}
                  prefix="$"
                  disabled={locked}
                  onChange={setSellerClosingCost}
                  hint="Defaults to Mortgage + HUD payoff needed to deliver clear title — edit to override"
                />
                <ReadOnlyField
                  label="Investor Split"
                  value={fmtPct(investorSplitPct)}
                  hint="Computed from the standard investor / company profit split"
                />
                <NumberField
                  label="Days to Close"
                  value={cycleDays}
                  step={5}
                  suffix="days"
                  disabled={locked}
                  onChange={setCycleDays}
                  hint={`Goal for ${activeConfig.title}: ${activeConfig.goalDays} days`}
                />
              </div>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 20 }}>
            <p className="sectionTitle">Forecasted Performance</p>
            <div className="resultsGrid">
              <div className="resultCard">
                <div className="label">Total Cost</div>
                <div className="amount">{fmtUSD(result.totalCost)}</div>
              </div>
              <div className="resultCard expense">
                <div className="label">Closing Costs (1% of Sale Price)</div>
                <div className="amount">{fmtUSD(result.routineClosingCosts)}</div>
              </div>
              <div className="resultCard expense">
                <div className="label">Broker Commission (5% of Sale Price)</div>
                <div className="amount">{fmtUSD(result.brokerCommission)}</div>
              </div>
              <div className="resultCard profit">
                <div className="label">Total Profit</div>
                <div className={`amount ${profitClass}`}>{fmtUSD(result.totalProfit)}</div>
                <div className="sub">{fmtPct(result.totalROI)} ROI</div>
              </div>
              <div className="resultCard">
                <div className="label">Investor Profit ({fmtPct(investorSplitPct)})</div>
                <div className="amount">{fmtUSD(result.investorProfit)}</div>
                <div className="sub">{fmtPct(result.investorROI)} ROI &middot; {fmtPct(result.annualizedInvestorROI)} annualized</div>
              </div>
              <div className="resultCard">
                <div className="label">Company Profit</div>
                <div className="amount">{fmtUSD(result.companyProfit)}</div>
                <div className="sub">{fmtPct(result.companyROI)} ROI &middot; {fmtPct(result.annualizedCompanyROI)} annualized</div>
              </div>
              <div className="resultCard">
                <div className="label">Annualized Total ROI</div>
                <div className="amount">{fmtPct(result.annualizedTotalROI)}</div>
                <div className="sub">Based on {cycleDays}-day cycle</div>
              </div>
            </div>
          </div>

          {selected && (
            <NotesPanel
              property={selected}
              noteText={noteText}
              onNoteChange={setNoteText}
              onSaveNote={handleSaveNote}
              savingNote={savingNote}
              onClearNotes={handleClearNotes}
            />
          )}
        </div>
      </div>
    </div>
  );
}
