# Tandem — setup (about 15 minutes, once)

Tandem has two parts:

- `backend/Code.gs` — a small script that lives inside your Google Sheet and reads/writes it.
- `app/` — the app itself (7 files). Host it anywhere that serves static files over HTTPS.

Want to look first? Open `app/index.html` in a browser and tap **Try the demo**.

---

## Part 1 — Google Sheet backend

1. Go to <https://sheets.new> and name the sheet (e.g. "Tandem expenses").
2. In the sheet: **Extensions → Apps Script**.
3. Delete whatever is in `Code.gs`, paste the whole contents of `backend/Code.gs`, and press **Save**.
4. In the toolbar's function dropdown choose **setup**, then press **Run**.
   - Google asks for permission. Choose your account → **Advanced** → **Go to (project name)** → **Allow**.
     (The "unverified app" warning appears because it is your own private script.)
   - It asks for three things: edit this spreadsheet, send email as you (card reminders), and run a daily timer.
5. Go back to the sheet. You should now see tabs: Expenses, Cards, Recurring, BillPayments, Settings.
6. In Apps Script: **Deploy → New deployment** → gear icon → **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - **Deploy**, then copy the **Web app URL** (it ends in `/exec`).

Keep that URL private — treat it like the address of your data. Signing in still needs a password.

## Part 2 — Host the app (free)

**GitHub Pages**

1. Create a new **public** repository on GitHub (e.g. `tandem`).
2. **Add file → Upload files**, drag in everything *inside* the `app` folder (not the folder itself, and not `backend`), commit.
3. **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)` → Save.
4. After a minute your app is at `https://<your-username>.github.io/tandem/`.

Cloudflare Pages or Netlify (drag-and-drop the `app` folder) work just as well.

## Part 3 — First run

1. Open your app URL on your phone.
2. Paste the backend URL from Part 1 → **Connect**.
3. Create your account (name, password, and your email if you want card reminders).
4. **Settings → Copy setup link** and send it to your partner. They open it and create the second account.
   After two accounts exist, sign-up is closed.

## Part 4 — Install it

| Device | How |
|---|---|
| Android (Chrome) | Menu ⋮ → **Install app** / **Add to Home screen** |
| iPhone / iPad (Safari) | Share → **Add to Home Screen** |
| Windows / Mac (Chrome, Edge) | Install icon in the address bar, or **More → Install app** |
| Mac (Safari) | **File → Add to Dock** |

---

## How things work

- **Offline:** you can add expenses with no signal. The pill at the top shows what is waiting; it syncs by itself when you are back online.
- **The sheet is the source of truth.** You can edit rows directly in Google Sheets; the app picks changes up on its next sync. Deleted expenses stay in the sheet with `deleted = TRUE`. Don't rename the tabs or the header row; adding your own extra columns or tabs is fine.
- **Splits:** `share1` is the first account's share and `share2` the second's. The default split (50/50 or anything else) is in Settings.
- **Settling up:** the balance is the sum of *open* shared expenses. Settle up lists them with tick boxes (everything, one month, or just a few). Recording the payment marks exactly those as settled (`settledBy` column in the sheet). Tap a settlement later to see what it covered or to undo it.
- **Credit cards:** add each card with the day the bill is generated and the day payment is due. Tandem totals what you logged in each billing cycle.
- **Reminders:** every morning the script emails the card owner the day after a bill is generated, then N days before the due date (default 3), 1 day before, and on the day — until you tap **Mark paid**. Use **Settings → Send test email** to check it works. Device notifications also appear when you open the app, if you turn them on.
- **Faster entry:** type sums in the amount box (`250+180`, or tap **+**), tap a quick-add chip on Home for things you log often, or long-press the app icon → **Add expense**. On a computer, press `n` to add and `/` to search.
- **Uneven splits:** Split → Custom → *By items* (what was only yours / only theirs, the rest shared), *Exact amounts*, or *Percent*.
- **Friends:** on any expense, pick friends under *Friends in on this?* (equal with everyone, or enter amounts). Their part is kept out of your spending and is owed to whoever paid. More → Friends shows who owes what, lets you tick what they have paid back, and shares a statement to send them.
- **Platforms:** tag an expense with where it was ordered (Amazon, Swiggy, Zepto…) and whether it was the primary or office phone. Typing the platform's name in the description picks it automatically. Edit the list under More → Categories.
- **Mixed orders:** tap *Mixed* under Category, then pick any categories and the amount for each (add as many rows as you need).
- **On someone's behalf:** switch *Paid by* to your partner; it counts as their payment and is marked as added by you.
- **Bank accounts:** More → Bank accounts & money in. Add each account with the UPI app you use for it; when you pay by UPI, debit card or net banking the form lets you pick which account.
- **Money in:** in the add screen switch *Expense* to *Money in* for salary, transfers, refunds and deposits. It is kept out of spending and shown against your spend for the month.
- **Ask-first recurring:** More → Recurring → *Ask me on some days*. Pick the days and a time; from then Home shows “Add this?” with Add / No (and a device notification while the app is running, if notifications are on).
- **UPI app:** when the mode is UPI, pick the app (GPay, PhonePe…) as well as the account. Picking an account fills in its usual app.
- **Timed prompts when the app is closed:** Settings → *Timed prompts* → *Set up on this phone*.
  - **Android:** install the free **ntfy** app, subscribe to the private topic shown, save. The sheet checks every 5 minutes and sends each due "Ask me" item once, with **Add** and **Not today** buttons that write straight to the sheet.
  - **iPhone:** Shortcuts → Automation → Time of Day → *Choose from Menu* (Add / No) → *Get Contents of URL* with the links copied from the app.
  - The first time you run **setup** after this update, Google asks for one more permission (connect to an external service) so the script can reach ntfy.
- **Transfers:** in the add screen choose *Transfer* for a credit card bill payment, money moved between your own accounts, or a cash withdrawal. They are not spending or income. A card bill transfer also marks that card's bill as paid.
- **Account balance:** open an account and type what it holds today. From then on the account shows an approximate running balance from what you log (settlements between the two of you are not included).
- **Refunds:** open the expense → *Refund*. It is recorded as a negative entry with the same split, so spending, the card bill and what you owe each other all adjust.
- **Part payments:** Settle up → *Pay a part instead* records money handed over on account; it comes off the next settlement. For friends, open the friend → *Received a part*.
- **Import:** More → *Import expenses*. Download your old sheet as CSV and pick the file; check the column matching and the preview before importing. Importing the same rows twice is skipped.
- **Backups:** on the 1st of each month the script saves a full copy of the sheet in the owner's Google Drive (named "… backup YYYY-MM-DD"); Settings → *Back up now* makes one on demand. Old copies are not deleted automatically.
- **Forgot a password:** on the sign-in screen tap *Forgot password?* to get a code by email (needs an email saved in Settings). Without one, sign in with Google, or unhide the `Users` tab and delete that person's row, then register again.
- **Reconcile (catching what you forgot to log):** each credit card and bank account has a *Reconcile* button.
  - *Card:* after the bill is generated, type the statement total. Tandem shows the gap against what you logged for that cycle; add the transactions you remember, mark fees/interest, and book whatever is left as **Unaccounted** (counted against the card owner only).
  - *Account:* type the balance the bank shows. Tandem compares it with the balance it expected and does the same. Reconciling resets the starting balance to the real one.
  - *Match a statement file:* pick the statement CSV instead and Tandem lists only the payments it cannot find among your entries (same amount within ₹1 and within 3 days counts as a match).
- **Monthly email:** on the 1st, both of you get last month's totals and what is still open to settle (turn off in Settings).
- **Recurring:** rent, subscriptions and so on are added automatically on their day each month, the next time either of you opens the app.

## Google sign-in (optional, recommended)

Lets each of you sign in with your Google account instead of a password. One-time setup, free:

1. Go to <https://console.cloud.google.com/>, create a project (any name).
2. Open **APIs & Services → OAuth consent screen** (it may be called *Google Auth Platform*). Choose **External**, give it a name such as "Tandem", and enter your email where asked. While the app is in *Testing*, add both of your Google addresses as **test users**.
3. Open **Credentials** (or *Clients*) → **Create credentials → OAuth client ID** → type **Web application**.
4. Under **Authorized JavaScript origins** add the address of your app *without any path*, for example `https://shreyasc13.github.io`.
5. Create, then copy the **Client ID** (it ends in `.apps.googleusercontent.com`).
6. In Tandem: **Settings → Google sign-in**, paste the client ID. A Google button appears; tap it to link your account. Your partner does the same on their device after signing in once with their password.

From then on the sign-in screen shows a Google button. Password sign-in keeps working as a fallback (for example if the Google pop-up does not open inside the installed iPhone app).

- Passwords are stored as a salted hash repeated thousands of times; old ones are upgraded automatically the next time you sign in with the password. That upgrade signs your other devices out once.
- Google checks are done by asking Google's `tokeninfo` service. Google describes that service as meant for debugging and says it can be throttled, so if a Google sign-in fails, try again or use the password.

## Speed and storage

- The app keeps its copy of your data in the browser's database (IndexedDB), not the small 5 MB store.
- A sync only downloads rows changed since the last one. A full copy is fetched once a day, on first sign-in, and whenever you tap the sync pill.
- Rows you edit by hand in the sheet are stamped automatically so the app picks them up. If something you changed in the sheet does not show, tap the sync pill.

## Updating later

- **App:** upload the new files to the same repository. Devices pick it up the second time they open the app.
- **Backend:** paste the new `Code.gs`, then **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The URL stays the same. (A plain Save does not update the live web app.)

## Good to know

- Forgot a password? Unhide the `Users` tab in the sheet, delete that person's row, and register again with the same name. Their expenses are kept.
- Card totals are what you logged, so they can differ from the bank's statement (fees, interest, refunds).
- Never type a full card number anywhere in Tandem — the optional "last 4" is only a label.
