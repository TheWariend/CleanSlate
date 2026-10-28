# Desktop demo background

Source: [cleanslate-desktop-background.png](cleanslate-desktop-background.png).
Generated with the built-in imagegen tool.

## Generation prompt

Use case: ads-marketing

Asset type: Background wallpaper for a desktop software demo video, landscape 1600 by 1020 composition.

Primary request: Create only a refined, understated blue-to-purple gradient wallpaper that will sit behind a large dark app window. No app window in the image. Smooth muted periwinkle blue toward upper left flowing to dusty violet and lavender toward lower right, gently luminous and softly shaded, with extremely subtle large flowing color fields like an elegant modern desktop wallpaper. Medium lightness, calm, understated, premium software presentation. Background should have visible blue and purple color across all four margins. Center remains quiet because an opaque app window will cover it.

Constraints: edge-to-edge abstract wallpaper only; no text, no letters, no logo, no watermark, no objects, no interface, no frame, no strong lines, no sharp details, no black border. Smooth clean gradients without texture or noise.

## Video composition

The original app window is cropped from the recording at x=58, y=39,
width=1484, height=904. Its pixels retain their native size. A static rounded
corner mask removes the exterior black corners without keying out dark app
content. The window is centered at x=118, y=98 on a 1720 by 1100 background,
with a soft shadow offset 16 pixels downward. FFmpeg composites the original
frames over the static backdrop and exports an H.264 MP4 for the README.

The export preserves all 1,868 source frame timestamps and the 32.683333-second
duration. It uses H.264, CRF 18, the slow preset, BT.709 color, YUV 4:2:0, and
fast-start metadata. The README thumbnail is extracted from the finished video.
