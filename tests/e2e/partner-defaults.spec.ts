import { test, expect } from "@playwright/test";

test.use({ reducedMotion: "reduce" });

test("study partner opens only by its button and remembers an auto-apply opt-out", async ({ page }) => {
  const partner = page.getByRole("complementary", { name: "AI study partner" });
  const toggle = page.getByRole("button", { name: "Toggle study partner", exact: true });
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await expect(partner).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name: "Journal", exact: true }).click();
  await expect(partner).toHaveCount(0);

  await toggle.click();
  const autoApply = partner.getByRole("switch", { name: "Auto-apply changes" });
  await expect(autoApply).toBeChecked();
  await autoApply.uncheck();
  await partner.getByRole("button", { name: "Close study partner", exact: true }).click();
  await page.getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name: "Computer", exact: true }).click();
  await expect(partner).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await expect(partner).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(autoApply).not.toBeChecked();
});
