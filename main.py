"""Entry point for running RuFaS with automatic simulation tracking and archiving."""

import os
import sys
from datetime import datetime
from pathlib import Path
from RUFAS.main import main

BASE_DIR = Path(__file__).resolve().parent

def run() -> None:
    start_time = datetime.now()
    exit_code = 0
    try:
        main()
    except Exception as e:
        exit_code = 1
        raise e
    finally:
        end_time = datetime.now()
        if os.environ.get("RUFAS_SUBPROCESS_TRACKED") != "1":
            try:
                from web_app.simulation_tracker import archive_simulation
                manifest = archive_simulation(
                    base_dir=BASE_DIR,
                    start_time=start_time,
                    end_time=end_time,
                    exit_code=exit_code
                )
                if manifest:
                    print(f"\n[RuFaS Tracker] ✅ Simulação arquivada em: {manifest.get('relative_path')}")
            except Exception as archive_err:
                print(f"\n[RuFaS Tracker] Aviso: Falha ao arquivar simulação: {archive_err}")

if __name__ == "__main__":
    run()

