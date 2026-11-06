import { ImageResponse } from "next/og";

/**
 * Social share image (1200×630), generated at build time with next/og
 * (statically optimized: it has no request-time data). Sample data only.
 */
export const alt = "Stocktill — point of sale and inventory for small shops (fictional portfolio project)";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LINES: [string, string, string][] = [
  ["2", "USB-C Cable 1 m", "$19.98"],
  ["1", "20 W USB-C Charger", "$19.99"],
  ["1", "Clear Phone Case", "$15.99"],
];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 55%, #4338ca 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 560 }}>
          <div style={{ fontSize: 34, fontWeight: 700, color: "#c7d2fe" }}>Stocktill</div>
          <div style={{ marginTop: 18, fontSize: 64, fontWeight: 800, lineHeight: 1.05 }}>Scan, sell and know your stock.</div>
          <div style={{ marginTop: 22, fontSize: 28, color: "#e0e7ff" }}>Point of sale + inventory for small shops</div>
          <div style={{ marginTop: 40, fontSize: 20, color: "#a5b4fc" }}>Fictional brand · portfolio project</div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 420,
            borderRadius: 24,
            background: "white",
            color: "#0f172a",
            padding: 28,
            boxShadow: "0 30px 60px rgba(0,0,0,.35)",
          }}
        >
          <div style={{ display: "flex", fontSize: 18, color: "#475569" }}>Register · sample data</div>
          <div style={{ display: "flex", marginTop: 14, padding: "10px 14px", border: "3px solid #6366f1", borderRadius: 12, fontSize: 20, color: "#64748b" }}>
            2000000000152
          </div>
          {LINES.map(([qty, name, price]) => (
            <div key={name} style={{ display: "flex", alignItems: "center", marginTop: 12, fontSize: 20 }}>
              <div style={{ display: "flex", width: 30, height: 30, borderRadius: 15, background: "#0f172a", color: "white", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
                {qty}
              </div>
              <div style={{ display: "flex", flex: 1, marginLeft: 12 }}>{name}</div>
              <div style={{ display: "flex" }}>{price}</div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, paddingTop: 14, borderTop: "2px solid #e2e8f0", fontSize: 30, fontWeight: 800 }}>
            <span>Total</span>
            <span>$55.96</span>
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 16, padding: "12px 0", borderRadius: 12, background: "#16a34a", color: "white", fontSize: 22, fontWeight: 700 }}>
            Paid · change $4.04
          </div>
        </div>
      </div>
    ),
    size,
  );
}
