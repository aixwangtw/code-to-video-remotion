---
name: light-leaks
description: Light leak pixel effect for Remotion using @remotion/effects/light-leak.
metadata:
  tags: light-leaks, effects, canvas
---

## Light Leaks

`@remotion/light-leaks` and its `<LightLeak>` component are **deprecated** as of Remotion v4.0.500 (see `remotion.dev/docs/effects/light-leak`) and will stop being published in Remotion v5. Do not `npx remotion add @remotion/light-leaks` in new work — use the `lightLeak()` effect from `@remotion/effects` instead, which requires Remotion 4.0.500+.

Unlike the old `<LightLeak>` component, `lightLeak()` is not a standalone self-animating overlay — it's a pixel effect applied via the `effects` prop of a canvas-based component (`<Solid>`, `<HtmlInCanvas>`, `<Video>`, `<Img>`, `<CanvasImage>`, `<AnimatedImage>`, `<Gif>`, `<RemotionRiveCanvas>`, or `@remotion/shapes` components). You must drive the reveal/retract animation yourself via `progress` — it no longer auto-animates over a `durationInFrames`.

**Not verified:** the official docs page does not show a `TransitionSeries.Overlay` example or a migration guide from the old package. If you need the old "overlay over the cut point between two scenes" behavior, you'll need to work out which host component to wrap `effects={[lightLeak(...)]}` in yourself (e.g. a full-bleed `<Solid>`) and confirm the visual result — don't assume `<CanvasImage>` (the only example Remotion documents) is the right fit for an overlay use case.

## Usage (per official docs example)

```tsx
import { lightLeak } from "@remotion/effects/light-leak";
import { CanvasImage, interpolate, staticFile, useCurrentFrame } from "remotion";

export const MyComp: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <CanvasImage
      src={staticFile("image.png")}
      width={1280}
      height={720}
      fit="cover"
      effects={[
        lightLeak({
          seed: 3,
          hueShift: 30,
          progress: interpolate(frame, [0, 30], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }),
      ]}
    />
  );
};
```

## Props

- `seed?` — determines the shape of the light leak pattern. Different seeds produce different patterns. Default: `0`.
- `hueShift?` — rotates the hue in degrees (`0`–`360`). Default: `0` (yellow-to-orange). `120` = green, `240` = blue.
- `progress?` — reveal/retract phase, `0`–`1`. Must be driven manually via `interpolate()`/`useCurrentFrame()`. Default: `0.5`.
- `disabled?` — skip the effect when `true`. Default: `false`.

## Effects compose in order

Multiple effects on the same component apply as a multipass sequence in array order, e.g. `effects={[lightLeak({...}), blur({radius: 10})]}`.
