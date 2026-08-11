import json
import queue
import subprocess
import sys
import threading
import tkinter as tk
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk

from subir_google_drive import (
    alterar_status_setor,
    carregar_controle_setores,
    listar_setores_base,
)


PASTA_PROJETO = Path(__file__).resolve().parent
SCRIPT_PUBLICACAO = PASTA_PROJETO / "subir_google_drive.py"
EXCEL_PADRAO = PASTA_PROJETO / "data" / "REVISITAS_CENSO.xlsx"
BASE_ACUMULADA = PASTA_PROJETO / "data" / "BASE_ACUMULADA.xlsx"
VERSAO_LOCAL = PASTA_PROJETO / "data" / "versao.json"

CORES = {
    "fundo": "#F3F6FC",
    "painel": "#FFFFFF",
    "lateral": "#111936",
    "lateral_hover": "#1D2854",
    "primaria": "#4657C8",
    "primaria_hover": "#3746A8",
    "texto": "#17203A",
    "texto_secundario": "#66708A",
    "borda": "#DDE3EF",
    "verde": "#178557",
    "verde_fundo": "#E9F8F1",
    "amarelo": "#A86606",
    "amarelo_fundo": "#FFF4D8",
    "vermelho": "#C33A43",
    "vermelho_fundo": "#FDECEF",
    "azul_fundo": "#EEF1FF",
}


def formatar_data(valor):
    if not valor:
        return "—"
    try:
        return datetime.fromisoformat(valor).strftime("%d/%m/%Y %H:%M")
    except (TypeError, ValueError):
        return str(valor)


class PublicadorDeep(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Publicador DEEP")
        self.geometry("1180x760")
        self.minsize(980, 650)
        self.configure(bg=CORES["fundo"])

        self.fila = queue.Queue()
        self.processo = None
        self.setores_cache = []
        self.dados_setor_por_item = {}
        self.pagina_atual = None
        self.botoes_navegacao = {}
        self.botoes_acao = []

        self.arquivo = tk.StringVar(value=str(EXCEL_PADRAO))
        self.status = tk.StringVar(value="Pronto para uma nova operação.")
        self.busca_setor = tk.StringVar()
        self.filtro_status = tk.StringVar(value="Todos")
        self.resumo_setores = tk.StringVar(value="Carregue os setores para consultar.")
        self.indicador_versao = tk.StringVar(value="—")
        self.indicador_registros = tk.StringVar(value="—")
        self.indicador_fotos = tk.StringVar(value="—")
        self.indicador_finalizados = tk.StringVar(value="—")

        self._configurar_estilos()
        self._montar_interface()
        self._atualizar_indicadores()
        self._mostrar_pagina("publicacao")
        self.after(100, self._ler_fila)

    def _configurar_estilos(self):
        estilo = ttk.Style(self)
        estilo.theme_use("clam")
        estilo.configure(
            "Deep.Treeview",
            background=CORES["painel"],
            fieldbackground=CORES["painel"],
            foreground=CORES["texto"],
            borderwidth=0,
            rowheight=34,
            font=("Segoe UI", 10),
        )
        estilo.configure(
            "Deep.Treeview.Heading",
            background="#E9EDF6",
            foreground="#424D68",
            relief="flat",
            borderwidth=0,
            font=("Segoe UI Semibold", 9),
            padding=(8, 9),
        )
        estilo.map("Deep.Treeview", background=[("selected", "#DDE3FF")], foreground=[("selected", CORES["texto"])])
        estilo.map("Deep.Treeview.Heading", background=[("active", "#E1E6F1")])
        estilo.configure(
            "Deep.TCombobox",
            fieldbackground=CORES["painel"],
            background=CORES["painel"],
            foreground=CORES["texto"],
            bordercolor=CORES["borda"],
            lightcolor=CORES["borda"],
            darkcolor=CORES["borda"],
            padding=8,
        )
        estilo.configure(
            "Deep.Horizontal.TProgressbar",
            troughcolor="#E5E9F3",
            background=CORES["primaria"],
            borderwidth=0,
            lightcolor=CORES["primaria"],
            darkcolor=CORES["primaria"],
        )

    def _montar_interface(self):
        self.sidebar = tk.Frame(self, bg=CORES["lateral"], width=220)
        self.sidebar.pack(side="left", fill="y")
        self.sidebar.pack_propagate(False)

        marca = tk.Frame(self.sidebar, bg=CORES["lateral"])
        marca.pack(fill="x", padx=22, pady=(26, 28))
        tk.Label(marca, text="DEEP", bg=CORES["lateral"], fg="#FFFFFF", font=("Segoe UI Semibold", 22)).pack(anchor="w")
        tk.Label(
            marca, text="PUBLICADOR DE DADOS", bg=CORES["lateral"], fg="#9CA7D3",
            font=("Segoe UI Semibold", 8),
        ).pack(anchor="w", pady=(1, 0))

        itens = [
            ("publicacao", "Publicação", "01"),
            ("setores", "Setores", "02"),
            ("historico", "Histórico", "03"),
        ]
        for chave, texto, numero in itens:
            botao = tk.Button(
                self.sidebar,
                text=f"  {numero}    {texto}",
                command=lambda pagina=chave: self._mostrar_pagina(pagina),
                anchor="w",
                bg=CORES["lateral"], fg="#C6CDE8", activebackground=CORES["lateral_hover"],
                activeforeground="#FFFFFF", relief="flat", borderwidth=0,
                font=("Segoe UI Semibold", 10), padx=14, pady=13, cursor="hand2",
            )
            botao.pack(fill="x", padx=12, pady=2)
            self.botoes_navegacao[chave] = botao

        rodape = tk.Frame(self.sidebar, bg=CORES["lateral"])
        rodape.pack(side="bottom", fill="x", padx=22, pady=22)
        tk.Label(rodape, text="BANCO OFFLINE", bg=CORES["lateral"], fg="#7783B4", font=("Segoe UI", 8)).pack(anchor="w")
        tk.Label(rodape, text="S3 + SQLite", bg=CORES["lateral"], fg="#C6CDE8", font=("Segoe UI Semibold", 10)).pack(anchor="w")

        self.area_principal = tk.Frame(self, bg=CORES["fundo"])
        self.area_principal.pack(side="left", fill="both", expand=True)

        self.faixa_status = tk.Frame(self.area_principal, bg=CORES["painel"], height=44)
        self.faixa_status.pack(side="bottom", fill="x")
        self.faixa_status.pack_propagate(False)
        self.status_ponto = tk.Label(self.faixa_status, text="●", bg=CORES["painel"], fg=CORES["verde"], font=("Segoe UI", 12))
        self.status_ponto.pack(side="left", padx=(22, 7))
        tk.Label(
            self.faixa_status, textvariable=self.status, bg=CORES["painel"], fg=CORES["texto_secundario"],
            font=("Segoe UI", 9),
        ).pack(side="left")
        self.progresso = ttk.Progressbar(
            self.faixa_status, mode="indeterminate", length=150, style="Deep.Horizontal.TProgressbar"
        )
        self.progresso.pack(side="right", padx=22, pady=14)

        self.container_paginas = tk.Frame(self.area_principal, bg=CORES["fundo"])
        self.container_paginas.pack(fill="both", expand=True)
        self.paginas = {
            "publicacao": self._criar_pagina_publicacao(),
            "setores": self._criar_pagina_setores(),
            "historico": self._criar_pagina_historico(),
        }

    def _cabecalho(self, pai, titulo, subtitulo):
        cabecalho = tk.Frame(pai, bg=CORES["fundo"])
        cabecalho.pack(fill="x", pady=(0, 18))
        tk.Label(cabecalho, text=titulo, bg=CORES["fundo"], fg=CORES["texto"], font=("Segoe UI Semibold", 22)).pack(anchor="w")
        tk.Label(
            cabecalho, text=subtitulo, bg=CORES["fundo"], fg=CORES["texto_secundario"],
            font=("Segoe UI", 10),
        ).pack(anchor="w", pady=(3, 0))

    def _cartao(self, pai, titulo=None):
        cartao = tk.Frame(pai, bg=CORES["painel"], highlightbackground=CORES["borda"], highlightthickness=1)
        if titulo:
            tk.Label(
                cartao, text=titulo.upper(), bg=CORES["painel"], fg=CORES["texto_secundario"],
                font=("Segoe UI Semibold", 8),
            ).pack(anchor="w", padx=18, pady=(15, 0))
        return cartao

    def _botao(self, pai, texto, comando, tipo="primario", largura=None):
        configuracoes = {
            "primario": (CORES["primaria"], "#FFFFFF", CORES["primaria_hover"]),
            "secundario": (CORES["painel"], CORES["texto"], "#E9EDF7"),
            "aviso": (CORES["amarelo_fundo"], CORES["amarelo"], "#FDE9B4"),
            "perigo": (CORES["vermelho_fundo"], CORES["vermelho"], "#F8D9DE"),
            "sucesso": (CORES["verde_fundo"], CORES["verde"], "#D8F1E5"),
        }
        fundo, frente, ativo = configuracoes[tipo]
        botao = tk.Button(
            pai, text=texto, command=comando, bg=fundo, fg=frente,
            activebackground=ativo, activeforeground=frente, relief="flat", borderwidth=0,
            highlightbackground=CORES["borda"], highlightthickness=1 if tipo == "secundario" else 0,
            font=("Segoe UI Semibold", 9), padx=16, pady=10, cursor="hand2",
        )
        if largura:
            botao.configure(width=largura)
        return botao

    def _criar_pagina_publicacao(self):
        pagina = tk.Frame(self.container_paginas, bg=CORES["fundo"])
        conteudo = tk.Frame(pagina, bg=CORES["fundo"])
        conteudo.pack(fill="both", expand=True, padx=28, pady=24)
        self._cabecalho(conteudo, "Central de publicação", "Valide, revise e publique a base usada pelos celulares.")

        indicadores = tk.Frame(conteudo, bg=CORES["fundo"])
        indicadores.pack(fill="x", pady=(0, 16))
        indicadores.grid_columnconfigure((0, 1, 2, 3), weight=1, uniform="indicadores")
        dados = [
            ("VERSÃO PUBLICADA", self.indicador_versao, CORES["primaria"]),
            ("REGISTROS NO BANCO", self.indicador_registros, CORES["verde"]),
            ("LINKS DE FOTOS", self.indicador_fotos, "#2581A8"),
            ("SETORES FINALIZADOS", self.indicador_finalizados, CORES["amarelo"]),
        ]
        for coluna, (titulo, variavel, cor) in enumerate(dados):
            cartao = self._cartao(indicadores)
            cartao.grid(row=0, column=coluna, sticky="nsew", padx=(0 if coluna == 0 else 6, 0 if coluna == 3 else 6))
            tk.Frame(cartao, bg=cor, height=4).pack(fill="x")
            tk.Label(cartao, text=titulo, bg=CORES["painel"], fg=CORES["texto_secundario"], font=("Segoe UI Semibold", 8)).pack(anchor="w", padx=16, pady=(12, 2))
            tk.Label(cartao, textvariable=variavel, bg=CORES["painel"], fg=CORES["texto"], font=("Segoe UI Semibold", 20)).pack(anchor="w", padx=16, pady=(0, 14))

        entrada = self._cartao(conteudo, "1. Selecione o Excel recebido")
        entrada.pack(fill="x", pady=(0, 12))
        linha = tk.Frame(entrada, bg=CORES["painel"])
        linha.pack(fill="x", padx=18, pady=(10, 18))
        campo = tk.Entry(
            linha, textvariable=self.arquivo, bg="#F8FAFD", fg=CORES["texto"],
            insertbackground=CORES["texto"], relief="flat", highlightbackground=CORES["borda"],
            highlightcolor=CORES["primaria"], highlightthickness=1, font=("Segoe UI", 9),
        )
        campo.pack(side="left", fill="x", expand=True, ipady=10)
        self.botao_escolher = self._botao(linha, "Escolher Excel", self._escolher_excel, "secundario")
        self.botao_escolher.pack(side="left", padx=(10, 0))

        acoes = self._cartao(conteudo, "2. Valide e publique")
        acoes.pack(fill="x", pady=(0, 12))
        linha_acoes = tk.Frame(acoes, bg=CORES["painel"])
        linha_acoes.pack(fill="x", padx=18, pady=(10, 18))
        self.botao_validar = self._botao(
            linha_acoes, "Validar somente", lambda: self._iniciar(validar_apenas=True), "secundario"
        )
        self.botao_validar.pack(side="left")
        self.botao_publicar = self._botao(
            linha_acoes, "Adicionar e publicar", lambda: self._iniciar(validar_apenas=False), "primario"
        )
        self.botao_publicar.pack(side="left", padx=(10, 0))
        self.botao_republicar = self._botao(
            linha_acoes, "Republicar base atual", lambda: self._iniciar(False, republicar_base=True), "aviso"
        )
        self.botao_republicar.pack(side="right")
        self.botoes_acao.extend([self.botao_escolher, self.botao_validar, self.botao_publicar, self.botao_republicar])

        log_cartao = self._cartao(conteudo, "Acompanhamento")
        log_cartao.pack(fill="both", expand=True)
        quadro_log = tk.Frame(log_cartao, bg=CORES["painel"])
        quadro_log.pack(fill="both", expand=True, padx=18, pady=(10, 18))
        self.log = tk.Text(
            quadro_log, wrap="word", state="disabled", font=("Cascadia Mono", 9),
            bg="#11172A", fg="#DCE3F7", insertbackground="#FFFFFF", relief="flat",
            borderwidth=0, padx=14, pady=12, height=9,
        )
        self.log.tag_configure("sucesso", foreground="#72D6A5")
        self.log.tag_configure("aviso", foreground="#F5C568")
        self.log.tag_configure("erro", foreground="#FF8D98")
        self.log.tag_configure("normal", foreground="#DCE3F7")
        barra = ttk.Scrollbar(quadro_log, orient="vertical", command=self.log.yview)
        self.log.configure(yscrollcommand=barra.set)
        self.log.pack(side="left", fill="both", expand=True)
        barra.pack(side="right", fill="y")
        return pagina

    def _criar_pagina_setores(self):
        pagina = tk.Frame(self.container_paginas, bg=CORES["fundo"])
        conteudo = tk.Frame(pagina, bg=CORES["fundo"])
        conteudo.pack(fill="both", expand=True, padx=28, pady=24)
        self._cabecalho(conteudo, "Controle de setores", "Finalize ou reative setores sem apagar o histórico acumulado.")

        filtros = self._cartao(conteudo)
        filtros.pack(fill="x", pady=(0, 12))
        linha = tk.Frame(filtros, bg=CORES["painel"])
        linha.pack(fill="x", padx=16, pady=14)
        tk.Label(linha, text="Buscar", bg=CORES["painel"], fg=CORES["texto_secundario"], font=("Segoe UI", 9)).pack(side="left")
        busca = tk.Entry(
            linha, textvariable=self.busca_setor, bg="#F8FAFD", fg=CORES["texto"], relief="flat",
            highlightbackground=CORES["borda"], highlightcolor=CORES["primaria"], highlightthickness=1,
            font=("Segoe UI", 9), width=28,
        )
        busca.pack(side="left", padx=(8, 18), ipady=7)
        tk.Label(linha, text="Status", bg=CORES["painel"], fg=CORES["texto_secundario"], font=("Segoe UI", 9)).pack(side="left")
        combo = ttk.Combobox(
            linha, textvariable=self.filtro_status, values=("Todos", "Ativos", "Finalizados"),
            state="readonly", width=14, style="Deep.TCombobox",
        )
        combo.pack(side="left", padx=(8, 0))
        self.botao_atualizar_setores = self._botao(linha, "Atualizar lista", self._carregar_setores_async, "secundario")
        self.botao_atualizar_setores.pack(side="right")
        self.botoes_acao.append(self.botao_atualizar_setores)

        tabela_cartao = self._cartao(conteudo)
        tabela_cartao.pack(fill="both", expand=True)
        quadro = tk.Frame(tabela_cartao, bg=CORES["painel"])
        quadro.pack(fill="both", expand=True, padx=14, pady=14)
        colunas = ("setor", "status", "registros", "alterado", "responsavel")
        self.arvore_setores = ttk.Treeview(
            quadro, columns=colunas, show="headings", selectmode="browse", style="Deep.Treeview"
        )
        titulos = {
            "setor": "MUNICÍPIO / SETOR", "status": "STATUS", "registros": "REGISTROS",
            "alterado": "ÚLTIMA ALTERAÇÃO", "responsavel": "RESPONSÁVEL",
        }
        larguras = {"setor": 310, "status": 105, "registros": 85, "alterado": 150, "responsavel": 145}
        for coluna in colunas:
            self.arvore_setores.heading(coluna, text=titulos[coluna])
            self.arvore_setores.column(coluna, width=larguras[coluna], anchor="w")
        self.arvore_setores.tag_configure("finalizado", foreground=CORES["vermelho"])
        self.arvore_setores.tag_configure("ativo", foreground=CORES["texto"])
        barra = ttk.Scrollbar(quadro, orient="vertical", command=self.arvore_setores.yview)
        self.arvore_setores.configure(yscrollcommand=barra.set)
        self.arvore_setores.pack(side="left", fill="both", expand=True)
        barra.pack(side="right", fill="y")

        rodape = tk.Frame(conteudo, bg=CORES["fundo"])
        rodape.pack(fill="x", pady=(12, 0))
        tk.Label(
            rodape, textvariable=self.resumo_setores, bg=CORES["fundo"], fg=CORES["texto_secundario"],
            font=("Segoe UI", 9),
        ).pack(side="left")
        self.botao_finalizar = self._botao(rodape, "Finalizar setor", lambda: self._alterar_setor("finalizado"), "perigo")
        self.botao_finalizar.pack(side="right")
        self.botao_reativar = self._botao(rodape, "Reativar setor", lambda: self._alterar_setor("ativo"), "sucesso")
        self.botao_reativar.pack(side="right", padx=(0, 8))
        self.botoes_acao.extend([self.botao_finalizar, self.botao_reativar])
        self.busca_setor.trace_add("write", lambda *_: self._renderizar_setores())
        combo.bind("<<ComboboxSelected>>", lambda _evento: self._renderizar_setores())
        return pagina

    def _criar_pagina_historico(self):
        pagina = tk.Frame(self.container_paginas, bg=CORES["fundo"])
        conteudo = tk.Frame(pagina, bg=CORES["fundo"])
        conteudo.pack(fill="both", expand=True, padx=28, pady=24)
        self._cabecalho(conteudo, "Histórico de setores", "Registro auditável de finalizações e reativações.")

        tabela_cartao = self._cartao(conteudo)
        tabela_cartao.pack(fill="both", expand=True)
        quadro = tk.Frame(tabela_cartao, bg=CORES["painel"])
        quadro.pack(fill="both", expand=True, padx=14, pady=14)
        colunas = ("data", "setor", "acao", "responsavel", "observacao")
        self.arvore_historico = ttk.Treeview(
            quadro, columns=colunas, show="headings", selectmode="browse", style="Deep.Treeview"
        )
        titulos = {
            "data": "DATA", "setor": "MUNICÍPIO / SETOR", "acao": "AÇÃO",
            "responsavel": "RESPONSÁVEL", "observacao": "OBSERVAÇÃO",
        }
        larguras = {"data": 150, "setor": 260, "acao": 105, "responsavel": 130, "observacao": 260}
        for coluna in colunas:
            self.arvore_historico.heading(coluna, text=titulos[coluna])
            self.arvore_historico.column(coluna, width=larguras[coluna], anchor="w")
        barra = ttk.Scrollbar(quadro, orient="vertical", command=self.arvore_historico.yview)
        self.arvore_historico.configure(yscrollcommand=barra.set)
        self.arvore_historico.pack(side="left", fill="both", expand=True)
        barra.pack(side="right", fill="y")
        rodape = tk.Frame(conteudo, bg=CORES["fundo"])
        rodape.pack(fill="x", pady=(12, 0))
        tk.Label(
            rodape, text="O histórico não é apagado quando um setor é reativado.",
            bg=CORES["fundo"], fg=CORES["texto_secundario"], font=("Segoe UI", 9),
        ).pack(side="left")
        self._botao(rodape, "Atualizar histórico", self._renderizar_historico, "secundario").pack(side="right")
        return pagina

    def _mostrar_pagina(self, nome):
        if self.pagina_atual:
            self.paginas[self.pagina_atual].pack_forget()
        self.paginas[nome].pack(fill="both", expand=True)
        self.pagina_atual = nome
        for chave, botao in self.botoes_navegacao.items():
            selecionado = chave == nome
            botao.configure(
                bg=CORES["lateral_hover"] if selecionado else CORES["lateral"],
                fg="#FFFFFF" if selecionado else "#C6CDE8",
            )
        if nome == "setores" and not self.setores_cache:
            self._carregar_setores_async()
        elif nome == "historico":
            self._renderizar_historico()

    def _atualizar_indicadores(self):
        try:
            manifesto = json.loads(VERSAO_LOCAL.read_text(encoding="utf-8")) if VERSAO_LOCAL.exists() else {}
        except (OSError, json.JSONDecodeError):
            manifesto = {}
        try:
            controle = carregar_controle_setores()
            finalizados = sum(1 for item in controle["setores"].values() if item.get("status") == "finalizado")
        except Exception:
            finalizados = 0
        self.indicador_versao.set(str(manifesto.get("versao", "—")))
        self.indicador_registros.set(f"{manifesto.get('totalRegistros', 0):,}".replace(",", "."))
        self.indicador_fotos.set(f"{manifesto.get('totalFotos', 0):,}".replace(",", "."))
        self.indicador_finalizados.set(str(finalizados))

    def _escolher_excel(self):
        atual = Path(self.arquivo.get().strip()).expanduser()
        caminho = filedialog.askopenfilename(
            title="Selecione o Excel recebido",
            initialdir=str(atual.parent if atual.parent.exists() else PASTA_PROJETO),
            filetypes=[("Planilhas Excel", "*.xlsx *.xls"), ("Todos os arquivos", "*.*")],
        )
        if caminho:
            self.arquivo.set(caminho)
            self._definir_status("Arquivo selecionado. Execute a validação antes de publicar.", "normal")

    def _iniciar(self, validar_apenas, republicar_base=False):
        caminho = BASE_ACUMULADA if republicar_base else Path(self.arquivo.get().strip()).expanduser()
        if not caminho.is_file():
            messagebox.showerror("Arquivo não encontrado", "Selecione um arquivo Excel existente.", parent=self)
            return
        mensagem = (
            "A base completa será republicada aplicando o controle atual de setores. "
            "As fotos no S3 não serão alteradas. Continuar?"
            if republicar_base else
            "Os registros novos serão adicionados à base acumulada. Nada antigo será apagado. Continuar?"
        )
        if not validar_apenas and not messagebox.askyesno("Confirmar publicação", mensagem, parent=self):
            return

        self._mostrar_pagina("publicacao")
        self._alternar_acoes(False)
        self._limpar_log()
        self._definir_status("Validando dados..." if validar_apenas else "Validando e publicando...", "processando")
        argumentos = [sys.executable, "-u", str(SCRIPT_PUBLICACAO), str(caminho)]
        if not republicar_base:
            argumentos.append("--incremental")
        if validar_apenas:
            argumentos.append("--validar-apenas")
        threading.Thread(target=self._executar, args=(argumentos,), daemon=True).start()

    def _executar(self, argumentos):
        try:
            self.processo = subprocess.Popen(
                argumentos, cwd=str(PASTA_PROJETO), stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
            )
            assert self.processo.stdout is not None
            for linha in self.processo.stdout:
                self.fila.put(("log", linha))
            self.fila.put(("fim", self.processo.wait()))
        except Exception as erro:
            self.fila.put(("log", f"\nErro ao iniciar o publicador: {erro}\n"))
            self.fila.put(("fim", 1))

    def _carregar_setores_async(self):
        if self.processo:
            return
        self.resumo_setores.set("Carregando setores da base acumulada...")
        self._definir_status("Lendo setores da base acumulada...", "processando")
        self.botao_atualizar_setores.configure(state="disabled")

        def carregar():
            try:
                self.fila.put(("setores", listar_setores_base()))
            except Exception as erro:
                self.fila.put(("erro_setores", str(erro)))

        threading.Thread(target=carregar, daemon=True).start()

    def _renderizar_setores(self):
        if not hasattr(self, "arvore_setores"):
            return
        for item in self.arvore_setores.get_children():
            self.arvore_setores.delete(item)
        self.dados_setor_por_item.clear()
        termo = self.busca_setor.get().strip().casefold()
        filtro = self.filtro_status.get()
        exibidos = 0
        for setor in self.setores_cache:
            if termo and termo not in setor["setor"].casefold():
                continue
            if filtro == "Ativos" and setor["status"] != "ativo":
                continue
            if filtro == "Finalizados" and setor["status"] != "finalizado":
                continue
            item = self.arvore_setores.insert(
                "", "end",
                values=(
                    setor["setor"], setor["status"].upper(), setor["registros"],
                    formatar_data(setor["alteradoEm"]), setor["responsavel"] or "—",
                ),
                tags=(setor["status"],),
            )
            self.dados_setor_por_item[item] = setor
            exibidos += 1
        ativos = sum(1 for item in self.setores_cache if item["status"] == "ativo")
        finalizados = len(self.setores_cache) - ativos
        self.resumo_setores.set(
            f"Exibindo {exibidos} de {len(self.setores_cache)} setores  •  {ativos} ativos  •  {finalizados} finalizados"
        )

    def _alterar_setor(self, status):
        selecao = self.arvore_setores.selection()
        if not selecao:
            messagebox.showwarning("Selecione um setor", "Selecione um setor na tabela.", parent=self)
            return
        setor = self.dados_setor_por_item[selecao[0]]
        if not setor.get("gerenciavel", True):
            messagebox.showwarning("Setor não identificado", "Este item não possui um setor válido.", parent=self)
            return
        if setor["status"] == status:
            messagebox.showinfo("Sem alteração", f"O setor já está {status}.", parent=self)
            return
        verbo = "finalizar" if status == "finalizado" else "reativar"
        if not messagebox.askyesno(
            f"Confirmar {verbo}",
            f"{setor['setor']} possui {setor['registros']} registros. Deseja {verbo} este setor?",
            parent=self,
        ):
            return
        responsavel = simpledialog.askstring(
            "Responsável", "Quem solicitou ou confirmou esta alteração?", parent=self
        )
        if not responsavel or not responsavel.strip():
            return
        observacao = simpledialog.askstring(
            "Observação", "Observação ou motivo (opcional):", parent=self
        ) or ""
        try:
            alterar_status_setor(setor["setor"], status, responsavel, observacao)
            self._atualizar_indicadores()
            self._renderizar_historico()
            self.setores_cache = []
            self._carregar_setores_async()
            self._definir_status(
                f"Setor {status}. Republique a base atual para aplicar nos celulares.", "aviso"
            )
        except Exception as erro:
            messagebox.showerror("Erro ao alterar setor", str(erro), parent=self)

    def _renderizar_historico(self):
        if not hasattr(self, "arvore_historico"):
            return
        for item in self.arvore_historico.get_children():
            self.arvore_historico.delete(item)
        try:
            historico = carregar_controle_setores().get("historico", [])
        except Exception as erro:
            messagebox.showerror("Erro ao carregar histórico", str(erro), parent=self)
            return
        for registro in reversed(historico):
            self.arvore_historico.insert(
                "", "end",
                values=(
                    formatar_data(registro.get("alteradoEm")), registro.get("setor", "—"),
                    registro.get("acao", "—").upper(), registro.get("responsavel", "—"),
                    registro.get("observacao", "") or "—",
                ),
            )

    def _ler_fila(self):
        try:
            while True:
                tipo, valor = self.fila.get_nowait()
                if tipo == "log":
                    self._adicionar_log(valor)
                elif tipo == "fim":
                    self.processo = None
                    self._alternar_acoes(True)
                    self._atualizar_indicadores()
                    if valor == 0:
                        self._definir_status("Operação concluída com sucesso.", "sucesso")
                    else:
                        self._definir_status("Operação interrompida. Confira o relatório.", "erro")
                elif tipo == "setores":
                    self.setores_cache = valor
                    self.botao_atualizar_setores.configure(state="normal")
                    self._renderizar_setores()
                    self._definir_status("Lista de setores atualizada.", "sucesso")
                elif tipo == "erro_setores":
                    self.botao_atualizar_setores.configure(state="normal")
                    self.resumo_setores.set("Não foi possível carregar os setores.")
                    self._definir_status("Erro ao carregar setores.", "erro")
                    messagebox.showerror("Erro ao carregar setores", valor, parent=self)
        except queue.Empty:
            pass
        self.after(100, self._ler_fila)

    def _alternar_acoes(self, habilitar):
        estado = "normal" if habilitar else "disabled"
        for botao in self.botoes_acao:
            botao.configure(state=estado)
        if habilitar:
            self.progresso.stop()
        else:
            self.progresso.start(12)

    def _definir_status(self, mensagem, tipo="normal"):
        cores = {
            "normal": CORES["primaria"], "processando": CORES["primaria"],
            "sucesso": CORES["verde"], "aviso": CORES["amarelo"], "erro": CORES["vermelho"],
        }
        self.status.set(mensagem)
        self.status_ponto.configure(fg=cores.get(tipo, CORES["primaria"]))
        if tipo == "processando":
            self.progresso.start(12)
        elif not self.processo:
            self.progresso.stop()

    def _limpar_log(self):
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")

    def _adicionar_log(self, texto):
        tag = "erro" if "❌" in texto or "Erro" in texto else "aviso" if "⚠" in texto else "sucesso" if "✅" in texto else "normal"
        self.log.configure(state="normal")
        self.log.insert("end", texto, tag)
        self.log.see("end")
        self.log.configure(state="disabled")


if __name__ == "__main__":
    PublicadorDeep().mainloop()
