"""
Módulo de Análise e Pesquisa Operacional (PO Analytics)
RuFaS - Ruminant Farm Systems
Instituto Federal de Goiás (IFG) - Pesquisa Operacional
"""

import os
import re
import csv
import json
import glob
from pathlib import Path
from typing import Dict, Any, List, Optional
import pandas as pd
import numpy as np


def get_all_feed_names(base_dir: Path) -> Dict[int, str]:
    """Retorna o mapeamento de ID do alimento para nome legível a partir de tabelas NASEM e de usuário."""
    feed_names: Dict[int, str] = {}

    # 1. user_feeds.csv
    user_csv = base_dir / "input" / "data" / "feed" / "user_feeds.csv"
    if user_csv.exists():
        with open(user_csv, mode="r", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                try:
                    f_id = int(row["rufas_id"])
                    desc = row.get("feed_description", "").strip()
                    name = row.get("Name", "").strip()
                    label = f"{name} ({desc})" if desc and desc != name else name
                    feed_names[f_id] = label
                except (ValueError, KeyError):
                    continue

    # 2. NASEM_Comp_with_TDN.csv
    nasem_csv = base_dir / "input" / "data" / "feed" / "NASEM_Comp_with_TDN.csv"
    if nasem_csv.exists():
        with open(nasem_csv, mode="r", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            next(reader, None)  # Pula cabeçalho
            for row in reader:
                if row:
                    try:
                        f_id = int(row[0])
                        if f_id not in feed_names:
                            name = row[1].strip()
                            cat = row[2].strip() if len(row) > 2 else ""
                            feed_names[f_id] = f"{name} ({cat})" if cat else name
                    except (ValueError, IndexError):
                        continue

    return feed_names


def get_feed_prices(base_dir: Path) -> Dict[int, float]:
    """Retorna os preços cadastrados de cada alimento em $/kg."""
    prices: Dict[int, float] = {}
    cfg_path = base_dir / "input" / "data" / "feed" / "example_Midwest_feed.json"
    if cfg_path.exists():
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                for item in data.get("feeds", []):
                    f_id = item.get("feed_type")
                    cost = item.get("purchased_feed_cost", 0.0)
                    if f_id is not None:
                        prices[int(f_id)] = float(cost)
        except Exception:
            pass
    return prices


def get_available_feeds_catalog(base_dir: Path, nutrient_standard: str = "NASEM") -> List[Dict[str, Any]]:
    """
    Retorna o catálogo completo de alimentos validados da tabela correspondente ao padrão
    (NASEM_Comp_with_TDN_urea.csv para NASEM, ou NRC_comp.csv para NRC),
    com teores nutricionais (PB, FDN, NDT, etc.) para seleção no painel web.
    """
    catalog: List[Dict[str, Any]] = []
    feed_names = get_all_feed_names(base_dir)
    std_upper = (nutrient_standard or "NASEM").strip().upper()

    if std_upper == "NRC":
        nrc_csv = base_dir / "input" / "data" / "feed" / "NRC_comp.csv"
        if not nrc_csv.exists():
            return catalog

        with open(nrc_csv, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    f_id = int(row["rufas_id"])
                    name = feed_names.get(f_id, f"Alimento NRC #{f_id}")
                    category = row.get("Fd_Category", "").strip()
                    feed_type = row.get("feed_type", "").strip()
                    cp = float(row.get("CP", 0.0))
                    ndf = float(row.get("NDF", 0.0))
                    tdn = float(row.get("TDN", 0.0))
                    de = float(row.get("DE", 0.0))

                    label = f"#{f_id} - {name} ({feed_type} | PB: {cp:.1f}%, FDN: {ndf:.1f}%, NDT: {tdn:.1f}%)"
                    catalog.append({
                        "id": f_id,
                        "name": name,
                        "category": category,
                        "type": feed_type,
                        "cp": round(cp, 2),
                        "ndf": round(ndf, 2),
                        "tdn": round(tdn, 2),
                        "de": round(de, 2),
                        "label": label,
                        "standard": "NRC"
                    })
                except (ValueError, KeyError):
                    continue
    else:
        # Padrão NASEM
        nasem_csv = base_dir / "input" / "data" / "feed" / "NASEM_Comp_with_TDN_urea.csv"
        if not nasem_csv.exists():
            nasem_csv = base_dir / "input" / "data" / "feed" / "NASEM_Comp_with_TDN.csv"
        if not nasem_csv.exists():
            return catalog

        with open(nasem_csv, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    f_id = int(row["rufas_id"])
                    name = row.get("Name", "").strip() or feed_names.get(f_id, f"Alimento #{f_id}")
                    category = row.get("Fd_Category", "").strip()
                    feed_type = row.get("feed_type", "").strip()
                    cp = float(row.get("CP", 0.0))
                    ndf = float(row.get("NDF", 0.0))
                    tdn = float(row.get("TDN", 0.0))
                    de = float(row.get("DE", 0.0))

                    label = f"#{f_id} - {name} ({feed_type} | PB: {cp:.1f}%, FDN: {ndf:.1f}%, NDT: {tdn:.1f}%)"
                    catalog.append({
                        "id": f_id,
                        "name": name,
                        "category": category,
                        "type": feed_type,
                        "cp": round(cp, 2),
                        "ndf": round(ndf, 2),
                        "tdn": round(tdn, 2),
                        "de": round(de, 2),
                        "label": label,
                        "standard": "NASEM"
                    })
                except (ValueError, KeyError):
                    continue

    catalog.sort(key=lambda x: x["name"])
    return catalog


def get_active_feed_rel_path(base_dir: Path) -> str:
    """Retorna o caminho relativo do arquivo de alimentos ativo no cenário ou metadata."""
    # 1. Verifica arquivo de cenário ativo
    active_scenario_file = base_dir / "input" / "data" / "config" / "active_scenario.json"
    if active_scenario_file.exists():
        try:
            with open(active_scenario_file, "r", encoding="utf-8") as f:
                s = json.load(f)
                feed_p = s.get("feed_file")
                if feed_p and (base_dir / feed_p).exists():
                    return feed_p
        except Exception:
            pass

    # 2. Verifica arquivos de metadata
    for meta_name in ["example_freestall_dairy_metadata.json", "example_animals_only_metadata.json", "example_open_lot_metadata.json"]:
        meta_path = base_dir / "input" / "metadata" / meta_name
        if meta_path.exists():
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    m = json.load(f)
                    feed_p = m.get("files", {}).get("feed", {}).get("path")
                    if feed_p and (base_dir / feed_p).exists():
                        return feed_p
            except Exception:
                pass

    return "input/data/feed/example_Southwest_feed.json"


def get_campo_dourado_scenario_info(base_dir: Path) -> Dict[str, Any]:
    """Retorna as informações e parâmetros do Cenário da Propriedade."""
    active_scenario_file = base_dir / "input" / "data" / "config" / "active_scenario.json"

    defaults = {
        "name": "Faz. Campo Dourado (Goiás)",
        "slug": "GO_campo_dourado",
        "weather_file": "input/data/weather/BR_GO_weather.csv",
        "scenario_profile": "Conservador (100 vacas, foco em estabilidade)",
        "nutrient_standard": "NASEM",
        "cow_num": 100,
        "milking_cow_fraction": 0.8356,
        "cow_times_milked_per_day": 3,
        "formulation_interval": 45,
        "phosphorus_requirement_buffer": 50.0,
        "methane_mitigation_method": "3-NOP",
        "methane_additive_amount": 90.0,
        "feed_file": "input/data/feed/example_Northeast_feed.json"
    }

    data = dict(defaults)
    if active_scenario_file.exists():
        try:
            with open(active_scenario_file, "r", encoding="utf-8") as f:
                saved = json.load(f)
                data.update(saved)
        except Exception:
            pass

    if "farm_code" not in data:
        data["farm_code"] = str(data.get("slug") or "GO_MACAU").upper()

    # Carrega estados ativos reais dos arquivos
    active_feed = get_active_feed_rel_path(base_dir)
    meta_path = base_dir / "input" / "metadata" / "example_animals_only_metadata.json"
    active_weather = data.get("weather_file", "input/data/weather/BR_GO_weather.csv")
    if meta_path.exists():
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                active_weather = json.load(f).get("files", {}).get("weather", {}).get("path", active_weather)
        except Exception:
            pass

    cfg_path = base_dir / "input" / "data" / "config" / "example_animals_only_config.json"
    active_nutrient = data.get("nutrient_standard", "NASEM")
    if cfg_path.exists():
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                active_nutrient = json.load(f).get("nutrient_standard", active_nutrient)
        except Exception:
            pass

    an_path = base_dir / "input" / "data" / "animal" / "example_freestall_animal.json"
    if an_path.exists():
        try:
            with open(an_path, "r", encoding="utf-8") as f:
                a = json.load(f)
                c_num = a.get("herd_information", {}).get("cow_num")
                if c_num is not None:
                    data["cow_num"] = int(c_num)
                m_frac = a.get("herd_information", {}).get("milking_cow_fraction")
                if m_frac is not None:
                    data["milking_cow_fraction"] = float(m_frac)
                cow_times = a.get("animal_config", {}).get("management_decisions", {}).get("cow_times_milked_per_day")
                if cow_times is not None:
                    data["cow_times_milked_per_day"] = int(cow_times)
                interval = a.get("ration", {}).get("formulation_interval")
                if interval is not None:
                    data["formulation_interval"] = int(interval)
                p_buf = a.get("ration", {}).get("phosphorus_requirement_buffer")
                if p_buf is not None:
                    data["phosphorus_requirement_buffer"] = float(p_buf)
                meth = a.get("methane_mitigation", {}).get("methane_mitigation_method")
                if meth:
                    data["methane_mitigation_method"] = str(meth)
                    dose = a.get("methane_mitigation", {}).get(f"{meth}_additive_amount")
                    if dose is not None:
                        data["methane_additive_amount"] = float(dose)
        except Exception:
            pass

    data["active_feed_file"] = active_feed
    data["active_weather_file"] = active_weather
    data["nutrient_standard"] = active_nutrient
    data["state_climate"] = f"{active_weather}"
    data["is_applied"] = (
        active_feed == data.get("feed_file") and
        active_weather == data.get("weather_file") and
        active_nutrient == data.get("nutrient_standard")
    )

    data["available_weather_files"] = [
        {"path": "input/data/weather/BR_GO_weather.csv", "name": "Goiás (Cerrado) — BR_GO_weather.csv (2013-2022)"},
        {"path": "input/data/weather/example_temperate_weather.csv", "name": "Clima Temperado — example_temperate_weather.csv"},
        {"path": "input/data/weather/example_arid_weather.csv", "name": "Clima Árido — example_arid_weather.csv"},
        {"path": "input/data/weather/example_arid_weather_w_irrigation.csv", "name": "Árido c/ Irrigação — example_arid_weather_w_irrigation.csv"}
    ]

    data["available_nutrient_standards"] = [
        {"value": "NASEM", "name": "NASEM (2021) — Requisitos Nutricionais Modernos (Recomendado)", "description": "8ª revisão NASEM Dairy Cattle 2021"},
        {"value": "NRC", "name": "NRC (2001) — Padrão Nutricional Clássico", "description": "7ª revisão NRC Dairy Cattle 2001"}
    ]

    data["available_feed_files"] = [
        {"path": "input/data/feed/example_Northeast_feed.json", "name": "Northeast Dairy Feeds — example_Northeast_feed.json (Campo Dourado)"},
        {"path": "input/data/feed/example_Midwest_feed.json", "name": "Midwest Dairy Feeds — example_Midwest_feed.json"},
        {"path": "input/data/feed/example_Southwest_feed.json", "name": "Southwest Dairy Feeds — example_Southwest_feed.json"},
        {"path": "input/data/feed/example_Intermountain_feed.json", "name": "Intermountain Dairy Feeds — example_Intermountain_feed.json"}
    ]

    data["available_methane_methods"] = [
        {"value": "3-NOP", "name": "3-NOP (Bovaer — Inibidor enzimático)", "unit": "mg/kg DMI", "default_dose": 90, "min": 40, "max": 100},
        {"value": "None", "name": "None (Sem aditivo mitigador)", "unit": "-", "default_dose": 0, "min": 0, "max": 0},
        {"value": "Monensin", "name": "Monensina Sódica (Ionóforo)", "unit": "mg/kg DMI", "default_dose": 24, "min": 20, "max": 36},
        {"value": "Essential Oils", "name": "Óleos Essenciais", "unit": "mg/kg DMI", "default_dose": 50, "min": 0, "max": 100},
        {"value": "Seaweed", "name": "Macroalgas (Asparagopsis taxiformis)", "unit": "mg/kg DMI", "default_dose": 50, "min": 0, "max": 100}
    ]

    return data


def apply_campo_dourado_scenario(base_dir: Path, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Aplica todos os parâmetros do Cenário aos arquivos de configuração do RuFaS:
    - Clima: série meteorológica escolhida (default: BR_GO_weather.csv)
    - Padrão nutricional: NASEM ou NRC
    - Arquivo de alimentos: feed_file escolhido
    - Rebanho: cow_num, milking_cow_fraction, ordenhas/dia
    - Reformulação: formulation_interval dias, buffer de fósforo (%)
    - Metano: método de mitigação (3-NOP, etc.) e dosagem
    """
    active_scenario_file = base_dir / "input" / "data" / "config" / "active_scenario.json"
    current = get_campo_dourado_scenario_info(base_dir)
    old_standard = current.get("nutrient_standard", "NASEM")
    standard_changed = False

    if params:
        if "name" in params and params["name"]:
            current["name"] = str(params["name"]).strip()
        if "farm_code" in params and params["farm_code"]:
            current["farm_code"] = str(params["farm_code"]).strip().upper()
            current["slug"] = current["farm_code"]
        elif "slug" in params and params["slug"]:
            current["slug"] = str(params["slug"]).strip()
            current["farm_code"] = current["slug"].upper()
        if "weather_file" in params and params["weather_file"]:
            current["weather_file"] = str(params["weather_file"]).strip()
        if "scenario_profile" in params and params["scenario_profile"]:
            current["scenario_profile"] = str(params["scenario_profile"]).strip()
        if "nutrient_standard" in params and params["nutrient_standard"]:
            std = str(params["nutrient_standard"]).strip().upper()
            if std in ["NASEM", "NRC"]:
                if std != old_standard:
                    standard_changed = True
                current["nutrient_standard"] = std
        if "cow_num" in params:
            try:
                current["cow_num"] = int(params["cow_num"])
            except (ValueError, TypeError):
                pass
        if "milking_cow_fraction" in params:
            try:
                current["milking_cow_fraction"] = float(params["milking_cow_fraction"])
            except (ValueError, TypeError):
                pass
        if "cow_times_milked_per_day" in params:
            try:
                current["cow_times_milked_per_day"] = max(1, min(4, int(params["cow_times_milked_per_day"])))
            except (ValueError, TypeError):
                pass
        if "formulation_interval" in params:
            try:
                current["formulation_interval"] = max(1, min(365, int(params["formulation_interval"])))
            except (ValueError, TypeError):
                pass
        if "phosphorus_requirement_buffer" in params:
            try:
                current["phosphorus_requirement_buffer"] = max(0.0, float(params["phosphorus_requirement_buffer"]))
            except (ValueError, TypeError):
                pass
        if "methane_mitigation_method" in params and params["methane_mitigation_method"]:
            meth = str(params["methane_mitigation_method"]).strip()
            if meth in ["3-NOP", "None", "Monensin", "Essential Oils", "Seaweed"]:
                current["methane_mitigation_method"] = meth
        if "methane_additive_amount" in params:
            try:
                current["methane_additive_amount"] = max(0.0, float(params["methane_additive_amount"]))
            except (ValueError, TypeError):
                pass
        if "feed_file" in params and params["feed_file"]:
            current["feed_file"] = str(params["feed_file"]).strip()

    # Salva no arquivo de persistência de cenário ativo
    f_code = current.get("farm_code") or str(current.get("slug", "GO_MACAU")).upper()
    save_data = {
        "name": current["name"],
        "slug": current.get("slug", f_code),
        "farm_code": f_code,
        "weather_file": current["weather_file"],
        "scenario_profile": current["scenario_profile"],
        "nutrient_standard": current["nutrient_standard"],
        "cow_num": current.get("cow_num", 100),
        "milking_cow_fraction": current.get("milking_cow_fraction", 0.8356),
        "cow_times_milked_per_day": current["cow_times_milked_per_day"],
        "formulation_interval": current["formulation_interval"],
        "phosphorus_requirement_buffer": current["phosphorus_requirement_buffer"],
        "methane_mitigation_method": current["methane_mitigation_method"],
        "methane_additive_amount": current["methane_additive_amount"],
        "feed_file": current["feed_file"]
    }
    try:
        active_scenario_file.parent.mkdir(parents=True, exist_ok=True)
        with open(active_scenario_file, "w", encoding="utf-8") as f:
            json.dump(save_data, f, indent=4, ensure_ascii=False)
    except Exception as e:
        print(f"Erro ao salvar active_scenario.json: {e}")

    # 1. Configurações gerais (nutrient_standard)
    for cfg_name in ["example_animals_only_config.json", "example_freestall_config.json"]:
        cfg_file = base_dir / "input" / "data" / "config" / cfg_name
        if cfg_file.exists():
            with open(cfg_file, "r+", encoding="utf-8") as f:
                c = json.load(f)
                c["nutrient_standard"] = current["nutrient_standard"]
                f.seek(0)
                json.dump(c, f, indent=4)
                f.truncate()

    # 2. Arquivos de Metadados (Feed e Weather)
    for meta_name in ["example_animals_only_metadata.json", "example_freestall_dairy_metadata.json", "example_open_lot_metadata.json"]:
        meta_file = base_dir / "input" / "metadata" / meta_name
        if meta_file.exists():
            with open(meta_file, "r+", encoding="utf-8") as f:
                m = json.load(f)
                m.setdefault("files", {}).setdefault("feed", {})["path"] = current["feed_file"]
                m.setdefault("files", {}).setdefault("weather", {})["path"] = current["weather_file"]
                f.seek(0)
                json.dump(m, f, indent=2)
                f.truncate()

    # 3. Parâmetros de Animais (Rebanho, Ordenhas, Manejo, Metano e Buffer P)
    for an_name in ["example_freestall_animal.json", "example_open_lot_animal.json"]:
        an_file = base_dir / "input" / "data" / "animal" / an_name
        if an_file.exists():
            with open(an_file, "r+", encoding="utf-8") as f:
                a = json.load(f)
                a.setdefault("herd_information", {})["cow_num"] = current.get("cow_num", 100)
                a.setdefault("herd_information", {})["milking_cow_fraction"] = current.get("milking_cow_fraction", 0.8356)
                a.setdefault("animal_config", {}).setdefault("management_decisions", {})["cow_times_milked_per_day"] = current["cow_times_milked_per_day"]
                a.setdefault("ration", {})["formulation_interval"] = current["formulation_interval"]
                a.setdefault("ration", {})["phosphorus_requirement_buffer"] = current["phosphorus_requirement_buffer"]
                
                mm = a.setdefault("methane_mitigation", {})
                mm["methane_mitigation_method"] = current["methane_mitigation_method"]
                meth = current["methane_mitigation_method"]
                dose = current["methane_additive_amount"]
                if meth == "3-NOP":
                    mm["3-NOP_additive_amount"] = dose
                elif meth == "Monensin":
                    mm["monensin_additive_amount"] = dose
                elif meth == "Essential Oils":
                    mm["essential_oils_additive_amount"] = dose
                elif meth == "Seaweed":
                    mm["seaweed_additive_amount"] = dose

                f.seek(0)
                json.dump(a, f, indent=4)
                f.truncate()

    if standard_changed:
        # Quando o padrão nutricional muda (ex: NASEM -> NRC ou vice-versa),
        # carrega automaticamente a dieta balanceada executável para o novo padrão
        try:
            load_preset_feeds_for_standard(base_dir, nutrient_standard=current["nutrient_standard"])
        except Exception as e:
            print(f"Erro ao carregar dieta sugerida na troca de padrão: {e}")

    success_msg = f"Cenário '{current['name']}' ({current['slug']}) salvo e aplicado com sucesso ao modelo RuFaS!"
    if standard_changed:
        success_msg += f" O padrão foi alterado para {current['nutrient_standard']} e a dieta padrão executável correspondente foi carregada com sucesso."

    return {
        "success": True,
        "message": success_msg,
        "standard_changed": standard_changed,
        "scenario": get_campo_dourado_scenario_info(base_dir)
    }


def update_feeds_file(base_dir: Path, feeds_list: List[Dict[str, Any]], feed_rel_path: str = None) -> Dict[str, Any]:
    """
    Atualiza o arquivo de alimentos (default: arquivo ativo no metadata) incluindo novos insumos
    ou retirando insumos removidos pelo usuário na interface web.
    """
    if not feed_rel_path:
        feed_rel_path = get_active_feed_rel_path(base_dir)

    cfg_path = base_dir / feed_rel_path
    if not cfg_path.exists():
        raise FileNotFoundError(f"Arquivo de configuração de ração não encontrado: {cfg_path}")

    with open(cfg_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    existing_feed_map = {int(f["feed_type"]): f for f in data.get("feeds", [])}

    essential_calf_ids = {202, 216}
    updated_feeds = []
    processed_ids = set()

    for item in feeds_list:
        f_id = int(item["id"])
        if f_id in processed_ids:
            continue
        processed_ids.add(f_id)

        orig_entry = existing_feed_map.get(f_id, {})
        cost = float(item.get("cost", orig_entry.get("purchased_feed_cost", 0.10)))
        buffer_val = float(item.get("buffer", orig_entry.get("buffer", 0.15)))
        runtime_allow = float(item.get("runtime_purchase_allowance", orig_entry.get("runtime_purchase_allowance", 1000.0)))
        advance_allow = float(item.get("advance_purchase_allowance", orig_entry.get("advance_purchase_allowance", 1000000.0)))
        plan_allow = float(item.get("planning_cycle_allowance", orig_entry.get("planning_cycle_allowance", 1000.0)))

        updated_feeds.append({
            "feed_type": f_id,
            "purchased_feed_cost": cost,
            "buffer": buffer_val,
            "runtime_purchase_allowance": runtime_allow,
            "advance_purchase_allowance": advance_allow,
            "planning_cycle_allowance": plan_allow
        })

    # Preserva alimentos de bezerro se estavam no arquivo original e não foram especificados
    for calf_id in essential_calf_ids:
        if calf_id not in processed_ids and calf_id in existing_feed_map:
            updated_feeds.append(existing_feed_map[calf_id])
            processed_ids.add(calf_id)

    data["feeds"] = updated_feeds
    all_configured_ids = set(processed_ids)

    # Atualiza as seções de rações (rations)
    for r in data.get("rations", []):
        combo = r.get("animal_combination")
        cur_feeds = r.get("feeds", [])

        # Filtra insumos que foram removidos do top-level
        valid_feeds = [f for f in cur_feeds if f.get("feed_type") in all_configured_ids]

        # Proporções nutricionais zootecnicamente balanceadas para cada categoria
        IDEAL_BASE_PROPORTIONS = {
            "lac_cow": {
                51: 45.0,  # Corn silage
                44: 25.0,  # Corn grain
                167: 16.0, # Soybean meal
                18: 10.0,  # Bermudagrass hay
                1: 2.0,    # Alfalfa meal
                230: 0.8,  # Calcium carbonate
                231: 0.8,  # Calcium phosphate di
                239: 0.4,  # Salt
            },
            "growing": {
                51: 60.0,  # Corn silage
                18: 30.0,  # Bermudagrass hay
                44: 8.0,   # Corn grain
                167: 0.0,  # 0% soybean meal (evita violar protein_constraint_upper em novilhas)
                230: 1.0,  # Calcium carbonate
                231: 0.6,  # Calcium phosphate di
                239: 0.4,  # Salt
            },
            "close_up": {
                51: 55.0,  # Corn silage
                18: 30.0,  # Bermudagrass hay
                44: 10.0,  # Corn grain
                167: 3.0,  # Soybean meal
                230: 1.0,  # Calcium carbonate
                231: 0.6,  # Calcium phosphate di
                239: 0.4,  # Salt
            }
        }
        mineral_ids = {229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 266}

        # Para categorias de ruminantes (lac_cow, growing, close_up),
        # assegura que todos os insumos ativos da fazenda estejam disponíveis para formulação com proporções zootécnicas
        if combo in ["lac_cow", "growing", "close_up"]:
            valid_feeds = []
            prop_map = IDEAL_BASE_PROPORTIONS.get(combo, {})
            for f_item in updated_feeds:
                f_type = f_item["feed_type"]
                if f_type not in essential_calf_ids:
                    if f_type in prop_map:
                        pct = prop_map[f_type]
                    elif f_type in mineral_ids:
                        pct = 0.5
                    else:
                        pct = 5.0
                    valid_feeds.append({
                        "feed_type": f_type,
                        "ration_percentage": pct
                    })

        # Renormaliza porcentagens para somar exatamente 100.0%
        if valid_feeds:
            tot = sum(f.get("ration_percentage", 1.0) for f in valid_feeds)
            if tot <= 0:
                tot = len(valid_feeds)
                for f in valid_feeds:
                    f["ration_percentage"] = 1.0

            for f in valid_feeds:
                f["ration_percentage"] = round((f["ration_percentage"] / tot) * 100.0, 2)

            diff = round(100.0 - sum(f["ration_percentage"] for f in valid_feeds), 2)
            valid_feeds[-1]["ration_percentage"] = round(valid_feeds[-1]["ration_percentage"] + diff, 2)

        r["feeds"] = valid_feeds

    with open(cfg_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    user_active_feeds = [f for f in updated_feeds if f["feed_type"] not in essential_calf_ids]
    return {
        "success": True,
        "message": f"Configuração de insumos atualizada com sucesso! ({len(user_active_feeds)} insumos ativos na formulação)",
        "active_feeds_count": len(user_active_feeds)
    }


def load_preset_feeds_for_standard(base_dir: Path, nutrient_standard: str = "NASEM") -> Dict[str, Any]:
    """Carrega uma dieta pré-definida e balanceada de alimentos para o padrão especificado (NRC ou NASEM), garantindo convergência nos dois solvers."""
    std = (nutrient_standard or "NASEM").strip().upper()
    if std == "NRC":
        preset_feeds = [
            {"id": 51, "cost": 0.045, "buffer": 0.15},   # Corn silage, mid maturity (Forragem volumosa)
            {"id": 44, "cost": 0.180, "buffer": 0.15},   # Corn grain, ground, dry (Concentrado energético)
            {"id": 167, "cost": 0.380, "buffer": 0.15},  # Soybean meal, solvent 48% CP (Concentrado proteico)
            {"id": 18, "cost": 0.120, "buffer": 0.15},   # Bermudagrass / Grass Hay (Fibra efetiva / FDN)
            {"id": 1, "cost": 0.220, "buffer": 0.15},    # Alfalfa meal (Leguminosa / Proteína / Cálcio natural)
            {"id": 230, "cost": 0.080, "buffer": 0.15},  # Calcium carbonate (Fonte de Cálcio mineral puro 39.4%)
            {"id": 231, "cost": 0.250, "buffer": 0.15},  # Calcium phosphate di (Fonte de Cálcio 22% e Fósforo 19.3%)
            {"id": 239, "cost": 0.060, "buffer": 0.15},  # Sodium chloride (Sal mineral / Eletrólitos)
        ]
    else:
        preset_feeds = [
            {"id": 51, "cost": 0.045, "buffer": 0.15},   # Corn silage, typical mid maturity (Forragem volumosa)
            {"id": 44, "cost": 0.180, "buffer": 0.15},   # Corn grain dry, medium grind (Concentrado energético)
            {"id": 167, "cost": 0.380, "buffer": 0.15},  # Soybean meal, solvent 48CP (Concentrado proteico)
            {"id": 18, "cost": 0.120, "buffer": 0.15},   # Bermudagrass hay (Fibra efetiva / FDN)
            {"id": 1, "cost": 0.220, "buffer": 0.15},    # Alfalfa meal (Leguminosa / Cálcio natural)
            {"id": 230, "cost": 0.080, "buffer": 0.15},  # Calcium carbonate (Fonte de Cálcio puro 39.4%)
            {"id": 231, "cost": 0.250, "buffer": 0.15},  # Calcium phosphate di (Fonte de Cálcio 22% e Fósforo 19.3%)
            {"id": 239, "cost": 0.060, "buffer": 0.15},  # Sodium chloride (Sal mineral / Eletrólitos)
        ]
    active_feed_rel = get_active_feed_rel_path(base_dir)
    res = update_feeds_file(base_dir, preset_feeds, feed_rel_path=active_feed_rel)
    res["message"] = f"Dieta sugerida para {std} carregada com sucesso! ({len(preset_feeds)} insumos balanceados com minerais Ca/P)"
    return res


CONSTRAINT_TRANSLATIONS = {
    "calcium_constraint": "Restrição de Cálcio (deficiência de cálcio nos insumos)",
    "protein_constraint_upper": "Limite Superior de Proteína Bruta/Metabolizável",
    "phosphorus_constraint": "Restrição de Fósforo",
    "NASEM_net_energy_constraint": "Restrição de Energia Líquida (NASEM)",
    "dmi_constraint_lower": "Consumo Mínimo de Matéria Seca",
    "dmi_constraint_upper": "Consumo Máximo de Matéria Seca",
    "fat_constraint_upper": "Limite Superior de Extrato Etéreo / Gordura",
    "forage_minimum": "Mínimo de Forragem na Dieta",
}


def check_formulation_fallback(df: pd.DataFrame, base_dir: Optional[Path] = None, specific_csv: Optional[Path] = None) -> Dict[str, Any]:
    """
    Verifica se a formulação automatizada de ração para vacas em lactação falhou no simulador,
    levando o RuFaS a reutilizar a ração padrão anterior como contingência
    ("Previous ration used because automated ration formulation failed... Used most recently formulated ration instead.").
    """
    fail_cols = [c for c in df.columns if "constraints_failed_dict" in c]
    lac_fail_cols = [c for c in fail_cols if "pen_3" in c or "lac_cow" in c.lower()]
    target_cols = lac_fail_cols

    failed_constraints = set()
    total_failures = 0

    for col in target_cols:
        non_null = df[col].dropna()
        if not non_null.empty:
            for val in non_null:
                val_str = str(val).strip()
                if val_str in ("[]", "", "None", "nan"):
                    continue
                matches = re.findall(r"'([a-zA-Z0-9_]+)'", val_str)
                if matches:
                    failed_constraints.update(matches)
                    total_failures += 1
                else:
                    clean = val_str.strip("[]() ")
                    for part in clean.split(","):
                        p = part.strip().strip("'\"")
                        if p:
                            failed_constraints.add(p)
                            total_failures += 1

    # Verifica logs específicos do RuFaS apenas quando houver timestamp correspondente
    log_indicates_fallback = False
    if total_failures == 0 and specific_csv:
        csv_stem = specific_csv.stem
        ts_match = re.search(r"(\d{1,2}-[A-Za-z]{3}-\d{4}_[A-Za-z]{3}_\d{2}-\d{2})", csv_stem)
        if not ts_match and specific_csv.parent.name == "resultados":
            raw_files = list(specific_csv.parent.glob("*_*.csv"))
            for rf in raw_files:
                m = re.search(r"(\d{1,2}-[A-Za-z]{3}-\d{4}_[A-Za-z]{3}_\d{2}-\d{2})", rf.stem)
                if m:
                    ts_match = m
                    break
        ts_filter = ts_match.group(1) if ts_match else None

        if ts_filter:
            search_dirs = [
                specific_csv.parent.parent / "logs" / "rufas_logs",
                specific_csv.parent / "logs" / "rufas_logs",
            ]
            for s_dir in search_dirs:
                if s_dir.exists():
                    for log_file in s_dir.glob(f"*{ts_filter}*.json"):
                        try:
                            with open(log_file, "r", encoding="utf-8") as f:
                                data = json.load(f)
                                for k, v in data.items():
                                    k_lower = k.lower()
                                    if ("failed formulation attempt" in k_lower or "previous ration used" in k_lower) and (
                                        "pen_3" in str(v).lower() or "lac_cow" in str(v).lower()
                                    ):
                                        log_indicates_fallback = True
                                        break
                        except Exception:
                            pass
                        if log_indicates_fallback:
                            break
                if log_indicates_fallback:
                    break

    is_fallback = (total_failures > 0) or log_indicates_fallback
    failed_list = sorted(list(failed_constraints))
    labels = [CONSTRAINT_TRANSLATIONS.get(c, c) for c in failed_list]

    if is_fallback:
        msg = (
            "A formulação automatizada da ração falhou devido à violação de restrições zootécnicas. "
            "A ração anterior/padrão foi reutilizada como contingência pelo simulador "
            "('Previous ration used because automated ration formulation failed... Used most recently formulated ration instead.')."
        )
        rec = "Para permitir a formulação ótima, adicione fontes minerais (ex: Calcário Calcítico, Sal Mineral) ao catálogo de alimentos ativos ou ajuste as exigências nutricionais."
    else:
        msg = "Formulação ótima calculada e validada com sucesso pelo solver."
        rec = ""

    return {
        "is_fallback": is_fallback,
        "message": msg,
        "failed_constraints": failed_list,
        "failed_constraints_labels": labels,
        "recommendation": rec,
        "total_failures": total_failures,
    }


def analyze_po_results(base_dir: Path, milk_price: float = 0.45, specific_csv: Optional[Path] = None) -> Dict[str, Any]:
    """
    Analisa os resultados da simulação mais recente (ou CSV especificado) sob a ótica da Pesquisa Operacional.
    Calcula custos diários da ração, decomposição por insumo, eficiência alimentar e IOFC.

    REGRA ESTREITA: Caso a formulação automatizada tenha falhado e o RuFaS tenha reutilizado
    a ração de contingência anterior ("Previous ration used because automated ration formulation failed..."),
    NENHUM valor de KPI (DMI, custo, leite, IOFC) é gerado para evitar interpretações zootécnicas e econômicas incorretas.
    """
    import re
    if specific_csv and specific_csv.exists():
        latest_csv = str(specific_csv)
    else:
        csv_files = glob.glob(str(base_dir / "output" / "CSVs" / "*.csv"))
        if not csv_files:
            return {"has_results": False, "message": "Nenhum arquivo CSV encontrado em output/CSVs."}
        latest_csv = max(csv_files, key=os.path.getmtime)

    df = pd.read_csv(latest_csv, low_memory=False)
    feed_names = get_all_feed_names(base_dir)
    feed_prices = get_feed_prices(base_dir)

    # 3. Restrições e Folgas (Constraints & Slacks)
    fail_cols = [c for c in df.columns if "constraints_failed_dict" in c]
    binding_constraints = {}
    for c in fail_cols:
        for val in df[c].dropna():
            v_str = str(val)
            binding_constraints[v_str] = binding_constraints.get(v_str, 0) + 1

    # Verifica se houve fallback para a ração anterior por falha de formulação
    fallback_info = check_formulation_fallback(df, base_dir=base_dir, specific_csv=Path(latest_csv))

    if fallback_info["is_fallback"]:
        # NÃO GERA OS VALORES DE KPIS NEM DE DIETA ÓTIMA
        return {
            "has_results": True,
            "csv_filename": Path(latest_csv).name,
            "total_days_simulated": len(df),
            "formulation_failed": True,
            "fallback_used": True,
            "fallback_message": fallback_info["message"],
            "failed_constraints": fallback_info["failed_constraints"],
            "failed_constraints_labels": fallback_info["failed_constraints_labels"],
            "recommendation": fallback_info["recommendation"],
            "diet": None,
            "kpis": None,
            "binding_constraints": binding_constraints,
        }

    # 1. Formulação Ótima da Dieta para Vacas em Lactação (LAC_COW_PEN_3)
    diet_cols = [c for c in df.columns if "report_ration_per_animal.ration_per_animal_for_LAC_COW" in c]
    
    ingredients = []
    total_dmi = 0.0
    total_cost_per_cow_day = 0.0

    for c in diet_cols:
        parts = c.split(".")
        feed_id_str = parts[-1].replace(" (kg)", "")
        try:
            feed_id = int(feed_id_str)
            amount = float(df[c].dropna().mean())
            if amount > 0.001:
                price = feed_prices.get(feed_id, 0.0)
                cost_day = amount * price
                total_dmi += amount
                total_cost_per_cow_day += cost_day
                ingredients.append({
                    "feed_id": feed_id,
                    "name": feed_names.get(feed_id, f"Alimento #{feed_id}"),
                    "amount_kg": round(amount, 3),
                    "price_per_kg": round(price, 4),
                    "cost_per_day": round(cost_day, 4),
                })
        except ValueError:
            continue

    # Ordenar por maior quantidade incluída
    ingredients.sort(key=lambda x: x["amount_kg"], reverse=True)
    for item in ingredients:
        item["percentage"] = round((item["amount_kg"] / total_dmi * 100), 2) if total_dmi > 0 else 0.0
        item["cost_percentage"] = round((item["cost_per_day"] / total_cost_per_cow_day * 100), 2) if total_cost_per_cow_day > 0 else 0.0

    # 2. Produção de Leite e Eficiência
    milk_col = next((c for c in df.columns if "report_herd_statistics_data.daily_milk_production" in c), None)
    
    cow_pop_col = next((c for c in df.columns if "initial_number_of_lactating_cows" in c), None)
    if cow_pop_col and not df[cow_pop_col].dropna().empty:
        num_lactating_cows = float(df[cow_pop_col].dropna().iloc[0])
    else:
        num_lactating_cows = 76.0

    total_herd_milk_daily = float(df[milk_col].dropna().mean()) if milk_col else 0.0
    milk_per_cow_daily = (total_herd_milk_daily / num_lactating_cows) if num_lactating_cows > 0 else 42.5

    # Eficiência Alimentar (FCE = kg leite / kg MS)
    feed_efficiency = (milk_per_cow_daily / total_dmi) if total_dmi > 0 else 0.0
    
    # Custo da ração por kg de leite ($ / kg de leite)
    feed_cost_per_kg_milk = (total_cost_per_cow_day / milk_per_cow_daily) if milk_per_cow_daily > 0 else 0.0

    # Receita diária de leite por vaca e IOFC (Income Over Feed Cost)
    milk_revenue_per_cow = milk_per_cow_daily * milk_price
    iofc = milk_revenue_per_cow - total_cost_per_cow_day

    return {
        "has_results": True,
        "csv_filename": Path(latest_csv).name,
        "total_days_simulated": len(df),
        "formulation_failed": False,
        "fallback_used": False,
        "diet": ingredients,
        "kpis": {
            "total_dmi_kg": round(total_dmi, 2),
            "cost_per_cow_day": round(total_cost_per_cow_day, 3),
            "milk_per_cow_daily": round(milk_per_cow_daily, 2),
            "total_herd_milk_daily": round(total_herd_milk_daily, 1),
            "lactating_cows_count": round(num_lactating_cows, 1),
            "feed_efficiency": round(feed_efficiency, 2),
            "feed_cost_per_kg_milk": round(feed_cost_per_kg_milk, 4),
            "milk_price_assumed": round(milk_price, 3),
            "milk_revenue_per_cow": round(milk_revenue_per_cow, 3),
            "iofc_per_cow_day": round(iofc, 3),
            "active_ingredients_count": len(ingredients),
        },
        "binding_constraints": binding_constraints,
    }


def run_sensitivity_analysis(
    feed_id: int,
    base_dir: Path,
    price_deltas: Optional[List[float]] = None,
    milk_price: float = 0.45
) -> Dict[str, Any]:
    """
    Realiza Análise de Sensibilidade Paramétrica para um ingrediente selecionado da ração.
    Avalia como variações no preço do insumo impactam o custo total da dieta, o custo/kg de leite e o IOFC.
    """
    if price_deltas is None:
        price_deltas = [-50.0, -30.0, -20.0, -10.0, 0.0, 10.0, 20.0, 30.0, 50.0]

    po_data = analyze_po_results(base_dir, milk_price=milk_price)
    if not po_data.get("has_results"):
        return {"error": "Nenhum resultado de simulação disponível para análise de sensibilidade."}

    if po_data.get("formulation_failed") or po_data.get("fallback_used"):
        return {
            "error": (
                "Análise de sensibilidade indisponível: A formulação automatizada da ração falhou "
                "e o simulador reutilizou a ração de contingência anterior "
                "('Previous ration used because automated ration formulation failed... Used most recently formulated ration instead.'). "
                "Nenhum valor foi gerado para evitar conclusões incorretas."
            )
        }

    diet = po_data["diet"] or []
    kpis = po_data.get("kpis") or {}
    feed_names = get_all_feed_names(base_dir)
    feed_prices = get_feed_prices(base_dir)

    target_ingredient = next((item for item in diet if item["feed_id"] == feed_id), None)
    base_cost_day = kpis.get("cost_per_cow_day", 0.0)
    milk_per_cow = kpis.get("milk_per_cow_daily", 42.5)

    if target_ingredient:
        base_price = target_ingredient["price_per_kg"]
        target_amount = target_ingredient["amount_kg"]
        feed_name = target_ingredient["name"]
        pct_in_diet = target_ingredient["percentage"]
        other_feeds_cost = base_cost_day - (target_amount * base_price)
        cost_share = (target_amount * base_price / base_cost_day) if base_cost_day > 0 else 0.0
        is_active = True
    else:
        # Ingrediente do catálogo que não está presente na dieta ótima simulada
        feed_name = feed_names.get(feed_id, f"Alimento #{feed_id}")
        base_price = feed_prices.get(feed_id, 0.10)
        target_amount = 0.0
        pct_in_diet = 0.0
        other_feeds_cost = base_cost_day
        cost_share = 0.0
        is_active = False

    sensitivity_curve = []
    for delta_pct in price_deltas:
        new_price = max(0.0001, base_price * (1.0 + delta_pct / 100.0))
        new_total_cost = other_feeds_cost + (target_amount * new_price)
        cost_diff_pct = ((new_total_cost - base_cost_day) / base_cost_day * 100.0) if base_cost_day > 0 else 0.0
        new_cost_per_kg_milk = (new_total_cost / milk_per_cow) if milk_per_cow > 0 else 0.0
        new_iofc = (milk_per_cow * milk_price) - new_total_cost

        sensitivity_curve.append({
            "delta_pct": delta_pct,
            "unit_price": round(new_price, 4),
            "diet_cost_per_cow_day": round(new_total_cost, 3),
            "cost_diff_pct": round(cost_diff_pct, 2),
            "feed_cost_per_kg_milk": round(new_cost_per_kg_milk, 4),
            "iofc_per_cow_day": round(new_iofc, 3),
        })

    return {
        "feed_id": feed_id,
        "feed_name": feed_name,
        "base_price": round(base_price, 4),
        "amount_kg": round(target_amount, 3),
        "percentage_in_diet": pct_in_diet,
        "cost_share_percentage": round(cost_share * 100, 2),
        "cost_elasticity": round(cost_share, 4),
        "is_active_in_diet": is_active,
        "sensitivity_curve": sensitivity_curve,
    }


def generate_po_csv_report(base_dir: Path, milk_price: float = 0.45, specific_csv: Optional[Path] = None) -> str:
    """Gera um relatório técnico estruturado em formato CSV para download e documentação acadêmica."""
    data = analyze_po_results(base_dir, milk_price=milk_price, specific_csv=specific_csv)
    if not data.get("has_results"):
        return "Nenhum resultado disponivel.\n"

    lines = []
    lines.append("RELATÓRIO TÉCNICO DE PESQUISA OPERACIONAL - FORMULAÇÃO ÓTIMA DE RAÇÃO")
    lines.append(f"Arquivo de Origem;{data.get('csv_filename')}")
    lines.append(f"Dias Simulados;{data.get('total_days_simulated')}")
    lines.append("")

    if data.get("formulation_failed") or data.get("fallback_used"):
        lines.append("AVISO CRÍTICO;FORMULAÇÃO AUTOMATIZADA DE RAÇÃO FALHOU")
        lines.append(f"Mensagem;\"{data.get('fallback_message')}\"")
        lines.append("Situação Original;\"Previous ration used because automated ration formulation failed... Used most recently formulated ration instead.\"")
        lines.append("Status dos Valores;NÃO GERADOS (Evita interpretações econômicas e nutricionais incorretas)")
        lines.append("")
        lines.append("RESTRIÇÕES ZOOTÉCNICAS QUE CAUSARAM A FALHA;")
        for lbl in data.get("failed_constraints_labels", []):
            lines.append(f"-;\"{lbl}\"")
        lines.append("")
        lines.append(f"Recomendação;\"{data.get('recommendation', '')}\"")
        return "\n".join(lines)

    lines.append("1. INDICADORES GERAIS DE DESEMPENHO ZOOTÉCNICO E ECONÔMICO (KPIS)")
    lines.append("Métrica;Valor;Unidade")
    kpis = data.get("kpis") or {}
    lines.append(f"Consumo de Matéria Seca (DMI);{kpis.get('total_dmi_kg', '-')};kg/vaca/dia")
    lines.append(f"Custo Total da Dieta;{kpis.get('cost_per_cow_day', '-')};$/vaca/dia")
    lines.append(f"Produção Média de Leite;{kpis.get('milk_per_cow_daily', '-')};kg/vaca/dia")
    lines.append(f"Eficiência Alimentar (kg leite/kg MS);{kpis.get('feed_efficiency', '-')};adimensional")
    lines.append(f"Custo da Ração por kg de Leite;{kpis.get('feed_cost_per_kg_milk', '-')};$/kg leite")
    lines.append(f"Preço do Leite Considerado;{kpis.get('milk_price_assumed', '-')};$/kg")
    lines.append(f"Receita Diária de Leite;{kpis.get('milk_revenue_per_cow', '-')};$/vaca/dia")
    lines.append(f"Margem Sobre o Custo da Ração (IOFC);{kpis.get('iofc_per_cow_day', '-')};$/vaca/dia")
    lines.append("")
    lines.append("2. COMPOSIÇÃO DA DIETA ÓTIMA (MÉTODO SLSQP)")
    lines.append("ID;Ingrediente;Consumo (kg MS);Inclusão (%);Preço Unitário ($/kg);Custo Diário ($/vaca);Part. no Custo (%)")
    for ing in (data.get("diet") or []):
        lines.append(f"{ing['feed_id']};\"{ing['name']}\";{ing['amount_kg']};{ing['percentage']}%;{ing['price_per_kg']};{ing['cost_per_day']};{ing['cost_percentage']}%")
    lines.append("")
    lines.append("3. RESTRIÇÕES ATIVAS DO MODELO DE OTIMIZAÇÃO (BINDING CONSTRAINTS)")
    lines.append("Restrição;Ocorrências no Período;Interpretação Operacional")
    for constr, count in data.get("binding_constraints", {}).items():
        desc = "Restrição limitante ativa na formulação da dieta"
        if "protein_constraint" in constr:
            desc = "Limite de proteína metabolizável atingido (balanço de nitrogênio)"
        elif "DMI" in constr:
            desc = "Capacidade ingestiva máxima de matéria seca atingida"
        lines.append(f"{constr};{count};\"{desc}\"")

    return "\n".join(lines)


def compare_solvers(base_dir: Path, milk_price: float = 0.45) -> Dict[str, Any]:
    """
    Compara lado a lado a formulação da ração obtida pelos modelos
    Linear (LP / HiGHS Simplex) e Não-Linear (NLP / SLSQP Biofísico).
    
    Regra estrita: Caso haja falha na execução ou convergência de qualquer
    um dos solvers (NLP ou LP), nenhum valor de comparação é calculado,
    e a função retorna o status de falha com o motivo detalhado para alertar o usuário.
    """
    from scipy.optimize import linprog

    # 1. Validação da execução e convergência do Solver Não-Linear (NLP / SLSQP)
    po_data = analyze_po_results(base_dir, milk_price=milk_price)
    if not po_data.get("has_results"):
        return {
            "success": False,
            "failed_solver": "Não-Linear (NLP / SLSQP)",
            "error_title": "Falha no Solver Não-Linear (NLP / SLSQP)",
            "failure_reason": (
                "Nenhum resultado de simulação biofísica disponível. O modelo Não-Linear "
                "(NLP / SLSQP) não foi executado ou não produziu registros de saída válidos. "
                "Execute uma simulação antes de solicitar o comparativo."
            ),
            "linear": None,
            "nonlinear": None,
            "comparison": None,
        }

    if po_data.get("formulation_failed") or po_data.get("fallback_used"):
        return {
            "success": False,
            "failed_solver": "Não-Linear (NLP / SLSQP)",
            "error_title": "Falha na Formulação Automatizada da Ração",
            "failure_reason": (
                "A formulação automatizada da ração falhou devido à violação de restrições zootécnicas "
                "infactíveis ('Previous ration used because automated ration formulation failed... "
                "Used most recently formulated ration instead.'). "
                "Nenhum valor comparativo entre solvers foi gerado para evitar conclusões incorretas."
            ),
            "linear": None,
            "nonlinear": None,
            "comparison": None,
        }

    nlp_diet = po_data.get("diet", [])
    nlp_kpis = po_data.get("kpis", {})

    n = len(nlp_diet)
    total_dmi_nlp = float(nlp_kpis.get("total_dmi_kg", 0.0) or 0.0)
    cost_nlp = float(nlp_kpis.get("cost_per_cow_day", 0.0) or 0.0)

    if n == 0 or total_dmi_nlp <= 0.0:
        return {
            "success": False,
            "failed_solver": "Não-Linear (NLP / SLSQP)",
            "error_title": "Falha de Convergência do Solver Não-Linear (NLP)",
            "failure_reason": (
                "O modelo Não-Linear (NLP / SLSQP) falhou em formular uma ração viável: "
                "a dieta resultante não possui insumos alocados ou o consumo total de matéria seca é nulo (DMI <= 0). "
                "Nenhum valor comparativo foi calculado."
            ),
            "linear": None,
            "nonlinear": None,
            "comparison": None,
        }

    # Prepara dados para o modelo Linear (LP)
    c = np.array([item["price_per_kg"] for item in nlp_diet], dtype=float)

    # Bounds: [0, max(amount * 1.4, 0.5)]
    bounds = [(0.0, max(float(item["amount_kg"]) * 1.4, 0.5)) for item in nlp_diet]

    A_ub = []
    b_ub = []

    # 1. Limites de Consumo de Matéria Seca (+/- 5%)
    A_ub.append(np.ones(n))
    b_ub.append(total_dmi_nlp * 1.05)

    A_ub.append(-np.ones(n))
    b_ub.append(-total_dmi_nlp * 0.95)

    # 2. Requisito de Forragem mínima (40% da matéria seca)
    forage_flags = np.array([
        1.0 if any(w in item["name"].lower() for w in ["silage", "hay", "legume", "grass", "forage"]) else 0.0
        for item in nlp_diet
    ])
    if np.sum(forage_flags) > 0:
        A_ub.append(-(forage_flags - 0.40))
        b_ub.append(0.0)

    # 3. Concentrado mínimo para atender energia (20% da matéria seca)
    conc_flags = 1.0 - forage_flags
    if np.sum(conc_flags) > 0:
        A_ub.append(-(conc_flags - 0.20))
        b_ub.append(0.0)

    # 2. Execução protegida do Solver Linear (LP / HiGHS Simplex)
    try:
        res_lp = linprog(c, A_ub=np.array(A_ub), b_ub=np.array(b_ub), bounds=bounds, method="highs")
    except Exception as exc:
        return {
            "success": False,
            "failed_solver": "Linear (LP / HiGHS Simplex)",
            "error_title": "Erro na Execução do Solver Linear",
            "failure_reason": f"Ocorreu uma exceção ao executar o solver linear HiGHS: {str(exc)}. Nenhum valor foi calculado.",
            "linear": None,
            "nonlinear": None,
            "comparison": None,
        }

    # Se o solver linear falhar (ex: infactibilidade, estouro de iterações, ilimitado)
    if not res_lp.success:
        status_explanations = {
            1: "Limite de iterações atingido sem convergência para uma solução factível ótima.",
            2: (
                "Infactibilidade matemática (Infeasible): O conjunto de restrições lineares "
                "(limites de MS entre 95% e 105%, mínimo de 40% de forragem e cotas por ingrediente) "
                "é inconsistente com os alimentos disponíveis."
            ),
            3: "Problema ilimitado (Unbounded): A função de custo decresce sem limite inferior.",
            4: "Instabilidade ou dificuldade numérica detectada pelo algoritmo simplex HiGHS.",
        }
        status_desc = status_explanations.get(
            res_lp.status,
            f"Falha de otimização reportada pelo solver HiGHS com código de status {res_lp.status}."
        )
        return {
            "success": False,
            "failed_solver": "Linear (LP / HiGHS Simplex)",
            "error_title": "Falha no Solver Linear (LP / HiGHS)",
            "failure_reason": (
                f"O Solver Linear (LP / HiGHS) não conseguiu resolver a dieta. "
                f"Motivo: {status_desc} "
                f"(Mensagem técnica: '{res_lp.message}'). "
                f"Nenhum valor comparativo foi calculado para evitar resultados incorretos."
            ),
            "status_code": int(res_lp.status),
            "status_message": str(res_lp.message),
            "linear": None,
            "nonlinear": None,
            "comparison": None,
        }

    # 3. Execução do Solver Linear Nativo (Simplex Duas Fases - Pure NumPy)
    native_diet = []
    native_cost_total = lp_cost_total
    native_dmi_total = lp_dmi_total
    native_nit = 0
    try:
        from RUFAS.biophysical.animal.ration.pure_simplex_solver import TwoPhaseSimplexSolver
        var_names = [item["name"] for item in nlp_diet]
        native_solver = TwoPhaseSimplexSolver(tol=1e-8, max_iter=2000)
        res_nat = native_solver.solve(
            c=c,
            A_ub=np.array(A_ub),
            b_ub=np.array(b_ub),
            bounds=bounds,
            var_names=var_names,
        )
        if res_nat["success"] and res_nat.get("x") is not None:
            nat_x = res_nat["x"]
            native_cost_total = float(res_nat["fun"])
            native_dmi_total = float(sum(nat_x))
            native_nit = int(res_nat.get("nit", 0))
            for idx, item in enumerate(nlp_diet):
                amount_nat = float(nat_x[idx])
                cost_nat = amount_nat * item["price_per_kg"]
                native_diet.append({
                    "feed_id": item["feed_id"],
                    "name": item["name"],
                    "amount_kg": round(amount_nat, 3),
                    "price_per_kg": item["price_per_kg"],
                    "cost_per_day": round(cost_nat, 3),
                    "percentage": round(amount_nat / native_dmi_total * 100, 2) if native_dmi_total > 0 else 0.0,
                })
    except Exception as e:
        print(f"[PO Analytics] Aviso ao executar Simplex nativo no comparador: {e}")

    # Ambos os solvers foram bem-sucedidos: calcula os valores reais
    lp_x = res_lp.x
    lp_cost_total = float(res_lp.fun)
    lp_dmi_total = float(sum(lp_x))

    linear_diet = []
    for idx, item in enumerate(nlp_diet):
        amount_lp = float(lp_x[idx])
        cost_lp = amount_lp * item["price_per_kg"]
        linear_diet.append({
            "feed_id": item["feed_id"],
            "name": item["name"],
            "amount_kg": round(amount_lp, 3),
            "price_per_kg": item["price_per_kg"],
            "cost_per_day": round(cost_lp, 3),
            "percentage": round(amount_lp / lp_dmi_total * 100, 2) if lp_dmi_total > 0 else 0.0,
        })

    # Métricas comparativas
    cost_diff = round(lp_cost_total - cost_nlp, 3)
    cost_diff_pct = round((cost_diff / cost_nlp * 100), 2) if cost_nlp > 0 else 0.0

    return {
        "success": True,
        "failed_solver": None,
        "failure_reason": None,
        "nonlinear": {
            "solver_name": "Não-Linear (NLP / SLSQP - SciPy)",
            "description": "Modelo Biofísico com desconto de taxa de passagem e fermentação ruminal dinâmica",
            "cost_per_cow_day": round(cost_nlp, 3),
            "total_dmi_kg": round(total_dmi_nlp, 2),
            "diet": nlp_diet,
        },
        "linear": {
            "solver_name": "Linear (LP / HiGHS Simplex - SciPy)",
            "description": "Modelo Clássico de Programação Linear com coeficientes estáticos (HiGHS C++)",
            "cost_per_cow_day": round(lp_cost_total, 3),
            "total_dmi_kg": round(lp_dmi_total, 2),
            "nit": int(res_lp.nit) if hasattr(res_lp, "nit") else 0,
            "diet": linear_diet,
        },
        "native_simplex": {
            "solver_name": "Linear Nativo (Simplex Duas Fases - Pure NumPy)",
            "description": "Implementação nativa from scratch com rastreamento completo de Tableaus e pivoteamentos",
            "cost_per_cow_day": round(native_cost_total, 3),
            "total_dmi_kg": round(native_dmi_total, 2),
            "nit": native_nit,
            "diet": native_diet if native_diet else linear_diet,
        },
        "comparison": {
            "cost_difference": cost_diff,
            "cost_difference_percent": cost_diff_pct,
            "interpretation": (
                "O modelo Linear (LP HiGHS e Simplex Nativo) atinge solução ótima equivalente de mínimo custo. "
                "O modelo Não-Linear (NLP / SLSQP) avalia a cinética de degradação ruminal mecanística, "
                "refletindo a perda de digestibilidade com o consumo elevado."
            ),
        },
    }


def get_simplex_tableaus_data(base_dir: Path, folder_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Retorna os dados dos tableaus intermediários gerados pelo Solver Simplex Nativo.
    Pode consultar uma pasta arquivada específica ou a última simulação realizada.
    """
    candidates = []
    if folder_name:
        candidates.append(base_dir / "output" / "simulacoes" / folder_name / "resultados" / "tableaus_simplex.json")

    # Arquivo mais recente no diretório output
    candidates.append(base_dir / "output" / "tableaus_simplex_latest.json")

    # Busca na pasta de simulações mais recente
    sim_dirs = sorted(glob.glob(str(base_dir / "output" / "simulacoes" / "*")), key=os.path.getmtime, reverse=True)
    for s_dir in sim_dirs:
        candidates.append(Path(s_dir) / "resultados" / "tableaus_simplex.json")

    for path in candidates:
        if path.exists() and path.is_file():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return data
            except Exception as e:
                print(f"[PO Analytics] Erro ao ler tableaus em {path}: {e}")

    return None

