import queue
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk


PASTA_PROJETO = Path(__file__).resolve().parent
SCRIPT_PUBLICACAO = PASTA_PROJETO / "subir_google_drive.py"
EXCEL_PADRAO = PASTA_PROJETO / "data" / "REVISITAS_CENSO.xlsx"
BASE_ACUMULADA = PASTA_PROJETO / "data" / "BASE_ACUMULADA.xlsx"


class PublicadorDeep(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Publicador DEEP")
        self.geometry("820x560")
        self.minsize(680, 440)
        self.configure(bg="#F4F6FB")
        self.fila = queue.Queue()
        self.processo = None
        self.arquivo = tk.StringVar(value=str(EXCEL_PADRAO))
        self.status = tk.StringVar(value="Selecione o Excel recebido e valide antes de publicar.")
        self._montar_tela()
        self.after(100, self._ler_fila)

    def _montar_tela(self):
        estilo = ttk.Style(self)
        estilo.configure("Titulo.TLabel", font=("Segoe UI", 18, "bold"), foreground="#2D3580")
        estilo.configure("Acao.TButton", font=("Segoe UI", 10, "bold"), padding=9)

        conteudo = ttk.Frame(self, padding=24)
        conteudo.pack(fill="both", expand=True)
        ttk.Label(conteudo, text="Publicador DEEP", style="Titulo.TLabel").pack(anchor="w")
        ttk.Label(
            conteudo,
            text="Escolha o Excel novo. Os registros anteriores serão mantidos automaticamente.",
        ).pack(anchor="w", pady=(4, 18))

        linha_arquivo = ttk.Frame(conteudo)
        linha_arquivo.pack(fill="x")
        ttk.Entry(linha_arquivo, textvariable=self.arquivo).pack(side="left", fill="x", expand=True)
        ttk.Button(linha_arquivo, text="Escolher Excel", command=self._escolher_excel).pack(side="left", padx=(8, 0))

        botoes = ttk.Frame(conteudo)
        botoes.pack(fill="x", pady=14)
        self.botao_validar = ttk.Button(
            botoes, text="1. Validar somente", style="Acao.TButton",
            command=lambda: self._iniciar(validar_apenas=True),
        )
        self.botao_validar.pack(side="left")
        self.botao_publicar = ttk.Button(
            botoes, text="2. Adicionar e publicar", style="Acao.TButton",
            command=lambda: self._iniciar(validar_apenas=False),
        )
        self.botao_publicar.pack(side="left", padx=(10, 0))
        self.botao_republicar = ttk.Button(
            botoes, text="Republicar base com links S3", style="Acao.TButton",
            command=lambda: self._iniciar(validar_apenas=False, republicar_base=True),
        )
        self.botao_republicar.pack(side="left", padx=(10, 0))

        ttk.Label(conteudo, textvariable=self.status).pack(anchor="w", pady=(0, 8))
        quadro_log = ttk.Frame(conteudo)
        quadro_log.pack(fill="both", expand=True)
        self.log = tk.Text(
            quadro_log, wrap="word", state="disabled", font=("Consolas", 10),
            bg="#FFFFFF", fg="#1A1F3C", relief="solid", borderwidth=1,
        )
        barra = ttk.Scrollbar(quadro_log, orient="vertical", command=self.log.yview)
        self.log.configure(yscrollcommand=barra.set)
        self.log.pack(side="left", fill="both", expand=True)
        barra.pack(side="right", fill="y")

    def _escolher_excel(self):
        caminho = filedialog.askopenfilename(
            title="Selecione o Excel recebido",
            initialdir=str(Path(self.arquivo.get()).parent),
            filetypes=[("Planilhas Excel", "*.xlsx *.xls"), ("Todos os arquivos", "*.*")],
        )
        if caminho:
            self.arquivo.set(caminho)

    def _iniciar(self, validar_apenas, republicar_base=False):
        caminho = BASE_ACUMULADA if republicar_base else Path(self.arquivo.get().strip()).expanduser()
        if not caminho.is_file():
            messagebox.showerror("Arquivo não encontrado", "Selecione um arquivo Excel existente.")
            return
        mensagem_confirmacao = (
            "A base acumulada completa será republicada usando diretamente os links S3. "
            "As fotos no Drive não serão alteradas. Continuar?"
            if republicar_base else
            "Os registros novos serão adicionados à base acumulada. Nada antigo será removido. Continuar?"
        )
        if not validar_apenas and not messagebox.askyesno(
            "Confirmar publicação",
            mensagem_confirmacao,
        ):
            return

        self._alternar_botoes(False)
        self._limpar_log()
        self.status.set("Validando..." if validar_apenas else "Validando e publicando...")
        argumentos = [sys.executable, "-u", str(SCRIPT_PUBLICACAO), str(caminho)]
        if not republicar_base:
            argumentos.append("--incremental")
        if validar_apenas:
            argumentos.append("--validar-apenas")
        threading.Thread(target=self._executar, args=(argumentos,), daemon=True).start()

    def _executar(self, argumentos):
        try:
            self.processo = subprocess.Popen(
                argumentos,
                cwd=str(PASTA_PROJETO),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            assert self.processo.stdout is not None
            for linha in self.processo.stdout:
                self.fila.put(("log", linha))
            codigo = self.processo.wait()
            self.fila.put(("fim", codigo))
        except Exception as erro:
            self.fila.put(("log", f"\nErro ao iniciar o publicador: {erro}\n"))
            self.fila.put(("fim", 1))

    def _ler_fila(self):
        try:
            while True:
                tipo, valor = self.fila.get_nowait()
                if tipo == "log":
                    self._adicionar_log(valor)
                elif tipo == "fim":
                    self._alternar_botoes(True)
                    if valor == 0:
                        self.status.set("Operação concluída com sucesso.")
                    else:
                        self.status.set("Operação interrompida. Confira o erro no relatório abaixo.")
        except queue.Empty:
            pass
        self.after(100, self._ler_fila)

    def _alternar_botoes(self, habilitar):
        estado = "normal" if habilitar else "disabled"
        self.botao_validar.configure(state=estado)
        self.botao_publicar.configure(state=estado)
        self.botao_republicar.configure(state=estado)

    def _limpar_log(self):
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")

    def _adicionar_log(self, texto):
        self.log.configure(state="normal")
        self.log.insert("end", texto)
        self.log.see("end")
        self.log.configure(state="disabled")


if __name__ == "__main__":
    PublicadorDeep().mainloop()
