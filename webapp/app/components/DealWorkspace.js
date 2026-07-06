"use client";

import { useEffect, useMemo, useState } from "react";
import { computeDeal, computeMaxBid } from "../../lib/proforma";
import { DEAL_CONFIG } from "../../lib/dealConfig";
import NavTabs from "./NavTabs";

const fmtUSD = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtPct = (n) => `${(n * 100).toFixed(1)}%`;

function Slider({ label, value, min, max, step, format, onChange, hint }) {
  return (
    <div className="sliderRow">
      <label>
        <span>{label}</span>
        <span className="value">{format(value)}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function NotesPanel({ property }) {
  const notes = [
    { label: "Condition / Drive-By Notes", text: property.driveByNotes },
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
              <div className="noteLabel">{n.label}</div>
              <div className="noteText">{n.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DealWorkspace({ dealType, title, goalDays, targetROI, judgmentLabel }) {
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

  // The Purchased tab mixes properties originally sourced from Sheriff Sales and
  // NTS, each with their own goal/ROI conventions — look those up per property
  // instead of using one static config for the whole page.
  function configFor(p) {
    if (dealType === "purchased" && p) {
      return DEAL_CONFIG[p.sourceType] || DEAL_CONFIG.sheriff;
    }
    return {
      title: title || "Properties",
      goalDays: goalDays || 180,
      targetROI: targetROI ?? 0.15,
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
    setPurchasePrice(Math.round(p.judgment * 1.05));
    setRemodelCost(30000);
    setSalePrice(arv);
    setSellerClosingCost(Math.round(p.mortgageBalance + p.hudAmount));
    setCycleDays(cfg.goalDays || 180);
  }

  async function handleTogglePurchased(p) {
    if (dealType === "purchased") {
      await fetch(`/api/purchased?id=${encodeURIComponent(p.id)}&dealType=${encodeURIComponent(p.sourceType)}`, {
        method: "DELETE",
      });
    } else {
      await fetch("/api/purchased", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, dealType: p.sourceType }),
      });
    }
    refreshProperties(true);
  }

  const selected = properties.find((p) => p.id === selectedId);
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
    () => computeMaxBid({ remodelCost, salePrice, sellerClosingCost, targetROI: activeConfig.targetROI }),
    [remodelCost, salePrice, sellerClosingCost, activeConfig.targetROI]
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
        {source && (
          <span className={`badge ${source === "google-sheets" ? "live" : "sample"}`}>
            {source === "google-sheets" ? "Live: Google Sheets" : "Sample data (Google Sheets not configured)"}
          </span>
        )}
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
                  ? "No purchased homes yet — check the Purchased box next to a property on the Sheriff Sales or NTS tab to move it here."
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
                  {dealType === "purchased" && (
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
          {selected && (
            <div className="panel" style={{ marginBottom: 20 }}>
              <div className="sectionTitleRow">
                <p className="sectionTitle">Base Figures &mdash; {selected.address}</p>
                <label className="purchaseToggle">
                  <input
                    type="checkbox"
                    checked={dealType === "purchased"}
                    onChange={() => handleTogglePurchased(selected)}
                  />
                  Purchased
                </label>
              </div>
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
            </div>
          )}

          <div className="panel maxBidPanel" style={{ marginBottom: 20 }}>
            <p className="sectionTitle">Max Bid &mdash; {fmtPct(activeConfig.targetROI)} Minimum ROI Target</p>
            <div className="bigNumber">{fmtUSD(Math.max(maxBid, 0))}</div>
            <div className="hint">
              The most you can bid at auction and still clear a {fmtPct(activeConfig.targetROI)} ROI, given the
              Remodel Cost, Sale Price, and Seller Closing Cost sliders below (goal: sell within {activeConfig.goalDays} days).
            </div>
            <div className={`bidRoom ${bidRoomClass}`}>
              {bidRoom >= 0
                ? `${fmtUSD(bidRoom)} of room below max bid at your current Purchase/Bid Price`
                : `${fmtUSD(Math.abs(bidRoom))} OVER max bid at your current Purchase/Bid Price`}
            </div>
            <div className="atBidCallout">
              <div className="label">Likely Profit at Your Bid Price ({fmtUSD(purchasePrice)})</div>
              <div className={`amount ${profitClass}`}>{fmtUSD(result.totalProfit)}</div>
              <div className="sub">{fmtPct(result.totalROI)} ROI &middot; {fmtPct(result.annualizedTotalROI)} annualized</div>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 20 }}>
            <p className="sectionTitle">Sliding Scale</p>
            <div className="grid2">
              <div>
                <Slider
                  label="Purchase / Bid Price"
                  value={purchasePrice}
                  min={0}
                  max={selected ? Math.round(selected.judgment * 3 + 50000) : 500000}
                  step={500}
                  format={fmtUSD}
                  onChange={setPurchasePrice}
                  hint={`What you bid at auction (defaults to ${activeConfig.judgmentLabel.toLowerCase()} + 5%)`}
                />
                <Slider
                  label="Remodel Cost"
                  value={remodelCost}
                  min={0}
                  max={200000}
                  step={500}
                  format={fmtUSD}
                  onChange={setRemodelCost}
                />
                <Slider
                  label="Sale Price (ARV)"
                  value={salePrice}
                  min={0}
                  max={arv ? Math.round(arv * 1.5) : 1000000}
                  step={1000}
                  format={fmtUSD}
                  onChange={setSalePrice}
                  hint="Defaults to average of Redfin/Zillow/Caliber"
                />
              </div>
              <div>
                <Slider
                  label="Seller Paid Closing Cost"
                  value={sellerClosingCost}
                  min={0}
                  max={selected ? Math.round((selected.mortgageBalance + selected.hudAmount) * 2 + 50000) : 500000}
                  step={500}
                  format={fmtUSD}
                  onChange={setSellerClosingCost}
                  hint="Mortgage + HUD payoff needed to deliver clear title"
                />
                <Slider
                  label="Investor Split"
                  value={investorSplitPct}
                  min={0}
                  max={1}
                  step={0.05}
                  format={fmtPct}
                  onChange={setInvestorSplitPct}
                />
                <Slider
                  label="Days to Close"
                  value={cycleDays}
                  min={30}
                  max={365}
                  step={5}
                  format={(v) => `${v} days`}
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
              <div className="resultCard">
                <div className="label">Gross Proceeds</div>
                <div className="amount">{fmtUSD(result.grossProceeds)}</div>
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

          {selected && <NotesPanel property={selected} />}
        </div>
      </div>
    </div>
  );
}
