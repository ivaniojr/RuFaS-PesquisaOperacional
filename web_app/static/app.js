// RuFaS Web App Frontend Logic - Pesquisa Operacional & Simulation Studio

let chartDiet = null;
let chartMilk = null;
let chartDmi = null;
let chartSensitivity = null;
let statusPollingInterval = null;
let feedsData = [];
let feedCatalog = [];
let poCurrentDiet = [];

// Modern Toast Notification System
function showToast(message, type = "info", duration = 3500) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  let icon = "ℹ️";
  if (type === "success") icon = "✅";
  else if (type === "error") icon = "❌";
  else if (type === "warning") icon = "⚠️";

  toast.innerHTML = `
    <span style="font-size: 16px;">${icon}</span>
    <span style="flex: 1; line-height: 1.4;">${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, duration);
}

// Extrai custos e buffers atuais dos inputs do formulário para sincronização
function buildFeedsPayload(feedList) {
  const inputsCost = document.querySelectorAll(".input-feed-cost");
  const inputsBuffer = document.querySelectorAll(".input-feed-buffer");

  const costMap = {};
  inputsCost.forEach(i => {
    costMap[parseInt(i.getAttribute("data-id"), 10)] = parseFloat(i.value) || 0.0;
  });

  const bufferMap = {};
  inputsBuffer.forEach(i => {
    bufferMap[parseInt(i.getAttribute("data-id"), 10)] = parseFloat(i.value) || 0.15;
  });

  return feedList.map(f => ({
    id: f.id,
    cost: costMap[f.id] !== undefined ? costMap[f.id] : f.cost,
    buffer: bufferMap[f.id] !== undefined ? bufferMap[f.id] : (f.buffer || 0.15)
  }));
}

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  loadConfig();
  loadFeedCatalog();
  loadResults();
  loadPOAnalytics();
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
      const targetEl = document.getElementById(targetId);
      if (targetEl) targetEl.classList.add("active");

      if (targetId === "tab-dashboard") {
        loadResults();
      } else if (targetId === "tab-po") {
        loadPOAnalytics();
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
  const btnSaveConfig = document.getElementById("btn-save-config");
  if (btnSaveConfig) btnSaveConfig.addEventListener("click", saveGeneralConfig);

  const btnSaveFeeds = document.getElementById("btn-save-feeds");
  if (btnSaveFeeds) btnSaveFeeds.addEventListener("click", saveFeedsConfig);

  const startSim = () => {
    switchTab("tab-run");
    startSimulation();
  };

  const btnQuick = document.getElementById("btn-quick-run");
  if (btnQuick) btnQuick.addEventListener("click", startSim);

  const btnStart = document.getElementById("btn-start-sim");
  if (btnStart) btnStart.addEventListener("click", startSim);

  const btnClear = document.getElementById("btn-clear-logs");
  if (btnClear) {
    btnClear.addEventListener("click", () => {
      const cons = document.getElementById("console-output");
      if (cons) cons.textContent = "";
    });
  }

  // PO & Sensibilidade Listeners
  const btnCalcSens = document.getElementById("btn-calc-sensitivity");
  if (btnCalcSens) {
    btnCalcSens.addEventListener("click", () => {
      const feedSelect = document.getElementById("select-po-feed");
      const feedId = parseInt(feedSelect.value, 10);
      const milkPrice = parseFloat(document.getElementById("input-po-milk-price").value) || 0.45;
      if (feedId) loadSensitivity(feedId, milkPrice);
    });
  }

  const btnExportCsv = document.getElementById("btn-export-po-csv");
  if (btnExportCsv) {
    btnExportCsv.addEventListener("click", () => {
      const milkPrice = parseFloat(document.getElementById("input-po-milk-price").value) || 0.45;
      window.location.href = `/api/po/export_csv?milk_price=${milkPrice}`;
    });
  }

  const btnCompareSolvers = document.getElementById("btn-compare-solvers");
  if (btnCompareSolvers) {
    btnCompareSolvers.addEventListener("click", () => {
      const milkPrice = parseFloat(document.getElementById("input-po-milk-price").value) || 0.45;
      loadSolverComparison(milkPrice);
      const card = document.getElementById("card-solver-comparison");
      if (card) card.scrollIntoView({ behavior: "smooth" });
    });
  }

  const btnRefreshCompare = document.getElementById("btn-refresh-compare");
  if (btnRefreshCompare) {
    btnRefreshCompare.addEventListener("click", () => {
      const milkPrice = parseFloat(document.getElementById("input-po-milk-price").value) || 0.45;
      loadSolverComparison(milkPrice);
    });
  }

  // Inclusão de Insumos da Dieta
  const btnToggleAdd = document.getElementById("btn-toggle-add-panel");
  if (btnToggleAdd) {
    btnToggleAdd.addEventListener("click", () => {
      const panel = document.getElementById("panel-add-feed");
      if (!panel) return;
      const isHidden = panel.style.display === "none";
      panel.style.display = isHidden ? "block" : "none";
      btnToggleAdd.textContent = isHidden ? "❌ Fechar Inclusão" : "➕ Incluir Insumo";
      if (isHidden) {
        document.getElementById("select-catalog-feed").focus();
      }
    });
  }

  const btnConfirmAdd = document.getElementById("btn-confirm-add-feed");
  if (btnConfirmAdd) {
    btnConfirmAdd.addEventListener("click", async () => {
      const select = document.getElementById("select-catalog-feed");
      const feedId = parseInt(select.value, 10);
      if (!feedId) {
        showToast("Por favor, selecione um ingrediente do catálogo para adicionar.", "warning");
        return;
      }

      const exists = feedsData.some(f => f.id === feedId);
      if (exists) {
        showToast("Este insumo já está presente na formulação ativa!", "warning");
        return;
      }

      const catItem = feedCatalog.find(c => c.id === feedId);
      const cost = parseFloat(document.getElementById("input-new-feed-cost").value) || 0.10;
      const buffer = parseFloat(document.getElementById("input-new-feed-buffer").value) || 0.15;

      const newFeed = {
        id: feedId,
        name: catItem ? catItem.name : `Alimento ID ${feedId}`,
        cost: cost,
        buffer: buffer,
        category: catItem ? catItem.category : "Geral",
        type: catItem ? catItem.type : "Insumo",
        cp: catItem ? catItem.cp : 0.0,
        ndf: catItem ? catItem.ndf : 0.0,
        tdn: catItem ? catItem.tdn : 0.0
      };

      btnConfirmAdd.disabled = true;
      btnConfirmAdd.textContent = "⏳ Adicionando e salvando...";

      const updatedFeeds = [...feedsData, newFeed];
      try {
        const payloadFeeds = buildFeedsPayload(updatedFeeds);
        const res = await fetch("/api/feeds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feeds: payloadFeeds })
        });
        const data = await res.json();
        if (data.success) {
          feedsData = updatedFeeds;
          renderFeedsTable(feedsData);
          select.value = "";
          const panel = document.getElementById("panel-add-feed");
          if (panel) panel.style.display = "none";
          const btnToggle = document.getElementById("btn-toggle-add-panel");
          if (btnToggle) btnToggle.textContent = "➕ Incluir Insumo";
          showToast(`Insumo #${feedId} (${newFeed.name}) incluído e salvo com sucesso!`, "success");
        } else {
          showToast("Erro ao salvar insumo: " + (data.error || "Desconhecido"), "error");
        }
      } catch (err) {
        showToast("Erro na requisição: " + err, "error");
      } finally {
        btnConfirmAdd.disabled = false;
        btnConfirmAdd.textContent = "✅ Adicionar à Dieta";
      }
    });
  }
}

// 1. Load Configurations
async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    if (data.error) return console.error(data.error);

    const taskSelect = document.getElementById("select-task");
    if (taskSelect && data.available_tasks) {
      taskSelect.innerHTML = "";
      data.available_tasks.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t.rel_path;
        opt.textContent = t.filename;
        if (t.rel_path === data.current_task) opt.selected = true;
        taskSelect.appendChild(opt);
      });
    }

    if (document.getElementById("input-start-year")) document.getElementById("input-start-year").value = data.start_year;
    if (document.getElementById("input-start-day")) document.getElementById("input-start-day").value = data.start_day;
    if (document.getElementById("input-end-year")) document.getElementById("input-end-year").value = data.end_year;
    if (document.getElementById("input-end-day")) document.getElementById("input-end-day").value = data.end_day;

    if (document.getElementById("select-opt-mode") && data.optimization_mode) {
      document.getElementById("select-opt-mode").value = data.optimization_mode;
    }

    feedsData = data.feeds || [];
    renderFeedsTable(feedsData);
  } catch (err) {
    console.error("Erro ao carregar configurações:", err);
  }
}

async function loadFeedCatalog() {
  try {
    const res = await fetch("/api/feeds/catalog");
    feedCatalog = await res.json();
    const select = document.getElementById("select-catalog-feed");
    if (!select) return;
    select.innerHTML = '<option value="">-- Selecione um alimento para incluir --</option>';
    feedCatalog.forEach(item => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.label;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error("Erro ao carregar catálogo NASEM:", err);
  }
}

function renderFeedsTable(feeds) {
  const tbody = document.getElementById("feeds-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const countBadge = document.getElementById("feeds-count-badge");
  if (countBadge) {
    countBadge.textContent = `${feeds.length} insumos ativos na formulação`;
  }

  if (feeds.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 24px;">Nenhum insumo ativo. Utilize o botão "➕ Incluir Insumo" acima para adicionar.</td></tr>`;
    return;
  }

  feeds.forEach(f => {
    const badgeClass = f.type === "Forage" ? "badge-slack" : (f.type === "Conc" ? "badge-subtle" : "badge");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>#${f.id}</strong></td>
      <td>
        <div style="font-weight: 600;">${f.name}</div>
        <small style="color: var(--text-muted); font-size: 11px;">${f.category || 'NASEM'}</small>
      </td>
      <td>
        <span class="badge ${badgeClass}">${f.type || 'Insumo'}</span>
      </td>
      <td>
        <span class="nutrient-pill">PB: ${(f.cp || 0).toFixed(1)}%</span>
        <span class="nutrient-pill">FDN: ${(f.ndf || 0).toFixed(1)}%</span>
        <span class="nutrient-pill">NDT: ${(f.tdn || 0).toFixed(1)}%</span>
      </td>
      <td>
        <div class="input-with-unit">
          <input type="number" step="0.001" min="0" value="${f.cost}" class="form-control input-feed-cost" data-id="${f.id}" style="width: 100px;">
          <span class="unit-badge">$/kg</span>
        </div>
      </td>
      <td>
        <input type="number" step="0.01" min="0" max="1" value="${f.buffer !== undefined ? f.buffer : 0.15}" class="form-control input-feed-buffer" data-id="${f.id}" style="width: 75px;">
      </td>
      <td style="text-align: center;">
        <button class="btn btn-danger btn-sm btn-remove-feed" data-id="${f.id}" onclick="removeFeedDirect(${f.id})" title="Retirar insumo da simulação">
          🗑️ Retirar
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Função global para exclusão direta e persistência imediata do insumo
window.removeFeedDirect = async function(fId) {
  if (feedsData.length <= 2) {
    showToast("Mantenha pelo menos 2 insumos na formulação para viabilidade zootécnica.", "warning");
    return;
  }
  const itemToRemove = feedsData.find(x => x.id === fId);
  const feedName = itemToRemove ? itemToRemove.name : `ID #${fId}`;

  // Desabilita botão e exibe feedback imediato
  const btn = document.querySelector(`.btn-remove-feed[data-id="${fId}"]`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "⏳ Excluindo...";
  }

  const updatedFeeds = feedsData.filter(x => x.id !== fId);
  try {
    const payloadFeeds = buildFeedsPayload(updatedFeeds);
    const res = await fetch("/api/feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feeds: payloadFeeds })
    });
    const data = await res.json();
    if (data.success) {
      feedsData = updatedFeeds;
      renderFeedsTable(feedsData);
      showToast(`Insumo #${fId} (${feedName}) excluído com sucesso do modelo!`, "success");
    } else {
      showToast(`Erro ao excluir insumo: ${data.error || "Desconhecido"}`, "error");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = "🗑️ Retirar";
      }
    }
  } catch (err) {
    showToast(`Erro de conexão ao excluir: ${err}`, "error");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = "🗑️ Retirar";
    }
  }
};

// 2. Save Configurations
async function saveGeneralConfig() {
  const optModeEl = document.getElementById("select-opt-mode");
  const payload = {
    current_task: document.getElementById("select-task").value,
    start_year: parseInt(document.getElementById("input-start-year").value, 10),
    start_day: parseInt(document.getElementById("input-start-day").value, 10),
    end_year: parseInt(document.getElementById("input-end-year").value, 10),
    end_day: parseInt(document.getElementById("input-end-day").value, 10),
    optimization_mode: optModeEl ? optModeEl.value : "nonlinear",
    feeds: buildFeedsPayload(feedsData)
  };

  try {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast("Configurações gerais e insumos salvos com sucesso!", "success");
    } else {
      showToast("Erro ao salvar: " + (data.error || "Desconhecido"), "error");
    }
  } catch (err) {
    showToast("Erro na requisição: " + err, "error");
  }
}

async function saveFeedsConfig() {
  if (feedsData.length === 0) {
    showToast("Não é possível salvar sem nenhum insumo ativo.", "warning");
    return;
  }

  const payloadFeeds = buildFeedsPayload(feedsData);

  try {
    const res = await fetch("/api/feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feeds: payloadFeeds })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || "Insumos e parâmetros salvos com sucesso no modelo RuFaS!", "success");
      await loadConfig();
    } else {
      showToast("Erro ao salvar insumos: " + (data.error || "Desconhecido"), "error");
    }
  } catch (err) {
    showToast("Erro na requisição: " + err, "error");
  }
}

// 3. Execution & Simulation Runner
async function startSimulation() {
  try {
    const res = await fetch("/api/run", { method: "POST" });
    const data = await res.json();
    if (data.error) {
      showToast(data.error, "error");
      return;
    }
    showToast("Simulação iniciada com sucesso!", "info");
    document.getElementById("console-output").textContent = "";
    document.getElementById("progress-bar").style.width = "0%";
    document.getElementById("progress-percent").textContent = "0%";
    pollStatus();
  } catch (err) {
    showToast("Erro ao iniciar simulação: " + err, "error");
  }
}

function pollStatus() {
  if (statusPollingInterval) clearInterval(statusPollingInterval);
  statusPollingInterval = setInterval(checkStatus, 1000);
}

async function checkStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();

    const badge = document.getElementById("sim-status-badge");
    const txt = document.getElementById("sim-status-text");
    const pb = document.getElementById("progress-bar");
    const pp = document.getElementById("progress-percent");
    const cons = document.getElementById("console-output");

    if (txt) txt.textContent = data.status_text;
    if (pb) pb.style.width = `${data.progress}%`;
    if (pp) pp.textContent = `${data.progress}%`;

    if (badge) {
      if (data.running) {
        badge.textContent = "EM EXECUÇÃO";
        badge.className = "status-badge running";
      } else if (data.exit_code === 0) {
        badge.textContent = "CONCLUÍDO";
        badge.className = "status-badge success";
      } else if (data.exit_code !== null) {
        badge.textContent = "FALHOU";
        badge.className = "status-badge error";
      } else {
        badge.textContent = "PARADO";
        badge.className = "status-badge ready";
      }
    }

    if (cons && data.logs && data.logs.length > 0) {
      cons.textContent = data.logs.join("\n");
      cons.scrollTop = cons.scrollHeight;
    }

    if (!data.running && statusPollingInterval) {
      clearInterval(statusPollingInterval);
      statusPollingInterval = null;
      if (data.exit_code === 0) {
        loadResults();
        loadPOAnalytics();
      }
    }
  } catch (err) {
    console.error("Erro no polling de status:", err);
  }
}

// 4. Results & Dashboard (Aba 3)
async function loadResults() {
  try {
    const res = await fetch("/api/results");
    const data = await res.json();
    if (!data.has_results) return;

    if (document.getElementById("kpi-milk")) document.getElementById("kpi-milk").textContent = `${data.kpis.avg_milk_daily} kg`;
    if (document.getElementById("kpi-dmi")) document.getElementById("kpi-dmi").textContent = `${data.kpis.avg_cow_dmi} kg`;
    if (document.getElementById("kpi-days")) document.getElementById("kpi-days").textContent = data.kpis.total_days_simulated;
    if (document.getElementById("kpi-ingredients")) document.getElementById("kpi-ingredients").textContent = data.kpis.active_ingredients_count;

    renderDietPieChart(data.diet);
    renderDietBreakdownTable(data.diet);
    renderMilkChart(data.milk_series);
    renderDmiChart(data.pens_dmi);
    renderConstraints(data.binding_constraints);
  } catch (err) {
    console.error("Erro ao carregar resultados:", err);
  }
}

function renderDietPieChart(diet) {
  const canvas = document.getElementById("chart-diet-pie");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const labels = diet.map(d => d.name);
  const data = diet.map(d => d.amount_kg);

  const colors = [
    "#10b981", "#3b82f6", "#f59e0b", "#06b6d4",
    "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"
  ];

  if (chartDiet) chartDiet.destroy();

  chartDiet = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.slice(0, data.length),
        borderWidth: 2,
        borderColor: "#131b2e"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      cutout: "68%"
    }
  });
}

function renderDietBreakdownTable(diet) {
  const tbody = document.getElementById("table-diet-breakdown");
  if (!tbody) return;
  tbody.innerHTML = "";

  diet.forEach(d => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${d.name}</td>
      <td style="font-weight: 600;">${d.amount_kg} kg</td>
      <td><span class="badge" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa;">${d.percentage}%</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderMilkChart(milkSeries) {
  const canvas = document.getElementById("chart-milk-trend");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const labels = milkSeries.map(s => `Dia ${s.day}`);
  const data = milkSeries.map(s => s.milk_kg);

  if (chartMilk) chartMilk.destroy();

  chartMilk = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Produção de Leite (kg/dia)",
        data,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        fill: true,
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: "#64748b" }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: {
          ticks: { color: "#64748b" },
          grid: { color: "rgba(255,255,255,0.05)" },
          title: { display: true, text: "kg de Leite / dia", color: "#94a3b8" }
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

function renderDmiChart(pensDmi) {
  const canvas = document.getElementById("chart-dmi-pens");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
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
  if (!container) return;
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

// 5. Pesquisa Operacional & Análise de Sensibilidade (Aba 4)
async function loadPOAnalytics() {
  try {
    const milkPriceInput = document.getElementById("input-po-milk-price");
    const milkPrice = milkPriceInput ? (parseFloat(milkPriceInput.value) || 0.45) : 0.45;
    const res = await fetch(`/api/po/analytics?milk_price=${milkPrice}`);
    const data = await res.json();
    if (!data.has_results) return;

    poCurrentDiet = data.diet || [];

    // Preenche cards de KPIs de PO
    const kpis = data.kpis || {};
    if (document.getElementById("po-kpi-cost-cow")) document.getElementById("po-kpi-cost-cow").textContent = `$ ${kpis.cost_per_cow_day.toFixed(2)}`;
    if (document.getElementById("po-kpi-cost-milk")) document.getElementById("po-kpi-cost-milk").textContent = `$ ${kpis.feed_cost_per_kg_milk.toFixed(4)}`;
    if (document.getElementById("po-kpi-iofc")) document.getElementById("po-kpi-iofc").textContent = `$ ${kpis.iofc_per_cow_day.toFixed(2)}`;
    if (document.getElementById("po-kpi-efficiency")) document.getElementById("po-kpi-efficiency").textContent = `${kpis.feed_efficiency.toFixed(2)}x`;
    if (document.getElementById("po-kpi-cows")) document.getElementById("po-kpi-cows").textContent = `${kpis.lactating_cows_count} vacas`;

    // Popula tabela da dieta com custos
    renderPODietTable(poCurrentDiet);

    // Popula select de insumos para sensibilidade
    populatePOFeedSelect(poCurrentDiet);

    // Se houver insumo, calcula sensibilidade inicial para o primeiro
    if (poCurrentDiet.length > 0) {
      const select = document.getElementById("select-po-feed");
      const currentSelected = select ? parseInt(select.value, 10) : null;
      const targetId = currentSelected || poCurrentDiet[0].feed_id;
      loadSensitivity(targetId, milkPrice);
    }

    // Restrições de PO
    renderPOConstraintsTable(data.binding_constraints);

    // Comparativo de Solvers (LP vs NLP)
    loadSolverComparison(milkPrice);
  } catch (err) {
    console.error("Erro ao carregar análise de PO:", err);
  }
}

function renderPODietTable(diet) {
  const tbody = document.getElementById("table-po-diet-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  diet.forEach(item => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>#${item.feed_id}</strong></td>
      <td>${item.name}</td>
      <td style="font-weight: 600;">${item.amount_kg.toFixed(3)} kg</td>
      <td><span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa;">${item.percentage}%</span></td>
      <td>$ ${item.price_per_kg.toFixed(4)}</td>
      <td style="font-weight: 700; color: #34d399;">$ ${item.cost_per_day.toFixed(3)}</td>
      <td><span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">${item.cost_percentage}%</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function populatePOFeedSelect(diet) {
  const select = document.getElementById("select-po-feed");
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = "";

  diet.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.feed_id;
    opt.textContent = `${item.name} ($${item.price_per_kg}/kg - ${item.percentage}%)`;
    if (currentVal && String(item.feed_id) === String(currentVal)) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

async function loadSensitivity(feedId, milkPrice) {
  try {
    const res = await fetch(`/api/po/sensitivity?feed_id=${feedId}&milk_price=${milkPrice}`);
    const data = await res.json();
    if (data.error) return showToast(data.error, "error");

    if (document.getElementById("po-selected-feed-name")) {
      document.getElementById("po-selected-feed-name").textContent = data.feed_name;
    }
    if (document.getElementById("po-feed-elasticity")) {
      document.getElementById("po-feed-elasticity").textContent = `${data.cost_elasticity} (${data.cost_share_percentage}% do custo total)`;
    }

    renderSensitivityChart(data.sensitivity_curve);
  } catch (err) {
    console.error("Erro na análise de sensibilidade:", err);
  }
}

function renderSensitivityChart(curve) {
  const canvas = document.getElementById("chart-sensitivity");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const labels = curve.map(c => `${c.delta_pct > 0 ? "+" : ""}${c.delta_pct}% ($${c.unit_price})`);
  const costPerCow = curve.map(c => c.diet_cost_per_cow_day);
  const costPerMilk = curve.map(c => c.feed_cost_per_kg_milk);

  if (chartSensitivity) chartSensitivity.destroy();

  chartSensitivity = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Custo da Dieta ($/vaca/dia)",
          data: costPerCow,
          borderColor: "#f59e0b",
          backgroundColor: "rgba(245, 158, 11, 0.1)",
          fill: true,
          tension: 0.2,
          yAxisID: "y"
        },
        {
          label: "Custo por kg de Leite ($/kg)",
          data: costPerMilk,
          borderColor: "#06b6d4",
          backgroundColor: "transparent",
          borderDash: [5, 5],
          tension: 0.2,
          yAxisID: "y1"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          ticks: { color: "#64748b" },
          grid: { color: "rgba(255,255,255,0.05)" },
          title: { display: true, text: "Variação no Preço do Insumo", color: "#94a3b8" }
        },
        y: {
          type: "linear",
          display: true,
          position: "left",
          ticks: { color: "#f59e0b" },
          grid: { color: "rgba(255,255,255,0.05)" },
          title: { display: true, text: "$ / vaca / dia", color: "#f59e0b" }
        },
        y1: {
          type: "linear",
          display: true,
          position: "right",
          ticks: { color: "#06b6d4" },
          grid: { drawOnChartArea: false },
          title: { display: true, text: "$ / kg de leite", color: "#06b6d4" }
        }
      },
      plugins: {
        legend: { labels: { color: "#cbd5e1" } }
      }
    }
  });
}

function renderPOConstraintsTable(binding) {
  const tbody = document.getElementById("table-po-constraints-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const constraintsList = [
    { name: "protein_constraint_upper", desc: "Teto de Proteína Metabolizável (MP max) para evitar perdas de N", standard: "NASEM" },
    { name: "protein_constraint_lower", desc: "Exigência Mínima de Proteína Metabolizável (MP min)", standard: "NASEM" },
    { name: "NE_lactation_constraint", desc: "Energia Líquida de Lactação para sustentar produção", standard: "NASEM" },
    { name: "DMI_constraint_upper", desc: "Capacidade Ingestiva Máxima de Matéria Seca (Rúmen Cheio)", standard: "Fisiológico" },
    { name: "forage_NDF_constraint", desc: "Mínimo de FDN de Forragem para motilidade ruminal", standard: "Fisiológico" },
    { name: "calcium_constraint", desc: "Exigência de Cálcio para mantença e lactação", standard: "Mineral" },
    { name: "phosphorus_constraint", desc: "Exigência de Fósforo com controle ambiental de excreção", standard: "Mineral" }
  ];

  constraintsList.forEach(c => {
    const hits = binding && binding[c.name] ? binding[c.name] : 0;
    const isBinding = hits > 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code>${c.name}</code></td>
      <td>${c.desc}</td>
      <td><span class="badge" style="background: rgba(148, 163, 184, 0.2); color: #cbd5e1;">${c.standard}</span></td>
      <td>${hits > 0 ? `<span class="badge-binding">Ativa (${hits}x)</span>` : `<span class="badge-slack">Atendida (Folga)</span>`}</td>
      <td style="font-size: 12px; color: var(--text-muted);">${isBinding ? "Restrição limitante (sombra ativa no custo)" : "Dentro da margem segura do lote"}</td>
    `;
    tbody.appendChild(tr);
  });
}

// 6. Comparativo de Solvers (LP vs NLP)
async function loadSolverComparison(milkPrice = 0.45) {
  try {
    const res = await fetch(`/api/po/compare_solvers?milk_price=${milkPrice}`);
    const data = await res.json();
    if (data.error) {
      console.warn("Aviso comparativo de solvers:", data.error);
      return;
    }

    const lp = data.linear;
    const nlp = data.nonlinear;
    const comp = data.comparison;

    if (document.getElementById("compare-lp-cost")) {
      document.getElementById("compare-lp-cost").textContent = `$ ${lp.cost_per_cow_day.toFixed(3)}`;
    }
    if (document.getElementById("compare-lp-dmi")) {
      document.getElementById("compare-lp-dmi").textContent = `Consumo: ${lp.total_dmi_kg.toFixed(2)} kg MS/dia`;
    }

    if (document.getElementById("compare-nlp-cost")) {
      document.getElementById("compare-nlp-cost").textContent = `$ ${nlp.cost_per_cow_day.toFixed(3)}`;
    }
    if (document.getElementById("compare-nlp-dmi")) {
      document.getElementById("compare-nlp-dmi").textContent = `Consumo: ${nlp.total_dmi_kg.toFixed(2)} kg MS/dia`;
    }

    if (document.getElementById("compare-cost-diff")) {
      const diffSign = comp.cost_difference > 0 ? "+" : "";
      document.getElementById("compare-cost-diff").textContent = `${diffSign}$ ${comp.cost_difference.toFixed(3)}/dia`;
      document.getElementById("compare-cost-diff").style.color = comp.cost_difference <= 0 ? "#10b981" : "#f43f5e";
    }
    if (document.getElementById("compare-cost-diff-pct")) {
      const pctSign = comp.cost_difference_percent > 0 ? "+" : "";
      document.getElementById("compare-cost-diff-pct").textContent = `Variação relativa: ${pctSign}${comp.cost_difference_percent.toFixed(2)}%`;
    }

    if (document.getElementById("compare-interpretation") && comp.interpretation) {
      document.getElementById("compare-interpretation").textContent = comp.interpretation;
    }

    // Renderiza tabela comparativa de ingredientes
    renderSolverComparisonTable(lp.diet, nlp.diet);
  } catch (err) {
    console.error("Erro ao carregar comparativo de solvers:", err);
  }
}

function renderSolverComparisonTable(lpDiet, nlpDiet) {
  const tbody = document.getElementById("table-compare-solvers-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const map = {};
  (nlpDiet || []).forEach(item => {
    map[item.feed_id] = {
      feed_id: item.feed_id,
      name: item.name,
      price_per_kg: item.price_per_kg,
      nlp_amount: item.amount_kg,
      nlp_pct: item.percentage,
      lp_amount: 0,
      lp_pct: 0
    };
  });

  (lpDiet || []).forEach(item => {
    if (!map[item.feed_id]) {
      map[item.feed_id] = {
        feed_id: item.feed_id,
        name: item.name,
        price_per_kg: item.price_per_kg,
        nlp_amount: 0,
        nlp_pct: 0,
        lp_amount: item.amount_kg,
        lp_pct: item.percentage
      };
    } else {
      map[item.feed_id].lp_amount = item.amount_kg;
      map[item.feed_id].lp_pct = item.percentage;
    }
  });

  const list = Object.values(map);
  list.sort((a, b) => (b.nlp_amount + b.lp_amount) - (a.nlp_amount + a.lp_amount));

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-dim);">Nenhum ingrediente encontrado para comparação.</td></tr>`;
    return;
  }

  list.forEach(row => {
    const diff = (row.lp_amount - row.nlp_amount);
    const diffSign = diff > 0 ? "+" : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>#${row.feed_id}</strong> ${row.name}</td>
      <td>$ ${row.price_per_kg.toFixed(3)}</td>
      <td style="color: #60a5fa; font-weight: 600;">${row.lp_amount.toFixed(3)} kg</td>
      <td><span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa;">${row.lp_pct.toFixed(1)}%</span></td>
      <td style="color: #f59e0b; font-weight: 600;">${row.nlp_amount.toFixed(3)} kg</td>
      <td><span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b;">${row.nlp_pct.toFixed(1)}%</span></td>
      <td style="font-weight: 600; color: ${Math.abs(diff) < 0.001 ? '#94a3b8' : (diff > 0 ? '#60a5fa' : '#f59e0b')}">
        ${diffSign}${diff.toFixed(3)} kg
      </td>
    `;
    tbody.appendChild(tr);
  });
}
