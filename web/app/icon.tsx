import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** Browser-tab icon: the "F" badge from the site header. */
export default function Icon() {
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
          borderRadius: 14,
          color: "#fff",
          fontSize: 44,
          fontWeight: 700,
        }}
      >
        F
      </div>
    ),
    size,
  );
}
