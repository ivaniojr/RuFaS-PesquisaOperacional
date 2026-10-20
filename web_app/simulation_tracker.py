"""
Módulo de Rastreamento e Arquivamento de Simulações (Simulation Tracker)
RuFaS - Ruminant Farm Systems
Instituto Federal de Goiás (IFG) - Pesquisa Operacional

Salva cada simulação em pasta individual contendo:
- Nome da fazenda, data e horário de execução
- Todos os parâmetros e inputs utilizados (snapshot de reprodutibilidade)
- Todos os resultados (CSVs, relatórios PO e resumos)
- Logs de console e execução
- Manifesto executivo (manifesto.json)
"""

import os
import re
import json
import shutil
import glob
import unicodedata
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional


def sanitize_name(name: str) -> str:
    """Sanitiza strings para nomes de pastas e arquivos válidos em Linux/Windows."""
    if not name:
        return "Fazenda"
    # Normaliza e remove acentos
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_str = nfkd.encode("ASCII", "ignore").decode("utf-8")
    # Substitui caracteres não alfanuméricos por underline
    cleaned = re.sub(r"[^a-zA-Z0-9_\-]", "_", ascii_str)
    # Remove múltiplos underlines consecutivos
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned or "Fazenda"


def sanitize_farm_code(code: str, fallback_name: str = "") -> str:
    """Sanitiza ou gera um código padronizado para a fazenda em maiúsculas (ex: GO_MACAU, FAZ_01)."""
    raw = (code or "").strip()
    if not raw and fallback_name:
        raw = fallback_name.strip()
    if not raw:
        return "FAZ"
    nfkd = unicodedata.normalize("NFKD", raw)
    ascii_str = nfkd.encode("ASCII", "ignore").decode("utf-8").upper()
    cleaned = re.sub(r"[^A-Z0-9_\-]", "_", ascii_str)
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned or "FAZ"


def get_next_simulation_sequence(base_dir: Path, farm_code: str) -> int:
    """
    Calcula o próximo número sequencial da simulação para a fazenda informada.
    Escaneia os manifestos em output/simulacoes/*/manifesto.json
    """
    simulacoes_root = base_dir / "output" / "simulacoes"
    if not simulacoes_root.exists():
        return 1

    clean_code = sanitize_farm_code(farm_code)
    max_seq = 0

    manifest_files = glob.glob(str(simulacoes_root / "*" / "manifesto.json"))
    for m_file in manifest_files:
        try:
            with open(m_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                m_farm_code = sanitize_farm_code(data.get("farm_code") or data.get("farm_slug") or data.get("farm_name", ""))
                if m_farm_code == clean_code:
                    run_num = data.get("run_number")
                    if isinstance(run_num, int) and run_num > max_seq:
                        max_seq = run_num
                    else:
                        sim_code = data.get("simulation_code", "")
                        match = re.search(r"SIM[-_]?(\d+)", sim_code) or re.search(r"SIM[-_]?(\d+)", data.get("folder_name", ""))
                        if match:
                            num = int(match.group(1))
                            if num > max_seq:
                                max_seq = num
        except Exception:
            continue

    # Verificação redundante direta por pastas para segurança
    for d in simulacoes_root.iterdir():
        if d.is_dir() and d.name.upper().startswith(clean_code):
            match = re.search(r"SIM[-_]?(\d+)", d.name, re.IGNORECASE)
            if match:
                num = int(match.group(1))
                if num > max_seq:
                    max_seq = num

    return max_seq + 1


def get_active_simulation_config(base_dir: Path) -> Dict[str, Any]:
    """Coleta os parâmetros ativos da simulação a partir dos arquivos de configuração e cenário."""
    info: Dict[str, Any] = {
        "farm_name": "Fazenda Campo Dourado",
        "farm_slug": "GO_campo_dourado",
        "farm_code": "GO_CAMPO_DOURADO",
        "nutrient_standard": "NASEM",
        "optimization_mode": "nonlinear",
        "simulation_type": "animals_only",
        "start_date": "2013:1",
        "end_date": "2013:31",
        "total_days": 31,
        "task_path": "input/data/tasks/example_animals_only_task.json",
        "config_path": "input/data/config/example_animals_only_config.json",
        "metadata_path": "input/metadata/example_animals_only_metadata.json",
        "feed_path": "input/data/feed/example_Northeast_feed.json"
    }

    # 1. active_scenario.json
    scenario_path = base_dir / "input" / "data" / "config" / "active_scenario.json"
    if scenario_path.exists():
        try:
            with open(scenario_path, "r", encoding="utf-8") as f:
                sc_data = json.load(f)
                info["farm_name"] = sc_data.get("name", info["farm_name"])
                info["farm_slug"] = sc_data.get("slug", sc_data.get("farm_code", info["farm_slug"]))
                info["farm_code"] = sanitize_farm_code(sc_data.get("farm_code") or sc_data.get("slug") or info["farm_name"])
                info["nutrient_standard"] = sc_data.get("nutrient_standard", info["nutrient_standard"])
                info["feed_path"] = sc_data.get("feed_file", info["feed_path"])
        except Exception:
            pass

    # 2. task_manager_metadata.json
    tm_path = base_dir / "input" / "task_manager_metadata.json"
    if tm_path.exists():
        try:
            with open(tm_path, "r", encoding="utf-8") as f:
                tm_data = json.load(f)
                t_path = tm_data.get("files", {}).get("tasks", {}).get("path")
                if t_path:
                    info["task_path"] = t_path
        except Exception:
            pass

    # 3. Task file para obter metadata_file_path
    task_full_path = base_dir / info["task_path"]
    if task_full_path.exists():
        try:
            with open(task_full_path, "r", encoding="utf-8") as f:
                task_data = json.load(f)
                tasks = task_data.get("tasks", [])
                if tasks:
                    meta_p = tasks[0].get("metadata_file_path")
                    if meta_p:
                        info["metadata_path"] = meta_p
        except Exception:
            pass

    # 4. Metadata file para obter config path
    meta_full_path = base_dir / info["metadata_path"]
    if meta_full_path.exists():
        try:
            with open(meta_full_path, "r", encoding="utf-8") as f:
                m_data = json.load(f)
                cfg_p = m_data.get("files", {}).get("config", {}).get("path")
                if cfg_p:
                    info["config_path"] = cfg_p
                fd_p = m_data.get("files", {}).get("feed", {}).get("path")
                if fd_p:
                    info["feed_path"] = fd_p
        except Exception:
            pass

    # 5. Config file para obter datas, simulation_type e optimization_mode
    cfg_full_path = base_dir / info["config_path"]
    if cfg_full_path.exists():
        try:
            with open(cfg_full_path, "r", encoding="utf-8") as f:
                c_data = json.load(f)
                info["start_date"] = c_data.get("start_date", "2013:1")
                info["end_date"] = c_data.get("end_date", "2013:31")
                info["simulation_type"] = c_data.get("simulation_type", "animals_only")
                info["optimization_mode"] = c_data.get("optimization_mode", "nonlinear")
                if "nutrient_standard" in c_data:
                    info["nutrient_standard"] = c_data["nutrient_standard"]

                s_parts = info["start_date"].split(":")
                e_parts = info["end_date"].split(":")
                s_y, s_d = int(s_parts[0]), int(s_parts[1])
                e_y, e_d = int(e_parts[0]), int(e_parts[1])
                if s_y == e_y:
                    info["total_days"] = e_d - s_d + 1
                else:
                    info["total_days"] = 365 * (e_y - s_y + 1)
        except Exception:
            pass

    return info


def archive_simulation(
    base_dir: Path,
    execution_logs: Optional[List[str]] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    exit_code: int = 0
) -> Dict[str, Any]:
    """
    Arquiva a execução da simulação em uma pasta dedicada contendo:
    - output/simulacoes/{codigo_fazenda}_SIM{seq}_{data}_{hora}/
      - manifesto.json
      - parametros/ (cópia de todos os inputs)
      - resultados/ (CSVs, relatórios PO e análises)
      - logs/ (logs de console e do RuFaS)
    """
    if start_time is None:
        start_time = datetime.now()
    if end_time is None:
        end_time = datetime.now()

    duration_sec = max(0.0, (end_time - start_time).total_seconds())

    # 1. Carrega parâmetros ativos
    cfg = get_active_simulation_config(base_dir)
    farm_name = cfg["farm_name"]
    farm_slug = cfg["farm_slug"]
    farm_code = cfg.get("farm_code") or sanitize_farm_code(farm_slug, farm_name)

    # Calcula número da simulação para esta fazenda
    run_seq = get_next_simulation_sequence(base_dir, farm_code)
    simulation_code = f"{farm_code}-SIM{run_seq:03d}"

    # 2. Gera nome da pasta e caminhos
    timestamp_folder = start_time.strftime("%Y-%m-%d_%H-%M-%S")
    folder_name = f"{farm_code}_SIM{run_seq:03d}_{timestamp_folder}"

    simulacoes_root = base_dir / "output" / "simulacoes"
    sim_dir = simulacoes_root / folder_name
    param_dir = sim_dir / "parametros"
    res_dir = sim_dir / "resultados"
    logs_dir = sim_dir / "logs"

    param_dir.mkdir(parents=True, exist_ok=True)
    res_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    copied_params: List[str] = []

    # 3. Snapshot de Parâmetros
    files_to_copy = [
        ("task_manager_metadata.json", base_dir / "input" / "task_manager_metadata.json"),
        ("active_scenario.json", base_dir / "input" / "data" / "config" / "active_scenario.json"),
        ("config.json", base_dir / cfg["config_path"]),
        ("task.json", base_dir / cfg["task_path"]),
        ("metadata.json", base_dir / cfg["metadata_path"]),
        ("feed_config.json", base_dir / cfg["feed_path"]),
        ("user_feeds.csv", base_dir / "input" / "data" / "feed" / "user_feeds.csv")
    ]

    for label_name, src_path in files_to_copy:
        if src_path.exists():
            try:
                dest = param_dir / label_name
                shutil.copy2(src_path, dest)
                copied_params.append(label_name)
            except Exception as e:
                print(f"[SimulationTracker] Aviso ao copiar {src_path.name}: {e}")

    # Salva resumo consolidado dos parâmetros
    try:
        with open(param_dir / "parametros_resumo.json", "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
    except Exception:
        pass

    # 4. Arquivamento de Resultados
    latest_csv_path: Optional[Path] = None
    csv_candidates = glob.glob(str(base_dir / "output" / "CSVs" / "*.csv"))
    if csv_candidates:
        # Pega o arquivo modificado mais recentemente
        latest_csv_str = max(csv_candidates, key=os.path.getmtime)
        latest_csv_path = Path(latest_csv_str)
        try:
            dest_csv = res_dir / latest_csv_path.name
            shutil.copy2(latest_csv_path, dest_csv)
            alias_csv = res_dir / "simulacao_dados_completos.csv"
            if not alias_csv.exists():
                try:
                    os.link(dest_csv, alias_csv)
                except Exception:
                    shutil.copy2(latest_csv_path, alias_csv)
        except Exception as e:
            print(f"[SimulationTracker] Aviso ao copiar CSV de resultados: {e}")

    # Gera relatório de Pesquisa Operacional e análises consolidadas
    kpis: Optional[Dict[str, Any]] = None
    formulation_failed = False
    fallback_used = False
    fallback_message = None
    failed_constraints = []
    failed_constraints_labels = []

    try:
        from web_app.po_analytics import analyze_po_results, generate_po_csv_report
        po_data = analyze_po_results(base_dir, specific_csv=latest_csv_path)
        if po_data.get("has_results"):
            formulation_failed = po_data.get("formulation_failed", False)
            fallback_used = po_data.get("fallback_used", False)
            fallback_message = po_data.get("fallback_message")
            failed_constraints = po_data.get("failed_constraints", [])
            failed_constraints_labels = po_data.get("failed_constraints_labels", [])

            # Quando a formulação falha e a ração anterior é utilizada como contingência,
            # os valores de KPIs NÃO DEVEM ser gerados/calculados
            if formulation_failed or fallback_used:
                kpis = None
            else:
                kpis = po_data.get("kpis")

            with open(res_dir / "analise_po.json", "w", encoding="utf-8") as f:
                json.dump(po_data, f, indent=2, ensure_ascii=False)

            csv_text = generate_po_csv_report(base_dir, specific_csv=latest_csv_path)
            with open(res_dir / "relatorio_pesquisa_operacional.csv", "w", encoding="utf-8") as f:
                f.write(csv_text)
    except Exception as e:
        print(f"[SimulationTracker] Aviso ao gerar relatórios PO: {e}")

    # Arquivamento dos Tableaus Simplex (se gerado pelo solver nativo)
    has_tableaus = False
    tableaus_src = base_dir / "output" / "tableaus_simplex_latest.json"
    if tableaus_src.exists():
        try:
            if tableaus_src.stat().st_mtime >= start_time.timestamp() - 10:
                shutil.copy2(tableaus_src, res_dir / "tableaus_simplex.json")
                has_tableaus = True
        except Exception as e:
            print(f"[SimulationTracker] Aviso ao copiar tableaus_simplex_latest.json: {e}")

    # 5. Arquivamento de Logs
    if execution_logs:
        try:
            with open(logs_dir / "console_execucao.log", "w", encoding="utf-8") as f:
                f.write("\n".join(execution_logs))
        except Exception:
            pass

    # Copia logs do RuFaS (output/logs/*)
    rufas_logs_src = base_dir / "output" / "logs"
    rufas_logs_dest = logs_dir / "rufas_logs"
    if rufas_logs_src.exists():
        rufas_logs_dest.mkdir(exist_ok=True)
        for log_file in rufas_logs_src.glob("*.*"):
            try:
                shutil.copy2(log_file, rufas_logs_dest / log_file.name)
            except Exception:
                pass

    # 6. Geração do Manifesto Executivo (manifesto.json)
    status_str = "success" if exit_code == 0 else "failed"
    manifest: Dict[str, Any] = {
        "simulation_id": simulation_code,
        "simulation_code": simulation_code,
        "farm_code": farm_code,
        "farm_name": farm_name,
        "farm_slug": farm_slug,
        "run_number": run_seq,
        "folder_name": folder_name,
        "relative_path": f"output/simulacoes/{folder_name}",
        "absolute_path": str(sim_dir.resolve()),
        "execution_date": start_time.strftime("%Y-%m-%d"),
        "execution_time": start_time.strftime("%H:%M:%S"),
        "start_iso": start_time.isoformat(),
        "end_iso": end_time.isoformat(),
        "duration_seconds": round(duration_sec, 2),
        "exit_code": exit_code,
        "status": status_str,
        "formulation_failed": formulation_failed,
        "fallback_used": fallback_used,
        "fallback_message": fallback_message,
        "failed_constraints": failed_constraints,
        "failed_constraints_labels": failed_constraints_labels,
        "optimization_mode": cfg.get("optimization_mode", "nonlinear"),
        "nutrient_standard": cfg.get("nutrient_standard", "NASEM"),
        "simulation_type": cfg.get("simulation_type", "animals_only"),
        "simulated_days": cfg.get("total_days", 31),
        "copied_parameters": copied_params,
        "raw_csv_file": latest_csv_path.name if latest_csv_path else None,
        "has_tableaus": has_tableaus,
        "kpis": kpis
    }

    try:
        with open(sim_dir / "manifesto.json", "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[SimulationTracker] Erro ao gravar manifesto.json: {e}")

    print(f"\n[SimulationTracker] ✅ Simulação [{simulation_code}] salva com sucesso em:\n  📂 output/simulacoes/{folder_name}")
    return manifest


def list_archived_simulations(base_dir: Path) -> List[Dict[str, Any]]:
    """Retorna a lista de todas as simulações arquivadas, ordenadas das mais recentes para as mais antigas."""
    simulacoes_root = base_dir / "output" / "simulacoes"
    if not simulacoes_root.exists():
        return []

    manifest_files = glob.glob(str(simulacoes_root / "*" / "manifesto.json"))
    simulations = []

    for m_file in manifest_files:
        try:
            with open(m_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                f_code = data.get("farm_code") or sanitize_farm_code(data.get("farm_slug") or data.get("farm_name", "FAZ"))
                data["farm_code"] = f_code
                if not data.get("simulation_code"):
                    run_num = data.get("run_number") or 1
                    data["simulation_code"] = f"{f_code}-SIM{run_num:03d}"
                if not data.get("run_number"):
                    match = re.search(r"SIM[-_]?(\d+)", data.get("simulation_code", "")) or re.search(r"SIM[-_]?(\d+)", data.get("folder_name", ""))
                    data["run_number"] = int(match.group(1)) if match else 1
                simulations.append(data)
        except Exception:
            continue

    # Ordena decrescente por data/hora de execução
    simulations.sort(
        key=lambda x: f"{x.get('execution_date', '')} {x.get('execution_time', '')}",
        reverse=True
    )
    return simulations


def get_archived_simulation_details(base_dir: Path, folder_name: str) -> Optional[Dict[str, Any]]:
    """Carrega os dados e resultados detalhados de uma simulação arquivada específica."""
    sim_dir = base_dir / "output" / "simulacoes" / folder_name
    manifest_path = sim_dir / "manifesto.json"
    if not manifest_path.exists():
        return None

    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)

        # Carrega analise_po.json se disponível
        po_path = sim_dir / "resultados" / "analise_po.json"
        po_data = {}
        if po_path.exists():
            with open(po_path, "r", encoding="utf-8") as f:
                po_data = json.load(f)

        # Carrega parâmetros resumidos
        param_path = sim_dir / "parametros" / "parametros_resumo.json"
        param_data = {}
        if param_path.exists():
            with open(param_path, "r", encoding="utf-8") as f:
                param_data = json.load(f)

        return {
            "manifest": manifest,
            "po_analytics": po_data,
            "parameters": param_data
        }
    except Exception as e:
        print(f"[SimulationTracker] Erro ao carregar detalhes de {folder_name}: {e}")
        return None


def open_simulation_folder(base_dir: Path, folder_name: str) -> Dict[str, Any]:
    """Abre o diretório da simulação no explorador de arquivos local do sistema operacional."""
    sim_dir = base_dir / "output" / "simulacoes" / folder_name
    if not sim_dir.exists():
        return {"success": False, "error": f"Pasta não encontrada: {sim_dir}"}

    try:
        path_str = str(sim_dir.resolve())
        if sys.platform.startswith("linux"):
            subprocess.Popen(["xdg-open", path_str], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif sys.platform == "win32":
            os.startfile(path_str)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path_str], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return {"success": True, "path": path_str}
    except Exception as e:
        return {"success": False, "error": str(e)}
