"""
Pure Simplex Solver - Implementação Nativa do Simplex de Duas Fases
Sem dependência de bibliotecas de otimização externas (apenas NumPy).
Projetado para Pesquisa Operacional e rastreamento passo a passo de Tableaus.
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple
import numpy as np


class TwoPhaseSimplexSolver:
    """
    Solver Linear Simplex de Duas Fases nativo com instrumentação completa de Tableaus.
    
    Resolve o problema canônico:
        min   c^T x
        s.t.  A_ub x <= b_ub
              l_i <= x_i <= u_i,  x >= 0
              
    Registra cada estado do tableau para exibição didática na interface gráfica.
    """

    def __init__(self, tol: float = 1e-8, max_iter: int = 2000):
        self.tol = tol
        self.max_iter = max_iter
        self.history: List[Dict[str, Any]] = []

    def solve(
        self,
        c: Sequence[float] | np.ndarray,
        A_ub: Optional[np.ndarray] = None,
        b_ub: Optional[np.ndarray] = None,
        bounds: Optional[List[Tuple[float, float]]] = None,
        var_names: Optional[List[str]] = None,
        constraint_names: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Executa o método Simplex de Duas Fases registrando o histórico de tableaus.
        """
        self.history = []
        c = np.array(c, dtype=np.float64)
        n = len(c)

        if var_names is None or len(var_names) != n:
            var_names = [f"x_{j+1}" for j in range(n)]

        # 1. Unificar restrições estruturais e limites de variáveis (bounds)
        rows: List[np.ndarray] = []
        rhs: List[float] = []
        is_le: List[bool] = []
        row_labels: List[str] = []

        if A_ub is not None and b_ub is not None:
            A_ub = np.array(A_ub, dtype=np.float64)
            b_ub = np.array(b_ub, dtype=np.float64)
            for i in range(len(b_ub)):
                rows.append(A_ub[i].copy())
                rhs.append(float(b_ub[i]))
                is_le.append(True)
                label = (
                    constraint_names[i]
                    if constraint_names and i < len(constraint_names)
                    else f"Restricao_{i+1}"
                )
                row_labels.append(label)

        # Adicionar bounds como restrições explícitas
        if bounds is not None:
            for j, (lb, ub) in enumerate(bounds):
                vname = var_names[j]
                if lb is not None and lb > 0:
                    r = np.zeros(n, dtype=np.float64)
                    r[j] = 1.0
                    rows.append(r)
                    rhs.append(float(lb))
                    is_le.append(False)  # x_j >= lb
                    row_labels.append(f"Minimo ({vname}) >= {lb:.2f}")
                if ub is not None and ub < np.inf:
                    r = np.zeros(n, dtype=np.float64)
                    r[j] = 1.0
                    rows.append(r)
                    rhs.append(float(ub))
                    is_le.append(True)  # x_j <= ub
                    row_labels.append(f"Maximo ({vname}) <= {ub:.2f}")

        m = len(rows)
        if m == 0:
            return {
                "success": False,
                "status": 2,
                "message": "Nenhuma restrição informada.",
                "x": None,
                "fun": 0.0,
                "nit": 0,
                "tableaus": [],
            }

        # 2. Padronização para forma padrão A_std x = b_std com b_std >= 0
        norm_rows: List[np.ndarray] = []
        norm_rhs: List[float] = []
        norm_is_le: List[bool] = []

        for i in range(m):
            a_row = rows[i].copy()
            b_val = rhs[i]
            le = is_le[i]

            # Inverter se o termo independente for negativo
            if b_val < -self.tol:
                a_row = -a_row
                b_val = -b_val
                le = not le
            elif abs(b_val) <= self.tol:
                b_val = 0.0

            norm_rows.append(a_row)
            norm_rhs.append(b_val)
            norm_is_le.append(le)

        num_slacks = sum(1 for le in norm_is_le if le)
        num_surplus = m - num_slacks
        num_artificial = num_surplus
        total_vars = n + num_slacks + num_surplus + num_artificial

        # Montar nomes de todas as colunas
        slack_names = [f"s_{i+1}" for i in range(num_slacks)]
        surplus_names = [f"e_{i+1}" for i in range(num_surplus)]
        artificial_names = [f"a_{i+1}" for i in range(num_artificial)]
        all_col_names = var_names + slack_names + surplus_names + artificial_names

        A_std = np.zeros((m, total_vars), dtype=np.float64)
        b_std = np.array(norm_rhs, dtype=np.float64)
        basis: List[int] = []
        art_vars: List[int] = []

        curr_s = n
        curr_e = n + num_slacks
        curr_a = n + num_slacks + num_surplus

        for i in range(m):
            A_std[i, :n] = norm_rows[i]
            if norm_is_le[i]:
                A_std[i, curr_s] = 1.0
                basis.append(curr_s)
                curr_s += 1
            else:
                A_std[i, curr_e] = -1.0
                A_std[i, curr_a] = 1.0
                basis.append(curr_a)
                art_vars.append(curr_a)
                curr_e += 1
                curr_a += 1

        total_nit = 0

        # =========================================================
        # FASE 1: Eliminação de Variáveis Artificiais (min W = sum(a_k))
        # =========================================================
        if num_artificial > 0:
            tableau_p1 = np.zeros((m + 1, total_vars + 1), dtype=np.float64)
            tableau_p1[:m, :total_vars] = A_std
            tableau_p1[:m, -1] = b_std

            # Ajustar linha de custo da Fase 1 para estar na forma canônica
            # Inicialmente c_p1 = 1 para artificiais e 0 para as outras
            # Subtrai das linhas que possuem variáveis artificiais na base
            for i, basic_var in enumerate(basis):
                if basic_var in art_vars:
                    tableau_p1[-1, :total_vars] -= tableau_p1[i, :total_vars]
                    tableau_p1[-1, -1] -= tableau_p1[i, -1]

            # Registrar o Tableau Inicial da Fase 1
            self._record_snapshot(
                tableau=tableau_p1,
                basis=basis,
                col_names=all_col_names,
                row_labels=row_labels,
                phase=1,
                iteration=0,
                description="Tableau Inicial da Fase 1: Formulado para encontrar uma Solução Básica Viável (min W = soma das variáveis artificiais).",
            )

            success_p1, nit_p1 = self._simplex_loop(
                tableau_p1, basis, total_vars, all_col_names, row_labels, phase=1, base_nit=0
            )
            total_nit += nit_p1

            residual_w = abs(-tableau_p1[-1, -1])
            if not success_p1 or residual_w > 1e-4:
                return {
                    "success": False,
                    "status": 2,
                    "message": f"Problema inviável (Infeasible). Violação residual das restrições: {residual_w:.6f}",
                    "x": None,
                    "fun": 0.0,
                    "nit": total_nit,
                    "tableaus": self.history,
                }

            # Se alguma artificial ainda está na base com valor zero, retirá-la por pivoteamento
            for i in range(m):
                if basis[i] in art_vars:
                    for j in range(curr_a - num_artificial):
                        if abs(tableau_p1[i, j]) > self.tol:
                            self._pivot(tableau_p1, basis, i, j)
                            break

            # Remover colunas artificiais para a Fase 2
            non_art_cols = list(range(curr_a - num_artificial)) + [-1]
            tableau_phase2 = tableau_p1[:m, non_art_cols]
            total_vars_p2 = curr_a - num_artificial
            col_names_p2 = var_names + slack_names + surplus_names
        else:
            tableau_phase2 = np.zeros((m, total_vars + 1), dtype=np.float64)
            tableau_phase2[:m, :total_vars] = A_std
            tableau_phase2[:m, -1] = b_std
            total_vars_p2 = total_vars
            col_names_p2 = all_col_names

        # =========================================================
        # FASE 2: Minimização do Custo Real da Ração (c^T x)
        # =========================================================
        final_tableau = np.zeros((m + 1, total_vars_p2 + 1), dtype=np.float64)
        final_tableau[:m, :] = tableau_phase2

        c_p2 = np.zeros(total_vars_p2, dtype=np.float64)
        c_p2[:n] = c

        # Linha de custos reduzidos: c_j - sum(c_B * y_j)
        final_tableau[-1, :total_vars_p2] = c_p2
        for i, basic_var in enumerate(basis):
            cb = c_p2[basic_var]
            if abs(cb) > 1e-12:
                final_tableau[-1, :] -= cb * final_tableau[i, :]

        # Registrar Tableau Inicial da Fase 2
        self._record_snapshot(
            tableau=final_tableau,
            basis=basis,
            col_names=col_names_p2,
            row_labels=row_labels,
            phase=2,
            iteration=total_nit,
            description="Tableau Inicial da Fase 2: Ponto viável encontrado com sucesso. Início da otimização do custo econômico real da dieta.",
        )

        success_p2, nit_p2 = self._simplex_loop(
            final_tableau, basis, total_vars_p2, col_names_p2, row_labels, phase=2, base_nit=total_nit
        )
        total_nit += nit_p2

        if not success_p2:
            return {
                "success": False,
                "status": 1,
                "message": "Simplex Fase 2 não convergiu dentro do limite de iterações.",
                "x": None,
                "fun": 0.0,
                "nit": total_nit,
                "tableaus": self.history,
            }

        # Extração da Solução Ótima
        x_full = np.zeros(total_vars_p2, dtype=np.float64)
        for i, basic_var in enumerate(basis):
            if basic_var < total_vars_p2:
                x_full[basic_var] = max(0.0, final_tableau[i, -1])

        x_opt = x_full[:n]
        fun_val = float(np.dot(c, x_opt))

        # Registrar o Tableau Final da Solução Ótima
        self._record_snapshot(
            tableau=final_tableau,
            basis=basis,
            col_names=col_names_p2,
            row_labels=row_labels,
            phase=2,
            iteration=total_nit,
            description=f"Solução Ótima Convergida: Custo diário mínimo = ${fun_val:.4f}/vaca/dia. Todos os custos reduzidos são >= 0.",
            is_final=True,
        )

        return {
            "success": True,
            "status": 0,
            "x": x_opt,
            "fun": fun_val,
            "nit": total_nit,
            "message": "Otimização concluída com sucesso via Simplex de Duas Fases nativo.",
            "tableaus": self.history,
        }

    def _simplex_loop(
        self,
        tableau: np.ndarray,
        basis: List[int],
        num_vars: int,
        col_names: List[str],
        row_labels: List[str],
        phase: int,
        base_nit: int,
    ) -> Tuple[bool, int]:
        m = len(basis)
        nit = 0

        while nit < self.max_iter:
            # 1. Verificar otimalidade: custos reduzidos
            reduced_costs = tableau[-1, :num_vars]
            min_rc = float(np.min(reduced_costs))

            if min_rc >= -self.tol:
                return True, nit  # Condição de otimalidade atingida

            # Variável que entra na base: coluna com custo reduzido mais negativo
            pivot_col = int(np.argmin(reduced_costs))
            entering_name = col_names[pivot_col]

            # 2. Teste da Razão Mínima para variável que sai da base
            col_vals = tableau[:m, pivot_col]
            rhs_vals = tableau[:m, -1]
            strictly_pos = col_vals > self.tol

            if not np.any(strictly_pos):
                return False, nit  # Problema ilimitado (unbounded)

            ratios = np.full(m, np.inf, dtype=np.float64)
            ratios[strictly_pos] = rhs_vals[strictly_pos] / col_vals[strictly_pos]

            pivot_row = int(np.argmin(ratios))
            leaving_var_idx = basis[pivot_row]
            leaving_name = col_names[leaving_var_idx]
            min_ratio = float(ratios[pivot_row])
            pivot_val = float(tableau[pivot_row, pivot_col])

            nit += 1
            curr_iteration = base_nit + nit

            desc = (
                f"Iteração {curr_iteration} (Fase {phase}): A variável '{entering_name}' entra na base "
                f"(menor custo reduzido = {min_rc:.4f}) substituindo '{leaving_name}' "
                f"(razão mínima = {min_ratio:.4f}). Elemento pivô = {pivot_val:.4f}."
            )

            # Gravar o snapshot com a indicação de quem entra, quem sai e do pivô
            self._record_snapshot(
                tableau=tableau,
                basis=basis,
                col_names=col_names,
                row_labels=row_labels,
                phase=phase,
                iteration=curr_iteration,
                pivot_row=pivot_row,
                pivot_col=pivot_col,
                pivot_val=pivot_val,
                entering_var=entering_name,
                leaving_var=leaving_name,
                ratios=ratios.tolist(),
                description=desc,
            )

            # 3. Pivoteamento de Gauss-Jordan
            self._pivot(tableau, basis, pivot_row, pivot_col)

        return False, nit

    def _pivot(self, tableau: np.ndarray, basis: List[int], pivot_row: int, pivot_col: int):
        pivot_val = tableau[pivot_row, pivot_col]
        tableau[pivot_row, :] /= pivot_val
        for i in range(tableau.shape[0]):
            if i != pivot_row:
                factor = tableau[i, pivot_col]
                if abs(factor) > 1e-15:
                    tableau[i, :] -= factor * tableau[pivot_row, :]
        basis[pivot_row] = pivot_col

    def _record_snapshot(
        self,
        tableau: np.ndarray,
        basis: List[int],
        col_names: List[str],
        row_labels: List[str],
        phase: int,
        iteration: int,
        pivot_row: Optional[int] = None,
        pivot_col: Optional[int] = None,
        pivot_val: Optional[float] = None,
        entering_var: Optional[str] = None,
        leaving_var: Optional[str] = None,
        ratios: Optional[List[float]] = None,
        description: str = "",
        is_final: bool = False,
    ):
        """Registra o estado completo do tableau em formato serializável para JSON."""
        m = len(basis)
        n_cols = len(col_names)

        # Montar linhas de matriz com dados arredondados para clareza visual
        matrix_rows = []
        for i in range(m):
            row_vals = [round(float(v), 4) for v in tableau[i, :n_cols]]
            rhs_val = round(float(tableau[i, -1]), 4)
            matrix_rows.append({
                "row_index": i,
                "label": row_labels[i] if i < len(row_labels) else f"Linha_{i+1}",
                "basic_var": col_names[basis[i]] if basis[i] < len(col_names) else f"Var_{basis[i]}",
                "coefficients": row_vals,
                "rhs": rhs_val,
                "ratio": round(float(ratios[i]), 4) if ratios and ratios[i] != np.inf else None,
            })

        # Linha inferior de Custos Reduzidos / Função Objetivo
        reduced_costs = [round(float(v), 4) for v in tableau[-1, :n_cols]]
        obj_value = round(float(-tableau[-1, -1] if phase == 1 else tableau[-1, -1]), 4)

        snapshot = {
            "iteration": iteration,
            "phase": phase,
            "phase_name": "Fase 1: Viabilidade (min W)" if phase == 1 else "Fase 2: Otimização de Custo (min Z)",
            "is_final": is_final,
            "col_names": col_names,
            "matrix_rows": matrix_rows,
            "reduced_costs": reduced_costs,
            "objective_value": obj_value,
            "pivot_row": pivot_row,
            "pivot_col": pivot_col,
            "pivot_val": round(float(pivot_val), 4) if pivot_val is not None else None,
            "entering_var": entering_var,
            "leaving_var": leaving_var,
            "description": description,
        }
        self.history.append(snapshot)

    def save_tableaus_json(self, target_path: Path | str):
        """Salva todo o histórico de tableaus em um arquivo JSON formatado."""
        target_path = Path(target_path)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        with open(target_path, "w", encoding="utf-8") as f:
            json.dump(self.history, f, indent=2, ensure_ascii=False)
