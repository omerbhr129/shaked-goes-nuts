import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function QR({ url, size }: { url: string; size: number }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#04170F", light: "#F3E3C3" } })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [url]);
  return <div className="qr" style={{ width: size, height: size }} role="img" aria-label={`קוד QR לכתובת ${url}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}
