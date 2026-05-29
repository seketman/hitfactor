import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const AMBER = "#d97706";
const BG = "#0c0c10";

/**
 * Apple Touch Icon 180×180. La diana ámbar del logo (sin wordmark) sobre el
 * fondo oscuro de la marca, consistente con `src/app/icon.svg`.
 */
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
          backgroundColor: BG,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 124,
            height: 124,
            borderRadius: 9999,
            border: `10px solid ${AMBER}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 72,
              height: 72,
              borderRadius: 9999,
              border: `10px solid ${AMBER}`,
            }}
          >
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 9999,
                background: AMBER,
              }}
            />
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
