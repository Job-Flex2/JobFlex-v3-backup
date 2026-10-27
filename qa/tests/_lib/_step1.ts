// STEP 1 OF THE SIGN-UP, TYPED THE WAY A PERSON TYPES IT — at any width.
//
// On a phone (≤768px) /auth/register is the sheet over the app (d926973a, components/v3/auth-register-mobile): it
// opens at a peek with the email field alone, and the name field (and the password fields of the password sign-up)
// come into view only once the email is typed and the sheet opens. On a desk every field is there from the start.
// So: the email first, then wait for the name field to be visible, then the name. JavaScript off draws the whole
// form at once, which this handles the same way.
// Playwright is found at run time (./_prod-server playwright()), so the page is typed by what is used of it.
type Field = { waitFor(o: { state: "visible"; timeout: number }): Promise<unknown>; fill(v: string): Promise<unknown> };
type Located = Field & { filter(o: { visible: boolean }): { first(): Field & { focus(): Promise<unknown> } }; count(): Promise<number> };
type Page = { locator(sel: string): Located; waitForTimeout(ms: number): Promise<unknown> };

export async function fillStepOne(page: Page, opts: { name: string; email: string; timeout?: number }): Promise<void> {
  const timeout = opts.timeout ?? 30000;
  const email = page.locator("#step1 #email, #email").filter({ visible: true }).first();
  await email.waitFor({ state: "visible", timeout });
  await email.fill(opts.email);
  const name = page.locator("#step1 #name, #name").filter({ visible: true }).first();
  await name.waitFor({ state: "visible", timeout });
  await name.fill(opts.name);
}

/** The phone's sheet opened, the way a person opens it — a tap into the email field (the sheet opens on a field's
 *  focus): everything on step 1, the Google button too, is then in view. On a desk (no sheet) nothing happens. */
export async function openStepOneSheet(page: Page, timeout = 30000): Promise<void> {
  if (!(await page.locator('section[data-state="peek"]').count())) return;
  const email = page.locator("#email").filter({ visible: true }).first();
  await email.waitFor({ state: "visible", timeout });
  await email.focus();
  await page.locator('section[data-state="open"]').waitFor({ state: "visible", timeout });
  // The sheet's slide up.
  await page.waitForTimeout(700);
}
