import { test, expect } from "@playwright/test";
import { goToTool } from "./desk-navigation";

test.use({ reducedMotion: "reduce" });

test("study partner opens only by its button and remembers an auto-apply opt-out", async ({ page }) => {
  const partner = page.getByRole("complementary", { name: "AI study partner" });
  const toggle = page.getByRole("button", { name: "Toggle study partner", exact: true });
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await expect(partner).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await goToTool(page, "Journal");
  await expect(partner).toHaveCount(0);

  await toggle.click();
  const autoApply = partner.getByRole("switch", { name: "Auto-apply changes" });
  await expect(autoApply).toBeChecked();
  await autoApply.uncheck();
  await partner.getByRole("button", { name: "Close study partner", exact: true }).click();
  await goToTool(page, "Computer");
  await expect(partner).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await expect(partner).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(autoApply).not.toBeChecked();
});
