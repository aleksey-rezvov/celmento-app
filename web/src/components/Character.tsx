import type { ReactElement } from "react";
import { PLACEMENT, type CharacterState } from "../lib/characters";

interface CharacterProps {
  state: CharacterState;
  size: number;
}

const densitySizes = [200, 400, 600] as const;

function imageSources(file: string, format: "webp" | "png"): string {
  return densitySizes
    .map((pixels, index) => `/characters/${file}@${pixels}px.${format} ${index + 1}x`)
    .join(", ");
}

export function Character({ state, size }: CharacterProps): ReactElement {
  const { files } = PLACEMENT[state];

  // spec:impl character-illustrations#cream-character-surface
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        marginInline: "auto",
        width: size * files.length,
        maxWidth: "100%",
        backgroundColor: "var(--color-cream, #F5ECE5)",
      }}
    >
      {files.map((file) => (
        <picture key={file} style={{ flex: "1 1 0", minWidth: 0 }}>
          {/* spec:impl character-illustrations#webp-by-pixel-density */}
          <source type="image/webp" srcSet={imageSources(file, "webp")} />
          {/* spec:impl character-illustrations#matching-png-fallback */}
          {/* spec:impl character-illustrations#square-no-crop */}
          <img
            src={`/characters/${file}@200px.png`}
            srcSet={imageSources(file, "png")}
            width={size}
            height={size}
            alt=""
            style={{
              display: "block",
              width: "100%",
              height: "auto",
              aspectRatio: "1 / 1",
              objectFit: "contain",
            }}
          />
        </picture>
      ))}
    </div>
  );
}
