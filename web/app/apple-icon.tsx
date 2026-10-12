import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon (iOS "Add to Home Screen" and link unfurlers that look for one). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#256abf",
          color: "#fff",
          fontSize: 124,
          fontWeight: 700,
        }}
      >
        F
      </div>
    ),
    size,
  );
}
