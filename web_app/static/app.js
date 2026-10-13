// RuFaS Web App Frontend Logic

let chartDiet = null;
let chartMilk = null;
let chartDmi = null;
let statusPollingInterval = null;
let feedsData = [];

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  loadConfig();
  loadResults();
  setupEventListeners();
  checkStatus();
});

// Tab navigation
function setupTabs() {
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

      btn.classList.add("active");
      const targetId = btn.getAttribute("data-tab");
      document.getElementById(targetId).classList.add("active");

      if (targetId === "tab-dashboard") {
        loadResults();
      }
    });
  });
}

function switchTab(tabId) {
  const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (tabBtn) tabBtn.click();
}

// Setup Event Listeners
function setupEventListeners() {
  document.getElementById("btn-save-config").addEventListener("click", saveGeneralConfig);
  document.getElementById("btn-save-feeds").addEventListener("click", saveFeedsConfig);

  const startSim = () => {
    switchTab("tab-run");
    startSimulation();
  };

  document.getElementById("btn-quick-run").addEventListener("click", startSim);
  document.getElementById("btn-start-sim").addEventListener("click", startSim);

  document.getElementById("btn-clear-logs").addEventListener("click", () => {
    document.getElementById("console-output").textContent = "";
  });
}

// 1. Load Configurations
async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    if (data.error) return console.error(data.error);

    // Populate task select
    const taskSelect = document.getElementById("select-task");
    taskSelect.innerHTML = "";
    data.available_tasks.forEach(t => {
      const opt = document.createElement("option");
      opt.value = t.rel_path;
      opt.textContent = t.filename;
      if (t.rel_path === data.current_task) opt.selected = true;
      taskSelect.appendChild(opt);
    });

    document.getElementById("input-start-year").value = data.start_year;
    document.getElementById("input-start-day").value = data.start_day;
    document.getElementById("input-end-year").value = data.end_year;
    document.getElementById("input-end-day").value = data.end_day;

    // Feeds table
    feedsData = data.feeds || [];
    renderFeedsTable(feedsData);
  } catch (err) {
    console.error("Erro ao carregar configurações:", err);
  }
}

function renderFeedsTable(feeds) {
  const tbody = document.getElementById("feeds-tbody");
  tbody.innerHTML = "";

  feeds.forEach(f => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${f.id}</strong></td>
      <td>${f.name}</td>
      <td>$ ${f.cost.toFixed(3)}</td>
      <td>
        <input type="number" step="0.01" min="0" class="input-cost" data-id="${f.id}" value="${f.cost}">
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// 2. Save Configurations
async function saveGeneralConfig() {
  const payload = {
    current_task: document.getElementById("select-task").value,
    start_year: parseInt(document.getElementById("input-start-year").value),
    start_day: parseInt(document.getElementById("input-start-day").value),
    end_year: parseInt(document.getElementById("input-end-year").value),
    end_day: parseInt(document.getElementById("input-end-day").value)
  };

  try {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.success) {
      alert("Configurações salvas com sucesso!");
    } else {
      alert("Erro ao salvar: " + (result.error || "Desconhecido"));
    }
  } catch (err) {
    alert("Falha de conexão com o servidor.");
  }
}

async function saveFeedsConfig() {
  const inputs = document.querySelectorAll(".input-cost");
  const feedsToSave = [];

  inputs.forEach(inp => {
    const id = parseInt(inp.getAttribute("data-id"));
    const cost = parseFloat(inp.value) || 0.0;
    feedsToSave.push({ id, cost });
  });

  try {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feeds: feedsToSave })
    });
    const result = await res.json();
    if (result.success) {
      alert("Preços dos alimentos salvos com sucesso!");
      loadConfig();
    } else {
      alert("Erro ao salvar preços: " + (result.error || "Desconhecido"));
    }
  } catch (err) {
    alert("Falha de conexão ao salvar preços.");
  }
}

// 3. Start & Monitor Simulation
async function startSimulation() {
  try {
    const res = await fetch("/api/run", { method: "POST" });
    const result = await res.json();
    if (result.error) {
      alert(result.error);
      return;
    }

    startPolling();
  } catch (err) {
    console.error("Erro ao iniciar simulação:", err);
  }
}

function startPolling() {
  if (statusPollingInterval) clearInterval(statusPollingInterval);
  statusPollingInterval = setInterval(checkStatus, 1500);
}

async function checkStatus() {
  try {
    const res = await fetch("/api/status");
    const status = await res.json();

    const badge = document.getElementById("sim-status-badge");
    const label = document.getElementById("sim-status-label");
    const fill = document.getElementById("progress-bar-fill");
    const textStatus = document.getElementById("progress-status-text");
    const percent = document.getElementById("progress-percent");
    const consoleBox = document.getElementById("console-output");

    textStatus.textContent = status.status_text;
    percent.textContent = `${status.progress}%`;
    fill.style.width = `${status.progress}%`;

    if (status.logs && status.logs.length > 0) {
      consoleBox.textContent = status.logs.join("\n");
      consoleBox.scrollTop = consoleBox.scrollHeight;
    }

    if (status.running) {
      badge.className = "status-indicator running";
      label.textContent = "Simulando...";
      document.getElementById("btn-quick-run").disabled = true;
      document.getElementById("btn-start-sim").disabled = true;
    } else {
      badge.className = "status-indicator idle";
      label.textContent = "Pronto";
      document.getElementById("btn-quick-run").disabled = false;
      document.getElementById("btn-start-sim").disabled = false;

      if (status.progress === 100) {
        clearInterval(statusPollingInterval);
        statusPollingInterval = null;
        loadResults();
      }
    }
  } catch (err) {
    console.error("Erro no polling de status:", err);
  }
}

// 4. Load & Render Dashboard Results
async function loadResults() {
  try {
    const res = await fetch("/api/results");
    const data = await res.json();

    if (!data.has_results) {
      document.getElementById("kpi-file").textContent = data.message || "Aguardando execução";
      return;
    }

    // KPIs
    document.getElementById("kpi-milk").textContent = `${data.kpis.avg_milk_daily} kg/dia`;
    document.getElementById("kpi-dmi").textContent = `${data.kpis.avg_cow_dmi} kg/dia`;
    document.getElementById("kpi-ingredients").textContent = `${data.kpis.active_ingredients_count} itens`;
    document.getElementById("kpi-days").textContent = `${data.kpis.total_days_simulated} dias`;
    document.getElementById("kpi-file").textContent = data.filename;

    // Charts
    renderDietChart(data.diet);
    renderMilkChart(data.milk_series);
    renderDmiChart(data.pens_dmi);
    renderConstraints(data.binding_constraints);
  } catch (err) {
    console.error("Erro ao carregar resultados:", err);
  }
}

function renderDietChart(diet) {
  const ctx = document.getElementById("chart-diet").getContext("2d");
  const labels = diet.map(d => `${d.name} (${d.percentage}%)`);
  const values = diet.map(d => d.amount_kg);

  // Colors
  const colors = [
    "#10b981", "#3b82f6", "#06b6d4", "#f59e0b",
    "#ec4899", "#8b5cf6", "#64748b", "#14b8a6"
  ];

  if (chartDiet) chartDiet.destroy();

  chartDiet = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: colors.slice(0, values.length),
        borderWidth: 2,
        borderColor: "#131b2e"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "right",
          labels: { color: "#94a3b8", font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: (item) => ` ${item.label}: ${item.raw} kg MS/dia`
          }
        }
      }
    }
  });

  // Table breakdown
  const tbody = document.getElementById("tbody-diet-breakdown");
  tbody.innerHTML = "";
  diet.forEach(d => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${d.name}</td>
      <td><strong>${d.amount_kg} kg</strong></td>
      <td>${d.percentage}%</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderMilkChart(series) {
  const ctx = document.getElementById("chart-milk").getContext("2d");
  const labels = series.map(s => `Dia ${s.day}`);
  const values = series.map(s => s.milk_kg);

  if (chartMilk) chartMilk.destroy();

  chartMilk = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [{
        label: "Produção de Leite (kg/dia)",
        data: values,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        borderWidth: 2,
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: "#64748b" }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: { ticks: { color: "#64748b" }, grid: { color: "rgba(255,255,255,0.05)" } }
      },
      plugins: {
        legend: { labels: { color: "#94a3b8" } }
      }
    }
  });
}

function renderDmiChart(pensDmi) {
  const ctx = document.getElementById("chart-dmi-pens").getContext("2d");
  const datasets = [];
  const palette = ["#10b981", "#06b6d4", "#f59e0b", "#ec4899"];
  let idx = 0;
  let labels = [];

  for (const [penName, series] of Object.entries(pensDmi)) {
    if (labels.length === 0) {
      labels = series.map(s => `Dia ${s.day}`);
    }
    datasets.push({
      label: penName,
      data: series.map(s => s.dmi),
      borderColor: palette[idx % palette.length],
      borderWidth: 2,
      tension: 0.2,
      fill: false
    });
    idx++;
  }

  if (chartDmi) chartDmi.destroy();

  chartDmi = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: "#64748b" }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: {
          ticks: { color: "#64748b" },
          grid: { color: "rgba(255,255,255,0.05)" },
          title: { display: true, text: "kg MS / animal / dia", color: "#94a3b8" }
        }
      },
      plugins: {
        legend: { labels: { color: "#94a3b8" } }
      }
    }
  });
}

function renderConstraints(binding) {
  const container = document.getElementById("binding-constraints-container");
  container.innerHTML = "";

  const keys = Object.keys(binding || {});
  if (keys.length === 0) {
    container.innerHTML = `<p class="text-muted">Nenhuma violação ou restrição ativa registrada no otimizador.</p>`;
    return;
  }

  keys.forEach(k => {
    const span = document.createElement("span");
    span.className = "constraint-tag";
    span.innerHTML = `<strong>${k}</strong> <span class="count">${binding[k]}x</span>`;
    container.appendChild(span);
  });
}
