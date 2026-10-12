import { ImageResponse } from "next/og";
import { OgMark } from "@/lib/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** Browser-tab icon: the Filed mark from the site header. */
export default function Icon() {
  // The glyph fills more of the badge than in the header: tabs show this at 16px.
  return new ImageResponse(<OgMark size={64} radius={14} fill={0.94} />, size);
}
