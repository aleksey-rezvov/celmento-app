import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss, { type Root } from "postcss";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import RootLayout from "./layout";
import Home from "./page";

function declaration(styles: Root, selector: string, property: string): string | undefined {
  let value: string | undefined;
  styles.walkRules(selector, (rule) => {
    rule.walkDecls(property, (entry) => {
      value = entry.value;
    });
  });
  return value;
}

// spec:test mobile-app-shell#center-phone-width-shell
test("wraps the page in a centered phone-width frame on the cream background", () => {
  const markup = renderToStaticMarkup(
    <RootLayout>
      <Home />
    </RootLayout>,
  );
  const document = new DOMParser().parseFromString(markup, "text/html");

  expect(document.querySelector("body > .app-frame > main")).not.toBeNull();

  const stylesheet = resolve("src/app/globals.css");
  const styles = postcss.parse(readFileSync(stylesheet, "utf8"));

  expect(declaration(styles, ".app-frame", "width")).toBe("min(100%, var(--app-width))");
  expect(declaration(styles, ":root", "--app-width")).toBe("24.5625rem");
  expect(declaration(styles, ".app-frame", "margin-inline")).toBe("auto");
  expect(declaration(styles, "body", "background")).toBe("var(--color-cream)");
  expect(declaration(styles, ":root", "--color-cream")?.toLowerCase()).toBe("#f5ece5");
});
