import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Character } from "./Character";

afterEach(cleanup);

// spec:test character-illustrations#webp-by-pixel-density
test("offers the 1x, 2x, and 3x WebP files for the character", () => {
  const { container } = render(<Character state="code" size={200} />);
  const source = container.querySelector("picture > source");

  expect(source?.getAttribute("type")).toBe("image/webp");
  expect(source?.getAttribute("srcset")).toBe(
    "/characters/celmento-master-blue@200px.webp 1x, " +
      "/characters/celmento-master-blue@400px.webp 2x, " +
      "/characters/celmento-master-blue@600px.webp 3x",
  );
});

// spec:test character-illustrations#matching-png-fallback
test("uses the same character and pixel densities for the PNG fallback", () => {
  const { container } = render(<Character state="code" size={200} />);
  const image = container.querySelector("picture > img");

  expect(image?.getAttribute("src")).toBe("/characters/celmento-master-blue@200px.png");
  expect(image?.getAttribute("srcset")).toBe(
    "/characters/celmento-master-blue@200px.png 1x, " +
      "/characters/celmento-master-blue@400px.png 2x, " +
      "/characters/celmento-master-blue@600px.png 3x",
  );
});

// spec:test character-illustrations#cream-character-surface
test("places the character on the project's cream background", () => {
  const { container } = render(<Character state="code" size={200} />);

  expect(container.querySelector("picture")?.parentElement?.getAttribute("style")).toMatch(
    /background-color:\s*var\(--color-cream,\s*#f5ece5\)/iu,
  );
});

// spec:test character-illustrations#square-no-crop
test("keeps each character square and uncropped at the requested size", () => {
  const { container } = render(<Character state="login_pair" size={173} />);
  const images = container.querySelectorAll<HTMLImageElement>("picture > img");

  expect(images).toHaveLength(2);
  for (const image of images) {
    expect(image.getAttribute("width")).toBe("173");
    expect(image.getAttribute("height")).toBe("173");
    expect(image.style.getPropertyValue("aspect-ratio")).toMatch(/^1\s*\/\s*1$/u);
    expect(image.style.objectFit).toBe("contain");
  }
});
