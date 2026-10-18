(function () {
  "use strict";

  const STORAGE_KEY = "ledgerly.credit-monitor.v1";
  const pageTitles = {
    dashboard: "Overview",
    monthly: "Monthly sheet",
    transactions: "Transactions",
    import: "Import statement",
    payments: "Payments",
    cards: "My cards",
    people: "People & income"
  };
  const today = new Date();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  let state = loadState();
  let activePage = "dashboard";
  let monthlyCardFilterId = sessionStorage.getItem("ledgerly.monthly-card-filter") || "";
  let monthlySheetViewMode = sessionStorage.getItem("ledgerly.monthly-sheet-view-mode") === "view" ? "view" : "edit";
  let dashboardChartCardFilterId = sessionStorage.getItem("ledgerly.dashboard-chart-card-filter") || "";
  let dashboardLineChartCardFilterId = sessionStorage.getItem("ledgerly.dashboard-line-chart-card-filter") || "";
  let periodMonth = currentMonth;
  let periodMode = "month";
  let reportYear = today.getFullYear();
  let reportBasis = "dueDate";
  let transactionSearch = "";
  let importState = { fileName: "", rows: [], error: "", progress: "", busy: false, mode: "spreadsheet", spreadsheetHeaders: [], spreadsheetData: [], spreadsheetMapping: {}, dateOrder: "MDY" };

  function loadState() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return { cards: [], people: [], transactions: [], payments: [], incomes: [], monthlyStatements: [], currency: "USD" };
      const parsed = JSON.parse(stored);
      return {
        cards: Array.isArray(parsed.cards) ? parsed.cards.map((card, index) => {
          const sortNo = Number(card.sortNo);
          return { ...card, sortNo: Number.isInteger(sortNo) && sortNo >= 1 ? sortNo : index + 1 };
        }) : [],
        people: Array.isArray(parsed.people) ? parsed.people : [],
        transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
        payments: Array.isArray(parsed.payments) ? parsed.payments : [],
        incomes: Array.isArray(parsed.incomes) ? parsed.incomes : [],
        monthlyStatements: Array.isArray(parsed.monthlyStatements) ? parsed.monthlyStatements : [],
        currency: ["USD", "PHP", "EUR", "GBP", "CAD", "AUD", "INR", "SGD"].includes(parsed.currency) ? parsed.currency : "USD"
      };
    } catch (error) {
      console.error("Could not load saved finance data.", error);
      return { cards: [], people: [], transactions: [], payments: [], incomes: [], monthlyStatements: [], currency: "USD" };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Could not save finance data.", error);
      toast("Could not save your changes. Check browser storage availability.", true);
      return false;
    }
    return true;
  }

  function id() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[char]);
  }

  function money(value) {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: state.currency }).format(Number(value) || 0);
  }

  function formatDate(value) {
    if (!value) return "—";
    const parsed = new Date(`${value}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(parsed);
  }

  function dueDateStatusClass(value, isPaid) {
    if (!value) return "";
    const due = new Date(`${value}T00:00:00`);
    if (Number.isNaN(due.getTime())) return "";
    if (isPaid) return "due-date-paid";
    const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const daysUntilDue = Math.round((due - currentDay) / 86400000);
    if (daysUntilDue < 0) {
      const overdueMonth = new Date(currentDay.getFullYear(), currentDay.getMonth() - 1, 1);
      const lastDayOfOverdueMonth = new Date(overdueMonth.getFullYear(), overdueMonth.getMonth() + 1, 0).getDate();
      const overdueLimit = new Date(overdueMonth.getFullYear(), overdueMonth.getMonth(), Math.min(currentDay.getDate(), lastDayOfOverdueMonth));
      if (due >= overdueLimit) return "due-date-overdue";
      return "";
    }
    if (daysUntilDue <= 3) return "due-date-soon";
    if (daysUntilDue <= 7) return "due-date-upcoming";
    return "";
  }

  function dueDateStatusMessage(status) {
    if (status === "due-date-overdue") return "Red: this due date has passed.";
    if (status === "due-date-soon") return "Orange: due today or within the next 3 days.";
    if (status === "due-date-upcoming") return "Yellow: due in 4–7 days.";
    return "";
  }

  function dueDateInfoIcon(status) {
    const message = dueDateStatusMessage(status);
    return message ? `<span class="due-date-info" role="img" tabindex="0" aria-label="${message}" data-tooltip="${message}">ⓘ</span>` : "";
  }

  function dueDateCell(value, cardId) {
    if (!value) return `<td>—</td>`;
    const status = dueDateStatusClass(value, hasPaymentForDueDate(cardId, value));
    const statusText = status === "due-date-overdue" ? "Overdue" : status === "due-date-soon" ? "Due soon" : status === "due-date-upcoming" ? "Upcoming" : "";
    const label = status === "due-date-paid" ? "Paid" : statusText;
    return `<td class="due-date-cell ${status}"><span>${escapeHtml(formatDate(value))} ${dueDateInfoIcon(status)}</span>${label ? `<small>${label}</small>` : ""}</td>`;
  }

  function monthLabel(value) {
    const date = new Date(`${value}-01T12:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
  }

  function monthOptions(selected) {
    const options = [];
    for (let offset = -24; offset <= 12; offset += 1) {
      const date = new Date(today.getFullYear(), today.getMonth() + offset, 1);
      const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      options.push(`<option value="${value}" ${value === selected ? "selected" : ""}>${monthLabel(value)}</option>`);
    }
    if (!options.some((option) => option.includes(`value="${selected}"`))) {
      options.push(`<option value="${escapeHtml(selected)}" selected>${monthLabel(selected)}</option>`);
    }
    return options.join("");
  }

  function selectedTotal(items, dateField, month) {
    return items.reduce((total, item) => String(item[dateField] || "").slice(0, 7) === month ? total + Number(item.amount || 0) : total, 0);
  }

  function selectedYearTotal(items, dateField, year) {
    return items.reduce((total, item) => String(item[dateField] || "").slice(0, 4) === String(year) ? total + Number(item.amount || 0) : total, 0);
  }

  function yearOptions(selected) {
    return Array.from({ length: 9 }, (_, index) => today.getFullYear() - 4 + index)
      .map((year) => `<option value="${year}" ${year === selected ? "selected" : ""}>${year}</option>`).join("");
  }

  function cardById(cardId) {
    return state.cards.find((card) => card.id === cardId);
  }

  function orderedCards() {
    return state.cards.slice().sort((a, b) => Number(a.sortNo) - Number(b.sortNo));
  }

  function nextCardSortNo() {
    return state.cards.reduce((max, card) => Math.max(max, Number(card.sortNo) || 0), 0) + 1;
  }

  function displayedMonthlyCards() {
    const cards = orderedCards();
    if (monthlyCardFilterId && !cards.some((card) => card.id === monthlyCardFilterId)) {
      monthlyCardFilterId = "";
      sessionStorage.removeItem("ledgerly.monthly-card-filter");
    }
    return monthlyCardFilterId ? cards.filter((card) => card.id === monthlyCardFilterId) : cards;
  }

  function personById(personId) {
    return state.people.find((person) => person.id === personId);
  }

  function incomeByPersonMonthCutoff(personId, month, cutoff) {
    return state.incomes.filter((income) => income.personId === personId && income.month === month && income.cutoff === cutoff)
      .reduce((sum, income) => sum + Number(income.amount || 0), 0);
  }

  function incomeForMonth(month) {
    return state.incomes.filter((income) => income.month === month)
      .reduce((sum, income) => sum + Number(income.amount || 0), 0);
  }

  function incomeForYear(year) {
    return state.incomes.filter((income) => String(income.month || "").slice(0, 4) === String(year))
      .reduce((sum, income) => sum + Number(income.amount || 0), 0);
  }

  function monthlyStatementForCard(cardId, month) {
    return state.monthlyStatements.find((statement) => statement.cardId === cardId && statement.month === month) || null;
  }

  function dateToIso(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function statementDateForMonth(card, year, monthIndex) {
    const statementDay = Number(card?.statementDay);
    if (!statementDay) return null;
    const firstDay = new Date(year, monthIndex, 1);
    const lastDay = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0).getDate();
    return new Date(firstDay.getFullYear(), firstDay.getMonth(), Math.min(statementDay, lastDay));
  }

  function dueDateAfterStatement(card, statementDate) {
    const days = Number(card?.dueDaysAfterStatement);
    if (!statementDate || !Number.isFinite(days) || days < 0) return "";
    const dueDate = new Date(statementDate);
    dueDate.setDate(dueDate.getDate() + days);
    return dateToIso(dueDate);
  }

  function dueDateForMonth(card, year, monthIndex) {
    if (card?.dueDaysAfterStatement !== undefined && Number(card.statementDay)) {
      const targetMonth = new Date(year, monthIndex, 1);
      const matches = [];
      for (let offset = -4; offset <= 1; offset += 1) {
        const statementDate = statementDateForMonth(card, targetMonth.getFullYear(), targetMonth.getMonth() + offset);
        const dueDate = dueDateAfterStatement(card, statementDate);
        if (dueDate && dueDate.slice(0, 7) === `${targetMonth.getFullYear()}-${String(targetMonth.getMonth() + 1).padStart(2, "0")}`) {
          matches.push(dueDate);
        }
      }
      if (matches.length) return matches.sort()[0];
    }
    const day = Number(card?.dueDay);
    if (!day) return "";
    const targetMonth = new Date(year, monthIndex, 1);
    const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
    return dateToIso(new Date(targetMonth.getFullYear(), targetMonth.getMonth(), Math.min(day, lastDay)));
  }

  function nextCardDueDate(card) {
    if (card?.dueDaysAfterStatement !== undefined && Number(card.statementDay)) {
      const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const upcoming = [];
      for (let offset = -1; offset <= 3; offset += 1) {
        const statementDate = statementDateForMonth(card, today.getFullYear(), today.getMonth() + offset);
        const dueDate = dueDateAfterStatement(card, statementDate);
        if (dueDate && dueDate >= dateToIso(now)) upcoming.push(dueDate);
      }
      if (upcoming.length) return upcoming.sort()[0];
    }
    const currentMonthDueDate = dueDateForMonth(card, today.getFullYear(), today.getMonth());
    if (currentMonthDueDate && currentMonthDueDate >= dateToIso(today)) return currentMonthDueDate;
    return dueDateForMonth(card, today.getFullYear(), today.getMonth() + 1);
  }

  function estimatedDaysAfterStatement(card) {
    if (card?.dueDaysAfterStatement !== undefined) return Number(card.dueDaysAfterStatement);
    const statementDay = Number(card?.statementDay);
    const dueDay = Number(card?.dueDay);
    if (!statementDay || !dueDay) return "";
    const referenceStatementDate = new Date(2026, 0, Math.min(statementDay, 31));
    const referenceDueDate = new Date(2026, 0, Math.min(dueDay, 31));
    if (referenceDueDate <= referenceStatementDate) referenceDueDate.setMonth(referenceDueDate.getMonth() + 1);
    return Math.round((referenceDueDate - referenceStatementDate) / 86400000);
  }

  function cardDuePreviewText(statementDay, daysAfterStatement) {
    const statementDayNumber = Number(statementDay);
    const offset = Number(daysAfterStatement);
    if (!statementDayNumber || !Number.isFinite(offset) || offset < 0) return "Enter a statement day and days-after value to calculate the due date.";
    const statementDate = statementDateForMonth({ statementDay: statementDayNumber }, today.getFullYear(), today.getMonth());
    const dueDate = dueDateAfterStatement({ dueDaysAfterStatement: offset }, statementDate);
    return `Calculated from this month's statement: ${formatDate(dueDate)}.`;
  }

  function cardMonthData(card, year, monthIndex) {
    const month = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    const statement = monthlyStatementForCard(card.id, month);
    const legacyDue = selectedTotal(state.transactions.filter((item) => item.cardId === card.id), "dueDate", month);
    const legacyPayment = selectedTotal(state.payments.filter((item) => item.cardId === card.id), "paymentDate", month);
    const dueAmount = statement && Object.prototype.hasOwnProperty.call(statement, "amountDue")
      ? Number(statement.amountDue || 0) : legacyDue;
    const paid = statement && Object.prototype.hasOwnProperty.call(statement, "payment")
      ? Number(statement.payment || 0) : legacyPayment;
    const generatedDate = dueDateForMonth(card, year, monthIndex);
    const dueDate = statement && Object.prototype.hasOwnProperty.call(statement, "dueDate")
      ? statement.dueDate : generatedDate;
    const interest = statement ? Number(statement.interest || 0) : 0;
    return { month, dueDate, dueAmount, paid, interest, balance: dueAmount + interest - paid, stillDue: Math.max(dueAmount + interest - paid, 0) };
  }

  function hasPaymentForDueDate(cardId, dueDate) {
    const card = cardById(cardId);
    if (!card || !dueDate) return false;
    const dueMonth = dueDate.slice(0, 7);
    if (state.monthlyStatements.some((statement) => statement.cardId === cardId &&
      Number(statement.payment) > 0 && (statement.month === dueMonth || statement.dueDate === dueDate))) return true;

    const targetTime = new Date(`${dueDate}T00:00:00`).getTime();
    if (!Number.isFinite(targetTime)) return false;
    return state.payments.some((payment) => {
      if (payment.cardId !== cardId || !(Number(payment.amount) > 0) || !payment.paymentDate) return false;
      const paymentDate = String(payment.paymentDate);
      const paymentTime = new Date(`${paymentDate}T00:00:00`).getTime();
      if (!Number.isFinite(paymentTime)) return false;
      const paymentMonth = new Date(`${paymentDate.slice(0, 7)}-01T00:00:00`);
      let nearestDueDate = "";
      let nearestDistance = Infinity;
      for (let offset = -2; offset <= 2; offset += 1) {
        const monthDate = new Date(paymentMonth.getFullYear(), paymentMonth.getMonth() + offset, 1);
        const candidate = cardMonthData(card, monthDate.getFullYear(), monthDate.getMonth()).dueDate;
        if (!candidate) continue;
        const distance = Math.abs(new Date(`${candidate}T00:00:00`).getTime() - paymentTime);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestDueDate = candidate;
        }
      }
      return nearestDueDate === dueDate && nearestDistance <= 31 * 86400000;
    });
  }

  function cardMonthTotal(field, month) {
    const [year, monthNumber] = month.split("-").map(Number);
    return state.cards.reduce((sum, card) => sum + cardMonthData(card, year, monthNumber - 1)[field], 0);
  }

  function cardYearTotal(field, year) {
    return Array.from({ length: 12 }, (_, index) => cardMonthTotal(field, `${year}-${String(index + 1).padStart(2, "0")}`))
      .reduce((sum, amount) => sum + amount, 0);
  }

  function totalCardBalance() {
    return state.cards.reduce((sum, card) => sum + cardTotals(card).balance, 0);
  }

  function saveMonthlyStatement(cardId, month, field, value) {
    let statement = monthlyStatementForCard(cardId, month);
    if (!statement) {
      statement = { id: id(), cardId, month };
      state.monthlyStatements.push(statement);
    }
    statement[field] = field === "dueDate" ? value : Number(value) || 0;
    if (!saveState()) return false;
    render();
    toast("Monthly card sheet updated.");
    return true;
  }

  function cardTotals(card) {
    const charges = state.transactions.filter((item) => item.cardId === card.id).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const payments = state.payments.filter((item) => item.cardId === card.id).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    let chargeAdjustment = 0;
    let paymentAdjustment = 0;
    let interest = 0;
    state.monthlyStatements.filter((statement) => statement.cardId === card.id).forEach((statement) => {
      if (Object.prototype.hasOwnProperty.call(statement, "amountDue")) {
        const legacyDue = selectedTotal(state.transactions.filter((item) => item.cardId === card.id), "dueDate", statement.month);
        chargeAdjustment += Number(statement.amountDue || 0) - legacyDue;
      }
      if (Object.prototype.hasOwnProperty.call(statement, "payment")) {
        const legacyPayment = selectedTotal(state.payments.filter((item) => item.cardId === card.id), "paymentDate", statement.month);
        paymentAdjustment += Number(statement.payment || 0) - legacyPayment;
      }
      interest += Number(statement.interest || 0);
    });
    const adjustedCharges = charges + chargeAdjustment;
    const adjustedPayments = payments + paymentAdjustment;
    return { charges: adjustedCharges, payments: adjustedPayments, balance: adjustedCharges + interest - adjustedPayments };
  }

  function toast(message, error) {
    const root = document.getElementById("toast-root");
    const element = document.createElement("div");
    element.className = `toast${error ? " error" : ""}`;
    element.textContent = message;
    root.appendChild(element);
    window.setTimeout(() => element.remove(), 3000);
  }

  function pageHeading(title, subtitle, actions) {
    return `<div class="page-heading"><div><div class="eyebrow">YOUR MONEY, MADE CLEAR</div><h1>${title}</h1><p class="page-subtitle">${subtitle}</p></div><div class="heading-actions">${actions || ""}</div></div>`;
  }

  function emptyState(title, description, action) {
    return `<div class="empty-state"><strong>${title}</strong>${description}${action ? `<div style="margin-top:13px">${action}</div>` : ""}</div>`;
  }

  function render() {
    document.getElementById("breadcrumb-current").textContent = pageTitles[activePage];
    document.getElementById("currency-select").value = state.currency;
    document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.page === activePage));
    const root = document.getElementById("page-content");
    root.classList.toggle("monthly-sheet-page", activePage === "monthly");
    root.classList.toggle("monthly-sheet-view-mode", activePage === "monthly" && monthlySheetViewMode === "view");
    const previousMonthlyScroll = activePage === "monthly"
      ? Array.from(root.querySelectorAll(".sheet-scroll"), (element) => element.scrollLeft)
      : [];
    if (activePage === "dashboard") root.innerHTML = renderDashboard();
    if (activePage === "monthly") root.innerHTML = renderMonthlySheet();
    if (activePage === "transactions") root.innerHTML = renderTransactions();
    if (activePage === "import") root.innerHTML = renderStatementImport();
    if (activePage === "payments") root.innerHTML = renderPayments();
    if (activePage === "cards") root.innerHTML = renderCards();
    if (activePage === "people") root.innerHTML = renderPeople();
    if (activePage === "monthly") {
      const scrollers = root.querySelectorAll(".sheet-scroll");
      if (previousMonthlyScroll.length) {
        scrollers.forEach((element, index) => { element.scrollLeft = previousMonthlyScroll[index] || 0; });
      } else {
        scrollMonthlySheetsToCurrentMonth(scrollers);
      }
    }
    bindPageEvents();
  }

  function scrollMonthlySheetsToCurrentMonth(scrollers) {
    scrollers.forEach((scroller) => {
      const currentMonth = scroller.querySelector(".current-month-column");
      if (!currentMonth) return;
      const stickyWidth = scroller.querySelector(".direct-monthly-sheet")
        ? 276
        : scroller.querySelector(".income-sheet") ? 205 : 0;
      const monthLeft = currentMonth.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
      scroller.scrollLeft = Math.max(0, monthLeft - stickyWidth);
    });
  }

  function renderDashboard() {
    const periodLabel = periodMode === "year" ? String(reportYear) : monthLabel(periodMonth);
    const periodSpend = reportBasis === "dueDate"
      ? periodMode === "year" ? cardYearTotal("dueAmount", reportYear) : cardMonthTotal("dueAmount", periodMonth)
      : periodMode === "year" ? selectedYearTotal(state.transactions, reportBasis, reportYear) : selectedTotal(state.transactions, reportBasis, periodMonth);
    const periodPayments = periodMode === "year" ? cardYearTotal("paid", reportYear) : cardMonthTotal("paid", periodMonth);
    const balance = totalCardBalance();
    const recordedIncome = periodMode === "year" ? incomeForYear(reportYear) : incomeForMonth(periodMonth);
    const basisName = { purchaseDate: "purchase date", statementDate: "statement date", dueDate: "due date" }[reportBasis];
    const actions = `<button class="button" data-page="monthly">＋ Enter monthly total</button><button class="button primary" data-action="add-payment">＋ Record payment</button>`;
    const cards = `<div class="cards-grid">
      <div class="metric-card"><div class="metric-top"><span class="metric-label">SPENDING ${periodMode === "year" ? "THIS YEAR" : "THIS MONTH"}</span><span class="metric-icon violet">↗</span></div><div class="metric-value">${money(periodSpend)}</div><div class="metric-foot">Based on ${basisName}</div></div>
      <div class="metric-card"><div class="metric-top"><span class="metric-label">PAYMENTS ${periodMode === "year" ? "THIS YEAR" : "THIS MONTH"}</span><span class="metric-icon green">↙</span></div><div class="metric-value">${money(periodPayments)}</div><div class="metric-foot">Payments recorded in ${periodLabel}</div></div>
      <div class="metric-card"><div class="metric-top"><span class="metric-label">CURRENT BALANCE</span><span class="metric-icon amber">◷</span></div><div class="metric-value">${money(balance)}</div><div class="metric-foot">Monthly totals + interest − payments</div></div>
      <div class="metric-card"><div class="metric-top"><span class="metric-label">${periodMode === "year" ? "YEARLY INCOME" : "INCOME THIS MONTH"}</span><span class="metric-icon blue">♙</span></div><div class="metric-value">${money(recordedIncome)}</div><div class="metric-foot">Recorded 15th and 30th cutoff salaries</div></div>
    </div>`;
    const chart = renderChart();
    const cardList = state.cards.length ? `<div class="card-list">${orderedCards().map((card) => {
      const totals = cardTotals(card);
      const limit = Number(card.limit || 0);
      const utilization = limit > 0 ? Math.max(totals.balance / limit * 100, 0) : 0;
      const usedPercent = Math.min(utilization, 100);
      const usedPie = limit > 0
        ? `<span class="credit-use-pie${utilization > 100 ? " over-limit" : ""}" role="img" aria-label="${escapeHtml(`${card.name}: ${money(totals.balance)} used of ${money(limit)} limit, ${utilization.toFixed(0)}% utilized${utilization > 100 ? ", over limit" : ""}`)}" title="${escapeHtml(`${money(totals.balance)} used of ${money(limit)} limit`)}" style="--used-angle:${(usedPercent * 3.6).toFixed(1)}deg"></span>`
        : "";
      return `<div class="card-row"><span class="mini-card"></span><div class="card-row-info"><div class="card-row-name">${escapeHtml(card.name)}</div><div class="card-row-number">${escapeHtml(card.bank)} ···· ${escapeHtml(card.last4 || "—")}</div></div>${usedPie}<div class="card-row-balance">${money(totals.balance)}<small>${limit ? `${utilization.toFixed(0)}% used · limit ${money(limit)}` : "limit not set"}</small></div></div>`;
    }).join("")}<div class="credit-use-legend"><span><i class="credit-use-key used"></i>Used</span><span><i class="credit-use-key available"></i>Available</span></div></div>` : emptyState("No cards added yet", "Add a card to start tracking your balances.", `<button class="button small" data-action="add-card">＋ Add a card</button>`);
    const recent = [...state.transactions].sort((a, b) => (b.purchaseDate || "").localeCompare(a.purchaseDate || "")).slice(0, 5);
    const recentRows = recent.length ? recent.map((item) => transactionRow(item, false)).join("") : `<tr><td colspan="5" class="empty-cell">No transactions yet. Add a transaction to see it here.</td></tr>`;
    return `${pageHeading("Your overview", "A clear picture of your cards, spending and payments.", actions)}
      <div class="period-controls" style="margin-bottom:14px"><select id="dashboard-period" aria-label="Report period"><option value="month" ${periodMode === "month" ? "selected" : ""}>Monthly report</option><option value="year" ${periodMode === "year" ? "selected" : ""}>Yearly report</option></select>${periodMode === "year" ? `<select id="dashboard-year" aria-label="Report year">${yearOptions(reportYear)}</select>` : `<select id="dashboard-month" aria-label="Report month">${monthOptions(periodMonth)}</select>`}<select id="report-basis" aria-label="Report date basis"><option value="purchaseDate" ${reportBasis === "purchaseDate" ? "selected" : ""}>By purchase date</option><option value="statementDate" ${reportBasis === "statementDate" ? "selected" : ""}>By statement date</option><option value="dueDate" ${reportBasis === "dueDate" ? "selected" : ""}>By due date</option></select></div>
      ${cards}
      <div class="overview-grid"><section class="panel"><div class="panel-header"><div><h2 class="panel-title">Monthly due vs payment</h2><div class="panel-caption">${periodMode === "year" ? `${reportYear} · monthly totals` : "Last 6 months · compare amount due with payments"}</div></div><div class="chart-filter-control"><label for="dashboard-chart-card-filter">Credit card</label><select id="dashboard-chart-card-filter" aria-label="Filter monthly graph by credit card">${chartCardFilterOptions()}</select></div></div><div class="panel-body">${chart}</div></section>
      <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Credit limit vs actual use</h2><div class="panel-caption">Current outstanding balance compared with each card limit</div></div><button class="icon-button" data-page="cards">Manage →</button></div><div class="panel-body">${cardList}</div></section></div>
      <section class="panel line-chart-panel"><div class="panel-header"><div><h2 class="panel-title">Payment vs due amount by month</h2><div class="panel-caption">${periodMode === "year" ? `${reportYear} · monthly trend` : "Last 6 months · hover or focus a point to see how much remains unpaid"}</div></div><div class="chart-filter-control"><label for="dashboard-line-chart-card-filter">Credit card</label><select id="dashboard-line-chart-card-filter" aria-label="Filter line graph by credit card">${lineChartCardFilterOptions()}</select></div></div><div class="panel-body">${renderDuePaymentLineChart()}</div></section>
      <section class="panel table-panel"><div class="panel-header"><div><h2 class="panel-title">Recent transactions</h2><div class="panel-caption">Latest recorded card activity</div></div><button class="button small" data-page="transactions">View all →</button></div><div class="table-wrap"><table><thead><tr><th class="table-first">DESCRIPTION</th><th>CARD</th><th>PURCHASE DATE</th><th>DUE DATE</th><th>AMOUNT</th></tr></thead><tbody>${recentRows}</tbody></table></div></section>`;
  }

  function chartCardFilterOptions() {
    const cards = orderedCards();
    if (dashboardChartCardFilterId && !cards.some((card) => card.id === dashboardChartCardFilterId)) {
      dashboardChartCardFilterId = "";
      sessionStorage.removeItem("ledgerly.dashboard-chart-card-filter");
    }
    return `<option value="" ${dashboardChartCardFilterId ? "" : "selected"}>All cards</option>${cards.map((card) => `<option value="${escapeHtml(card.id)}" ${card.id === dashboardChartCardFilterId ? "selected" : ""}>${escapeHtml(card.name)}</option>`).join("")}`;
  }

  function lineChartCardFilterOptions() {
    const cards = orderedCards();
    if (dashboardLineChartCardFilterId && !cards.some((card) => card.id === dashboardLineChartCardFilterId)) {
      dashboardLineChartCardFilterId = "";
      sessionStorage.removeItem("ledgerly.dashboard-line-chart-card-filter");
    }
    return `<option value="" ${dashboardLineChartCardFilterId ? "" : "selected"}>All cards</option>${cards.map((card) => `<option value="${escapeHtml(card.id)}" ${card.id === dashboardLineChartCardFilterId ? "selected" : ""}>${escapeHtml(card.name)}</option>`).join("")}`;
  }

  function monthlyDuePaymentData(cardFilterId = dashboardChartCardFilterId) {
    const cards = orderedCards().filter((card) => !cardFilterId || card.id === cardFilterId);
    const months = [];
    const monthCount = periodMode === "year" ? 12 : 6;
    for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
      const date = periodMode === "year" ? new Date(reportYear, 11 - offset, 1) : new Date(today.getFullYear(), today.getMonth() - offset, 1);
      const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const [year, month] = value.split("-").map(Number);
      const totals = cards.reduce((sum, card) => {
        const data = cardMonthData(card, year, month - 1);
        sum.due += data.dueAmount;
        sum.paid += data.paid;
        return sum;
      }, { due: 0, paid: 0 });
      const paidPercent = totals.due > 0 ? totals.paid / totals.due * 100 : null;
      months.push({
        value,
        label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(date),
        ...totals,
        gap: totals.due - totals.paid,
        paidPercent,
        paidLabel: paidPercent === null ? "—" : `${paidPercent.toFixed(0)}% paid`
      });
    }
    return months;
  }

  function renderChart() {
    const months = monthlyDuePaymentData();
    const max = Math.max(...months.flatMap((item) => [item.due, item.paid]), 1);
    const chartBars = (item) => {
      const dueHeight = item.due > 0 ? Math.max(item.due / max * 140, 2) : 0;
      const paidHeight = item.paid > 0 ? Math.max(item.paid / max * 140, 2) : 0;
      const current = item.value === periodMonth ? " current" : "";
      const detail = `${monthLabel(item.value)} · Amount due: ${money(item.due)} · Payments: ${money(item.paid)} · ${item.paidPercent === null ? "No amount due to calculate payment percentage" : `${item.paidPercent.toFixed(1)}% of amount due paid`}`;
      return `<div class="chart-month-group" tabindex="0" aria-label="${escapeHtml(detail)}" data-tooltip="${escapeHtml(detail)}" title="${escapeHtml(detail)}"><div class="chart-month-bars"><div class="chart-bar due${current}" style="height:${dueHeight}px" title="Due: ${escapeHtml(money(item.due))}" aria-label="Due ${escapeHtml(money(item.due))}"></div><div class="chart-bar paid${current}" style="height:${paidHeight}px" title="Paid: ${escapeHtml(money(item.paid))}" aria-label="Paid ${escapeHtml(money(item.paid))}"></div></div><div class="chart-label">${item.label}</div><div class="chart-coverage">${item.paidLabel}</div></div>`;
    };
    return `<div class="chart-area${periodMode === "year" ? " yearly-chart" : ""}">${months.map(chartBars).join("")}</div><div class="chart-legend"><span class="legend-key"><i class="legend-dot due"></i>Amount due</span><span class="legend-key"><i class="legend-dot paid"></i>Payments</span>${dashboardChartCardFilterId ? `<span class="chart-filter-caption">${escapeHtml(cardById(dashboardChartCardFilterId)?.name || "")}</span>` : ""}</div>`;
  }

  function renderDuePaymentLineChart() {
    const months = monthlyDuePaymentData(dashboardLineChartCardFilterId);
    const width = 880;
    const height = 270;
    const left = 100;
    const right = 18;
    const top = 18;
    const bottom = 45;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const max = Math.max(...months.flatMap((item) => [item.due, item.paid]), 1);
    const x = (index) => left + index * plotWidth / Math.max(months.length - 1, 1);
    const y = (value) => top + plotHeight - value / max * plotHeight;
    const grid = Array.from({ length: 5 }, (_, index) => {
      const value = max * (4 - index) / 4;
      const gridY = y(value);
      const label = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: state.currency,
        notation: "compact",
        maximumFractionDigits: 1
      }).format(value);
      return `<line class="line-chart-grid" x1="${left}" y1="${gridY}" x2="${width - right}" y2="${gridY}"></line><text class="line-chart-axis-label" x="${left - 9}" y="${gridY + 3}" text-anchor="end">${escapeHtml(label)}</text>`;
    }).join("");
    const line = (field, className) => {
      const points = months.map((item, index) => `${x(index)},${y(item[field])}`).join(" ");
      const markers = months.map((item, index) => {
        const gap = item.gap >= 0 ? `Unpaid gap: ${money(item.gap)}` : `Payments exceed amount due by: ${money(Math.abs(item.gap))}`;
        const detail = `${monthLabel(item.value)} · Amount due: ${money(item.due)} · Payments: ${money(item.paid)} · ${gap}`;
        return `<g class="line-chart-point ${className}${item.value === periodMonth ? " current" : ""}" tabindex="0" role="img" aria-label="${escapeHtml(detail)}"><title>${escapeHtml(detail)}</title><circle cx="${x(index)}" cy="${y(item[field])}" r="5"></circle></g>`;
      }).join("");
      return `<polyline class="line-chart-series ${className}" points="${points}"></polyline>${markers}`;
    };
    const labels = months.map((item, index) => `<text class="line-chart-month-label" x="${x(index)}" y="${height - 16}" text-anchor="middle">${escapeHtml(item.label)}</text>`).join("");
    const selectedCard = dashboardLineChartCardFilterId ? `<span class="chart-filter-caption">${escapeHtml(cardById(dashboardLineChartCardFilterId)?.name || "")}</span>` : "";
    return `<div class="due-payment-line-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly amount due and payment line graph">${grid}${line("due", "due")}${line("paid", "paid")}${labels}</svg></div><div class="chart-legend line-chart-legend"><span class="legend-key"><i class="line-legend-key due"></i>Amount due</span><span class="legend-key"><i class="line-legend-key paid"></i>Payments</span><span class="line-chart-gap-note">Point details show the unpaid gap (due minus payment).</span>${selectedCard}</div>`;
  }

  function renderMonthlySheet() {
    const isViewMode = monthlySheetViewMode === "view";
    const cards = orderedCards();
    const displayedCards = displayedMonthlyCards();
    const months = Array.from({ length: 12 }, (_, index) => ({
      index,
      label: new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(reportYear, index, 1))
    }));
    const yearSelector = `<select id="monthly-sheet-year" aria-label="Monthly sheet year">${yearOptions(reportYear)}</select>`;
    const cardFilter = `<select id="monthly-sheet-card-filter" aria-label="Filter monthly sheet by credit card"><option value="" ${monthlyCardFilterId ? "" : "selected"}>All credit cards</option>${cards.map((card) => `<option value="${escapeHtml(card.id)}" ${card.id === monthlyCardFilterId ? "selected" : ""}>${escapeHtml(card.name)}</option>`).join("")}</select>`;
    const salaryAction = state.people.length ? `<button class="button" data-action="add-income">＋ Record salary</button>` : `<button class="button" data-action="add-person">＋ Add person</button>`;
    const actions = isViewMode ? "" : `<button class="button" data-action="export-monthly-csv">↓ Export Excel CSV</button><button class="button" data-page="import">⇧ Import statement</button>${salaryAction}<button class="button primary" data-action="add-monthly-card">＋ Enter monthly total</button>`;
    const currentMonthClass = (month) => month.index === today.getMonth() ? " current-month-column" : "";
    const monthHeaders = months.map((month) => `<th class="${currentMonthClass(month)}">${month.label}</th>`).join("");
    const cardRows = displayedCards.map((card) => {
      const cardBalance = cardTotals(card).balance;
      const monthData = months.map((month) => cardMonthData(card, reportYear, month.index));
      const sums = {
        amountDue: monthData.reduce((sum, item) => sum + item.dueAmount, 0),
        payment: monthData.reduce((sum, item) => sum + item.paid, 0),
        interest: monthData.reduce((sum, item) => sum + item.interest, 0),
        balance: monthData.reduce((sum, item) => sum + item.balance, 0)
      };
      const cardInfo = `<strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(card.bank)}${card.last4 ? ` ···· ${escapeHtml(card.last4)}` : ""}</span><small>${isViewMode ? "" : `Sort no. ${escapeHtml(card.sortNo)}<br>`}Limit ${card.limit ? money(card.limit) : "not set"}<br>Current balance ${money(cardBalance)}</small>`;
      const statementRows = [
        `<tr class="sheet-data-row"><th class="sheet-card-name" rowspan="5">${cardInfo}</th><th class="sheet-row-label">Amount / total</th>${months.map((month) => {
          const data = cardMonthData(card, reportYear, month.index);
          return `<td class="sheet-month-start sheet-number${currentMonthClass(month)}">${isViewMode ? (data.dueAmount ? money(data.dueAmount) : "—") : `<input class="sheet-edit-input" type="number" min="0" step="0.01" aria-label="${escapeHtml(card.name)} ${month.label} amount due" data-month-edit="amountDue" data-card-id="${escapeHtml(card.id)}" data-month="${data.month}" value="${data.dueAmount || ""}" placeholder="0.00">`}</td>`;
        }).join("")}<td class="sheet-annual-value">${money(sums.amountDue)}</td></tr>`,
        `<tr class="sheet-data-row"><th class="sheet-row-label">Payment (total)</th>${months.map((month) => {
          const data = cardMonthData(card, reportYear, month.index);
          return `<td class="sheet-month-start sheet-number${currentMonthClass(month)}">${isViewMode ? (data.paid ? money(data.paid) : "—") : `<input class="sheet-edit-input" type="number" min="0" step="0.01" aria-label="${escapeHtml(card.name)} ${month.label} total payment" data-month-edit="payment" data-card-id="${escapeHtml(card.id)}" data-month="${data.month}" value="${data.paid || ""}" placeholder="0.00">`}</td>`;
        }).join("")}<td class="sheet-annual-value">${money(sums.payment)}</td></tr>`,
        `<tr class="sheet-data-row sheet-balance-row"><th class="sheet-row-label">Balance</th>${monthData.map((data, index) => `<td class="sheet-month-start sheet-number${currentMonthClass(months[index])} ${data.balance > 0 ? "sheet-unpaid" : "sheet-paid"}">${money(data.balance)}</td>`).join("")}<td class="sheet-annual-value">${money(sums.balance)}</td></tr>`,
        `<tr class="sheet-data-row"><th class="sheet-row-label">Due date</th>${months.map((month) => {
          const data = cardMonthData(card, reportYear, month.index);
          const dueStatus = dueDateStatusClass(data.dueDate, data.paid > 0 || hasPaymentForDueDate(card.id, data.dueDate));
          return `<td class="sheet-month-start${currentMonthClass(month)} ${dueStatus}">${isViewMode ? `<span class="sheet-view-date">${formatDate(data.dueDate)}</span>${dueDateInfoIcon(dueStatus)}` : `<div class="sheet-due-date-control"><input class="sheet-edit-input sheet-date-input" type="date" aria-label="${escapeHtml(card.name)} ${month.label} due date" data-month-edit="dueDate" data-card-id="${escapeHtml(card.id)}" data-month="${data.month}" value="${escapeHtml(data.dueDate)}">${dueDateInfoIcon(dueStatus)}</div>`}</td>`;
        }).join("")}<td class="sheet-annual-value">—</td></tr>`,
        `<tr class="sheet-data-row sheet-card-end"><th class="sheet-row-label">Interest</th>${months.map((month) => {
          const data = cardMonthData(card, reportYear, month.index);
          return `<td class="sheet-month-start sheet-number${currentMonthClass(month)}">${isViewMode ? (data.interest ? money(data.interest) : "—") : `<input class="sheet-edit-input" type="number" min="0" step="0.01" aria-label="${escapeHtml(card.name)} ${month.label} interest" data-month-edit="interest" data-card-id="${escapeHtml(card.id)}" data-month="${data.month}" value="${data.interest || ""}" placeholder="0.00">`}</td>`;
        }).join("")}<td class="sheet-annual-value">${money(sums.interest)}</td></tr>`
      ];
      return statementRows.join("");
    }).join("");
    const totalRow = (label, field, className) => `<tr class="sheet-total-row"><th class="sheet-row-label" colspan="2">${label}</th>${months.map((month) => {
      const total = displayedCards.reduce((sum, card) => sum + cardMonthData(card, reportYear, month.index)[field], 0);
      return `<td class="sheet-number${currentMonthClass(month)} ${className || ""}">${money(total)}</td>`;
    }).join("")}<td class="sheet-annual-value">${money(displayedCards.reduce((sum, card) => sum + Array.from({ length: 12 }, (_, index) => cardMonthData(card, reportYear, index)[field]).reduce((monthTotal, amount) => monthTotal + amount, 0), 0))}</td></tr>`;
    const totalsLabel = monthlyCardFilterId ? escapeHtml(displayedCards[0].name.toUpperCase()) : "ALL CARDS";
    const totalsRow = `${totalRow(`${totalsLabel} · AMOUNT DUE`, "dueAmount")}${totalRow(`${totalsLabel} · PAYMENTS`, "paid", "sheet-paid")}${totalRow(`${totalsLabel} · BALANCE`, "balance", "sheet-unpaid")}`;
    const empty = !state.cards.length ? `<tr><td colspan="14" class="empty-cell">${isViewMode ? "No credit cards have been added." : "Add a credit card, then enter its monthly total directly in the sheet."}</td></tr>` : "";
    const incomeColumns = months.map((month) => `<th class="sheet-month-start${currentMonthClass(month)}">15th cutoff</th><th class="${month.index === today.getMonth() ? "current-month-column" : ""}">30th cutoff</th><th class="${month.index === today.getMonth() ? "current-month-column" : ""}">Month total</th>`).join("");
    const incomeTotals = months.map((month) => {
      const firstCutoff = state.incomes.filter((income) => income.month === `${reportYear}-${String(month.index + 1).padStart(2, "0")}` && income.cutoff === "15")
        .reduce((sum, income) => sum + Number(income.amount || 0), 0);
      const secondCutoff = state.incomes.filter((income) => income.month === `${reportYear}-${String(month.index + 1).padStart(2, "0")}` && income.cutoff === "30")
        .reduce((sum, income) => sum + Number(income.amount || 0), 0);
      return `<td class="sheet-month-start sheet-number${currentMonthClass(month)}">${money(firstCutoff)}</td><td class="sheet-number${currentMonthClass(month)}">${money(secondCutoff)}</td><td class="sheet-number${currentMonthClass(month)}">${money(firstCutoff + secondCutoff)}</td>`;
    }).join("");
    const incomePeople = state.people.map((person) => {
      const monthlyCells = months.map((month) => {
        const monthKey = `${reportYear}-${String(month.index + 1).padStart(2, "0")}`;
        const first = incomeByPersonMonthCutoff(person.id, monthKey, "15");
        const second = incomeByPersonMonthCutoff(person.id, monthKey, "30");
        return `<td class="sheet-month-start sheet-number${currentMonthClass(month)}">${money(first)}</td><td class="sheet-number${currentMonthClass(month)}">${money(second)}</td><td class="sheet-number${currentMonthClass(month)}">${money(first + second)}</td>`;
      }).join("");
      const annualIncome = state.incomes.filter((income) => income.personId === person.id && String(income.month || "").slice(0, 4) === String(reportYear))
        .reduce((sum, income) => sum + Number(income.amount || 0), 0);
      return `<tr><td class="sheet-card-cell"><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(person.note || "Salary income")}</span><small>Income recorded for ${reportYear}</small></td>${monthlyCells}<td class="sheet-number">${money(annualIncome)}</td></tr>`;
    }).join("");
    const incomeAnnualTotal = incomeForYear(reportYear);
    const incomeTotalRow = `<tr class="sheet-total-row"><th class="sheet-card-cell">ALL INCOME TOTAL</th>${incomeTotals}<td class="sheet-number">${money(incomeAnnualTotal)}</td></tr>`;
    const incomeEmpty = !state.people.length ? `<tr><td colspan="38" class="empty-cell">Add a person and record their 15th and 30th cutoff salary amounts.</td></tr>` : "";
    return `${pageHeading("Monthly credit card sheet", isViewMode ? `Read-only card details by month.` : `A Jan–Dec spreadsheet view of each card’s due date, bill amount, payments and estimated amount still due.`, actions)}
      <div class="sheet-toolbar"><div class="period-controls"><label for="monthly-sheet-year">Report year</label>${yearSelector}<label for="monthly-sheet-card-filter">Credit card</label>${cardFilter}<button class="button small sheet-view-toggle" id="monthly-sheet-view-toggle" type="button" aria-pressed="${isViewMode}">${isViewMode ? "Edit mode" : "View mode"}</button></div><span class="sheet-tip">Opens at ${new Intl.DateTimeFormat(undefined, { month: "long" }).format(today)} · scroll sideways to view other months. Frozen card details stay in view.</span></div>
      <section class="panel sheet-panel"><div class="sheet-scroll"><table class="monthly-sheet direct-monthly-sheet"><thead><tr class="month-groups"><th class="sheet-card-head" colspan="2">CREDIT CARD / MONTHLY DETAIL</th>${monthHeaders}<th>YEAR TOTAL</th></tr></thead><tbody>${cardRows || empty}${cardRows ? totalsRow : ""}</tbody></table></div></section>
      ${isViewMode ? "" : `<div class="report-note"><strong>Fast monthly entry:</strong> type the month's total card amount, total payment, due date, and optional interest directly into the cells. You do not need a separate transaction for every date. Payment is one monthly total per card; it is not split by person. Balance is calculated as monthly amount + interest − payment. Existing dated transactions and payments are used as the starting totals until you edit that month here.</div>
      <div class="sheet-section-heading"><div><h2>Salary by cutoff</h2><p>Enter each month's actual salary separately. 15th covers the first cutoff; 30th covers the second cutoff (including the last day of shorter months).</p></div><button class="button primary" data-action="${state.people.length ? "add-income" : "add-person"}">＋ ${state.people.length ? "Record salary" : "Add person"}</button></div>
      <section class="panel sheet-panel"><div class="sheet-scroll"><table class="monthly-sheet income-sheet"><thead><tr class="month-groups"><th class="sheet-card-head" rowspan="2">PERSON</th>${months.map((month) => `<th class="${month.index === today.getMonth() ? "current-month-column" : ""}" colspan="3">${month.label}</th>`).join("")}<th rowspan="2">YEAR TOTAL</th></tr><tr class="month-columns">${incomeColumns}</tr></thead><tbody>${incomePeople || incomeEmpty}${incomePeople ? incomeTotalRow : ""}</tbody></table></div></section>`}`;
  }

  function csvField(value) {
    let text = String(value == null ? "" : value);
    if (/^[\t\r =+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportMonthlyCsv() {
    const rows = [["Credit card", "Bank", "Last 4 digits", "Credit limit", "Current calculated balance"]];
    for (let index = 0; index < 12; index += 1) {
      const label = new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(reportYear, index, 1));
      rows[0].push(`${label} amount / total`, `${label} payment total`, `${label} balance`, `${label} due date`, `${label} interest`);
    }
    rows[0].push("Year total amount", "Year total payments", "Year total interest", "Year total balance");
    displayedMonthlyCards().forEach((card) => {
      const row = [card.name, card.bank, card.last4 || "", Number(card.limit || 0), cardTotals(card).balance];
      for (let index = 0; index < 12; index += 1) {
        const data = cardMonthData(card, reportYear, index);
        row.push(data.dueAmount, data.paid, data.balance, data.dueDate, data.interest);
      }
      const annual = Array.from({ length: 12 }, (_, index) => cardMonthData(card, reportYear, index));
      row.push(annual.reduce((sum, item) => sum + item.dueAmount, 0), annual.reduce((sum, item) => sum + item.paid, 0),
        annual.reduce((sum, item) => sum + item.interest, 0), annual.reduce((sum, item) => sum + item.balance, 0));
      rows.push(row);
    });
    rows.push([]);
    const incomeHeader = ["SALARY BY CUTOFF"];
    incomeHeader.push("Person");
    for (let index = 0; index < 12; index += 1) {
      const label = new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(reportYear, index, 1));
      incomeHeader.push(`${label} 15th cutoff`, `${label} 30th cutoff`, `${label} total`);
    }
    incomeHeader.push("Year total");
    rows.push(incomeHeader);
    state.people.forEach((person) => {
      const row = [person.name];
      for (let index = 0; index < 12; index += 1) {
        const month = `${reportYear}-${String(index + 1).padStart(2, "0")}`;
        const first = incomeByPersonMonthCutoff(person.id, month, "15");
        const second = incomeByPersonMonthCutoff(person.id, month, "30");
        row.push(first, second, first + second);
      }
      row.push(state.incomes.filter((income) => income.personId === person.id && String(income.month || "").slice(0, 4) === String(reportYear))
        .reduce((sum, income) => sum + Number(income.amount || 0), 0));
      rows.push(row);
    });
    const csv = `\uFEFF${rows.map((row) => row.map(csvField).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `credit-card-monthly-sheet-${reportYear}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Monthly sheet exported as an Excel-ready CSV.");
  }

  function transactionRow(item, includeActions) {
    const card = cardById(item.cardId);
    const person = personById(item.personId);
    return `<tr><td class="table-first"><strong>${escapeHtml(item.description)}</strong>${person ? `<div class="muted" style="font-size:9px;margin-top:3px">Paid by ${escapeHtml(person.name)}</div>` : ""}</td><td>${card ? escapeHtml(card.name) : '<span class="muted">Card removed</span>'}</td><td>${formatDate(item.purchaseDate)}</td>${dueDateCell(item.dueDate, item.cardId)}<td class="amount">${money(item.amount)}</td>${includeActions ? `<td><button class="icon-button" data-edit="transaction" data-id="${escapeHtml(item.id)}" aria-label="Edit transaction">Edit</button><button class="icon-button" data-delete="transaction" data-id="${escapeHtml(item.id)}" aria-label="Delete transaction">×</button></td>` : ""}</tr>`;
  }

  function renderTransactions() {
    const actions = `<button class="button" data-page="import">⇧ Import statement</button><button class="button primary" data-action="add-transaction">＋ Add transaction</button>`;
    const basisLabel = { purchaseDate: "Sale date", postDate: "Post date", statementDate: "Statement date", dueDate: "Due date" }[reportBasis];
    const filtered = state.transactions.filter((item) => {
      const dateMatches = String(item[reportBasis] || "").slice(0, 7) === periodMonth;
      const searchMatches = !transactionSearch || `${item.description} ${cardById(item.cardId)?.name || ""}`.toLowerCase().includes(transactionSearch.toLowerCase());
      return dateMatches && searchMatches;
    }).sort((a, b) => (b[reportBasis] || "").localeCompare(a[reportBasis] || ""));
    const rows = filtered.length ? filtered.map((item) => transactionRow(item, true)).join("") : `<tr><td colspan="6" class="empty-cell">No transactions found for ${escapeHtml(monthLabel(periodMonth))}.</td></tr>`;
    const total = filtered.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return `${pageHeading("Transactions", "Track card charges by purchase, statement or due date.", actions)}
      <section class="panel"><div class="panel-header"><div><h2 class="panel-title">${escapeHtml(monthLabel(periodMonth))} activity</h2><div class="panel-caption">${filtered.length} transaction${filtered.length === 1 ? "" : "s"} · Total ${money(total)}</div></div><div class="period-controls"><select id="transaction-month" aria-label="Filter month">${monthOptions(periodMonth)}</select><select id="report-basis" aria-label="Filter date basis"><option value="purchaseDate" ${reportBasis === "purchaseDate" ? "selected" : ""}>Sale date</option><option value="postDate" ${reportBasis === "postDate" ? "selected" : ""}>Post date</option><option value="dueDate" ${reportBasis === "dueDate" ? "selected" : ""}>Due date</option></select></div></div>
      <div class="filter-bar"><input id="transaction-search" type="search" placeholder="Search description or card…" value="${escapeHtml(transactionSearch)}" aria-label="Search transactions"></div>
      <div class="table-wrap"><table><thead><tr><th class="table-first">DESCRIPTION / PAID BY</th><th>CARD</th><th>SALE DATE</th><th>POST DATE</th><th>DUE DATE</th><th>AMOUNT</th><th></th></tr></thead><tbody>${filtered.length ? filtered.map((item) => {
        const card = cardById(item.cardId);
        const person = personById(item.personId);
        return `<tr><td class="table-first"><strong>${escapeHtml(item.description)}</strong>${person ? `<div class="muted" style="font-size:9px;margin-top:3px">Paid by ${escapeHtml(person.name)}</div>` : ""}</td><td>${card ? escapeHtml(card.name) : '<span class="muted">Card removed</span>'}</td><td>${formatDate(item.purchaseDate)}</td><td>${formatDate(item.postDate || item.statementDate)}</td>${dueDateCell(item.dueDate, item.cardId)}<td class="amount">${money(item.amount)}</td><td><button class="icon-button" data-edit="transaction" data-id="${escapeHtml(item.id)}" aria-label="Edit transaction">Edit</button><button class="icon-button" data-delete="transaction" data-id="${escapeHtml(item.id)}" aria-label="Delete transaction">×</button></td></tr>`;
      }).join("") : `<tr><td colspan="7" class="empty-cell">No transactions found for ${escapeHtml(monthLabel(periodMonth))}.</td></tr>`}</tbody></table></div></section><div class="report-note">Report is filtered by <strong>${basisLabel.toLowerCase()}</strong>. Add statement and due dates to each charge to include it in those reports.</div>`;
  }

  function renderStatementImport() {
    const selectedCardId = importState.cardId || state.cards[0]?.id || "";
    const rows = importState.rows.map((row, index) => `<tr>
      <td><input type="checkbox" data-import-field="selected" data-index="${index}" ${row.selected ? "checked" : ""} aria-label="Import ${escapeHtml(row.description)}"></td>
      <td><input class="import-edit" data-import-field="saleDate" data-index="${index}" type="date" value="${escapeHtml(row.saleDate)}" aria-label="Sale date"></td>
      <td><input class="import-edit" data-import-field="postDate" data-index="${index}" type="date" value="${escapeHtml(row.postDate)}" aria-label="Post date"></td>
      <td><input class="import-edit" data-import-field="dueDate" data-index="${index}" type="date" value="${escapeHtml(row.dueDate || "")}" aria-label="Due date"></td>
      <td><input class="import-edit import-description" data-import-field="description" data-index="${index}" value="${escapeHtml(row.description)}" aria-label="Description"></td>
      <td><input class="import-edit import-amount" data-import-field="amount" data-index="${index}" type="number" step="0.01" value="${escapeHtml(row.amount)}" aria-label="Amount"></td>
      <td><span class="status-pill pending">Review</span></td>
      </tr>`).join("");
    const cardOptions = optionList(state.cards, selectedCardId, "Select a card");
    const importButton = importState.rows.length ? `<button class="button primary" data-action="commit-statement-import">Import selected rows</button>` : "";
    const columnSelect = (field, label, required) => `<label class="form-field"><span>${label}${required ? " *" : ""}</span><select data-column-map="${field}">${columnOptions(importState.spreadsheetHeaders, importState.spreadsheetMapping[field], required)}</select></label>`;
    const spreadsheetMapping = importState.spreadsheetHeaders.length ? `<div class="spreadsheet-mapping">
      ${columnSelect("saleDate", "Purchase / sale date", true)}
      ${columnSelect("description", "Merchant / description", true)}
      ${columnSelect("amount", "Transaction amount", true)}
      ${columnSelect("postDate", "Post / statement date", false)}
      ${columnSelect("dueDate", "Due date", false)}
    </div><div class="spreadsheet-actions"><span>Choose the matching columns, then verify the preview below. Refunds should remain negative.</span><button class="button primary" data-action="build-spreadsheet-preview">Preview rows</button></div>` : "";
    return `${pageHeading("Import card transactions", "Excel or CSV gives more reliable results than statement-image OCR. Upload a spreadsheet, map its columns and review the rows before saving.", `<button class="button" data-page="transactions">← Transactions</button>`)}
      <section class="panel importer-panel"><div class="panel-header"><div><h2 class="panel-title">1. Choose card and date options</h2><div class="panel-caption">Files are processed locally in this browser; they are not uploaded.</div></div></div>
      <div class="import-controls">
        <label class="form-field"><span>Credit card *</span><select id="import-card" required ${importState.busy ? "disabled" : ""}>${cardOptions}</select></label>
        <label class="form-field"><span>Year shown on statement *</span><select id="import-year">${yearOptions(Number(importState.year) || today.getFullYear())}</select></label>
        <label class="form-field"><span>Statement due date (optional)</span><input id="import-due-date" type="date" value="${escapeHtml(importState.dueDate || "")}"></label>
      </div>
      <div class="spreadsheet-import">
        <h2>2. Upload an Excel or CSV file</h2>
        <p>Use a row per purchase with columns for date, description and amount. .xlsx, .xls and .csv files are supported.</p>
        <a class="template-link" download="credit-card-import-template.csv" href="data:text/csv;charset=utf-8,Purchase%20Date%2CDescription%2CAmount%2CPost%20Date%0A2026-10-01%2CGrocery%20store%2C1250.00%2C2026-10-02">Download a sample CSV template</a>
        <input id="spreadsheet-file" type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv">
        <label class="date-order-control"><span>Order for ambiguous text dates (e.g. 05/06/2026)</span><select id="import-date-order"><option value="MDY" ${importState.dateOrder !== "DMY" ? "selected" : ""}>Month / day / year</option><option value="DMY" ${importState.dateOrder === "DMY" ? "selected" : ""}>Day / month / year</option></select></label>
        ${importState.spreadsheetHeaders.length ? `<div class="spreadsheet-file-name">${escapeHtml(importState.fileName)} · ${importState.spreadsheetData.length} data rows detected</div>${spreadsheetMapping}` : ""}
      </div>
      <details class="ocr-import"><summary>Or try importing from a statement image or PDF (OCR may be inaccurate)</summary>
        <div class="upload-zone"><strong>Choose a statement image or PDF</strong><p>Supports JPG, PNG, WebP, and PDF. Carefully check all recognized dates and amounts.</p><input id="statement-file" type="file" accept="image/*,.pdf,application/pdf"><span class="file-name">${escapeHtml(importState.ocrFileName || "No file selected")}</span></div>
      </details>
      <div class="import-status" role="status">${escapeHtml(importState.progress || "Select a card and file to begin.")}</div>${importState.error ? `<div class="import-error" role="alert">${escapeHtml(importState.error)}</div>` : ""}
      ${importState.rows.length ? `<div class="import-results-header"><div><strong>${importState.rows.length} possible transaction${importState.rows.length === 1 ? "" : "s"} found</strong><span>Verify every amount and date against the original before importing.</span></div>${importButton}</div><div class="table-wrap import-table-wrap"><table class="import-table"><thead><tr><th><input id="select-all-import" type="checkbox" checked aria-label="Select all rows"></th><th>SALE DATE</th><th>POST DATE</th><th>DUE DATE</th><th>DESCRIPTION</th><th>AMOUNT</th><th>REVIEW</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
      </section>
      <div class="report-note"><strong>Privacy:</strong> Your file and extracted data stay in this browser. Excel support is downloaded from a public CDN when first needed. OCR additionally downloads the OCR engine and language model. Imported amounts use the app's selected currency; change the currency selector to PHP for peso values. Changing currency does not convert amounts.</div>`;
  }

  function columnOptions(headers, selected, required) {
    const options = headers.map((header, index) => `<option value="${index}" ${String(index) === String(selected) ? "selected" : ""}>${escapeHtml(header || `Column ${index + 1}`)}</option>`).join("");
    return `${required ? '<option value="">Choose a column</option>' : '<option value="">Not used</option>'}${options}`;
  }

  const OCR_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1";
  const PDF_CDN = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174";
  const XLSX_CDN = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
  const monthNumbers = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

  function loadScript(src, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-library="${globalName}"]`);
      const script = existing || document.createElement("script");
      const onLoad = () => window[globalName] ? resolve(window[globalName]) : reject(new Error(`${globalName} did not initialize.`));
      const onError = () => {
        script.remove();
        reject(new Error(`Could not load ${globalName}. Check your internet connection and retry.`));
      };
      script.addEventListener("load", onLoad, { once: true });
      script.addEventListener("error", onError, { once: true });
      if (!existing) {
        script.dataset.library = globalName;
        script.src = src;
        script.async = true;
        document.head.appendChild(script);
      }
    });
  }

  function guessSpreadsheetMapping(headers) {
    const find = (pattern) => {
      const index = headers.findIndex((header) => pattern.test(String(header)));
      return index < 0 ? "" : String(index);
    };
    return {
      saleDate: find(/purchase\s*date|sale\s*date|transaction\s*date|trans\s*date|^date$/i),
      description: find(/description|merchant|transaction\s*details|details|particulars|narration/i),
      amount: find(/peso\s*amount|transaction\s*amount|^amount$|^debit$|^credit$|^total$/i),
      postDate: find(/post\s*date|posting\s*date|statement\s*date/i),
      dueDate: find(/due\s*date|payment\s*due/i)
    };
  }

  function spreadsheetDate(value, xlsx, dateOrder) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const parts = xlsx.SSF.parse_date_code(value);
      if (parts) return `${parts.y}-${String(parts.m).padStart(2, "0")}-${String(parts.d).padStart(2, "0")}`;
    }
    const text = String(value || "").trim();
    const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}-${String(Number(iso[3])).padStart(2, "0")}`;
    const numeric = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
    if (numeric) {
      let first = Number(numeric[1]);
      let second = Number(numeric[2]);
      let year = Number(numeric[3]);
      if (year < 100) year += year < 50 ? 2000 : 1900;
      if (first > 12 || (first <= 12 && second <= 12 && dateOrder === "DMY")) [first, second] = [second, first];
      const month = first;
      const day = second;
      if (month < 1 || month > 12 || day < 1 || day > 31) return "";
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    }
    return "";
  }

  function spreadsheetAmount(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    const text = String(value == null ? "" : value).trim();
    const negative = /^\s*\(.*\)\s*$/.test(text);
    const cleaned = text.replace(/[(),\s$₱€£]/g, "").replace(/,/g, "").replace(/[^\d.+-]/g, "");
    const amount = Number(cleaned);
    return Number.isFinite(amount) ? (negative ? -Math.abs(amount) : amount) : NaN;
  }

  async function processSpreadsheetFile(file) {
    if (!file) return;
    importState = { ...importState, fileName: file.name, sourceType: "spreadsheet", rows: [], spreadsheetHeaders: [], spreadsheetData: [], spreadsheetMapping: {}, error: "", progress: "Reading spreadsheet…", busy: true };
    render();
    try {
      if (!state.cards.length) throw new Error("Add a credit card before importing a statement.");
      if (file.size > 20 * 1024 * 1024) throw new Error("Please choose a file smaller than 20 MB.");
      const xlsx = await loadScript(XLSX_CDN, "XLSX");
      const workbook = xlsx.read(await file.arrayBuffer(), { type: "array", cellDates: false, raw: true });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error("The spreadsheet has no worksheets.");
      const values = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" });
      const headerCandidates = values.slice(0, 20);
      const headerIndex = headerCandidates.reduce((bestIndex, row, index, candidates) =>
        row.filter((cell) => String(cell).trim()).length > candidates[bestIndex].filter((cell) => String(cell).trim()).length ? index : bestIndex, 0);
      const headers = (values[headerIndex] || []).map((cell, index) => String(cell || "").trim() || `Column ${index + 1}`);
      const data = values.slice(headerIndex + 1).filter((row) => row.some((cell) => String(cell).trim() !== ""));
      if (!headers.length || !data.length) throw new Error("Could not find a header row followed by transaction data.");
      importState = { ...importState, spreadsheetHeaders: headers, spreadsheetData: data, spreadsheetMapping: guessSpreadsheetMapping(headers), progress: `Loaded "${sheetName}". Map the columns that contain date, description and amount.` };
      render();
    } catch (error) {
      console.error("Spreadsheet import failed.", error);
      importState.error = error instanceof Error ? error.message : "Could not read this spreadsheet.";
      importState.progress = "Spreadsheet could not be read.";
      render();
    } finally {
      importState.busy = false;
      const cardInput = document.getElementById("import-card");
      if (cardInput) cardInput.disabled = false;
    }
  }

  function buildSpreadsheetPreview() {
    const mapping = importState.spreadsheetMapping;
    if (!["saleDate", "description", "amount"].every((field) => mapping[field] !== "" && mapping[field] != null)) {
      importState.error = "Map a purchase date, description, and amount column before previewing.";
      render();
      return;
    }
    const xlsx = window.XLSX;
    let skipped = 0;
    const rows = importState.spreadsheetData.flatMap((values, index) => {
      const dateOrder = document.getElementById("import-date-order")?.value || "MDY";
      const saleDate = spreadsheetDate(values[Number(mapping.saleDate)], xlsx, dateOrder);
      const description = String(values[Number(mapping.description)] || "").trim();
      const amount = spreadsheetAmount(values[Number(mapping.amount)]);
      if (!saleDate || !description || !Number.isFinite(amount) || amount === 0) {
        skipped += 1;
        return [];
      }
      return [{
        saleDate,
        postDate: mapping.postDate ? spreadsheetDate(values[Number(mapping.postDate)], xlsx, dateOrder) : "",
        dueDate: mapping.dueDate ? spreadsheetDate(values[Number(mapping.dueDate)], xlsx, dateOrder) : "",
        description,
        amount,
        selected: true,
        sourceLine: index
      }];
    });
    if (!rows.length) {
      importState.error = "No valid transactions found. Check the mapped columns and the source spreadsheet.";
      render();
      return;
    }
    importState.rows = rows;
    importState.error = "";
    importState.progress = `Previewing ${rows.length} transactions${skipped ? `; skipped ${skipped} blank, invalid, or summary rows` : ""}.`;
    render();
  }

  function parseStatementDates(text, year) {
    const datePattern = /^\s*([A-Z]{3})\s+(\d{1,2})\s+([A-Z]{3})\s+(\d{1,2})\s+(.+)$/i;
    let previousPostMonth = 0;
    let postYear = year;
    const parsed = [];
    String(text).split(/\r?\n/).forEach((rawLine, lineIndex) => {
      const line = rawLine.replace(/\s+/g, " ").trim();
      if (!line || /PREVIOUS BALANCE|BASIC TRANSACTIONS|YOUR CARD ACTIVITIES|TRANSACTION DESCRIPTION|CURRENCY AMOUNT|PESO AMOUNT|PAGE\s+\d+/i.test(line)) return;
      const match = line.match(datePattern);
      if (!match) return;
      const saleMonth = monthNumbers[match[1].toUpperCase()];
      const saleDay = Number(match[2]);
      const postMonth = monthNumbers[match[3].toUpperCase()];
      const postDay = Number(match[4]);
      if (!saleMonth || !postMonth || saleDay < 1 || saleDay > 31 || postDay < 1 || postDay > 31) return;
      if (previousPostMonth && previousPostMonth - postMonth > 6) postYear += 1;
      previousPostMonth = postMonth;
      const tail = match[5];
      const amountMatches = [...tail.matchAll(/(\(?-?\s*\d[\d,]*\.\d{2}\)?)/g)];
      if (!amountMatches.length) return;
      const amountText = amountMatches[amountMatches.length - 1][1];
      const negative = amountText.includes("(") || amountText.trim().startsWith("-");
      const amount = Number(amountText.replace(/[(),\s]/g, "").replace(/^-/, "")) * (negative ? -1 : 1);
      if (!Number.isFinite(amount) || amount === 0) return;
      let description = tail.slice(0, amountMatches[amountMatches.length - 1].index).trim();
      description = description.replace(/\b(PHL|PHP|USD|EUR|GBP|CAD|SGD|INR)\b/gi, " ").replace(/\s+/g, " ").trim();
      if (!description || /^(PREVIOUS BALANCE|TOTAL|PAYMENT|BASIC TRANSACTIONS)$/i.test(description)) return;
      const saleYear = saleMonth > postMonth && saleMonth - postMonth > 6 ? postYear - 1 : postYear;
      const toIso = (dateYear, dateMonth, day) => `${dateYear}-${String(dateMonth).padStart(2, "0")}-${String(Math.min(day, new Date(dateYear, dateMonth, 0).getDate())).padStart(2, "0")}`;
      parsed.push({
        saleDate: toIso(saleYear, saleMonth, saleDay),
        postDate: toIso(postYear, postMonth, postDay),
        description,
        amount,
        selected: true,
        sourceLine: lineIndex
      });
    });
    return parsed;
  }

  function inferDueDate(card, postDate) {
    if (!postDate) return "";
    const [year, month, day] = postDate.split("-").map(Number);
    if (card?.dueDaysAfterStatement !== undefined && Number(card.statementDay)) {
      const statementMonth = day <= Number(card.statementDay) ? month - 1 : month;
      const statementDate = statementDateForMonth(card, year, statementMonth - 1);
      return dueDateAfterStatement(card, statementDate);
    }
    if (!Number(card?.dueDay)) return "";
    let dueYear = year;
    let dueMonth = month;
    if (Number(card.dueDay) <= day) dueMonth += 1;
    if (dueMonth > 12) {
      dueMonth = 1;
      dueYear += 1;
    }
    const lastDay = new Date(dueYear, dueMonth, 0).getDate();
    return `${dueYear}-${String(dueMonth).padStart(2, "0")}-${String(Math.min(Number(card.dueDay), lastDay)).padStart(2, "0")}`;
  }

  function pdfPageText(items) {
    const rows = [];
    items.forEach((item) => {
      if (!item.str || !item.str.trim()) return;
      const y = Math.round(item.transform[5]);
      let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2);
      if (!row) {
        row = { y, items: [] };
        rows.push(row);
      }
      row.items.push({ x: item.transform[4], text: item.str.trim() });
    });
    return rows.sort((a, b) => b.y - a.y)
      .map((row) => row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(" "))
      .join("\n");
  }

  async function processStatementFile(file) {
    if (!file) return;
    importState = { ...importState, ocrFileName: file.name, sourceType: "statement-ocr", rows: [], error: "", progress: "", busy: true };
    render();
    const progress = (message) => {
      importState.progress = message;
      const status = document.querySelector(".import-status");
      if (status) status.textContent = message;
    };
    let worker;
    try {
      if (!state.cards.length) throw new Error("Add a credit card before importing a statement.");
      if (file.size > 20 * 1024 * 1024) throw new Error("Please choose a file smaller than 20 MB.");
      const year = Number(document.getElementById("import-year")?.value) || today.getFullYear();
      const buffer = await file.arrayBuffer();
      let text = "";
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (isPdf) {
        progress("Reading PDF pages in your browser…");
        const pdfjs = await loadScript(`${PDF_CDN}/build/pdf.min.js`, "pdfjsLib");
        pdfjs.GlobalWorkerOptions.workerSrc = `${PDF_CDN}/build/pdf.worker.min.js`;
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
        if (pdf.numPages > 20) throw new Error("This PDF has more than 20 pages. Split it into smaller files and try again.");
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          progress(`Reading PDF page ${pageNumber} of ${pdf.numPages}…`);
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          const pageText = pdfPageText(content.items);
          if (pageText.trim()) text += `\n${pageText}`;
        }
        if (!parseStatementDates(text, year).length) {
          progress("No selectable transaction text found. Loading local OCR for scanned pages…");
          worker = await createOcrWorker(progress);
          text = "";
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            progress(`Running OCR on PDF page ${pageNumber} of ${pdf.numPages}…`);
            const page = await pdf.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1.7 });
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
            const result = await worker.recognize(canvas);
            text += `\n${result.data.text}`;
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      } else if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(file.name)) {
        progress("Loading local OCR engine…");
        worker = await createOcrWorker(progress);
        progress("Reading image text in your browser…");
        const image = await createImageBitmap(file);
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext("2d").drawImage(image, 0, 0);
        const result = await worker.recognize(canvas);
        text = result.data.text;
        canvas.width = 0;
        canvas.height = 0;
        image.close();
      } else {
        throw new Error("Choose a JPG, PNG, WebP, BMP, TIFF, or PDF statement.");
      }
      const rows = parseStatementDates(text, year);
      if (!rows.length) throw new Error("No transaction rows were recognized. Try a clearer scan or text-based PDF. No records were imported.");
      const targetCardId = document.getElementById("import-card")?.value || state.cards[0]?.id || "";
      const targetCard = cardById(targetCardId);
      const dueDate = document.getElementById("import-due-date")?.value || "";
      rows.forEach((row) => {
        row.dueDate = dueDate || inferDueDate(targetCard, row.postDate);
      });
      importState = {
        ...importState,
        rows,
        cardId: targetCardId,
        year,
        dueDate,
        progress: `Found ${rows.length} possible transaction rows. Review every field before importing.`
      };
      render();
    } catch (error) {
      console.error("Statement import failed.", error);
      importState.error = error instanceof Error ? error.message : "Statement import failed. Please try another file.";
      importState.progress = "Import could not be completed.";
      const status = document.querySelector(".import-status");
      if (status) status.textContent = importState.progress;
      const errorBox = document.querySelector(".import-error");
      if (errorBox) errorBox.textContent = importState.error;
      else {
        const panel = document.querySelector(".importer-panel");
        if (panel) panel.insertAdjacentHTML("beforeend", `<div class="import-error" role="alert">${escapeHtml(importState.error)}</div>`);
      }
    } finally {
      if (worker) await worker.terminate();
      importState.busy = false;
      const fileInput = document.getElementById("statement-file");
      const cardInput = document.getElementById("import-card");
      if (fileInput) fileInput.disabled = false;
      if (cardInput) cardInput.disabled = false;
    }
  }

  async function createOcrWorker(progress) {
    const tesseract = await loadScript(`${OCR_CDN}/dist/tesseract.min.js`, "Tesseract");
    return tesseract.createWorker("eng", 1, {
      workerPath: `${OCR_CDN}/dist/worker.min.js`,
      corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core.wasm.js",
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
      logger: (message) => {
        if (message.status === "recognizing text" && typeof message.progress === "number") {
          progress(`Recognizing text… ${Math.round(message.progress * 100)}%`);
        }
      }
    });
  }

  function commitStatementImport() {
    const cardId = document.getElementById("import-card")?.value || "";
    const dueDate = document.getElementById("import-due-date")?.value || "";
    const card = cardById(cardId);
    if (!card) return toast("Select a credit card before importing.", true);
    const selected = importState.rows.filter((row) => row.selected);
    if (!selected.length) return toast("Select at least one transaction to import.", true);
    if (selected.some((row) => !row.description.trim() || !row.saleDate || !Number.isFinite(Number(row.amount)) || Number(row.amount) === 0)) {
      return toast("Check that each selected row has a description, sale date and non-zero amount.", true);
    }
    let imported = 0;
    let skipped = 0;
    selected.forEach((row) => {
      const duplicate = state.transactions.some((transaction) =>
        transaction.cardId === cardId &&
        transaction.purchaseDate === row.saleDate &&
        transaction.postDate === row.postDate &&
        transaction.description.toLowerCase() === row.description.trim().toLowerCase() &&
        Number(transaction.amount) === Number(row.amount));
      if (duplicate) {
        skipped += 1;
        return;
      }
      state.transactions.push({
        id: id(),
        cardId,
        description: row.description.trim(),
        amount: Number(row.amount),
        purchaseDate: row.saleDate,
        postDate: row.postDate,
        statementDate: "",
          dueDate: dueDate || row.dueDate || inferDueDate(card, row.postDate || row.saleDate),
          source: importState.sourceType || "statement-ocr"
      });
      imported += 1;
    });
    if (!imported) return toast("All selected statement rows already exist. Nothing was imported.", true);
    if (!saveState()) return;
    importState = { fileName: "", ocrFileName: "", rows: [], error: "", progress: "", busy: false, mode: "spreadsheet", spreadsheetHeaders: [], spreadsheetData: [], spreadsheetMapping: {}, dateOrder: "MDY" };
    activePage = "transactions";
    if (dueDate) {
      periodMonth = dueDate.slice(0, 7);
      reportBasis = "dueDate";
    } else {
      periodMonth = selected[0].saleDate.slice(0, 7);
      reportBasis = "purchaseDate";
    }
    render();
    toast(`${imported} transaction${imported === 1 ? "" : "s"} imported${skipped ? `; ${skipped} duplicate${skipped === 1 ? "" : "s"} skipped` : ""}.`);
  }

  function renderPayments() {
    const rows = state.payments.filter((item) => String(item.paymentDate || "").slice(0, 7) === periodMonth).sort((a, b) => (b.paymentDate || "").localeCompare(a.paymentDate || ""));
    const total = cardMonthTotal("paid", periodMonth);
    const tableRows = rows.length ? rows.map((item) => {
      const card = cardById(item.cardId);
      const person = personById(item.personId);
      return `<tr><td class="table-first"><strong>${escapeHtml(item.reference || "Card payment")}</strong>${person ? `<div class="muted" style="font-size:9px;margin-top:3px">Paid by ${escapeHtml(person.name)}</div>` : ""}</td><td>${card ? escapeHtml(card.name) : '<span class="muted">Card removed</span>'}</td><td>${formatDate(item.paymentDate)}</td><td class="amount">${money(item.amount)}</td><td><span class="status-pill">Recorded</span></td><td><button class="icon-button" data-edit="payment" data-id="${escapeHtml(item.id)}" aria-label="Edit payment">Edit</button><button class="icon-button" data-delete="payment" data-id="${escapeHtml(item.id)}" aria-label="Delete payment">×</button></td></tr>`;
    }).join("") : `<tr><td colspan="6" class="empty-cell">No payments recorded yet.</td></tr>`;
    return `${pageHeading("Payments", "Record repayments and keep your outstanding balance up to date.", `<button class="button primary" data-action="add-payment">＋ Record payment</button>`)}
      <div class="cards-grid"><div class="metric-card"><div class="metric-top"><span class="metric-label">PAYMENTS THIS MONTH</span><span class="metric-icon green">↙</span></div><div class="metric-value">${money(total)}</div><div class="metric-foot">${escapeHtml(monthLabel(periodMonth))}</div></div><div class="metric-card"><div class="metric-top"><span class="metric-label">ALL-TIME BALANCE</span><span class="metric-icon amber">◷</span></div><div class="metric-value">${money(totalCardBalance())}</div><div class="metric-foot">Recorded monthly amounts and payments</div></div></div>
      <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Payment history</h2><div class="panel-caption">${rows.length} payment${rows.length === 1 ? "" : "s"} · ${escapeHtml(monthLabel(periodMonth))}</div></div><div class="period-controls"><select id="payment-month" aria-label="Payment report month">${monthOptions(periodMonth)}</select></div></div><div class="table-wrap"><table><thead><tr><th class="table-first">REFERENCE / PAID BY</th><th>CARD</th><th>PAYMENT DATE</th><th>AMOUNT</th><th>STATUS</th><th></th></tr></thead><tbody>${rows.length ? tableRows : `<tr><td colspan="6" class="empty-cell">No payments recorded in ${escapeHtml(monthLabel(periodMonth))}.</td></tr>`}</tbody></table></div></section>`;
  }

  function renderCards() {
    const rows = state.cards.length ? orderedCards().map((card) => {
      const totals = cardTotals(card);
      const limit = Number(card.limit || 0);
      const utilization = limit > 0 ? Math.max(totals.balance / limit * 100, 0) : 0;
      const nextDueDate = nextCardDueDate(card);
      const dueDays = estimatedDaysAfterStatement(card);
      const dueStatus = dueDateStatusClass(nextDueDate, hasPaymentForDueDate(card.id, nextDueDate));
      const dueStatusLabel = dueStatus === "due-date-overdue" ? "Overdue" : dueStatus === "due-date-soon" ? "Due soon" : dueStatus === "due-date-upcoming" ? "Upcoming" : "";
      const dueLabel = dueStatus === "due-date-paid" ? "Paid" : dueStatusLabel;
      const dueDisplay = nextDueDate
        ? `<span class="due-date-badge ${dueStatus}" title="${escapeHtml(formatDate(nextDueDate))}${dueDays !== "" ? ` · ${escapeHtml(dueDays)} days after statement` : ""}">Day ${Number(nextDueDate.slice(8, 10))}</span><div class="due-date-detail ${dueStatus}">${dueLabel ? `${dueLabel} · ` : ""}${escapeHtml(formatDate(nextDueDate))} ${dueDateInfoIcon(dueStatus)}</div>`
        : "—";
      return `<tr><td>${escapeHtml(card.sortNo)}</td><td class="table-first"><div class="row-title"><span class="mini-card"></span><div><strong>${escapeHtml(card.name)}</strong><div class="muted" style="font-size:9px;margin-top:3px">${escapeHtml(card.bank)} ···· ${escapeHtml(card.last4 || "—")}</div></div></div></td><td>${limit ? money(limit) : "—"}</td><td>${Number(card.statementDay) ? `Day ${escapeHtml(card.statementDay)}` : "—"}</td><td>${dueDisplay}</td><td class="amount">${money(totals.balance)}</td><td>${limit ? `${utilization.toFixed(0)}%` : "—"}</td><td><button class="icon-button" data-edit="card" data-id="${escapeHtml(card.id)}">Edit</button><button class="icon-button" data-delete="card" data-id="${escapeHtml(card.id)}">×</button></td></tr>`;
    }).join("") : `<tr><td colspan="8" class="empty-cell">No cards added yet. Add your first card to track its charges and balance.</td></tr>`;
    return `${pageHeading("My cards", "Manage card details, limits and billing-cycle dates.", `<button class="button primary" data-action="add-card">＋ Add card</button>`)}
      <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Credit cards</h2><div class="panel-caption">${state.cards.length} card${state.cards.length === 1 ? "" : "s"} · Balance is calculated from recorded charges and payments</div></div></div><div class="table-wrap"><table><thead><tr><th>SORT NO.</th><th class="table-first">CARD</th><th>CREDIT LIMIT</th><th>STATEMENT DATE</th><th>PAYMENT DUE</th><th>BALANCE</th><th>UTILIZATION</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>
      <div class="report-note">Only store the card nickname and last four digits here. Never enter a full card number, security code or PIN.</div>`;
  }

  function renderPeople() {
    const monthTotal = incomeForMonth(periodMonth);
    const rows = state.people.length ? state.people.map((person) => {
      const cutoff15 = incomeByPersonMonthCutoff(person.id, periodMonth, "15");
      const cutoff30 = incomeByPersonMonthCutoff(person.id, periodMonth, "30");
      return `<tr><td class="table-first"><div class="row-title"><span class="person-avatar">${escapeHtml((person.name || "?").trim().charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(person.name)}</strong>${person.note ? `<div class="muted" style="font-size:9px;margin-top:3px">${escapeHtml(person.note)}</div>` : ""}</div></div></td><td class="amount">${money(cutoff15)}</td><td class="amount">${money(cutoff30)}</td><td class="amount">${money(cutoff15 + cutoff30)}</td><td>${person.salary ? `Usual ${money(person.salary)}` : "Variable"}</td><td><button class="icon-button" data-edit="person" data-id="${escapeHtml(person.id)}">Edit</button><button class="icon-button" data-delete="person" data-id="${escapeHtml(person.id)}">×</button></td></tr>`;
    }).join("") : `<tr><td colspan="6" class="empty-cell">No people yet. Add a person before recording salary.</td></tr>`;
    const payroll = state.incomes.filter((income) => income.month === periodMonth).sort((a, b) => (a.cutoff || "").localeCompare(b.cutoff || ""));
    const payrollRows = payroll.length ? payroll.map((income) => {
      const person = personById(income.personId);
      return `<tr><td class="table-first"><strong>${escapeHtml(person ? person.name : "Former person")}</strong></td><td>${income.cutoff === "15" ? "15th cutoff (1–15)" : "30th cutoff (16–end of month)"}</td><td>${formatDate(income.payDate)}</td><td class="amount">${money(income.amount)}</td><td><button class="icon-button" data-edit="income" data-id="${escapeHtml(income.id)}">Edit</button><button class="icon-button" data-delete="income" data-id="${escapeHtml(income.id)}">×</button></td></tr>`;
    }).join("") : `<tr><td colspan="5" class="empty-cell">No salary recorded for ${escapeHtml(monthLabel(periodMonth))}.</td></tr>`;
    const recordButton = state.people.length ? `<button class="button primary" data-action="add-income">＋ Record salary</button>` : "";
    return `${pageHeading("People & income", "Enter the actual salary amount received in each month; the two cutoff amounts can change monthly.", `<button class="button" data-action="add-person">＋ Add person</button>${recordButton}`)}
      <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Salary by person · ${escapeHtml(monthLabel(periodMonth))}</h2><div class="panel-caption">Monthly amounts come from the two cutoff entries, not a fixed salary.</div></div><div class="period-controls"><select id="salary-report-month" aria-label="Salary report month">${monthOptions(periodMonth)}</select></div></div><div class="table-wrap"><table><thead><tr><th class="table-first">PERSON</th><th>15TH CUTOFF (1–15)</th><th>30TH CUTOFF (16–END)</th><th>MONTH TOTAL</th><th>REFERENCE ONLY</th><th></th></tr></thead><tbody>${rows}</tbody><tfoot><tr class="sheet-total-row"><th class="table-first">TOTAL ACTUAL INCOME</th><th>${money(state.incomes.filter((income) => income.month === periodMonth && income.cutoff === "15").reduce((sum, income) => sum + Number(income.amount || 0), 0))}</th><th>${money(state.incomes.filter((income) => income.month === periodMonth && income.cutoff === "30").reduce((sum, income) => sum + Number(income.amount || 0), 0))}</th><th>${money(monthTotal)}</th><th colspan="2"></th></tr></tfoot></table></div></section>
      <section class="panel table-panel"><div class="panel-header"><div><h2 class="panel-title">Salary entries</h2><div class="panel-caption">${payroll.length} cutoff entr${payroll.length === 1 ? "y" : "ies"} for ${escapeHtml(monthLabel(periodMonth))}</div></div>${recordButton}</div><div class="table-wrap"><table><thead><tr><th class="table-first">PERSON</th><th>CUTOFF PERIOD</th><th>RECEIVED DATE</th><th>AMOUNT</th><th></th></tr></thead><tbody>${payrollRows}</tbody></table></div></section>`;
  }

  function optionList(items, selectedId, emptyText) {
    const options = items.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("");
    return `<option value="">${emptyText}</option>${options}`;
  }

  function defaultDueDate(card) {
    if (card?.dueDaysAfterStatement !== undefined && Number(card.statementDay)) {
      return nextCardDueDate(card);
    }
    const date = new Date();
    let year = date.getFullYear();
    let month = date.getMonth();
    const statementDay = Number(card?.statementDay || 0);
    const dueDay = Number(card?.dueDay || 0);
    if (statementDay && date.getDate() > statementDay) month += 1;
    if (dueDay && dueDay <= statementDay) month += 1;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const dueDate = dueDateForMonth(card, year, month);
    if (dueDate) return dueDate;
    return `${new Date(year, month, 1).getFullYear()}-${String(new Date(year, month, 1).getMonth() + 1).padStart(2, "0")}-${String(Math.min(dueDay || date.getDate(), lastDay)).padStart(2, "0")}`;
  }

  function cutoffDate(month, cutoff) {
    const [year, monthNumber] = String(month || currentMonth).split("-").map(Number);
    const day = cutoff === "15" ? 15 : new Date(year, monthNumber, 0).getDate();
    return `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function openForm(kind, record) {
    const editing = Boolean(record);
    const forms = {
      card: {
        title: editing ? "Edit card" : "Add a credit card",
        intro: "Keep your billing details organized. Card numbers are never needed.",
        fields: `<div class="form-field"><label for="sortNo">Sort no. *</label><input id="sortNo" name="sortNo" type="number" required min="1" step="1" value="${escapeHtml(record?.sortNo ?? nextCardSortNo())}"><small class="form-help">Cards are shown in ascending sort number.</small></div>
          <div class="form-field"><label for="name">Card nickname *</label><input id="name" name="name" required maxlength="60" placeholder="e.g. Everyday rewards" value="${escapeHtml(record?.name || "")}"></div>
          <div class="form-field"><label for="bank">Bank or issuer *</label><input id="bank" name="bank" required maxlength="60" placeholder="e.g. North Bank" value="${escapeHtml(record?.bank || "")}"></div>
          <div class="form-field"><label for="last4">Last 4 digits</label><input id="last4" name="last4" inputmode="numeric" pattern="[0-9]{0,4}" maxlength="4" placeholder="0000" value="${escapeHtml(record?.last4 || "")}"></div>
          <div class="form-field"><label for="limit">Credit limit</label><input id="limit" name="limit" type="number" min="0" step="0.01" value="${escapeHtml(record?.limit || "")}" placeholder="0.00"></div>
          <div class="form-field"><label for="statementDay">Statement day *</label><input id="statementDay" name="statementDay" type="number" required min="1" max="31" value="${escapeHtml(record?.statementDay || "")}" placeholder="1–31"></div>
          <div class="form-field"><label for="dueDaysAfterStatement">Payment due after statement (days) *</label><input id="dueDaysAfterStatement" name="dueDaysAfterStatement" type="number" required min="0" max="90" value="${escapeHtml(estimatedDaysAfterStatement(record) ?? "")}" placeholder="e.g. 20"><small class="calculated-due-preview" id="calculated-due-preview">${escapeHtml(cardDuePreviewText(record?.statementDay, estimatedDaysAfterStatement(record)))}</small></div>
          <div class="form-field full"><div class="form-help">The payment due date is calculated from the statement date plus these days. It can fall in the following month; the card list shows the next calculated due date.</div></div>`,
        submit: editing ? "Save changes" : "Add card"
      },
      person: {
        title: editing ? "Edit person" : "Add a person",
        intro: "Track salary entries by month. A usual salary is an optional reference only.",
        fields: `<div class="form-field full"><label for="name">Name *</label><input id="name" name="name" required maxlength="80" placeholder="e.g. Alex Morgan" value="${escapeHtml(record?.name || "")}"></div>
          <div class="form-field full"><label for="salary">Usual monthly salary (optional reference)</label><input id="salary" name="salary" type="number" min="0" step="0.01" placeholder="Not used for monthly totals" value="${escapeHtml(record?.salary || "")}"></div>
          <div class="form-field full"><label for="note">Note (optional)</label><input id="note" name="note" maxlength="100" placeholder="e.g. Primary income" value="${escapeHtml(record?.note || "")}"></div>`,
        submit: editing ? "Save changes" : "Add person"
      },
      income: {
        title: editing ? "Edit salary entry" : "Record salary",
        intro: "Enter the actual amount for this person's selected month and pay cutoff.",
        fields: `<div class="form-field full"><label for="personId">Person *</label><select id="personId" name="personId" required>${optionList(state.people, record?.personId || "", "Select a person")}</select></div>
          <div class="form-field"><label for="month">Salary month *</label><input id="month" name="month" type="month" required value="${escapeHtml(record?.month || periodMonth)}"></div>
          <div class="form-field"><label for="cutoff">Pay cutoff *</label><select id="cutoff" name="cutoff" required><option value="15" ${record?.cutoff !== "30" ? "selected" : ""}>15th cutoff (1st–15th)</option><option value="30" ${record?.cutoff === "30" ? "selected" : ""}>30th cutoff (16th–end)</option></select></div>
          <div class="form-field"><label for="amount">Salary amount *</label><input id="amount" name="amount" type="number" required min="0" step="0.01" placeholder="0.00" value="${escapeHtml(record?.amount ?? "")}"></div>
          <div class="form-field"><label for="payDate">Received date</label><input id="payDate" name="payDate" type="date" value="${escapeHtml(record?.payDate || cutoffDate(record?.month || periodMonth, record?.cutoff || "15"))}"></div>
          <div class="form-field full"><div class="form-help">The 30th cutoff covers the 16th through the last day of the month (including February 28/29).</div></div>`,
        submit: editing ? "Save changes" : "Record salary"
      },
      transaction: {
        title: editing ? "Edit transaction" : "Add a transaction",
        intro: "Enter the charge amount and its purchase, statement and due dates.",
        fields: `<div class="form-field full"><label for="description">Description *</label><input id="description" name="description" required maxlength="100" placeholder="e.g. Groceries" value="${escapeHtml(record?.description || "")}"></div>
          <div class="form-field"><label for="cardId">Credit card *</label><select id="cardId" name="cardId" required>${optionList(state.cards, record?.cardId || "", "Select a card")}</select></div>
          <div class="form-field"><label for="personId">Paid by</label><select id="personId" name="personId">${optionList(state.people, record?.personId || "", "Select person (optional)")}</select></div>
          <div class="form-field"><label for="amount">Amount *</label><input id="amount" name="amount" type="number" required min="0.01" step="0.01" placeholder="0.00" value="${escapeHtml(record?.amount || "")}"></div>
          <div class="form-field"><label for="purchaseDate">Sale / purchase date *</label><input id="purchaseDate" name="purchaseDate" type="date" required value="${escapeHtml(record?.purchaseDate || today.toISOString().slice(0, 10))}"></div>
          <div class="form-field"><label for="postDate">Post date</label><input id="postDate" name="postDate" type="date" value="${escapeHtml(record?.postDate || "")}"></div>
          <div class="form-field"><label for="statementDate">Statement date</label><input id="statementDate" name="statementDate" type="date" value="${escapeHtml(record?.statementDate || today.toISOString().slice(0, 10))}"></div>
          <div class="form-field"><label for="dueDate">Payment due date</label><input id="dueDate" name="dueDate" type="date" value="${escapeHtml(record?.dueDate || "")}"></div>
          <div class="form-field full"><div class="form-help">Date-based reports use these dates to include the charge in the selected month.</div></div>`,
        submit: editing ? "Save changes" : "Add transaction"
      },
      payment: {
        title: editing ? "Edit payment" : "Record a payment",
        intro: "Payments are subtracted from the selected card's outstanding balance.",
        fields: `<div class="form-field full"><label for="cardId">Credit card *</label><select id="cardId" name="cardId" required>${optionList(state.cards, record?.cardId || "", "Select a card")}</select></div>
          <div class="form-field full"><label for="personId">Paid by</label><select id="personId" name="personId">${optionList(state.people, record?.personId || "", "Select person (optional)")}</select></div>
          <div class="form-field"><label for="amount">Payment amount *</label><input id="amount" name="amount" type="number" required min="0.01" step="0.01" placeholder="0.00" value="${escapeHtml(record?.amount || "")}"></div>
          <div class="form-field"><label for="paymentDate">Payment date *</label><input id="paymentDate" name="paymentDate" type="date" required value="${escapeHtml(record?.paymentDate || today.toISOString().slice(0, 10))}"></div>
          <div class="form-field full"><label for="reference">Note (optional)</label><input id="reference" name="reference" maxlength="80" placeholder="e.g. Minimum payment" value="${escapeHtml(record?.reference || "")}"></div>`,
        submit: editing ? "Save changes" : "Record payment"
      }
    };
    const config = forms[kind];
    if (!config) return;
    const modalRoot = document.getElementById("modal-root");
    modalRoot.innerHTML = `<div class="modal-backdrop" data-close-modal><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><h2 id="modal-title">${config.title}</h2><p>${config.intro}</p></div><button class="modal-close" type="button" data-close-modal aria-label="Close">×</button></div><form class="modal-form" id="record-form"><div class="form-grid">${config.fields}</div><div class="form-actions">${editing ? `<button type="button" class="delete-button" data-delete="${kind}" data-id="${escapeHtml(record.id)}">Delete ${kind}</button>` : "<span></span>"}<div class="form-actions-right"><button type="button" class="button" data-close-modal>Cancel</button><button type="submit" class="button primary">${config.submit}</button></div></div></form></section></div>`;
    modalRoot.querySelector(".modal-backdrop").addEventListener("click", (event) => {
      if (event.target.hasAttribute("data-close-modal")) closeModal();
    });
    const modalDelete = modalRoot.querySelector("[data-delete]");
    if (modalDelete) modalDelete.addEventListener("click", () => deleteRecord(kind, record.id));
    if (kind === "card") {
      const updateDuePreview = () => {
        const preview = modalRoot.querySelector("#calculated-due-preview");
        if (preview) preview.textContent = cardDuePreviewText(
          modalRoot.querySelector("#statementDay")?.value,
          modalRoot.querySelector("#dueDaysAfterStatement")?.value
        );
      };
      modalRoot.querySelector("#statementDay").addEventListener("input", updateDuePreview);
      modalRoot.querySelector("#dueDaysAfterStatement").addEventListener("input", updateDuePreview);
    }
    modalRoot.querySelector("#record-form").addEventListener("submit", (event) => {
      event.preventDefault();
      if (!event.currentTarget.reportValidity()) return;
      const formData = new FormData(event.currentTarget);
      const data = Object.fromEntries(formData.entries());
      for (const key of ["amount", "salary", "limit", "statementDay", "dueDay", "dueDaysAfterStatement", "sortNo"]) {
        if (data[key] !== undefined) data[key] = Number(data[key]) || 0;
      }
      if (kind === "card") {
        const previewDueDate = nextCardDueDate({
          statementDay: data.statementDay,
          dueDaysAfterStatement: data.dueDaysAfterStatement
        });
        data.dueDay = previewDueDate ? Number(previewDueDate.slice(8, 10)) : (record?.dueDay || 0);
      }
      const collection = kind === "card" ? "cards" : kind === "person" ? "people" : kind === "transaction" ? "transactions" : kind === "income" ? "incomes" : "payments";
      if (kind === "income") {
        const duplicate = state.incomes.find((income) => income.id !== (record?.id || "") && income.personId === data.personId && income.month === data.month && income.cutoff === data.cutoff);
        if (duplicate) {
          toast("A salary entry already exists for this person, month and cutoff. Edit that entry instead.", true);
          return;
        }
        if (!data.payDate) data.payDate = cutoffDate(data.month, data.cutoff);
      }
      if (editing) {
        state[collection] = state[collection].map((item) => item.id === record.id ? { ...item, ...data } : item);
      } else {
        state[collection].push({ id: id(), ...data });
      }
      if (!saveState()) return;
      closeModal();
      render();
      toast(`${kind.charAt(0).toUpperCase()}${kind.slice(1)} ${editing ? "updated" : "added"}.`);
    });
    if (kind === "transaction" && !record) {
      const cardSelect = modalRoot.querySelector("#cardId");
      cardSelect.addEventListener("change", () => {
        const card = cardById(cardSelect.value);
        const due = modalRoot.querySelector("#dueDate");
        if (card && due && !due.value) due.value = defaultDueDate(card);
      });
      if (cardSelect.value) modalRoot.querySelector("#dueDate").value = defaultDueDate(cardById(cardSelect.value));
    }
    if (kind === "income" && !record) {
      const monthInput = modalRoot.querySelector("#month");
      const cutoffInput = modalRoot.querySelector("#cutoff");
      const payDateInput = modalRoot.querySelector("#payDate");
      const updateCutoffDate = () => {
        payDateInput.value = cutoffDate(monthInput.value, cutoffInput.value);
      };
      monthInput.addEventListener("change", updateCutoffDate);
      cutoffInput.addEventListener("change", updateCutoffDate);
    }
    const firstInput = modalRoot.querySelector("input, select");
    if (firstInput) firstInput.focus();
  }

  function closeModal() {
    document.getElementById("modal-root").innerHTML = "";
  }

  function deleteRecord(kind, recordId) {
    const collection = kind === "card" ? "cards" : kind === "person" ? "people" : kind === "transaction" ? "transactions" : kind === "income" ? "incomes" : "payments";
    const item = state[collection].find((record) => record.id === recordId);
    if (!item) return;
    const description = kind === "card" ? item.name : kind === "person" ? item.name : kind === "transaction" ? item.description : kind === "income" ? `salary entry for ${personById(item.personId)?.name || "person"}` : item.reference || "this payment";
    if (!window.confirm(`Delete ${description}?${kind === "card" ? " Existing transactions and payments will remain in your history." : ""}`)) return;
    state[collection] = state[collection].filter((record) => record.id !== recordId);
    if (!saveState()) return;
    closeModal();
    render();
    toast(`${kind.charAt(0).toUpperCase()}${kind.slice(1)} deleted.`);
  }

  function bindPageEvents() {
    document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "add-card") openForm("card");
      if (action === "add-person") openForm("person");
      if (action === "add-income") {
        if (!state.people.length) return toast("Add a person before recording salary.", true);
        openForm("income");
      }
      if (action === "add-transaction") {
        if (!state.cards.length) return toast("Add a credit card before entering a transaction.", true);
        openForm("transaction");
      }
      if (action === "add-payment") {
        if (!state.cards.length) return toast("Add a credit card before recording a payment.", true);
        openForm("payment");
      }
      if (action === "open-statement-import") {
        if (!state.cards.length) {
          activePage = "cards";
          render();
          toast("Add a credit card before importing a statement.", true);
          return;
        }
        importState = { fileName: "", ocrFileName: "", rows: [], error: "", progress: "", busy: false, mode: "spreadsheet", spreadsheetHeaders: [], spreadsheetData: [], spreadsheetMapping: {}, dateOrder: "MDY" };
        activePage = "import";
        render();
      }
      if (action === "commit-statement-import") commitStatementImport();
      if (action === "build-spreadsheet-preview") buildSpreadsheetPreview();
      if (action === "add-monthly-card") {
        if (!state.cards.length) {
          activePage = "cards";
          render();
          toast("Add a credit card first, then enter its monthly totals.", true);
          return;
        }
        const defaultCardId = displayedMonthlyCards()[0].id;
        const month = `${reportYear}-01`;
        const firstAmount = document.querySelector(`[data-month-edit="amountDue"][data-card-id="${defaultCardId}"][data-month="${month}"]`);
        firstAmount?.focus();
        firstAmount?.scrollIntoView({ block: "center", inline: "center" });
      }
      if (action === "export-monthly-csv") exportMonthlyCsv();
    }));
    document.getElementById("page-content").querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => {
      activePage = button.dataset.page;
      render();
    }));
    document.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => {
      const kind = button.dataset.edit;
      const collection = kind === "card" ? "cards" : kind === "person" ? "people" : kind === "transaction" ? "transactions" : kind === "income" ? "incomes" : "payments";
      const item = state[collection].find((record) => record.id === button.dataset.id);
      if (item) openForm(kind, item);
    }));
    document.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => deleteRecord(button.dataset.delete, button.dataset.id)));
    document.querySelectorAll("[data-month-edit]").forEach((input) => input.addEventListener("change", () => {
      saveMonthlyStatement(input.dataset.cardId, input.dataset.month, input.dataset.monthEdit, input.value);
    }));
    const statementFile = document.getElementById("statement-file");
    if (statementFile) statementFile.addEventListener("change", () => processStatementFile(statementFile.files[0]));
    const spreadsheetFile = document.getElementById("spreadsheet-file");
    if (spreadsheetFile) spreadsheetFile.addEventListener("change", () => processSpreadsheetFile(spreadsheetFile.files[0]));
    document.querySelectorAll("[data-column-map]").forEach((select) => select.addEventListener("change", () => {
      importState.spreadsheetMapping[select.dataset.columnMap] = select.value;
      importState.rows = [];
      importState.error = "";
      importState.progress = "Column mapping changed. Preview the rows to check them before importing.";
      render();
    }));
    const dateOrder = document.getElementById("import-date-order");
    if (dateOrder) dateOrder.addEventListener("change", () => {
      importState.dateOrder = dateOrder.value;
      importState.rows = [];
      importState.progress = "Date order changed. Preview the rows again to verify dates.";
      render();
    });
    const importCard = document.getElementById("import-card");
    if (importCard) importCard.addEventListener("change", () => {
      importState.cardId = importCard.value;
    });
    const importYear = document.getElementById("import-year");
    if (importYear) importYear.addEventListener("change", () => {
      importState.year = Number(importYear.value);
    });
    const importDueDate = document.getElementById("import-due-date");
    if (importDueDate) importDueDate.addEventListener("change", () => {
      importState.dueDate = importDueDate.value;
    });
    document.querySelectorAll("[data-import-field]").forEach((input) => input.addEventListener("change", () => {
      const row = importState.rows[Number(input.dataset.index)];
      if (!row) return;
      if (input.dataset.importField === "selected") row.selected = input.checked;
      else if (input.dataset.importField === "amount") row.amount = Number(input.value) || 0;
      else row[input.dataset.importField] = input.value;
    }));
    const selectAllImport = document.getElementById("select-all-import");
    if (selectAllImport) selectAllImport.addEventListener("change", () => {
      importState.rows.forEach((row) => { row.selected = selectAllImport.checked; });
      render();
    });
    const monthInputs = ["dashboard-month", "transaction-month", "payment-month", "salary-report-month"].map((elementId) => document.getElementById(elementId)).filter(Boolean);
    monthInputs.forEach((input) => input.addEventListener("change", () => {
      periodMonth = input.value;
      render();
    }));
    const basisSelect = document.getElementById("report-basis");
    if (basisSelect) basisSelect.addEventListener("change", () => {
      reportBasis = basisSelect.value;
      render();
    });
    const reportPeriod = document.getElementById("dashboard-period");
    if (reportPeriod) reportPeriod.addEventListener("change", () => {
      periodMode = reportPeriod.value;
      render();
    });
    const yearInput = document.getElementById("dashboard-year");
    if (yearInput) yearInput.addEventListener("change", () => {
      reportYear = Number(yearInput.value);
      render();
    });
    const dashboardChartCardFilter = document.getElementById("dashboard-chart-card-filter");
    if (dashboardChartCardFilter) dashboardChartCardFilter.addEventListener("change", () => {
      dashboardChartCardFilterId = dashboardChartCardFilter.value;
      if (dashboardChartCardFilterId) sessionStorage.setItem("ledgerly.dashboard-chart-card-filter", dashboardChartCardFilterId);
      else sessionStorage.removeItem("ledgerly.dashboard-chart-card-filter");
      render();
    });
    const dashboardLineChartCardFilter = document.getElementById("dashboard-line-chart-card-filter");
    if (dashboardLineChartCardFilter) dashboardLineChartCardFilter.addEventListener("change", () => {
      dashboardLineChartCardFilterId = dashboardLineChartCardFilter.value;
      if (dashboardLineChartCardFilterId) sessionStorage.setItem("ledgerly.dashboard-line-chart-card-filter", dashboardLineChartCardFilterId);
      else sessionStorage.removeItem("ledgerly.dashboard-line-chart-card-filter");
      render();
    });
    const sheetYear = document.getElementById("monthly-sheet-year");
    if (sheetYear) sheetYear.addEventListener("change", () => {
      reportYear = Number(sheetYear.value);
      render();
    });
    const sheetCardFilter = document.getElementById("monthly-sheet-card-filter");
    if (sheetCardFilter) sheetCardFilter.addEventListener("change", () => {
      monthlyCardFilterId = sheetCardFilter.value;
      if (monthlyCardFilterId) sessionStorage.setItem("ledgerly.monthly-card-filter", monthlyCardFilterId);
      else sessionStorage.removeItem("ledgerly.monthly-card-filter");
      render();
    });
    const sheetViewToggle = document.getElementById("monthly-sheet-view-toggle");
    if (sheetViewToggle) sheetViewToggle.addEventListener("click", () => {
      monthlySheetViewMode = monthlySheetViewMode === "edit" ? "view" : "edit";
      sessionStorage.setItem("ledgerly.monthly-sheet-view-mode", monthlySheetViewMode);
      render();
    });
    const search = document.getElementById("transaction-search");
    if (search) search.addEventListener("input", () => {
      const start = search.selectionStart;
      transactionSearch = search.value;
      render();
      const replacement = document.getElementById("transaction-search");
      replacement.focus();
      replacement.setSelectionRange(start, start);
    });
  }

  document.querySelectorAll(".nav-link,.brand").forEach((element) => element.addEventListener("click", (event) => {
    event.preventDefault();
    activePage = element.dataset.page || "dashboard";
    render();
  }));
  document.getElementById("currency-select").addEventListener("change", (event) => {
    state.currency = event.currentTarget.value;
    if (saveState()) render();
  });
  render();
}());
