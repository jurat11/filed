import { ImageResponse } from "next/og";
import { OgMark } from "@/lib/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon (iOS "Add to Home Screen" and link unfurlers that look for one). Full
 * bleed, since iOS rounds the corners itself. */
export default function AppleIcon() {
  return new ImageResponse(<OgMark size={180} radius={0} />, size);
}
