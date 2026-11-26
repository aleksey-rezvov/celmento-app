import { expect, test } from "vitest";
import { characterFiles } from "./characters";

// spec:test character-illustrations#state-image-with-master-fallback
test("chooses matching state files when supplied and otherwise uses the same-colour master", () => {
  expect(characterFiles("signup", new Set(["celmento-signup"]))).toEqual(["celmento-signup"]);
  expect(characterFiles("signup", new Set(["celmento-code"]))).toEqual(["celmento-master-red"]);
  expect(characterFiles("notes_not_found", new Set(["celmento-not-found"]))).toEqual([
    "celmento-not-found",
  ]);
});

test("uses two separate masters until the approved state art is supplied", () => {
  expect(characterFiles("finish_pair", new Set())).toEqual([
    "celmento-master-blue",
    "celmento-master-red",
  ]);
  expect(characterFiles("finish_pair", new Set(["celmento-finish"]))).toEqual(["celmento-finish"]);
});
