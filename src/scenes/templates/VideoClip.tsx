import React from "react";
import {
  OffthreadVideo,
  interpolate,
  Easing,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { SceneVisual } from "../../types";
import { BLACK, WHITE } from "../../constants";

type Props = Extract<SceneVisual, { type: "videoClip" }> & {
  accentColor: string;
};

// 與 Terminal 同樣的黑框視窗語言,但內容是真實錄影。
// portrait 給手機直式實拍(9:16),landscape 給螢幕錄影(16:9)。
const SIZES = {
  landscape: { width: 880, height: 495 },
  portrait: { width: 315, height: 560 },
};

export const VideoClip: React.FC<Props> = ({
  src,
  aspect = "landscape",
  label,
  startFromSeconds = 0,
  muted = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const containerP = interpolate(Math.max(0, frame - 10), [0, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.back(1.2)),
  });

  const { width, height } = SIZES[aspect];

  return (
    <div
      style={{
        opacity: containerP,
        transform: `scale(${containerP}) translateY(${(1 - containerP) * 24}px)`,
        width,
        background: WHITE,
        border: `6px solid ${BLACK}`,
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          background: BLACK,
          padding: "10px 18px",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <Dot color="#FF5F57" />
        <Dot color="#FEBC2E" />
        <Dot color="#28C840" />
        {label ? (
          <div
            style={{
              color: WHITE,
              fontSize: 14,
              marginLeft: 14,
              letterSpacing: 2,
            }}
          >
            {label}
          </div>
        ) : null}
      </div>
      <div style={{ width, height, background: BLACK }}>
        <OffthreadVideo
          src={staticFile(src)}
          startFrom={Math.round(startFromSeconds * fps)}
          muted={muted}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    </div>
  );
};

const Dot: React.FC<{ color: string }> = ({ color }) => (
  <div style={{ width: 12, height: 12, borderRadius: 6, background: color }} />
);
