# Ledgerly — Credit Card Monitor

A lightweight credit-card finance dashboard that runs in a web browser and stores each signed-in user's records in Firebase Cloud Firestore.

## Open the app

Serve the project through Firebase Hosting (see **Firebase setup** below). The app uses Firebase Authentication and Firestore, so it cannot be opened directly with `file://`. Spreadsheet, OCR, and Firebase SDK libraries are loaded from public CDNs and need internet access.

## Features

- Maintain credit cards, an editable sort number, statement day, days from statement to payment due, limits, and last four digits. Cards are ordered by ascending sort number in My cards and the monthly sheet. The payment due date is calculated from the statement date and offset; it is not manually editable.
- Maintain people and record each person's actual salary separately for the 1st–15th and 16th–end-of-month cutoffs. Cutoff amounts can vary month to month; optional usual salary is reference only.
- Record card charges with purchase, statement, and due dates.
- Import card transactions from Excel (`.xlsx`, `.xls`) or CSV files. Choose the date, merchant, amount, and optional post/due-date columns, then review and correct rows before importing.
- Import image or PDF card statements with in-browser OCR as a fallback; verify recognized sale/post dates, descriptions, and amounts before importing.
- Record payments and associate charges/payments with a person.
- Calculate outstanding balances as recorded charges minus recorded payments.
- View monthly or yearly spending reports, including purchase-date, statement-date, and due-date totals.
- Compare monthly card amount-due and payment totals in a grouped bar chart and a line graph, with paid-versus-due percentages and exact values plus the unpaid gap on hover/focus. Each graph has its own all-cards or per-card filter, saved for the current browser session. The dashboard card list shows current balance versus remaining credit as a pie chart for each card.
- View all 12 months in a spreadsheet-style card summary with due dates, billed amounts, payments, and estimated remaining amounts; export the sheet as a CSV for Excel.
- Filter the monthly card sheet by card name; the selected card filter is kept in browser session storage across refreshes in the same session, and totals/export follow the selected card.
- Due dates turn green and their warning icon is hidden when a payment is recorded for that billing cycle, including payments made before or after the due date.
- Open the compact monthly card and salary sheets positioned at the current month, while keeping the January–December column order and preserving your horizontal position during sheet edits.
- Switch the monthly credit-card sheet between editable entry mode and a compact, read-only view of card details by month; the selected mode is remembered for the current browser session. View mode hides salary details and entry controls.
- View salary totals for each person's two pay cutoffs by month and year on the monthly sheet; recorded income is reflected in the dashboard.
- Change the display currency from the top bar.

## Data and privacy

Records are stored in Cloud Firestore under the signed-in user's Firebase UID. Firestore security rules restrict each active account to its own data and check a server-managed access record, so deactivation blocks Firestore access and signs out open app sessions as well as preventing future sign-ins. An administrator can create active accounts and deactivate accounts; users cannot self-register. An administrator account is a Firebase Authentication user with the `admin` custom claim, which is granted using the trusted Admin SDK bootstrap script—not from browser code. Passwords are managed by Firebase Authentication. A password reset link is available on the sign-in screen.

The first time an account signs in with empty cloud storage, the app offers to migrate existing records from this browser's local storage. Migration copies the data to Firestore and leaves the local browser copy untouched. Other devices do not automatically import browser-local records.

This app does not connect to banks or submit payments; it is a manual tracking tool. For your safety, enter only a card nickname and its last four digits—never a full card number, security code, or PIN.

## Firebase setup

1. Register a **Web app** in your Firebase project and place its `firebaseConfig` values in `firebase-config.js`. Firebase web configuration is visible to users; never put a service-account key or other private credential in that file.
2. In Firebase Console, enable **Authentication → Email/Password**, and create a **Cloud Firestore** database.
3. Install Node.js 20, the Firebase CLI, and the Google Cloud CLI (`gcloud`), then sign in:

   ```powershell
   npm install -g firebase-tools
   firebase login
   firebase use --add
   ```

   Select your project when prompted. Cloud Functions deployment requires a Firebase project on the Blaze billing plan. For local testing at `http://127.0.0.1:8765`, add `127.0.0.1` to **Authentication → Settings → Authorized domains** (add `localhost` too if you use that hostname).
4. Deploy the Firestore ownership rules, account-management functions, and web app:

   ```powershell
   firebase deploy --only firestore:rules,functions,hosting
   ```

5. Create the first administrator in **Firebase Console → Authentication → Users**. From the `functions` folder, install its dependencies, authenticate the Firebase Admin SDK with Google Application Default Credentials, and set the project ID and administrator claim. Run these commands in the same PowerShell window:

   ```powershell
   cd functions
   npm install
   gcloud auth application-default login
   $env:GCLOUD_PROJECT = "sherwin-ai"
   node scripts/set-admin.js --email admin@example.com
   ```

   Replace `admin@example.com` with the email of an account that already exists in Firebase Authentication. The Google account used by `gcloud auth application-default login` must have permission to manage Firebase Authentication users and write to Firestore in this project. Sign out and back in after assigning the claim. Keep the administrator password and cloud credentials private. Accounts with the admin claim are protected from being disabled in the app; manage those accounts through trusted Firebase Console/Admin SDK access.
6. Sign in as that administrator and use **Accounts** to create active accounts or activate/deactivate existing accounts. The administrator sets an initial temporary password; share it securely and have the user change it after signing in. Account creation and status changes run through admin-claim-protected Cloud Functions.

For production, restrict the Firebase API key to your app's authorized domains and the APIs it needs. The Firestore rules intentionally grant users access only to documents beneath their own UID; do not replace them with open/test rules.

Spreadsheet files and OCR both run in-browser; the statement file and extracted transaction data are not uploaded. Excel support and the PDF/OCR libraries are downloaded from public CDN URLs when first needed, so internet access is required on first use. For spreadsheets, map purchase date, description, and amount; optional post and due date columns can also be mapped. Excel date cells and common date strings are supported; choose month/day or day/month for ambiguous text dates. Review the preview before importing. OCR is approximate and remains available as a fallback; for the supported image statement layout, sale date maps to purchase date and post date is retained separately. Where available, the final peso-amount column is used. Set the app currency to match imported amounts; changing display currency does not convert them.

For each card, set the statement day and the number of days after the statement date that payment is due. Due dates are calculated using the calendar month and can fall in the following month. Existing cards with only a saved due day receive an estimated days-after value when edited; confirm that estimate with the card issuer.

The balance is a simple calculation from entries you record. It does not include unentered interest, fees, refunds, or pending bank transactions.

The monthly card sheet shows a single card total and combined payment for each month. If no direct monthly value has been entered, it uses dated transactions due that month and payments made that month as the starting values.

You can skip daily transactions and enter one monthly card amount and one combined monthly payment per card directly in the Jan–Dec sheet, along with a due date and optional interest. The dashboard links directly to this workflow and defaults to monthly due-date totals. The sheet calculates each month's balance as amount + interest − payment and shows separate all-card monthly totals for amount due, payments, and balance. A value entered directly in a card/month cell replaces the dated transaction or payment total for that card/month in balance calculations.

Salary is recorded as actual amounts per person and month: the 15th cutoff covers days 1–15, and the 30th cutoff covers day 16 through the end of that month. The second cutoff uses the calendar month's last day (including February 28 or 29). A person's usual monthly salary is optional reference information and is not used to calculate income reports.
