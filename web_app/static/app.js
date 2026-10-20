// RuFaS Web App Frontend Logic - Pesquisa Operacional & Simulation Studio

let chartDiet = null;
let chartMilk = null;
let chartDmi = null;
let chartSensitivity = null;
let statusPollingInterval = null;
let feedsData = [];
let feedCatalog = [];
let poCurrentDiet = [];
let currentStandard = "NASEM";

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
      } else if (targetId === "tab-tableaus") {
        loadSimplexTableaus();
      } else if (targetId === "tab-history") {
        loadSimulationHistory();
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

  const btnLoadPreset = document.getElementById("btn-load-preset-feeds");
  if (btnLoadPreset) {
    btnLoadPreset.addEventListener("click", () => {
      loadStandardPresetFeeds(currentStandard);
    });
  }

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

  // Histórico de Simulações Listeners
  const btnRefreshHistory = document.getElementById("btn-refresh-history");
  if (btnRefreshHistory) btnRefreshHistory.addEventListener("click", loadSimulationHistory);

  const btnViewArchiveHistory = document.getElementById("btn-view-archive-history");
  if (btnViewArchiveHistory) {
    btnViewArchiveHistory.addEventListener("click", () => {
      switchTab("tab-history");
    });
  }

  const btnOpenArchiveFolder = document.getElementById("btn-open-archive-folder");
  if (btnOpenArchiveFolder) {
    btnOpenArchiveFolder.addEventListener("click", () => {
      if (lastArchivedFolderName) {
        openArchiveFolder(lastArchivedFolderName);
      }
    });
  }

  // PO & Sensibilidade Listeners
  const feedSelect = document.getElementById("select-po-feed");
  if (feedSelect) {
    feedSelect.addEventListener("change", () => {
      const feedId = parseInt(feedSelect.value, 10);
      const milkPrice = parseFloat(document.getElementById("input-po-milk-price").value) || 0.45;
      if (feedId) loadSensitivity(feedId, milkPrice);
    });
  }

  const btnCalcSens = document.getElementById("btn-calc-sensitivity");
  if (btnCalcSens) {
    btnCalcSens.addEventListener("click", () => {
      const feedId = parseInt(document.getElementById("select-po-feed")?.value, 10);
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

  // Sincronização e ações do Quadro de Cenário
  const profileSelect = document.getElementById("scenario-param-profile-select");
  const profileInput = document.getElementById("scenario-param-profile");
  if (profileSelect && profileInput) {
    profileSelect.addEventListener("change", () => {
      if (profileSelect.value !== "custom") {
        profileInput.value = profileSelect.value;
      }
    });
    profileInput.addEventListener("input", () => {
      if (profileSelect.value !== "custom" && profileInput.value !== profileSelect.value) {
        profileSelect.value = "custom";
      }
    });
  }

  const methaneSelect = document.getElementById("scenario-param-methane");
  if (methaneSelect) {
    methaneSelect.addEventListener("change", () => {
      updateMethaneDoseUI(methaneSelect.value);
    });
  }

  // Restaurar Padrões Iniciais do Cenário
  const btnResetScenario = document.getElementById("btn-reset-scenario");
  if (btnResetScenario) {
    btnResetScenario.addEventListener("click", () => {
      if (document.getElementById("scenario-param-name")) document.getElementById("scenario-param-name").value = "Faz. Campo Dourado (Goiás)";
      if (document.getElementById("scenario-param-slug")) document.getElementById("scenario-param-slug").value = "GO_campo_dourado";
      if (document.getElementById("scenario-param-weather")) document.getElementById("scenario-param-weather").value = "input/data/weather/BR_GO_weather.csv";
      if (document.getElementById("scenario-param-profile-select")) document.getElementById("scenario-param-profile-select").value = "Conservador (100 vacas, foco em estabilidade)";
      if (document.getElementById("scenario-param-profile")) document.getElementById("scenario-param-profile").value = "Conservador (100 vacas, foco em estabilidade)";
      if (document.getElementById("scenario-param-nutrient")) document.getElementById("scenario-param-nutrient").value = "NASEM";
      if (document.getElementById("scenario-param-cownum")) document.getElementById("scenario-param-cownum").value = 100;
      if (document.getElementById("scenario-param-milking-fraction")) document.getElementById("scenario-param-milking-fraction").value = 0.8356;
      if (document.getElementById("scenario-param-milking")) document.getElementById("scenario-param-milking").value = 3;
      if (document.getElementById("scenario-param-interval")) document.getElementById("scenario-param-interval").value = 45;
      if (document.getElementById("scenario-param-pbuffer")) document.getElementById("scenario-param-pbuffer").value = 50;
      if (document.getElementById("scenario-param-methane")) document.getElementById("scenario-param-methane").value = "3-NOP";
      if (document.getElementById("scenario-param-methane-dose")) document.getElementById("scenario-param-methane-dose").value = 90;
      if (document.getElementById("scenario-param-feed")) document.getElementById("scenario-param-feed").value = "input/data/feed/example_Northeast_feed.json";
      updateMethaneDoseUI("3-NOP");
      showToast("Valores padrões restaurados no formulário do cenário. Clique em 'Salvar e Aplicar' para persistir.", "info");
    });
  }

  // Salvar e Aplicar Cenário
  const btnApplyScenario = document.getElementById("btn-apply-scenario");
  if (btnApplyScenario) {
    btnApplyScenario.addEventListener("click", async () => {
      btnApplyScenario.disabled = true;
      btnApplyScenario.innerHTML = "⏳ Salvando e Aplicando...";

      const payload = {
        name: document.getElementById("scenario-param-name")?.value?.trim() || "Fazenda Macau",
        slug: document.getElementById("scenario-param-slug")?.value?.trim()?.toUpperCase() || "GO_MACAU",
        farm_code: document.getElementById("scenario-param-slug")?.value?.trim()?.toUpperCase() || "GO_MACAU",
        weather_file: document.getElementById("scenario-param-weather")?.value || "input/data/weather/BR_GO_weather.csv",
        scenario_profile: document.getElementById("scenario-param-profile")?.value?.trim() || "Conservador (100 vacas, foco em estabilidade)",
        nutrient_standard: document.getElementById("scenario-param-nutrient")?.value || "NASEM",
        cow_num: parseInt(document.getElementById("scenario-param-cownum")?.value) || 100,
        milking_cow_fraction: parseFloat(document.getElementById("scenario-param-milking-fraction")?.value) || 0.8356,
        cow_times_milked_per_day: parseInt(document.getElementById("scenario-param-milking")?.value) || 3,
        formulation_interval: parseInt(document.getElementById("scenario-param-interval")?.value) || 45,
        phosphorus_requirement_buffer: parseFloat(document.getElementById("scenario-param-pbuffer")?.value) || 50,
        methane_mitigation_method: document.getElementById("scenario-param-methane")?.value || "3-NOP",
        methane_additive_amount: parseFloat(document.getElementById("scenario-param-methane-dose")?.value) || 90,
        feed_file: document.getElementById("scenario-param-feed")?.value || "input/data/feed/example_Northeast_feed.json"
      };

      try {
        const res = await fetch("/api/scenario/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message || "Cenário configurado e aplicado com sucesso!", "success");
          await loadConfig();
        } else {
          showToast("Erro ao aplicar cenário: " + (data.error || "Desconhecido"), "error");
        }
      } catch (err) {
        showToast("Erro de conexão ao aplicar cenário: " + err, "error");
      } finally {
        btnApplyScenario.disabled = false;
        btnApplyScenario.innerHTML = "💾 Salvar e Aplicar Cenário";
      }
    });
  }

  // Tableaus Simplex Event Listeners
  const btnReloadTab = document.getElementById("btn-reload-tableaus");
  if (btnReloadTab) btnReloadTab.addEventListener("click", () => loadSimplexTableaus());

  const btnTabFirst = document.getElementById("btn-tableau-first");
  if (btnTabFirst) btnTabFirst.addEventListener("click", () => { currentTableauIdx = 0; renderCurrentTableau(); });

  const btnTabPrev = document.getElementById("btn-tableau-prev");
  if (btnTabPrev) btnTabPrev.addEventListener("click", () => {
    if (currentTableauIdx > 0) { currentTableauIdx--; renderCurrentTableau(); }
  });

  const btnTabNext = document.getElementById("btn-tableau-next");
  if (btnTabNext) btnTabNext.addEventListener("click", () => {
    if (currentTableauIdx < currentTableaus.length - 1) { currentTableauIdx++; renderCurrentTableau(); }
  });

  const btnTabLast = document.getElementById("btn-tableau-last");
  if (btnTabLast) btnTabLast.addEventListener("click", () => {
    if (currentTableaus.length > 0) {
      currentTableauIdx = currentTableaus.length - 1;
      renderCurrentTableau();
    }
  });

  const tabSlider = document.getElementById("tableau-slider");
  if (tabSlider) {
    tabSlider.addEventListener("input", (e) => {
      currentTableauIdx = parseInt(e.target.value, 10);
      renderCurrentTableau();
    });
  }

  const btnActivateNative = document.getElementById("btn-activate-native-solver");
  if (btnActivateNative) {
    btnActivateNative.addEventListener("click", () => {
      const sel = document.getElementById("select-opt-mode");
      if (sel) sel.value = "linear_native";
      switchTab("tab-config");
      showToast("Solver Linear Nativo ativado! Clique em 'Salvar Parâmetros Gerais' e execute a simulação.", "info", 5000);
    });
  }
}

function updateMethaneDoseUI(method) {
  const wrap = document.getElementById("scenario-methane-dose-wrap");
  const doseInput = document.getElementById("scenario-param-methane-dose");
  const unitLabel = document.getElementById("scenario-methane-unit");
  if (!wrap || !doseInput) return;

  if (method === "None") {
    wrap.style.display = "none";
    doseInput.value = 0;
  } else {
    wrap.style.display = "flex";
    if (unitLabel) unitLabel.textContent = "mg/kg DMI";
    if (method === "3-NOP") {
      doseInput.min = 40;
      doseInput.max = 100;
      if (!doseInput.value || parseFloat(doseInput.value) === 0) doseInput.value = 90;
    } else if (method === "Monensin") {
      doseInput.min = 20;
      doseInput.max = 36;
      if (!doseInput.value || parseFloat(doseInput.value) === 0) doseInput.value = 24;
    } else {
      doseInput.min = 0;
      doseInput.max = 100;
      if (!doseInput.value || parseFloat(doseInput.value) === 0) doseInput.value = 50;
    }
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

    if (data.scenario) {
      const s = data.scenario;
      if (document.getElementById("scenario-param-name") && s.name) {
        document.getElementById("scenario-param-name").value = s.name;
      }
      if (document.getElementById("scenario-param-slug") && (s.farm_code || s.slug)) {
        document.getElementById("scenario-param-slug").value = (s.farm_code || s.slug).toUpperCase();
      }
      if (document.getElementById("scenario-param-weather") && (s.weather_file || s.active_weather_file)) {
        document.getElementById("scenario-param-weather").value = s.active_weather_file || s.weather_file;
      }
      if (document.getElementById("scenario-param-profile") && s.scenario_profile) {
        document.getElementById("scenario-param-profile").value = s.scenario_profile;
        const profSel = document.getElementById("scenario-param-profile-select");
        if (profSel) {
          if (["Conservador (100 vacas, foco em estabilidade)", "Moderado (foco em eficiência alimentar)", "Intensivo (alta produtividade por vaca)"].includes(s.scenario_profile)) {
            profSel.value = s.scenario_profile;
          } else {
            profSel.value = "custom";
          }
        }
      }
      if (document.getElementById("scenario-param-nutrient") && s.nutrient_standard) {
        document.getElementById("scenario-param-nutrient").value = s.nutrient_standard;
      }
      if (document.getElementById("scenario-param-cownum") && s.cow_num != null) {
        document.getElementById("scenario-param-cownum").value = s.cow_num;
      }
      if (document.getElementById("scenario-param-milking-fraction") && s.milking_cow_fraction != null) {
        document.getElementById("scenario-param-milking-fraction").value = s.milking_cow_fraction;
      }
      if (document.getElementById("scenario-param-milking") && s.cow_times_milked_per_day != null) {
        document.getElementById("scenario-param-milking").value = s.cow_times_milked_per_day;
      }
      if (document.getElementById("scenario-param-interval") && s.formulation_interval != null) {
        document.getElementById("scenario-param-interval").value = s.formulation_interval;
      }
      if (document.getElementById("scenario-param-pbuffer") && s.phosphorus_requirement_buffer != null) {
        document.getElementById("scenario-param-pbuffer").value = s.phosphorus_requirement_buffer;
      }
      if (document.getElementById("scenario-param-methane") && s.methane_mitigation_method) {
        document.getElementById("scenario-param-methane").value = s.methane_mitigation_method;
        updateMethaneDoseUI(s.methane_mitigation_method);
      }
      if (document.getElementById("scenario-param-methane-dose") && s.methane_additive_amount != null) {
        document.getElementById("scenario-param-methane-dose").value = s.methane_additive_amount;
      }
      if (document.getElementById("scenario-param-feed") && (s.feed_file || s.active_feed_file)) {
        document.getElementById("scenario-param-feed").value = s.active_feed_file || s.feed_file;
      }

      const activeBadge = document.getElementById("badge-scenario-status");
      const indicator = document.getElementById("scenario-active-indicator");
      if (s.is_applied) {
        if (activeBadge) activeBadge.innerHTML = `✅ ${s.slug || "GO_campo_dourado"} <strong>(Ativo)</strong>`;
        if (indicator) indicator.innerHTML = `✅ Cenário <strong>${s.name || "Faz. Campo Dourado"}</strong> ativo no RuFaS`;
      } else {
        if (activeBadge) activeBadge.innerHTML = `Slug: ${s.slug || "GO_campo_dourado"}`;
        if (indicator) indicator.innerHTML = `⚪ Clique em "Salvar e Aplicar Cenário" para sincronizar com o RuFaS`;
      }
    }

    currentStandard = (data.scenario && data.scenario.nutrient_standard) ? data.scenario.nutrient_standard.toUpperCase() : "NASEM";

    // Atualiza indicadores de padrão nutricional na interface
    const badgeDietStd = document.getElementById("badge-diet-standard");
    if (badgeDietStd) {
      if (currentStandard === "NRC") {
        badgeDietStd.textContent = "Padrão Ativo: NRC (2001)";
        badgeDietStd.style.background = "rgba(245, 158, 11, 0.15)";
        badgeDietStd.style.borderColor = "rgba(245, 158, 11, 0.35)";
        badgeDietStd.style.color = "#fbbf24";
      } else {
        badgeDietStd.textContent = "Padrão Ativo: NASEM (2021)";
        badgeDietStd.style.background = "rgba(59, 130, 246, 0.15)";
        badgeDietStd.style.borderColor = "rgba(59, 130, 246, 0.35)";
        badgeDietStd.style.color = "#60a5fa";
      }
    }

    const panelCatalogTitle = document.getElementById("label-panel-catalog-title");
    if (panelCatalogTitle) {
      panelCatalogTitle.textContent = currentStandard === "NRC"
        ? "Incluir Ingrediente do Catálogo NRC (2001) — 134 Alimentos"
        : "Incluir Ingrediente do Catálogo NASEM (2021) — 177 Alimentos";
    }

    const labelSelectFeed = document.getElementById("label-select-catalog-feed");
    if (labelSelectFeed) {
      labelSelectFeed.textContent = `Selecione o Alimento (Catálogo ${currentStandard})`;
    }

    const btnPreset = document.getElementById("btn-load-preset-feeds");
    if (btnPreset) {
      btnPreset.textContent = `⚡ Dieta Sugerida (${currentStandard})`;
    }

    feedsData = data.feeds || [];
    renderFeedsTable(feedsData);

    // Carrega o catálogo do padrão ativo
    await loadFeedCatalog(currentStandard);
  } catch (err) {
    console.error("Erro ao carregar configurações:", err);
  }
}

async function loadFeedCatalog(std = null) {
  try {
    const standard = (std || currentStandard || "NASEM").toUpperCase();
    const res = await fetch(`/api/feeds/catalog?standard=${encodeURIComponent(standard)}`);
    feedCatalog = await res.json();
    const select = document.getElementById("select-catalog-feed");
    if (select) {
      select.innerHTML = `<option value="">-- Selecione um alimento do catálogo ${standard} (${feedCatalog.length} itens) --</option>`;
      feedCatalog.forEach(item => {
        const opt = document.createElement("option");
        opt.value = item.id;
        opt.textContent = item.label;
        select.appendChild(opt);
      });
    }

    // Sincroniza a combo "Ingrediente da Dieta para Análise" com os itens do catálogo
    populatePOFeedSelect();
  } catch (err) {
    console.error("Erro ao carregar catálogo de alimentos:", err);
  }
}

function renderFeedsTable(feeds) {
  const tbody = document.getElementById("feeds-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const countBadge = document.getElementById("feeds-count-badge");
  if (countBadge) {
    countBadge.textContent = `${feeds.length} insumos ativos na formulação (${currentStandard})`;
  }

  if (feeds.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 36px 20px; background: rgba(15, 23, 42, 0.25); border-radius: var(--radius-md);">
          <div style="max-width: 580px; margin: 0 auto; text-align: center;">
            <div style="font-size: 32px; margin-bottom: 8px;">📋</div>
            <h4 style="color: #fff; font-size: 16px; margin-bottom: 6px;">Tabela de Insumos Limpa para o Padrão ${currentStandard}</h4>
            <p style="color: var(--text-dim); font-size: 13px; line-height: 1.5; margin-bottom: 18px;">
              O padrão nutricional foi alterado para <strong>${currentStandard}</strong>. Os insumos anteriores foram limpos para evitar incompatibilidade entre bibliotecas de dados nutricionais.
            </p>
            <div style="display: flex; justify-content: center; gap: 12px; flex-wrap: wrap;">
              <button class="btn btn-primary" onclick="loadStandardPresetFeeds('${currentStandard}')">
                ⚡ Carregar Dieta Sugerida para ${currentStandard}
              </button>
              <button class="btn btn-outline" onclick="const p = document.getElementById('panel-add-feed'); if (p && p.style.display==='none') document.getElementById('btn-toggle-add-panel').click();">
                ➕ Adicionar Manualmente do Catálogo ${currentStandard}
              </button>
            </div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  feeds.forEach(f => {
    const badgeClass = f.type === "Forage" ? "badge-slack" : (f.type === "Conc" ? "badge-subtle" : "badge");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>#${f.id}</strong></td>
      <td>
        <div style="font-weight: 600;">${f.name}</div>
        <small style="color: var(--text-muted); font-size: 11px;">${f.category || currentStandard}</small>
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

window.loadStandardPresetFeeds = async function(std) {
  const targetStd = std || currentStandard || "NASEM";
  const btn = document.getElementById("btn-load-preset-feeds");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "⏳ Carregando...";
  }

  try {
    const res = await fetch("/api/feeds/preset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ standard: targetStd })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || `Dieta sugerida para ${targetStd} carregada com sucesso!`, "success");
      await loadConfig();
    } else {
      showToast("Erro ao carregar dieta sugerida: " + (data.error || "Desconhecido"), "error");
    }
  } catch (err) {
    showToast("Erro de conexão ao carregar dieta: " + err, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `⚡ Dieta Sugerida (${currentStandard})`;
    }
  }
};

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
        loadSimplexTableaus();
        if (data.last_archived) {
          displayArchivedNotification(data.last_archived);
        }
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

    const dashAlert = document.getElementById("dashboard-contingency-alert");
    if (data.formulation_failed || data.fallback_used) {
      if (dashAlert) {
        dashAlert.style.display = "block";
        dashAlert.innerHTML = `
          <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.4); border-left: 4px solid #f59e0b; padding: 14px 18px; border-radius: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <span style="font-size: 20px;">⚠️</span>
              <strong style="font-size: 14.5px; color: #fbbf24;">Aviso: Formulação Automatizada da Ração Falhou — Ração Anterior Utilizada</strong>
            </div>
            <div style="font-size: 13px; color: #f1f5f9; line-height: 1.5;">
              A formulação automatizada da ração falhou devido à violação de restrições zootécnicas. O simulador utilizou a ração de contingência anterior:
              <div style="margin: 6px 0; padding: 6px 12px; background: rgba(0,0,0,0.3); border-radius: 4px; font-family: monospace; font-size: 12px; color: #fbbf24;">
                "Previous ration used because automated ration formulation failed... Used most recently formulated ration instead."
              </div>
              <strong style="color: #f87171;">Os valores de consumo (DMI) e composição de dieta ótima não foram gerados</strong> para evitar interpretações incorretas sobre uma dieta não otimizada.
            </div>
          </div>
        `;
      }

      if (document.getElementById("kpi-milk")) document.getElementById("kpi-milk").textContent = "--";
      if (document.getElementById("kpi-dmi")) document.getElementById("kpi-dmi").textContent = "--";
      if (document.getElementById("kpi-days")) document.getElementById("kpi-days").textContent = data.total_days_simulated || "--";
      if (document.getElementById("kpi-ingredients")) document.getElementById("kpi-ingredients").textContent = "--";

      const dietTbody = document.getElementById("table-diet-breakdown");
      if (dietTbody) {
        dietTbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 20px; color: #fbbf24; font-size: 13px;">⚠️ Dieta ótima não gerada: a formulação automatizada falhou e utilizou a ração de contingência anterior.</td></tr>`;
      }
      if (chartDiet) chartDiet.destroy();

      renderMilkChart(data.milk_series || []);
      renderDmiChart(data.pens_dmi || {});
      renderConstraints(data.binding_constraints || {});
      return;
    } else {
      if (dashAlert) dashAlert.style.display = "none";
    }

    const kpis = data.kpis || {};
    if (document.getElementById("kpi-milk")) document.getElementById("kpi-milk").textContent = `${kpis.avg_milk_daily || 0} kg`;
    if (document.getElementById("kpi-dmi")) document.getElementById("kpi-dmi").textContent = `${kpis.avg_cow_dmi || 0} kg`;
    if (document.getElementById("kpi-days")) document.getElementById("kpi-days").textContent = kpis.total_days_simulated || "--";
    if (document.getElementById("kpi-ingredients")) document.getElementById("kpi-ingredients").textContent = kpis.active_ingredients_count || 0;

    renderDietPieChart(data.diet || []);
    renderDietBreakdownTable(data.diet || []);
    renderMilkChart(data.milk_series || []);
    renderDmiChart(data.pens_dmi || {});
    renderConstraints(data.binding_constraints || {});
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

    const poAlert = document.getElementById("po-contingency-alert");
    if (data.formulation_failed || data.fallback_used) {
      if (poAlert) {
        poAlert.style.display = "block";
        const constrBadges = (data.failed_constraints_labels || []).map(l => `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #fca5a5; font-size: 11px; padding: 3px 8px; margin: 2px 4px 2px 0; display: inline-block;">${l}</span>`).join("");
        poAlert.innerHTML = `
          <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.4); border-left: 4px solid #f59e0b; padding: 16px 20px; border-radius: 8px;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
              <span style="font-size: 22px;">⚠️</span>
              <strong style="font-size: 15px; color: #fbbf24;">Aviso: Formulação Automatizada da Ração Falhou — Ração de Contingência Utilizada</strong>
            </div>
            <div style="font-size: 13px; color: #f1f5f9; line-height: 1.55;">
              A formulação automatizada de ração para vacas em lactação não convergiu para uma solução viável devido à violação de restrições zootécnicas. O RuFaS utilizou a ração de contingência anterior:
              <div style="margin: 8px 0; padding: 8px 12px; background: rgba(0,0,0,0.3); border-radius: 5px; font-family: monospace; font-size: 12px; color: #fbbf24;">
                "Previous ration used because automated ration formulation failed... Used most recently formulated ration instead."
              </div>
              <strong style="color: #f87171;">Os valores de consumo (CMS), custo diário da ração, custo/kg leite e IOFC não foram gerados</strong> para evitar conclusões incorretas sobre uma dieta não otimizada.
            </div>
            <div style="margin-top: 10px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
              <span style="font-size: 12px; color: #cbd5e1; font-weight: 600;">Restrições não atendidas:</span>
              ${constrBadges || '<span style="color: #cbd5e1; font-size: 12px;">Cálcio / Proteína</span>'}
            </div>
            <div style="margin-top: 8px; font-size: 12px; color: #94a3b8;">
              💡 <strong>Recomendação Técnica:</strong> ${data.recommendation || "Adicione fontes minerais (ex: Calcário Calcítico) ou revise os limites zootécnicos dos alimentos."}
            </div>
          </div>
        `;
      }

      // Supressão de valores de KPIs de PO
      if (document.getElementById("po-kpi-cost-cow")) document.getElementById("po-kpi-cost-cow").textContent = "--";
      if (document.getElementById("po-kpi-cost-milk")) document.getElementById("po-kpi-cost-milk").textContent = "--";
      if (document.getElementById("po-kpi-iofc")) document.getElementById("po-kpi-iofc").textContent = "--";
      if (document.getElementById("po-kpi-efficiency")) document.getElementById("po-kpi-efficiency").textContent = "--";
      if (document.getElementById("po-kpi-cows")) document.getElementById("po-kpi-cows").textContent = "--";

      // Mensagem na tabela de dieta de PO
      const dietTbody = document.getElementById("table-po-diet-body");
      if (dietTbody) {
        dietTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 25px; color: #fbbf24; font-size: 13px;">⚠️ <strong>Dieta ótima não gerada:</strong> A formulação automatizada falhou e utilizou a ração de contingência anterior ("Previous ration used because automated ration formulation failed... Used most recently formulated ration instead.").</td></tr>`;
      }

      // Restrições de PO
      renderPOConstraintsTable(data.binding_constraints || {});

      // Comparativo de Solvers (LP vs NLP)
      loadSolverComparison(milkPrice);
      return;
    } else {
      if (poAlert) poAlert.style.display = "none";
    }

    poCurrentDiet = data.diet || [];

    // Preenche cards de KPIs de PO normalmente
    const kpis = data.kpis || {};
    if (document.getElementById("po-kpi-cost-cow")) document.getElementById("po-kpi-cost-cow").textContent = `$ ${Number(kpis.cost_per_cow_day || 0).toFixed(2)}`;
    if (document.getElementById("po-kpi-cost-milk")) document.getElementById("po-kpi-cost-milk").textContent = `$ ${Number(kpis.feed_cost_per_kg_milk || 0).toFixed(4)}`;
    if (document.getElementById("po-kpi-iofc")) document.getElementById("po-kpi-iofc").textContent = `$ ${Number(kpis.iofc_per_cow_day || 0).toFixed(2)}`;
    if (document.getElementById("po-kpi-efficiency")) document.getElementById("po-kpi-efficiency").textContent = `${Number(kpis.feed_efficiency || 0).toFixed(2)}x`;
    if (document.getElementById("po-kpi-cows")) document.getElementById("po-kpi-cows").textContent = `${kpis.lactating_cows_count || 0} vacas`;

    // Popula tabela da dieta com custos
    renderPODietTable(poCurrentDiet);

    // Popula select de insumos para sensibilidade com os itens do catálogo
    populatePOFeedSelect();

    // Se houver insumo, calcula sensibilidade inicial para o primeiro selecionado
    const select = document.getElementById("select-po-feed");
    const currentSelected = select ? parseInt(select.value, 10) : null;
    const targetId = currentSelected || (poCurrentDiet.length > 0 ? poCurrentDiet[0].feed_id : (feedCatalog.length > 0 ? feedCatalog[0].id : null));
    if (targetId) {
      loadSensitivity(targetId, milkPrice);
    }

    // Restrições de PO
    renderPOConstraintsTable(data.binding_constraints || {});

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

function populatePOFeedSelect() {
  const select = document.getElementById("select-po-feed");
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = "";

  if (!feedCatalog || feedCatalog.length === 0) {
    select.innerHTML = '<option value="">Carregando catálogo de insumos...</option>';
    return;
  }

  // Mapeia insumos presentes na formulação simulada
  const dietMap = {};
  (poCurrentDiet || []).forEach(item => {
    dietMap[item.feed_id] = item;
  });

  const activeInDiet = feedCatalog.filter(item => dietMap[item.id]);
  const othersInCatalog = feedCatalog.filter(item => !dietMap[item.id]);

  if (activeInDiet.length > 0) {
    // 1. Grupo de insumos ativos na dieta simulada
    const groupActive = document.createElement("optgroup");
    groupActive.label = `⭐ Ativos na Dieta Formulada (${activeInDiet.length})`;
    activeInDiet.forEach(item => {
      const d = dietMap[item.id];
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = `⭐ #${item.id} - ${item.name} (${d.amount_kg} kg | ${d.percentage}% | $${d.price_per_kg}/kg)`;
      if (currentVal && String(item.id) === String(currentVal)) {
        opt.selected = true;
      }
      groupActive.appendChild(opt);
    });
    select.appendChild(groupActive);

    // 2. Grupo com todos os demais alimentos do catálogo
    const groupOthers = document.createElement("optgroup");
    groupOthers.label = `📋 Todos os Alimentos do Catálogo ${currentStandard} (${othersInCatalog.length} itens)`;
    othersInCatalog.forEach(item => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.label;
      if (currentVal && String(item.id) === String(currentVal)) {
        opt.selected = true;
      }
      groupOthers.appendChild(opt);
    });
    select.appendChild(groupOthers);
  } else {
    // Sem dieta simulada ainda: carrega todos os itens do catálogo diretamente
    feedCatalog.forEach(item => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.label;
      if (currentVal && String(item.id) === String(currentVal)) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }

  if (!select.value && select.options.length > 0) {
    select.selectedIndex = 0;
  }
}

async function loadSensitivity(feedId, milkPrice) {
  try {
    const res = await fetch(`/api/po/sensitivity?feed_id=${feedId}&milk_price=${milkPrice}`);
    const data = await res.json();
    if (data.error) return showToast(data.error, "error");

    if (document.getElementById("po-selected-feed-name")) {
      document.getElementById("po-selected-feed-name").textContent = data.feed_name + (data.is_active_in_diet ? " (Ativo na Dieta)" : " (Insumo do Catálogo)");
    }
    if (document.getElementById("po-feed-elasticity")) {
      if (data.is_active_in_diet) {
        document.getElementById("po-feed-elasticity").textContent = `${data.cost_elasticity} (${data.cost_share_percentage}% do custo total | ${data.amount_kg} kg/vaca/dia)`;
      } else {
        document.getElementById("po-feed-elasticity").textContent = `0.0 (Insumo do catálogo com consumo 0.0 kg na dieta ótima simulada atual)`;
      }
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
  const alertContainer = document.getElementById("solver-comparison-alert-container");

  try {
    const res = await fetch(`/api/po/compare_solvers?milk_price=${milkPrice}`);
    const data = await res.json();

    // Se houver falha na execução de qualquer um dos solvers
    if (!data || data.success === false || data.error || data.failure_reason) {
      const solverName = data.failed_solver || "Otimizador";
      const failureReason = data.failure_reason || data.error || "Falha matemática na convergência do solver.";
      const errorTitle = data.error_title || "Falha na Execução do Solver de Otimização";

      // 1. Alerta ao usuário via Toast
      showToast(`⚠️ [${solverName}] ${failureReason}`, "error", 6500);

      // 2. Banner de Alerta Visual no Painel
      if (alertContainer) {
        alertContainer.style.display = "block";
        alertContainer.innerHTML = `
          <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.45); border-left: 5px solid #ef4444; border-radius: 8px; padding: 16px 20px; color: #fecaca;">
            <div style="display: flex; align-items: flex-start; gap: 14px;">
              <span style="font-size: 26px; line-height: 1;">⚠️</span>
              <div style="flex: 1;">
                <h4 style="margin: 0 0 6px 0; color: #f87171; font-size: 16px; font-weight: 600;">
                  ${errorTitle}
                </h4>
                <p style="margin: 0 0 10px 0; font-size: 13.5px; line-height: 1.55; color: #cbd5e1;">
                  <strong>Solver Afetado:</strong> <span class="badge" style="background: rgba(239, 68, 68, 0.25); color: #fca5a5; font-weight: 600;">${solverName}</span><br>
                  <strong>Motivo da Falha:</strong> ${failureReason}
                </p>
                <div style="display: inline-flex; align-items: center; gap: 6px; background: rgba(0, 0, 0, 0.35); padding: 6px 12px; border-radius: 6px; font-size: 12px; color: #fda4af; border: 1px dashed rgba(239, 68, 68, 0.4);">
                  <span>🚫</span>
                  <strong>Nenhum valor comparativo foi calculado para evitar resultados incorretos ou artificiais.</strong>
                </div>
              </div>
            </div>
          </div>
        `;
      }

      // 3. Bloqueia e limpa os KPIs para indicar que NENHUM valor foi calculado
      if (document.getElementById("compare-lp-cost")) {
        document.getElementById("compare-lp-cost").textContent = "Falha";
        document.getElementById("compare-lp-cost").style.color = "#f87171";
      }
      if (document.getElementById("compare-lp-dmi")) {
        document.getElementById("compare-lp-dmi").textContent = "Consumo: Não calculado";
      }

      if (document.getElementById("compare-nlp-cost")) {
        if (data.nonlinear && data.nonlinear.cost_per_cow_day) {
          document.getElementById("compare-nlp-cost").textContent = `$ ${data.nonlinear.cost_per_cow_day.toFixed(3)}`;
          document.getElementById("compare-nlp-cost").style.color = "#f59e0b";
        } else {
          document.getElementById("compare-nlp-cost").textContent = "Falha";
          document.getElementById("compare-nlp-cost").style.color = "#f87171";
        }
      }
      if (document.getElementById("compare-nlp-dmi")) {
        if (data.nonlinear && data.nonlinear.total_dmi_kg) {
          document.getElementById("compare-nlp-dmi").textContent = `Consumo: ${data.nonlinear.total_dmi_kg.toFixed(2)} kg MS/dia`;
        } else {
          document.getElementById("compare-nlp-dmi").textContent = "Consumo: Não calculado";
        }
      }

      if (document.getElementById("compare-cost-diff")) {
        document.getElementById("compare-cost-diff").textContent = "--";
        document.getElementById("compare-cost-diff").style.color = "#94a3b8";
      }
      if (document.getElementById("compare-cost-diff-pct")) {
        document.getElementById("compare-cost-diff-pct").textContent = "Variação relativa: Não calculada (Execução abortada)";
      }

      // 4. Limpa e sinaliza na tabela de ingredientes
      const tbody = document.getElementById("table-compare-solvers-body");
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align: center; color: #f87171; padding: 26px 16px; background: rgba(239, 68, 68, 0.05);">
              <div style="font-size: 15px; font-weight: 600; margin-bottom: 6px;">
                ⚠️ Execução Interrompida: Falha no Solver <strong>${solverName}</strong>
              </div>
              <div style="font-size: 13px; color: var(--text-muted); max-width: 650px; margin: 0 auto 8px auto; line-height: 1.45;">
                ${failureReason}
              </div>
              <div style="font-size: 12px; color: #fda4af; font-weight: 600;">
                🚫 Nenhum ingrediente ou valor foi calculado.
              </div>
            </td>
          </tr>
        `;
      }

      // 5. Atualiza caixa explicativa
      if (document.getElementById("compare-interpretation")) {
        document.getElementById("compare-interpretation").innerHTML = `
          <span style="color: #f87171; font-weight: 500;">
            ⚠️ O cálculo comparativo entre os modelos foi suspenso devido à falha de execução no solver <strong>${solverName}</strong>.
            Nenhum valor comparativo foi calculado. Ajuste os insumos ou limites do lote para restaurar a viabilidade matemática.
          </span>
        `;
      }
      return;
    }

    // Se ambos os solvers executaram com sucesso:
    if (alertContainer) {
      alertContainer.style.display = "none";
      alertContainer.innerHTML = "";
    }

    const lp = data.linear;
    const nlp = data.nonlinear;
    const comp = data.comparison;

    if (document.getElementById("compare-lp-cost")) {
      document.getElementById("compare-lp-cost").textContent = `$ ${lp.cost_per_cow_day.toFixed(3)}`;
      document.getElementById("compare-lp-cost").style.color = "#60a5fa";
    }
    if (document.getElementById("compare-lp-dmi")) {
      document.getElementById("compare-lp-dmi").textContent = `Consumo: ${lp.total_dmi_kg.toFixed(2)} kg MS/dia`;
    }

    if (document.getElementById("compare-native-cost")) {
      if (data.native_simplex && data.native_simplex.cost_per_cow_day) {
        document.getElementById("compare-native-cost").textContent = `$ ${data.native_simplex.cost_per_cow_day.toFixed(3)}`;
        document.getElementById("compare-native-cost").style.color = "#c084fc";
      } else {
        document.getElementById("compare-native-cost").textContent = "$ --";
      }
    }
    if (document.getElementById("compare-native-dmi")) {
      if (data.native_simplex && data.native_simplex.total_dmi_kg) {
        document.getElementById("compare-native-dmi").textContent = `Consumo: ${data.native_simplex.total_dmi_kg.toFixed(2)} kg MS/dia (${data.native_simplex.nit || 0} iterações)`;
      } else {
        document.getElementById("compare-native-dmi").textContent = "Consumo: -- kg MS/dia";
      }
    }

    if (document.getElementById("compare-nlp-cost")) {
      document.getElementById("compare-nlp-cost").textContent = `$ ${nlp.cost_per_cow_day.toFixed(3)}`;
      document.getElementById("compare-nlp-cost").style.color = "#f59e0b";
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
    showToast(`Erro na requisição do comparativo: ${err}`, "error");
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

// 7. Histórico e Arquivamento de Simulações
let lastArchivedFolderName = null;
let allArchivedSimulations = [];

function displayArchivedNotification(manifest) {
  const card = document.getElementById("run-archive-card");
  const title = document.getElementById("archive-card-title");
  const desc = document.getElementById("archive-card-desc");
  if (!card) return;

  lastArchivedFolderName = manifest.folder_name;
  const simCode = manifest.simulation_code || manifest.simulation_id || "";
  if (title) {
    title.innerHTML = `Simulação <span class="badge" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; font-family: monospace; font-size: 13px; font-weight: 700;">${simCode}</span> da "${manifest.farm_name}" Salva!`;
  }
  if (desc) {
    desc.textContent = `📁 Pasta: ${manifest.relative_path} (${manifest.simulated_days} dias simulados, ${manifest.duration_seconds}s)`;
  }
  card.style.display = "block";
  showToast(`Simulação [${simCode}] arquivada com sucesso!`, "success");
}

async function openArchiveFolder(folderName) {
  if (!folderName) return;
  try {
    showToast(`Solicitando abertura da pasta no explorador...`, "info");
    const res = await fetch(`/api/simulations/open_folder/${encodeURIComponent(folderName)}`, {
      method: "POST"
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Pasta aberta no sistema!`, "success");
    } else {
      showToast(`Aviso: ${data.error || "Não foi possível abrir automaticamente"}`, "warning");
    }
  } catch (err) {
    console.error("Erro ao abrir pasta:", err);
    showToast("Erro ao abrir pasta da simulação", "error");
  }
}

async function loadSimulationHistory() {
  const loading = document.getElementById("history-loading");
  const empty = document.getElementById("history-empty");
  const tableCont = document.getElementById("history-table-container");
  const tbody = document.getElementById("table-history-body");
  const farmFilter = document.getElementById("select-history-farm-filter");

  if (loading) loading.style.display = "block";
  if (empty) empty.style.display = "none";
  if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-dim);">Carregando simulações...</td></tr>`;

  try {
    const res = await fetch("/api/simulations/history");
    const list = await res.json();
    allArchivedSimulations = Array.isArray(list) ? list : [];

    if (loading) loading.style.display = "none";

    if (allArchivedSimulations.length === 0) {
      if (empty) empty.style.display = "block";
      if (tableCont) tableCont.style.display = "none";
      return;
    }

    // Popula o seletor de filtros com as fazendas disponíveis
    if (farmFilter) {
      const currentSelected = farmFilter.value;
      const farms = new Map();
      allArchivedSimulations.forEach(s => {
        const fCode = s.farm_code || s.farm_slug || "FAZ";
        const fName = s.farm_name || fCode;
        if (!farms.has(fCode)) farms.set(fCode, fName);
      });

      farmFilter.innerHTML = `<option value="">Todas as Fazendas (${allArchivedSimulations.length})</option>`;
      farms.forEach((fName, fCode) => {
        const opt = document.createElement("option");
        opt.value = fCode;
        opt.textContent = `${fCode} - ${fName}`;
        farmFilter.appendChild(opt);
      });
      if (currentSelected && farms.has(currentSelected)) {
        farmFilter.value = currentSelected;
      }

      farmFilter.onchange = () => renderHistoryTable(farmFilter.value);
    }

    renderHistoryTable(farmFilter ? farmFilter.value : "");
  } catch (err) {
    console.error("Erro ao carregar histórico:", err);
    if (loading) loading.style.display = "none";
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #f87171;">Erro ao carregar histórico: ${err}</td></tr>`;
  }
}

function renderHistoryTable(filterFarmCode = "") {
  const tbody = document.getElementById("table-history-body");
  const empty = document.getElementById("history-empty");
  const tableCont = document.getElementById("history-table-container");
  if (!tbody) return;

  const filtered = filterFarmCode
    ? allArchivedSimulations.filter(s => (s.farm_code === filterFarmCode || s.farm_slug === filterFarmCode))
    : allArchivedSimulations;

  if (filtered.length === 0) {
    if (empty) empty.style.display = "block";
    if (tableCont) tableCont.style.display = "none";
    return;
  }

  if (empty) empty.style.display = "none";
  if (tableCont) tableCont.style.display = "block";
  tbody.innerHTML = "";

  filtered.forEach(sim => {
    const tr = document.createElement("tr");
    tr.style.verticalAlign = "top";

    const kpis = sim.kpis || {};
    const isSuccess = sim.status === "success" && sim.exit_code === 0;
    const isFallback = Boolean(
      sim.formulation_failed ||
      sim.fallback_used ||
      !sim.kpis ||
      Object.keys(kpis).length === 0
    );

    // Formatações zootécnicas (apenas se não houver fallback)
    const dmiStr = (kpis.total_dmi_kg !== undefined && kpis.total_dmi_kg !== null)
      ? `${Number(kpis.total_dmi_kg).toFixed(2)} kg MS/dia`
      : "-";
    const milkStr = (kpis.milk_per_cow_daily !== undefined && kpis.milk_per_cow_daily !== null)
      ? `${Number(kpis.milk_per_cow_daily).toFixed(1)} kg/vaca/dia`
      : "-";
    const herdMilkStr = (kpis.total_herd_milk_daily !== undefined && kpis.total_herd_milk_daily !== null)
      ? `${Number(kpis.total_herd_milk_daily).toLocaleString("pt-BR", {maximumFractionDigits: 1})} kg/dia`
      : "-";
    const effStr = (kpis.feed_efficiency !== undefined && kpis.feed_efficiency !== null)
      ? `${Number(kpis.feed_efficiency).toFixed(2)} kg leite/kg MS`
      : "-";
    const activeFeedsStr = (kpis.active_ingredients_count !== undefined && kpis.active_ingredients_count !== null)
      ? `${kpis.active_ingredients_count} insumos ativos`
      : "-";

    // Formatações econômicas (apenas se não houver fallback)
    const costStr = (kpis.cost_per_cow_day !== undefined && kpis.cost_per_cow_day !== null)
      ? `$ ${Number(kpis.cost_per_cow_day).toFixed(3)} /dia`
      : "-";
    const feedCostPerKgMilkStr = (kpis.feed_cost_per_kg_milk !== undefined && kpis.feed_cost_per_kg_milk !== null)
      ? `$ ${Number(kpis.feed_cost_per_kg_milk).toFixed(4)} /kg`
      : "-";
    const revenueStr = (kpis.milk_revenue_per_cow !== undefined && kpis.milk_revenue_per_cow !== null)
      ? `$ ${Number(kpis.milk_revenue_per_cow).toFixed(2)} /dia`
      : "-";
    const iofcStr = (kpis.iofc_per_cow_day !== undefined && kpis.iofc_per_cow_day !== null)
      ? `$ ${Number(kpis.iofc_per_cow_day).toFixed(2)} /dia`
      : "-";
    const milkPriceStr = (kpis.milk_price_assumed !== undefined && kpis.milk_price_assumed !== null)
      ? `$ ${Number(kpis.milk_price_assumed).toFixed(2)}/kg`
      : "$ 0.45/kg";

    const fallbackBadgeHtml = isFallback
      ? `<span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.45); align-self: flex-start; font-size: 10.5px; padding: 3px 6px; display: inline-flex; align-items: center; gap: 4px;" title="A formulação de ração falhou e a ração anterior foi utilizada">
           ⚠️ Ração Contingência
         </span>`
      : "";

    const failedBadgesHtml = (sim.failed_constraints_labels && sim.failed_constraints_labels.length > 0)
      ? sim.failed_constraints_labels.map(l => `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #fca5a5; font-size: 10px; padding: 2px 6px; margin: 2px 2px 0 0; display: inline-block;">${l}</span>`).join("")
      : `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #fca5a5; font-size: 10px; padding: 2px 6px; margin-top: 2px; display: inline-block;">Restrições zootécnicas infactíveis (ex: Cálcio)</span>`;

    const col3Content = isFallback
      ? `<div style="background: rgba(245, 158, 11, 0.08); border-left: 3px solid #f59e0b; padding: 8px 10px; border-radius: 4px; font-size: 12px; line-height: 1.45;">
           <strong style="color: #fbbf24; display: block; margin-bottom: 2px;">⚠️ Valores Não Gerados</strong>
           <span style="color: #e2e8f0; display: block;">
             A formulação automatizada da ração falhou. A ração anterior/padrão foi reutilizada como contingência.
           </span>
           <div style="margin-top: 5px; color: #94a3b8; font-size: 10.5px; font-style: italic; line-height: 1.3;">
             "Previous ration used because automated ration formulation failed... Used most recently formulated ration instead."
           </div>
         </div>`
      : `<div>
           <span style="color: var(--text-dim);">Consumo (CMS):</span> 
           <strong style="color: #38bdf8; font-size: 13px;">${dmiStr}</strong>
         </div>
         <div>
           <span style="color: var(--text-dim);">Produção Leite:</span> 
           <strong style="color: #f1f5f9;">${milkStr}</strong>
         </div>
         <div>
           <span style="color: var(--text-dim);">Prod. Rebanho:</span> 
           <span style="color: #cbd5e1;">${herdMilkStr}</span>
         </div>
         <div>
           <span style="color: var(--text-dim);">Eficiência Alimentar:</span> 
           <strong style="color: #a78bfa;">${effStr}</strong>
         </div>
         <div style="font-size: 11.5px; color: var(--text-muted);">
           <span style="color: var(--text-dim);">Formulação:</span> 
           <span>${activeFeedsStr}</span>
         </div>`;

    const col4Content = isFallback
      ? `<div style="background: rgba(239, 68, 68, 0.08); border-left: 3px solid #ef4444; padding: 8px 10px; border-radius: 4px; font-size: 12px; line-height: 1.45;">
           <strong style="color: #f87171; display: block; margin-bottom: 2px;">⚠️ Custos e IOFC Não Calculados</strong>
           <span style="color: #cbd5e1; display: block; margin-bottom: 4px;">
             O solver não encontrou solução factível para as restrições nutricionais do lote.
           </span>
           <div style="display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px;">
             ${failedBadgesHtml}
           </div>
         </div>`
      : `<div>
           <span style="color: var(--text-dim);">Custo Ração:</span> 
           <strong style="color: #f59e0b; font-size: 13px;">${costStr}</strong>
         </div>
         <div>
           <span style="color: var(--text-dim);">Custo / kg Leite:</span> 
           <strong style="color: #fbbf24;">${feedCostPerKgMilkStr}</strong>
         </div>
         <div>
           <span style="color: var(--text-dim);">Receita Leite:</span> 
           <span style="color: #cbd5e1;">${revenueStr}</span>
         </div>
         <div>
           <span style="color: var(--text-dim);">IOFC (Margem):</span> 
           <strong style="color: #10b981; font-size: 13.5px;">${iofcStr}</strong>
         </div>
         <div style="font-size: 11px; color: var(--text-dim);">
           <span>Preço Leite Base:</span> ${milkPriceStr}
         </div>`;

    tr.innerHTML = `
      <!-- Coluna 1: Identificação da Simulação -->
      <td>
        <div style="display: flex; flex-direction: column; gap: 5px;">
          <span class="badge" style="background: rgba(59, 130, 246, 0.18); color: #60a5fa; font-weight: 700; font-family: monospace; font-size: 12.5px; letter-spacing: 0.5px; border: 1px solid rgba(59, 130, 246, 0.3); padding: 4px 8px; align-self: flex-start;">
            ${sim.simulation_code || sim.simulation_id}
          </span>
          <span style="font-size: 11px; color: var(--text-dim); font-family: monospace;">
            Rodada #${sim.run_number || 1}
          </span>
          <span class="badge ${isSuccess ? 'badge-success' : 'badge-danger'}" style="background: ${isSuccess ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color: ${isSuccess ? '#34d399' : '#f87171'}; align-self: flex-start; font-size: 11px; padding: 3px 7px;">
            ${isSuccess ? '✅ Concluída' : '❌ Falhou'}
          </span>
          ${fallbackBadgeHtml}
        </div>
      </td>

      <!-- Coluna 2: Dados da Simulação (Metadados Condensados) -->
      <td style="line-height: 1.6; font-size: 12.5px;">
        <div style="margin-bottom: 2px;">
          <strong style="color: #f1f5f9; font-size: 13.5px;">${sim.farm_name || "Fazenda"}</strong> 
          <span style="font-size: 11px; color: var(--text-dim);">(${sim.farm_code || "FAZ"})</span>
        </div>
        <div style="color: #cbd5e1;">
          <span style="color: var(--text-dim);">Data/Hora:</span> 
          <span>📅 ${sim.execution_date}</span> às <span>⏰ ${sim.execution_time}</span>
          ${sim.duration_seconds ? `<span style="color: var(--text-dim);"> (${sim.duration_seconds}s)</span>` : ''}
        </div>
        <div style="color: #cbd5e1;">
          <span style="color: var(--text-dim);">Período:</span> 
          <strong>${sim.simulated_days || 31} dias</strong>
          <span style="color: var(--text-dim);"> [${sim.simulation_type || 'full_farm'}]</span>
        </div>
        <div style="color: #cbd5e1; margin-top: 2px;">
          <span style="color: var(--text-dim);">Solver:</span> 
          <span class="badge" style="padding: 2px 7px; font-size: 11px; background: ${
            sim.optimization_mode === 'linear_native' ? 'rgba(168, 85, 247, 0.22)' :
            sim.optimization_mode === 'linear' ? 'rgba(59, 130, 246, 0.18)' : 'rgba(16, 185, 129, 0.18)'
          }; color: ${
            sim.optimization_mode === 'linear_native' ? '#c084fc' :
            sim.optimization_mode === 'linear' ? '#60a5fa' : '#34d399'
          }; font-weight: 600;">
            ${
              sim.optimization_mode === 'linear_native' ? 'LP Nativo (Simplex)' :
              sim.optimization_mode === 'linear' ? 'LP (HiGHS)' : 'NLP (SLSQP)'
            }
          </span>
          <span style="color: var(--text-dim); margin-left: 6px;">Padrão:</span> 
          <span style="color: #cbd5e1; font-weight: 500;">${sim.nutrient_standard || 'NASEM'}</span>
        </div>
      </td>

      <!-- Coluna 3: Indicadores Zootécnicos (Produção & Rúmen) -->
      <td style="line-height: 1.6; font-size: 12.5px;">
        ${col3Content}
      </td>

      <!-- Coluna 4: Indicadores Econômicos & PO ($) -->
      <td style="line-height: 1.6; font-size: 12.5px;">
        ${col4Content}
      </td>

      <!-- Coluna 5: Ações e Pasta -->
      <td style="text-align: center; vertical-align: middle;">
        <div style="display: flex; flex-direction: column; gap: 6px; align-items: center;">
          <button class="btn btn-secondary btn-sm" onclick="openArchiveFolder('${sim.folder_name}')" title="Abre a pasta da simulação no explorador de arquivos" style="padding: 6px 12px; font-size: 12px; font-weight: 500; width: 100%; border-color: rgba(148, 163, 184, 0.3);">
            📂 Abrir Pasta
          </button>
          ${sim.has_tableaus || sim.optimization_mode === 'linear_native' ? `
            <button class="btn btn-outline btn-sm" onclick="viewTableausForSimulation('${sim.folder_name}')" title="Ver Tableaus do Simplex" style="padding: 4px 8px; font-size: 11px; width: 100%; border-color: rgba(168, 85, 247, 0.5); color: #c084fc;">
              🧮 Ver Tableaus
            </button>
          ` : ''}
          <span style="font-size: 10px; color: var(--text-dim); font-family: monospace; word-break: break-all; max-width: 135px; line-height: 1.2;">
            ${sim.folder_name}
          </span>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ==========================================
// TABLEAUS SIMPLEX MODULE (Passo a Passo)
// ==========================================
let currentTableaus = [];
let currentTableauIdx = 0;
let currentTableauPayload = null;

async function loadSimplexTableaus(folderName = null) {
  const container = document.getElementById("tableau-content-container");
  const notAvail = document.getElementById("tableau-not-available");
  const notAvailMsg = document.getElementById("tableau-not-available-msg");

  try {
    const url = folderName ? `/api/po/tableaus?folder=${encodeURIComponent(folderName)}` : `/api/po/tableaus`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data || !data.available || !data.tableaus || data.tableaus.length === 0) {
      if (container) container.style.display = "none";
      if (notAvail) {
        notAvail.style.display = "block";
        if (data && data.message && notAvailMsg) notAvailMsg.textContent = data.message;
      }
      return;
    }

    if (notAvail) notAvail.style.display = "none";
    if (container) container.style.display = "block";

    currentTableauPayload = data;
    currentTableaus = data.tableaus;
    currentTableauIdx = 0;

    // Atualiza limites do slider
    const slider = document.getElementById("tableau-slider");
    if (slider) {
      slider.min = 0;
      slider.max = Math.max(0, currentTableaus.length - 1);
      slider.value = 0;
    }

    renderCurrentTableau();
    renderNativeDietSummary(data.diet_summary);
  } catch (err) {
    console.error("Erro ao carregar tableaus simplex:", err);
    showToast("Erro ao carregar tableaus do Simplex: " + err.message, "error");
  }
}

function renderCurrentTableau() {
  if (!currentTableaus || currentTableaus.length === 0) return;
  if (currentTableauIdx < 0) currentTableauIdx = 0;
  if (currentTableauIdx >= currentTableaus.length) currentTableauIdx = currentTableaus.length - 1;

  const snap = currentTableaus[currentTableauIdx];
  const total = currentTableaus.length;

  // Atualiza contadores
  const lblStep = document.getElementById("lbl-tableau-step");
  const lblTotal = document.getElementById("lbl-tableau-total");
  const slider = document.getElementById("tableau-slider");
  if (lblStep) lblStep.textContent = snap.iteration !== undefined ? snap.iteration : currentTableauIdx;
  if (lblTotal) lblTotal.textContent = total - 1;
  if (slider) slider.value = currentTableauIdx;

  // Badge da Fase
  const badgePhase = document.getElementById("badge-tableau-phase");
  if (badgePhase) {
    badgePhase.textContent = snap.phase_name || (snap.phase === 1 ? "Fase 1: Viabilidade" : "Fase 2: Otimização");
    badgePhase.className = "badge " + (snap.is_final ? "badge-phase-opt" : (snap.phase === 1 ? "badge-phase-1" : "badge-phase-2"));
  }

  // Cards de diagnóstico
  const kpiEnter = document.getElementById("kpi-entering-var");
  const kpiLeave = document.getElementById("kpi-leaving-var");
  const kpiPivot = document.getElementById("kpi-pivot-val");
  const kpiObj = document.getElementById("kpi-objective-val");

  if (kpiEnter) kpiEnter.textContent = snap.entering_var || (snap.is_final ? "Ótimo Atingido" : "Nenhuma");
  if (kpiLeave) kpiLeave.textContent = snap.leaving_var || (snap.is_final ? "Solução Estável" : "Nenhuma");
  if (kpiPivot) kpiPivot.textContent = snap.pivot_val !== null && snap.pivot_val !== undefined ? snap.pivot_val.toFixed(4) : "--";
  if (kpiObj) {
    const prefix = snap.phase === 1 ? "W = " : "Z = $";
    kpiObj.textContent = snap.objective_value !== undefined ? `${prefix}${snap.objective_value.toFixed(4)}` : "--";
  }

  // Descrição do passo
  const descBox = document.getElementById("tableau-description-box");
  if (descBox) {
    descBox.innerHTML = `<strong>Passo ${currentTableauIdx + 1} de ${total}:</strong> ${snap.description || "Iteração do Simplex."}`;
  }

  // Renderiza tabela matricial
  const thead = document.getElementById("matrix-tableau-thead");
  const tbody = document.getElementById("matrix-tableau-tbody");
  const tfoot = document.getElementById("matrix-tableau-tfoot");

  if (!thead || !tbody || !tfoot) return;

  const colNames = snap.col_names || [];
  const pRow = snap.pivot_row;
  const pCol = snap.pivot_col;

  // Thead
  let headerHtml = `<tr>
    <th style="text-align: left; min-width: 80px; background: #0f172a; padding: 8px 10px;">Base</th>
    <th style="text-align: left; min-width: 220px; background: #0f172a; padding: 8px 10px;">Restrição Biológica</th>`;

  colNames.forEach((name, cIdx) => {
    const isPivotCol = cIdx === pCol;
    headerHtml += `<th style="padding: 8px 10px; min-width: 90px; text-align: right; ${isPivotCol ? 'background: rgba(59, 130, 246, 0.25); color: #93c5fd; border-bottom: 2px solid #3b82f6;' : ''}">
      ${name}
    </th>`;
  });

  headerHtml += `<th style="padding: 8px 10px; min-width: 90px; text-align: right; background: rgba(16, 185, 129, 0.15); color: #34d399;">RHS (b)</th>
                 <th style="padding: 8px 10px; min-width: 80px; text-align: right; color: var(--text-dim);">Razão</th></tr>`;
  thead.innerHTML = headerHtml;

  // Tbody
  let bodyHtml = "";
  const rows = snap.matrix_rows || [];
  rows.forEach((row, rIdx) => {
    const isPivotRow = rIdx === pRow;
    const rowClass = isPivotRow ? "pivot-row-highlight" : "";
    bodyHtml += `<tr class="${rowClass}">
      <td style="text-align: left; font-weight: 700; color: #38bdf8; padding: 6px 10px;">${row.basic_var}</td>
      <td style="text-align: left; color: #cbd5e1; white-space: nowrap; padding: 6px 10px;">${row.label}</td>`;

    row.coefficients.forEach((val, cIdx) => {
      const isPivotCell = (rIdx === pRow && cIdx === pCol);
      const isPivotCol = cIdx === pCol;
      let cellClass = "";
      if (isPivotCell) {
        cellClass = "pivot-cell";
      } else if (isPivotCol) {
        cellClass = "pivot-col-highlight";
      }

      bodyHtml += `<td class="${cellClass}" style="padding: 6px 10px;">${val.toFixed(3)}</td>`;
    });

    bodyHtml += `<td style="font-weight: 700; color: #f8fafc; padding: 6px 10px; background: rgba(16, 185, 129, 0.08);">${row.rhs.toFixed(3)}</td>`;
    bodyHtml += `<td style="color: ${row.ratio !== null ? '#fde68a' : 'var(--text-dim)'}; padding: 6px 10px;">${row.ratio !== null ? row.ratio.toFixed(2) : '-'}</td>`;
    bodyHtml += `</tr>`;
  });
  tbody.innerHTML = bodyHtml;

  // Tfoot (Custos Reduzidos)
  let footHtml = `<tr>
    <td style="text-align: left; color: #fbbf24; padding: 8px 10px;">Custos</td>
    <td style="text-align: left; color: #fbbf24; padding: 8px 10px;">Custos Reduzidos (c̄ - z)</td>`;

  const reducedCosts = snap.reduced_costs || [];
  reducedCosts.forEach((rc, cIdx) => {
    const isPivotCol = cIdx === pCol;
    const isNegative = rc < -0.0001;
    const color = isNegative ? "#f87171" : "#94a3b8";
    const bg = isPivotCol ? "background: rgba(59, 130, 246, 0.25);" : "";
    footHtml += `<td style="padding: 8px 10px; text-align: right; color: ${color}; ${bg}; font-weight: 700;">${rc.toFixed(3)}</td>`;
  });

  const objSymbol = snap.phase === 1 ? "W" : "Z";
  footHtml += `<td style="padding: 8px 10px; color: #34d399; font-weight: 800;">${objSymbol} = ${snap.objective_value.toFixed(3)}</td>
               <td></td></tr>`;
  tfoot.innerHTML = footHtml;
}

function renderNativeDietSummary(diet) {
  const tbody = document.getElementById("native-diet-summary-tbody");
  if (!tbody) return;
  if (!diet || diet.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-dim);">Nenhum insumo formulado na dieta.</td></tr>`;
    return;
  }
  let html = "";
  let totalCost = 0;
  let totalKg = 0;
  diet.forEach(item => {
    totalCost += item.daily_cost || 0;
    totalKg += item.amount_kg || 0;
    html += `<tr>
      <td style="text-align: left; font-weight: 600;">${item.feed_name}</td>
      <td style="text-align: right;">${item.amount_kg.toFixed(3)}</td>
      <td style="text-align: right;"><span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa;">${item.percentage.toFixed(1)}%</span></td>
      <td style="text-align: right;">$${item.unit_cost.toFixed(3)}</td>
      <td style="text-align: right; font-weight: 700; color: #34d399;">$${item.daily_cost.toFixed(3)}</td>
    </tr>`;
  });
  html += `<tr style="border-top: 2px solid var(--border); font-weight: 700;">
    <td style="text-align: left; color: var(--accent);">TOTAL DIETA</td>
    <td style="text-align: right; color: var(--accent);">${totalKg.toFixed(3)} kg</td>
    <td style="text-align: right; color: var(--accent);">100.0%</td>
    <td>-</td>
    <td style="text-align: right; color: #34d399; font-size: 14px;">$${totalCost.toFixed(3)} /vaca/dia</td>
  </tr>`;
  tbody.innerHTML = html;
}

function viewTableausForSimulation(folderName) {
  switchTab("tab-tableaus");
  loadSimplexTableaus(folderName);
}

