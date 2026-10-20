import os
import sys
import glob
import json
import re
import csv
import threading
import subprocess
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from flask import Flask, jsonify, request, send_from_directory, Response
try:
    from web_app.po_analytics import (
        get_all_feed_names,
        get_available_feeds_catalog,
        get_active_feed_rel_path,
        get_campo_dourado_scenario_info,
        apply_campo_dourado_scenario,
        update_feeds_file,
        load_preset_feeds_for_standard,
        analyze_po_results,
        run_sensitivity_analysis,
        generate_po_csv_report,
        compare_solvers
    )
    from web_app.simulation_tracker import (
        archive_simulation,
        list_archived_simulations,
        get_archived_simulation_details,
        open_simulation_folder
    )
except ModuleNotFoundError:
    from po_analytics import (
        get_all_feed_names,
        get_available_feeds_catalog,
        get_active_feed_rel_path,
        get_campo_dourado_scenario_info,
        apply_campo_dourado_scenario,
        update_feeds_file,
        load_preset_feeds_for_standard,
        analyze_po_results,
        run_sensitivity_analysis,
        generate_po_csv_report,
        compare_solvers
    )
    from simulation_tracker import (
        archive_simulation,
        list_archived_simulations,
        get_archived_simulation_details,
        open_simulation_folder
    )

app = Flask(__name__, static_folder="static", static_url_path="")

# Resolve Python executable across platforms (Linux / Windows / local venv)
candidate_pythons = [
    BASE_DIR / "venv" / "bin" / "python",
    BASE_DIR / "venv" / "Scripts" / "python.exe",
    Path(r"C:\Users\ivani\OneDrive\IFG_Goias\PesquisaOperacional\Projeto_Final\venv\Scripts\python.exe"),
    Path(sys.executable),
]
VENV_PYTHON = next((p for p in candidate_pythons if p.exists()), Path(sys.executable))

# Global execution state
sim_state = {
    "running": False,
    "progress": 0,
    "current_day": 0,
    "total_days": 31,
    "status_text": "Pronto",
    "logs": [],
    "exit_code": None,
    "error": None,
    "last_archived": None
}

sim_lock = threading.Lock()

def get_feed_names():
    return get_all_feed_names(BASE_DIR)

@app.after_request
def add_header(response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/api/config", methods=["GET"])
def get_config():
    try:
        # Task Manager Metadata
        tm_path = BASE_DIR / "input" / "task_manager_metadata.json"
        current_task_path = "input/data/tasks/example_animals_only_task.json"
        if tm_path.exists():
            with open(tm_path, "r", encoding="utf-8") as f:
                tm_data = json.load(f)
                current_task_path = tm_data.get("files", {}).get("tasks", {}).get("path", current_task_path)

        # Available tasks
        tasks_dir = BASE_DIR / "input" / "data" / "tasks"
        available_tasks = []
        if tasks_dir.exists():
            for t_file in tasks_dir.glob("*.json"):
                available_tasks.append({
                    "filename": t_file.name,
                    "rel_path": f"input/data/tasks/{t_file.name}"
                })

        # Config parameters based on current task
        # Check if animals_only or freestall
        if "animals_only" in current_task_path:
            config_path = BASE_DIR / "input" / "data" / "config" / "example_animals_only_config.json"
        else:
            config_path = BASE_DIR / "input" / "data" / "config" / "example_freestall_config.json"

        start_year, start_day = 2013, 1
        end_year, end_day = 2013, 31
        sim_type = "animals_only"
        opt_mode = "nonlinear"

        if config_path.exists():
            with open(config_path, "r", encoding="utf-8") as f:
                c_data = json.load(f)
                s_parts = c_data.get("start_date", "2013:1").split(":")
                e_parts = c_data.get("end_date", "2013:31").split(":")
                start_year, start_day = int(s_parts[0]), int(s_parts[1])
                end_year, end_day = int(e_parts[0]), int(e_parts[1])
                sim_type = c_data.get("simulation_type", "animals_only")
                opt_mode = c_data.get("optimization_mode", "nonlinear")

        scenario_info = get_campo_dourado_scenario_info(BASE_DIR)
        nutrient_standard = scenario_info.get("nutrient_standard", "NASEM")

        # Feeds and costs enriched with catalog metadata
        feed_names = get_all_feed_names(BASE_DIR)
        catalog_map = {item["id"]: item for item in get_available_feeds_catalog(BASE_DIR, nutrient_standard=nutrient_standard)}
        active_feed_rel = get_active_feed_rel_path(BASE_DIR)
        feed_config_path = BASE_DIR / active_feed_rel
        feeds_list = []
        calf_feed_ids = {202, 216}  # Alimentos exclusivos de bezerros em aleitamento líquido
        if feed_config_path.exists():
            with open(feed_config_path, "r", encoding="utf-8") as f:
                f_data = json.load(f)
                for item in f_data.get("feeds", []):
                    f_id = item.get("feed_type")
                    if f_id in calf_feed_ids:
                        continue  # Mantidos em segundo plano para o modelo de bezerros
                    cat_info = catalog_map.get(f_id, {})
                    feeds_list.append({
                        "id": f_id,
                        "name": feed_names.get(f_id, f"Alimento ID {f_id}"),
                        "cost": item.get("purchased_feed_cost", 0.0),
                        "buffer": item.get("buffer", 0.15),
                        "category": cat_info.get("category", "Geral"),
                        "type": cat_info.get("type", "Insumo"),
                        "cp": cat_info.get("cp", 0.0),
                        "ndf": cat_info.get("ndf", 0.0),
                        "tdn": cat_info.get("tdn", 0.0)
                    })

        scenario_info = get_campo_dourado_scenario_info(BASE_DIR)

        return jsonify({
            "current_task": current_task_path,
            "available_tasks": available_tasks,
            "simulation_type": sim_type,
            "optimization_mode": opt_mode,
            "start_year": start_year,
            "start_day": start_day,
            "end_year": end_year,
            "end_day": end_day,
            "total_days": (end_day - start_day + 1) if start_year == end_year else (365 * (end_year - start_year + 1)),
            "active_feed_file": active_feed_rel,
            "scenario": scenario_info,
            "feeds": feeds_list
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/scenario", methods=["GET"])
def get_scenario_route():
    try:
        info = get_campo_dourado_scenario_info(BASE_DIR)
        return jsonify(info)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/scenario/apply", methods=["POST"])
def apply_scenario_route():
    try:
        data = request.json or {}
        result = apply_campo_dourado_scenario(BASE_DIR, data)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/feeds/catalog", methods=["GET"])
def get_feeds_catalog_route():
    try:
        std = request.args.get("standard")
        if not std:
            scenario = get_campo_dourado_scenario_info(BASE_DIR)
            std = scenario.get("nutrient_standard", "NASEM")
        catalog = get_available_feeds_catalog(BASE_DIR, nutrient_standard=std)
        return jsonify(catalog)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/feeds", methods=["POST"])
def save_feeds_route():
    try:
        data = request.json or {}
        feeds = data.get("feeds", [])
        active_feed_rel = get_active_feed_rel_path(BASE_DIR)
        result = update_feeds_file(BASE_DIR, feeds, feed_rel_path=active_feed_rel)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/feeds/preset", methods=["POST"])
def load_feeds_preset_route():
    try:
        data = request.json or {}
        std = data.get("standard")
        if not std:
            scenario = get_campo_dourado_scenario_info(BASE_DIR)
            std = scenario.get("nutrient_standard", "NASEM")
        result = load_preset_feeds_for_standard(BASE_DIR, nutrient_standard=std)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/config", methods=["POST"])
def save_config():
    try:
        data = request.json or {}
        task_path = data.get("current_task")
        start_year = int(data.get("start_year", 2013))
        start_day = int(data.get("start_day", 1))
        end_year = int(data.get("end_year", 2013))
        end_day = int(data.get("end_day", 31))
        opt_mode = data.get("optimization_mode", "nonlinear").lower()
        if opt_mode not in ["linear", "nonlinear"]:
            opt_mode = "nonlinear"
        feeds = data.get("feeds", [])

        # 1. Update task_manager_metadata.json
        tm_path = BASE_DIR / "input" / "task_manager_metadata.json"
        if tm_path.exists() and task_path:
            with open(tm_path, "r+", encoding="utf-8") as f:
                tm_data = json.load(f)
                tm_data.setdefault("files", {}).setdefault("tasks", {})["path"] = task_path
                f.seek(0)
                json.dump(tm_data, f, indent=2)
                f.truncate()

        # 2. Update config file (both animals_only and freestall for safety)
        configs_to_update = [
            BASE_DIR / "input" / "data" / "config" / "example_animals_only_config.json",
            BASE_DIR / "input" / "data" / "config" / "example_freestall_config.json"
        ]
        for cfg_file in configs_to_update:
            if cfg_file.exists():
                with open(cfg_file, "r+", encoding="utf-8") as f:
                    c_data = json.load(f)
                    c_data["start_date"] = f"{start_year}:{start_day}"
                    c_data["end_date"] = f"{end_year}:{end_day}"
                    c_data["optimization_mode"] = opt_mode
                    f.seek(0)
                    json.dump(c_data, f, indent=4)
                    f.truncate()

        # 3. Update feeds (inclusion/removal and costs/buffer)
        if feeds:
            update_feeds_file(BASE_DIR, feeds)

        return jsonify({"success": True, "message": "Configurações e insumos salvos com sucesso!"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def run_simulation_worker():
    global sim_state
    sim_start_time = datetime.now()
    try:
        # Pass current optimization mode explicitly in child process environment
        env_vars = os.environ.copy()
        env_vars["RUFAS_SUBPROCESS_TRACKED"] = "1"
        try:
            cfg_path = BASE_DIR / "input" / "data" / "config" / "example_animals_only_config.json"
            if cfg_path.exists():
                with open(cfg_path, "r", encoding="utf-8") as f:
                    c_data = json.load(f)
                    opt_m = c_data.get("optimization_mode", "nonlinear")
                    env_vars["RUFAS_OPTIMIZATION_MODE"] = str(opt_m).lower()
        except Exception:
            pass

        cmd = [str(VENV_PYTHON), "-u", "main.py"]
        process = subprocess.Popen(
            cmd,
            cwd=str(BASE_DIR),
            env=env_vars,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )

        with sim_lock:
            sim_state["status_text"] = "Simulando..."

        day_pattern = re.compile(r"Day:\s*(\d+)\s*/\s*(\d+)")

        for line in iter(process.stdout.readline, ""):
            line_str = line.strip()
            if not line_str:
                continue
            with sim_lock:
                sim_state["logs"].append(line_str)
                if len(sim_state["logs"]) > 200:
                    sim_state["logs"].pop(0)

                match = day_pattern.search(line_str)
                if match:
                    cur = int(match.group(1))
                    tot = int(match.group(2))
                    sim_state["current_day"] = cur
                    sim_state["total_days"] = tot
                    sim_state["progress"] = int((cur / tot) * 100)
                    sim_state["status_text"] = f"Simulando dia {cur} de {tot} ({sim_state['progress']}%)"

        process.wait()

        # Arquiva a simulação na pasta específica da fazenda, data e horário
        archived_manifest = None
        try:
            archived_manifest = archive_simulation(
                base_dir=BASE_DIR,
                execution_logs=list(sim_state["logs"]),
                start_time=sim_start_time,
                end_time=datetime.now(),
                exit_code=process.returncode
            )
        except Exception as arch_err:
            print(f"[SimulationTracker] Erro ao arquivar simulação: {arch_err}")

        with sim_lock:
            sim_state["exit_code"] = process.returncode
            sim_state["running"] = False
            sim_state["last_archived"] = archived_manifest
            if process.returncode == 0:
                sim_state["progress"] = 100
                f_name = archived_manifest.get("folder_name") if archived_manifest else "output/simulacoes"
                sim_state["status_text"] = f"Simulação concluída e salva em: {f_name}"
            else:
                sim_state["status_text"] = f"Erro na simulação (Código {process.returncode})"
    except Exception as e:
        with sim_lock:
            sim_state["running"] = False
            sim_state["error"] = str(e)
            sim_state["status_text"] = f"Erro: {e}"

@app.route("/api/run", methods=["POST"])
def run_simulation():
    global sim_state
    with sim_lock:
        if sim_state["running"]:
            return jsonify({"error": "Já existe uma simulação em andamento."}), 400

        sim_state["running"] = True
        sim_state["progress"] = 0
        sim_state["current_day"] = 0
        sim_state["logs"] = []
        sim_state["exit_code"] = None
        sim_state["error"] = None
        sim_state["status_text"] = "Iniciando motor de simulação..."

    t = threading.Thread(target=run_simulation_worker, daemon=True)
    t.start()
    return jsonify({"success": True, "message": "Simulação iniciada em segundo plano."})

@app.route("/api/status", methods=["GET"])
def get_status():
    with sim_lock:
        return jsonify(dict(sim_state))

@app.route("/api/results", methods=["GET"])
def get_results():
    try:
        csv_files = glob.glob(str(BASE_DIR / "output" / "CSVs" / "*.csv"))
        if not csv_files:
            return jsonify({"has_results": False, "message": "Nenhum arquivo de resultado encontrado em output/CSVs."})

        # Most recent CSV
        latest_csv = max(csv_files, key=os.path.getmtime)
        feed_names = get_feed_names()

        # Let's read relevant columns using pandas
        import pandas as pd
        df = pd.read_csv(latest_csv)

        # 1. Optimal diet for LAC_COW_PEN_3
        diet_cols = [c for c in df.columns if "report_ration_per_animal.ration_per_animal_for_LAC_COW" in c]
        cow_diet = []
        total_dmi = 0.0

        for c in diet_cols:
            parts = c.split(".")
            feed_id_str = parts[-1].replace(" (kg)", "")
            try:
                feed_id = int(feed_id_str)
                amount = float(df[c].dropna().mean())
                if amount > 0.001:
                    cow_diet.append({
                        "feed_id": feed_id,
                        "name": feed_names.get(feed_id, f"Alimento #{feed_id}"),
                        "amount_kg": round(amount, 3)
                    })
                    total_dmi += amount
            except ValueError:
                continue

        # Sort descending by amount
        cow_diet.sort(key=lambda x: x["amount_kg"], reverse=True)
        for item in cow_diet:
            item["percentage"] = round((item["amount_kg"] / total_dmi * 100), 1) if total_dmi > 0 else 0

        # 2. Milk production series
        milk_col = next((c for c in df.columns if "report_herd_statistics_data.daily_milk_production" in c), None)
        milk_series = []
        if milk_col:
            m_vals = df[milk_col].dropna().tolist()
            milk_series = [{"day": i + 1, "milk_kg": round(val, 2)} for i, val in enumerate(m_vals)]

        # 3. DMI across pens
        pens_dmi = {}
        pens_map = {
            "CALF": "Bezerros (Calf)",
            "GROWING": "Novilhas (Growing)",
            "CLOSE_UP": "Pré-Parto (Close-Up)",
            "LAC_COW": "Vacas em Lactação"
        }
        for p_key, p_label in pens_map.items():
            col = next((c for c in df.columns if f"report_ration_per_animal.ration_per_animal_for_{p_key}" in c and "dry_matter_intake_total" in c), None)
            if col:
                vals = df[col].dropna().tolist()
                pens_dmi[p_label] = [{"day": i + 1, "dmi": round(v, 2)} for i, v in enumerate(vals)]

        # 4. Failed/Binding constraints in RationOptimizer
        fail_cols = [c for c in df.columns if "constraints_failed_dict" in c]
        binding_constraints = {}
        for c in fail_cols:
            s = df[c].dropna()
            for v in s:
                v_str = str(v)
                binding_constraints[v_str] = binding_constraints.get(v_str, 0) + 1

        # Verifica se a formulação falhou e houve fallback para ração de contingência
        from web_app.po_analytics import check_formulation_fallback
        fallback_info = check_formulation_fallback(df, base_dir=BASE_DIR, specific_csv=Path(latest_csv))

        if fallback_info["is_fallback"]:
            return jsonify({
                "has_results": True,
                "filename": Path(latest_csv).name,
                "formulation_failed": True,
                "fallback_used": True,
                "fallback_message": fallback_info["message"],
                "failed_constraints": fallback_info["failed_constraints"],
                "failed_constraints_labels": fallback_info["failed_constraints_labels"],
                "recommendation": fallback_info["recommendation"],
                "kpis": None,
                "diet": None,
                "milk_series": milk_series,
                "pens_dmi": pens_dmi,
                "binding_constraints": binding_constraints
            })

        # KPIs normais para formulação bem-sucedida
        avg_milk = round(df[milk_col].dropna().mean(), 2) if milk_col else 0.0
        avg_dmi = round(total_dmi, 2)
        total_days = len(milk_series)

        return jsonify({
            "has_results": True,
            "filename": Path(latest_csv).name,
            "formulation_failed": False,
            "fallback_used": False,
            "kpis": {
                "avg_milk_daily": avg_milk,
                "avg_cow_dmi": avg_dmi,
                "total_days_simulated": total_days,
                "active_ingredients_count": len(cow_diet)
            },
            "diet": cow_diet,
            "milk_series": milk_series,
            "pens_dmi": pens_dmi,
            "binding_constraints": binding_constraints
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/po/analytics", methods=["GET"])
def get_po_analytics():
    try:
        milk_price = float(request.args.get("milk_price", 0.45))
        data = analyze_po_results(BASE_DIR, milk_price=milk_price)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/po/sensitivity", methods=["GET"])
def get_po_sensitivity():
    try:
        feed_id = int(request.args.get("feed_id", 50))
        milk_price = float(request.args.get("milk_price", 0.45))
        data = run_sensitivity_analysis(feed_id, BASE_DIR, milk_price=milk_price)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/po/export_csv", methods=["GET"])
def export_po_csv():
    try:
        milk_price = float(request.args.get("milk_price", 0.45))
        csv_text = generate_po_csv_report(BASE_DIR, milk_price=milk_price)
        return Response(
            csv_text,
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=relatorio_pesquisa_operacional_rufas.csv"}
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/po/compare_solvers", methods=["GET"])
def get_po_compare_solvers():
    try:
        milk_price = float(request.args.get("milk_price", 0.45))
        data = compare_solvers(BASE_DIR, milk_price=milk_price)
        return jsonify(data)
    except Exception as e:
        return jsonify({
            "success": False,
            "failed_solver": "Erro Geral de Execução",
            "error_title": "Erro no Processamento dos Solvers",
            "failure_reason": f"Erro inesperado no servidor: {str(e)}. Nenhum valor foi calculado.",
            "linear": None,
            "nonlinear": None,
            "comparison": None
        }), 500

@app.route("/api/simulations/history", methods=["GET"])
def get_simulations_history():
    try:
        sims = list_archived_simulations(BASE_DIR)
        return jsonify(sims)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/simulations/details/<folder_name>", methods=["GET"])
def get_simulation_details_route(folder_name):
    try:
        data = get_archived_simulation_details(BASE_DIR, folder_name)
        if not data:
            return jsonify({"error": "Simulação não encontrada"}), 404
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/simulations/open_folder/<folder_name>", methods=["POST"])
def open_simulation_folder_route(folder_name):
    try:
        res = open_simulation_folder(BASE_DIR, folder_name)
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/po/tableaus", methods=["GET"])
def api_po_tableaus():
    folder_name = request.args.get("folder")
    try:
        from web_app.po_analytics import get_simplex_tableaus_data
        data = get_simplex_tableaus_data(BASE_DIR, folder_name=folder_name)
        if not data:
            return jsonify({
                "available": False,
                "message": (
                    "Nenhum registro de tableaus disponível. Os tableaus são gerados passo a passo "
                    "quando a simulação é executada com o solver 'Linear Nativo (Simplex Duas Fases)'."
                ),
                "tableaus": []
            })
        data["available"] = True
        return jsonify(data)
    except Exception as e:
        return jsonify({"available": False, "error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)

