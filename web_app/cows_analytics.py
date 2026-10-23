"""
Módulo de Análise e Ficha das Vacas (Cows Scorecard Analytics)
RuFaS - Ruminant Farm Systems
Instituto Federal de Goiás (IFG) - Pesquisa Operacional

Processa dados zootécnicos e bioeconômicos individuais de cada vaca simulada:
- Seleção dinâmica da simulação executada
- Benchmarks e Médias Gerais do Rebanho (Leite, DMI, Custo, IOFC, Eficiência)
- Ranking das Top N Melhores e Top N Piores vacas por IOFC
- Comparativo percentual individual vs. Média do Rebanho
- Séries temporais da curva individual de lactação de cada vaca
"""

import os
import glob
import json
import re
from pathlib import Path
from typing import Dict, Any, List, Optional
import pandas as pd
import numpy as np


def get_cows_simulations_and_farms(base_dir: Path) -> Dict[str, Any]:
    """
    Escaneia todas as pastas em output/simulacoes/ e extrai tanto as fazendas
    quanto todas as simulações disponíveis, de forma resiliente mesmo se manifesto.json
    estiver em geração ou ausente.
    """
    simulacoes_root = base_dir / "output" / "simulacoes"
    simulations = []
    farms_map: Dict[str, Dict[str, Any]] = {}

    if simulacoes_root.exists():
        for p in sorted(simulacoes_root.iterdir(), reverse=True):
            if not p.is_dir():
                continue

            folder = p.name
            manifest = p / "manifesto.json"
            res_dir = p / "resultados"

            # Verifica CSVs existentes
            csvs = list(res_dir.glob("*.csv")) if res_dir.exists() else []
            has_csv = (res_dir / "simulacao_dados_completos.csv").exists() or bool(list(res_dir.glob("freestall_saved_variables_csv_all_variables*.csv"))) or len(csvs) > 0

            farm_name = ""
            farm_code = ""
            code = ""
            date_str = ""
            time_str = ""

            if manifest.exists():
                try:
                    with open(manifest, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        farm_name = data.get("farm_name", "")
                        farm_code = data.get("farm_code", "")
                        code = data.get("simulation_code", "")
                        date_str = data.get("execution_date", "")
                        time_str = data.get("execution_time", "")
                except Exception:
                    pass

            # Extração de fallback a partir do nome da pasta caso manifesto esteja ausente
            # Ex: GO_OURO_PRETO_SIM023_2026-10-23_09-44-08
            match = re.match(r"^(.*?)[-_]SIM[-_]?(\d+)[-_](\d{4}-\d{2}-\d{2})[-_](\d{2}-\d{2}-\d{2})", folder, re.IGNORECASE)
            if match:
                f_prefix, run_num, d_part, t_part = match.groups()
                if not farm_code:
                    farm_code = f_prefix
                if not code:
                    code = f"{f_prefix}-SIM{int(run_num):03d}"
                if not date_str:
                    date_str = d_part
                if not time_str:
                    time_str = t_part.replace("-", ":")
            else:
                if not farm_code:
                    farm_code = folder.split("_SIM")[0] if "_SIM" in folder else "FAZ"
                if not code:
                    code = folder

            if not farm_name:
                clean_name = farm_code.replace("_", " ").replace("-", " ").title()
                if not clean_name.lower().startswith("fazenda"):
                    clean_name = f"Fazenda {clean_name}"
                farm_name = clean_name
            else:
                farm_name = farm_name.replace("_", " ")

            sim_entry = {
                "folder_name": folder,
                "simulation_code": code,
                "farm_code": farm_code,
                "farm_name": farm_name,
                "execution_date": date_str,
                "execution_time": time_str,
                "label": f"{code} ({date_str} {time_str})",
                "full_label": f"{code} — {farm_name} ({date_str} {time_str})",
                "has_csv": has_csv
            }
            simulations.append(sim_entry)

            # Agrupa contagem por fazenda
            if farm_code not in farms_map:
                farms_map[farm_code] = {
                    "farm_code": farm_code,
                    "farm_name": farm_name,
                    "count": 0
                }
            farms_map[farm_code]["count"] += 1

    # Ordena as simulações da mais recente para a mais antiga
    simulations.sort(
        key=lambda x: f"{x.get('execution_date', '')} {x.get('execution_time', '')} {x.get('folder_name', '')}",
        reverse=True
    )

    farms_list = list(farms_map.values())
    farms_list.sort(key=lambda x: (-x["count"], x["farm_name"]))

    return {
        "farms": farms_list,
        "simulations": simulations
    }


def list_available_simulations(base_dir: Path) -> List[Dict[str, Any]]:
    """Retorna lista plana de todas as simulações disponíveis para retrocompatibilidade."""
    return get_cows_simulations_and_farms(base_dir)["simulations"]



def get_cows_scorecard(
    base_dir: Path,
    folder_name: Optional[str] = None,
    milk_price: float = 0.45,
    limit: int = 10
) -> Dict[str, Any]:
    """
    Calcula a Ficha das Vacas para a simulação indicada:
    - Médias gerais do rebanho no topo
    - Top N melhores vacas em função do IOFC
    - Top N piores vacas em função do IOFC
    - Sistema de cache por simulação e preço do leite
    """
    sim_dir = None
    simulacoes_root = base_dir / "output" / "simulacoes"

    if folder_name and folder_name != "latest":
        candidate = simulacoes_root / folder_name
        if candidate.exists():
            sim_dir = candidate

    if not sim_dir:
        # Pega a mais recente
        all_sims = list_available_simulations(base_dir)
        if all_sims:
            sim_dir = simulacoes_root / all_sims[0]["folder_name"]

    if not sim_dir or not sim_dir.exists():
        return {
            "has_results": False,
            "error": "Nenhuma simulação encontrada em output/simulacoes/."
        }

    resultados_dir = sim_dir / "resultados"
    cache_path = resultados_dir / f"ficha_vacas_cache_p{milk_price:.2f}.json"

    # Se o cache já existir e for válido, carrega instantaneamente
    if cache_path.exists():
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                cached_data = json.load(f)
                # Atualiza as fatias de limit solicitadas pelo usuário
                all_cows = cached_data.get("_all_cows", [])
                if all_cows:
                    top_slice = all_cows[:limit] if limit > 0 else all_cows
                    bot_slice = all_cows[::-1][:limit] if limit > 0 else all_cows[::-1]
                    cached_data["top_cows"] = top_slice
                    cached_data["bottom_cows"] = bot_slice
                    cached_data["limit"] = limit
                    return cached_data
        except Exception:
            pass

    # Localiza o arquivo CSV com dados completos
    csv_candidates = [
        resultados_dir / "simulacao_dados_completos.csv"
    ] + list(resultados_dir.glob("freestall_saved_variables_csv_all_variables*.csv"))

    target_csv = next((c for c in csv_candidates if c.exists()), None)
    if not target_csv:
        return {
            "has_results": False,
            "error": f"Arquivo CSV de resultados não encontrado em {sim_dir.name}/resultados."
        }

    # Carrega os parâmetros de lote a partir de analise_po.json
    pen_dmi = 25.5
    pen_feed_cost = 3.65
    analise_po_file = resultados_dir / "analise_po.json"
    if analise_po_file.exists():
        try:
            with open(analise_po_file, "r", encoding="utf-8") as f:
                po_data = json.load(f)
                kpis = po_data.get("kpis") or {}
                pen_dmi = float(kpis.get("total_dmi_kg") or pen_dmi)
                pen_feed_cost = float(kpis.get("cost_per_cow_day") or pen_feed_cost)
        except Exception:
            pass

    cost_per_kg_dmi = (pen_feed_cost / pen_dmi) if pen_dmi > 0 else 0.143

    cols = [
        "AnimalModuleReporter.report_milk.milk_data_at_milk_update.cow_id (unitless)",
        "AnimalModuleReporter.report_milk.milk_data_at_milk_update.pen_id (unitless)",
        "AnimalModuleReporter.report_milk.milk_data_at_milk_update.is_milking (unitless)",
        "AnimalModuleReporter.report_milk.milk_data_at_milk_update.days_in_milk (day)",
        "AnimalModuleReporter.report_milk.milk_data_at_milk_update.estimated_daily_milk_produced (kg/day)",
        "AnimalModuleReporter.report_milk.milk_data_at_milk_update.milk_protein (kg/day)",
        "AnimalModuleReporter.report_milk.milk_data_at_milk_update.milk_fat (kg/day)",
        "AnimalModuleReporter.report_milk.milk_data_at_milk_update.milk_lactose (kg/day)",
        "AnimalModuleReporter.report_milk.milk_data_at_milk_update.parity (unitless)",
        "AnimalModuleReporter.report_milk.milk_data_at_milk_update.simulation_day (simulation day)"
    ]

    try:
        header_cols = pd.read_csv(target_csv, nrows=1).columns.tolist()
        available_cols = [c for c in cols if c in header_cols]
        if not available_cols:
            return {
                "has_results": False,
                "error": "Colunas de produção de leite individual não foram encontradas no CSV."
            }

        df = pd.read_csv(target_csv, usecols=available_cols, low_memory=False)

        # Filtra vacas em lactação
        is_milking_col = next((c for c in available_cols if "is_milking" in c), None)
        if is_milking_col:
            df = df[df[is_milking_col] == True].copy()

        cow_id_col = next(c for c in available_cols if "cow_id" in c)
        milk_col = next(c for c in available_cols if "estimated_daily_milk_produced" in c)
        fat_col = next((c for c in available_cols if "milk_fat" in c), None)
        prot_col = next((c for c in available_cols if "milk_protein" in c), None)
        dim_col = next((c for c in available_cols if "days_in_milk" in c), None)
        parity_col = next((c for c in available_cols if "parity" in c), None)
        day_col = next((c for c in available_cols if "simulation_day" in c), None)

        agg_dict = {
            "days_milking": (day_col or cow_id_col, "count"),
            "avg_milk": (milk_col, "mean"),
            "total_milk": (milk_col, "sum"),
        }
        if fat_col:
            agg_dict["avg_fat"] = (fat_col, "mean")
        if prot_col:
            agg_dict["avg_protein"] = (prot_col, "mean")
        if dim_col:
            agg_dict["max_dim"] = (dim_col, "max")
            agg_dict["avg_dim"] = (dim_col, "mean")
        if parity_col:
            agg_dict["parity"] = (parity_col, "last")

        cows_df = df.groupby(cow_id_col).agg(**agg_dict).reset_index()
        cows_df.rename(columns={cow_id_col: "cow_id"}, inplace=True)

        # Considera vacas ativas com no mínimo 5 dias ordenhadas
        cows_df = cows_df[cows_df["days_milking"] >= 5].copy()

        if cows_df.empty:
            return {
                "has_results": False,
                "error": "Nenhuma vaca em lactação com dados suficientes nesta simulação."
            }

        mean_milk = float(cows_df["avg_milk"].mean()) if len(cows_df) > 0 else 38.0

        # Partição energética de consumo e custos (Diluição de Mantença NASEM 2021)
        cows_df["dmi_kg"] = cows_df["avg_milk"].apply(lambda m: pen_dmi * (0.35 + 0.65 * (m / mean_milk)))
        cows_df["feed_cost"] = cows_df["dmi_kg"] * cost_per_kg_dmi
        cows_df["milk_revenue"] = cows_df["avg_milk"] * milk_price
        cows_df["iofc"] = cows_df["milk_revenue"] - cows_df["feed_cost"]
        cows_df["feed_efficiency"] = cows_df["avg_milk"] / cows_df["dmi_kg"]
        cows_df["methane_g"] = cows_df["dmi_kg"] * 21.6
        cows_df["methane_per_kg_milk"] = cows_df["methane_g"] / cows_df["avg_milk"]

        if "avg_fat" in cows_df.columns:
            cows_df["fat_pct"] = (cows_df["avg_fat"] / cows_df["avg_milk"] * 100).round(2)
        else:
            cows_df["fat_pct"] = 3.90

        if "avg_protein" in cows_df.columns:
            cows_df["protein_pct"] = (cows_df["avg_protein"] / cows_df["avg_milk"] * 100).round(2)
        else:
            cows_df["protein_pct"] = 3.15

        # FCM 4% e ECM
        cows_df["fcm_4"] = (0.4 * cows_df["avg_milk"] + 15.0 * cows_df.get("avg_fat", cows_df["avg_milk"] * 0.039)).round(2)

        # Médias gerais do rebanho para o topo da ficha
        herd_averages = {
            "total_cows": int(len(cows_df)),
            "avg_milk": round(float(cows_df["avg_milk"].mean()), 2),
            "avg_dmi": round(float(cows_df["dmi_kg"].mean()), 2),
            "avg_feed_cost": round(float(cows_df["feed_cost"].mean()), 3),
            "avg_revenue": round(float(cows_df["milk_revenue"].mean()), 3),
            "avg_iofc": round(float(cows_df["iofc"].mean()), 3),
            "avg_feed_efficiency": round(float(cows_df["feed_efficiency"].mean()), 2),
            "avg_fat_pct": round(float(cows_df["fat_pct"].mean()), 2),
            "avg_protein_pct": round(float(cows_df["protein_pct"].mean()), 2),
            "avg_methane_g": round(float(cows_df["methane_g"].mean()), 1),
            "avg_methane_per_kg_milk": round(float(cows_df["methane_per_kg_milk"].mean()), 2),
            "milk_price": milk_price,
            "pen_feed_cost_assumed": round(pen_feed_cost, 3),
            "pen_dmi_assumed": round(pen_dmi, 2),
            "cost_per_kg_dmi": round(cost_per_kg_dmi, 4)
        }

        avg_iofc = herd_averages["avg_iofc"]
        avg_milk = herd_averages["avg_milk"]

        # Calcula as diferenças relativas à média do rebanho
        cows_df["iofc_diff"] = (cows_df["iofc"] - avg_iofc).round(3)
        cows_df["iofc_diff_pct"] = (((cows_df["iofc"] - avg_iofc) / avg_iofc) * 100).round(1)
        cows_df["milk_diff_pct"] = (((cows_df["avg_milk"] - avg_milk) / avg_milk) * 100).round(1)

        # Arredonda métricas
        cows_df["avg_milk"] = cows_df["avg_milk"].round(2)
        cows_df["dmi_kg"] = cows_df["dmi_kg"].round(2)
        cows_df["feed_cost"] = cows_df["feed_cost"].round(3)
        cows_df["milk_revenue"] = cows_df["milk_revenue"].round(3)
        cows_df["iofc"] = cows_df["iofc"].round(3)
        cows_df["feed_efficiency"] = cows_df["feed_efficiency"].round(2)
        cows_df["methane_g"] = cows_df["methane_g"].round(1)
        cows_df["methane_per_kg_milk"] = cows_df["methane_per_kg_milk"].round(2)
        if "max_dim" in cows_df.columns:
            cows_df["max_dim"] = cows_df["max_dim"].astype(int)
        if "parity" in cows_df.columns:
            cows_df["parity"] = cows_df["parity"].astype(int)

        # Ordenação decrescente por IOFC (Melhores no topo)
        cows_sorted = cows_df.sort_values(by="iofc", ascending=False)
        all_cows_list = cows_sorted.to_dict(orient="records")

        # Adiciona ranking numérico
        for idx, cow in enumerate(all_cows_list, start=1):
            cow["rank_iofc"] = idx
            cow["status_tier"] = "top" if cow["iofc_diff_pct"] >= 10 else ("bottom" if cow["iofc_diff_pct"] <= -10 else "normal")

        # Inverte para o ranking reverso das piores
        all_cows_reversed = all_cows_list[::-1]
        for idx, cow in enumerate(all_cows_reversed, start=1):
            cow["rank_bottom"] = idx

        # Lê manifesto da simulação para metadados
        manifest_path = sim_dir / "manifesto.json"
        sim_metadata = {}
        if manifest_path.exists():
            try:
                with open(manifest_path, "r", encoding="utf-8") as f:
                    sim_metadata = json.load(f)
            except Exception:
                pass

        sim_code = sim_metadata.get("simulation_code")
        farm_name = sim_metadata.get("farm_name")
        exec_date = sim_metadata.get("execution_date") or ""
        exec_time = sim_metadata.get("execution_time") or ""

        if not sim_code or not farm_name:
            match = re.match(r"^(.*?)[-_]SIM[-_]?(\d+)[-_](\d{4}-\d{2}-\d{2})[-_](\d{2}-\d{2}-\d{2})", sim_dir.name, re.IGNORECASE)
            if match:
                f_prefix, run_num, d_part, t_part = match.groups()
                if not sim_code:
                    sim_code = f"{f_prefix}-SIM{int(run_num):03d}"
                if not farm_name:
                    clean_name = f_prefix.replace("_", " ").replace("-", " ").title()
                    farm_name = clean_name if clean_name.lower().startswith("fazenda") else f"Fazenda {clean_name}"
                if not exec_date:
                    exec_date = d_part
                if not exec_time:
                    exec_time = t_part.replace("-", ":")
            else:
                if not sim_code:
                    sim_code = sim_dir.name
                if not farm_name:
                    farm_name = "Fazenda"

        result_payload = {
            "has_results": True,
            "folder_name": sim_dir.name,
            "simulation_code": sim_code,
            "farm_name": farm_name,
            "execution_date": exec_date,
            "execution_time": exec_time,
            "total_cows_evaluated": len(all_cows_list),
            "herd_averages": herd_averages,
            "limit": limit,
            "top_cows": all_cows_list[:limit] if limit > 0 else all_cows_list,
            "bottom_cows": all_cows_reversed[:limit] if limit > 0 else all_cows_reversed,
            "_all_cows": all_cows_list  # Mantém no cache para permitir mudar o limit sem reprocessar
        }

        # Salva em cache para respostas imediatas futuras
        try:
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(result_payload, f, indent=2)
        except Exception:
            pass

        return result_payload

    except Exception as e:
        return {
            "has_results": False,
            "error": f"Erro ao processar Ficha das Vacas: {str(e)}"
        }


def get_cow_individual_timeseries(
    base_dir: Path,
    folder_name: str,
    cow_id: int
) -> Dict[str, Any]:
    """
    Retorna a curva temporal de lactação (dia a dia) de uma vaca específica.
    Permite visualizar a evolução de leite, gordura e proteína no modal interativo.
    """
    simulacoes_root = base_dir / "output" / "simulacoes"
    sim_dir = simulacoes_root / folder_name
    if not sim_dir.exists():
        return {"error": "Simulação não encontrada"}

    resultados_dir = sim_dir / "resultados"
    csv_candidates = [
        resultados_dir / "simulacao_dados_completos.csv"
    ] + list(resultados_dir.glob("freestall_saved_variables_csv_all_variables*.csv"))

    target_csv = next((c for c in csv_candidates if c.exists()), None)
    if not target_csv:
        return {"error": "CSV de resultados não encontrado"}

    cols = [
        "AnimalModuleReporter.report_milk.milk_data_at_milk_update.cow_id (unitless)",
        "AnimalModuleReporter.report_milk.milk_data_at_milk_update.is_milking (unitless)",
        "AnimalModuleReporter.report_milk.milk_data_at_milk_update.days_in_milk (day)",
        "AnimalModuleReporter.report_milk.milk_data_at_milk_update.estimated_daily_milk_produced (kg/day)",
        "AnimalModuleReporter.report_milk.milk_data_at_milk_update.milk_protein (kg/day)",
        "AnimalModuleReporter.report_milk.milk_data_at_milk_update.milk_fat (kg/day)",
        "AnimalModuleReporter.report_milk.milk_data_at_milk_update.parity (unitless)",
        "AnimalModuleReporter.report_milk.milk_data_at_milk_update.simulation_day (simulation day)"
    ]

    try:
        header_cols = pd.read_csv(target_csv, nrows=1).columns.tolist()
        available_cols = [c for c in cols if c in header_cols]
        df = pd.read_csv(target_csv, usecols=available_cols, low_memory=False)

        cow_id_col = next(c for c in available_cols if "cow_id" in c)
        df_cow = df[df[cow_id_col] == int(cow_id)].copy()

        is_milking_col = next((c for c in available_cols if "is_milking" in c), None)
        if is_milking_col:
            df_cow_milking = df_cow[df_cow[is_milking_col] == True]
            if not df_cow_milking.empty:
                df_cow = df_cow_milking

        if df_cow.empty:
            return {"error": f"Vaca #{cow_id} não encontrada nos registros"}

        milk_col = next(c for c in available_cols if "estimated_daily_milk_produced" in c)
        day_col = next((c for c in available_cols if "simulation_day" in c), None)
        dim_col = next((c for c in available_cols if "days_in_milk" in c), None)
        fat_col = next((c for c in available_cols if "milk_fat" in c), None)
        prot_col = next((c for c in available_cols if "milk_protein" in c), None)
        parity_col = next((c for c in available_cols if "parity" in c), None)

        timeline = []
        for _, row in df_cow.iterrows():
            m_val = float(row[milk_col]) if pd.notnull(row[milk_col]) else 0.0
            timeline.append({
                "day": int(row[day_col]) if day_col and pd.notnull(row[day_col]) else 0,
                "dim": int(row[dim_col]) if dim_col and pd.notnull(row[dim_col]) else 0,
                "milk_kg": round(m_val, 2),
                "fat_kg": round(float(row[fat_col]), 3) if fat_col and pd.notnull(row[fat_col]) else 0.0,
                "protein_kg": round(float(row[prot_col]), 3) if prot_col and pd.notnull(row[prot_col]) else 0.0
            })

        parity_val = int(df_cow[parity_col].iloc[-1]) if parity_col and not df_cow[parity_col].dropna().empty else 1

        return {
            "cow_id": int(cow_id),
            "parity": parity_val,
            "total_days_recorded": len(timeline),
            "timeline": timeline
        }
    except Exception as e:
        return {"error": str(e)}
