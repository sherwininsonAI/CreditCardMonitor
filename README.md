# Ledgerly — Credit Card Monitor

A lightweight credit-card finance dashboard that runs in a web browser.

## Open the app

Open `index.html` in a modern browser. No installation, account, or build step is required. Spreadsheet and OCR import features download their processing libraries from public CDNs on first use, so they need internet access initially.

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

Records are saved in this browser's local storage and are not sent to a server. They are not automatically shared with another browser or device. This app does not connect to banks or submit payments; it is a manual tracking tool. For your safety, enter only a card nickname and its last four digits—never a full card number, security code, or PIN.

Spreadsheet files and OCR both run in-browser; the statement file and extracted transaction data are not uploaded. Excel support and the PDF/OCR libraries are downloaded from public CDN URLs when first needed, so internet access is required on first use. For spreadsheets, map purchase date, description, and amount; optional post and due date columns can also be mapped. Excel date cells and common date strings are supported; choose month/day or day/month for ambiguous text dates. Review the preview before importing. OCR is approximate and remains available as a fallback; for the supported image statement layout, sale date maps to purchase date and post date is retained separately. Where available, the final peso-amount column is used. Set the app currency to match imported amounts; changing display currency does not convert them.

For each card, set the statement day and the number of days after the statement date that payment is due. Due dates are calculated using the calendar month and can fall in the following month. Existing cards with only a saved due day receive an estimated days-after value when edited; confirm that estimate with the card issuer.

The balance is a simple calculation from entries you record. It does not include unentered interest, fees, refunds, or pending bank transactions.

The monthly card sheet shows a single card total and combined payment for each month. If no direct monthly value has been entered, it uses dated transactions due that month and payments made that month as the starting values.

You can skip daily transactions and enter one monthly card amount and one combined monthly payment per card directly in the Jan–Dec sheet, along with a due date and optional interest. The dashboard links directly to this workflow and defaults to monthly due-date totals. The sheet calculates each month's balance as amount + interest − payment and shows separate all-card monthly totals for amount due, payments, and balance. A value entered directly in a card/month cell replaces the dated transaction or payment total for that card/month in balance calculations.

Salary is recorded as actual amounts per person and month: the 15th cutoff covers days 1–15, and the 30th cutoff covers day 16 through the end of that month. The second cutoff uses the calendar month's last day (including February 28 or 29). A person's usual monthly salary is optional reference information and is not used to calculate income reports.
