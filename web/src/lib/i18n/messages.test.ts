import { expect, test } from "vitest";
import en from "./en.json";
import guestEn from "./guest-booking.en.json";
import guestRu from "./guest-booking.ru.json";
import { t } from "./messages";
import ru from "./ru.json";

test("contains the same nonempty message keys in both languages", () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());

  for (const value of [...Object.values(en), ...Object.values(ru)]) {
    expect(value.trim()).not.toBe("");
  }
});

test("preserves the distinct meeting and guest-booking comment labels", () => {
  expect(t("form.comment", undefined, "en")).toBe("Comment (only you can see it)");
  expect(t("form.comment", undefined, "ru")).toBe("Комментарий (видите только вы)");
  expect(Object.keys(guestEn).sort()).toEqual(Object.keys(guestRu).sort());
  expect(guestEn["form.comment"]).toBe("Comment");
  expect(guestRu["form.comment"]).toBe("Комментарий");
});
